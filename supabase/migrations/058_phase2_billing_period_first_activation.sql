-- ============================================================================
-- Migration 058 — Phase 2 Billing-Period Integrity, Part 1: first-activation
-- marker + mandatory backfill + immutable-column protection + atomic
-- initialization RPC.
--
-- Root cause (fixed in the same deploy, application layer): Stripe's SDK/API
-- (stripe npm v22 / API 2025+) moved current_period_start/current_period_end
-- off the top-level Subscription object onto each subscription item. The
-- webhook's previous top-level read always resolved to undefined, so
-- stripe_current_period_start/end were silently written NULL on every
-- activation and renewal — which would have permanently broken the monthly
-- jobs_this_month reset once real billing periods rolled over. Phase 1
-- already backfilled the 5 existing subscribed providers with real Stripe
-- period dates (scripts/backfill-billing-period.mjs); this migration adds
-- the durable "already initialized" marker so no future webhook delivery can
-- ever re-zero jobs_this_month / re-set jobs_reset_at for a provider that has
-- already been initialized once.
--
-- Verify-first (run before applying):
--   SELECT pg_get_functiondef('public.enforce_providers_immutable_columns()'::regprocedure);
-- Confirm the live body matches migration 039 exactly before this migration
-- extends its protected-column list.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, backfill only touches rows with
-- first_activation_at IS NULL, CREATE OR REPLACE FUNCTION. Safe to re-run
-- (the backfill UPDATE affects 0 rows on a second run since
-- first_activation_at will no longer be NULL for those providers).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 058.0 Verify-first assertions
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enforce_providers_immutable_columns'
  ) THEN
    RAISE EXCEPTION 'Migration 058 aborted: public.enforce_providers_immutable_columns not found (expected from migration 039).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'stripe_current_period_start'
  ) THEN
    RAISE EXCEPTION 'Migration 058 aborted: public.providers.stripe_current_period_start not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'stripe_subscription_id'
  ) THEN
    RAISE EXCEPTION 'Migration 058 aborted: public.providers.stripe_subscription_id not found.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 058.1 Marker column (Q2)
-- ----------------------------------------------------------------------------
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS first_activation_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 058.2 Mandatory backfill — BEFORE the trigger protects the column.
-- Predicate: plan IN ('starter','pro','business') AND stripe_subscription_id
-- IS NOT NULL AND first_activation_at IS NULL. Expected affected-row count:
-- 5 (the same 5 providers backfilled with real Stripe period dates in
-- Phase 1 — see scripts/backfill-billing-period.mjs). Any matching row with
-- a NULL stripe_current_period_start is a blocking anomaly: fail loudly
-- instead of inventing an activation timestamp.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_matched_count   INT;
  v_anomalous_count INT;
BEGIN
  SELECT COUNT(*) INTO v_matched_count
  FROM public.providers
  WHERE plan IN ('starter','pro','business')
    AND stripe_subscription_id IS NOT NULL
    AND first_activation_at IS NULL;

  SELECT COUNT(*) INTO v_anomalous_count
  FROM public.providers
  WHERE plan IN ('starter','pro','business')
    AND stripe_subscription_id IS NOT NULL
    AND first_activation_at IS NULL
    AND stripe_current_period_start IS NULL;

  RAISE NOTICE 'Migration 058 backfill: % matching provider(s), % anomalous (NULL stripe_current_period_start)', v_matched_count, v_anomalous_count;

  IF v_anomalous_count > 0 THEN
    RAISE EXCEPTION 'Migration 058 aborted: % subscribed provider(s) matched the backfill predicate with a NULL stripe_current_period_start — refusing to invent an activation timestamp. Investigate before re-running.', v_anomalous_count;
  END IF;

  UPDATE public.providers
  SET first_activation_at = stripe_current_period_start
  WHERE plan IN ('starter','pro','business')
    AND stripe_subscription_id IS NOT NULL
    AND first_activation_at IS NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 058.3 Extend the C3 immutable-column trigger (migration 039) to protect
-- first_activation_at. CREATE OR REPLACE preserves the existing trigger
-- binding (trg_providers_immutable_columns) — no DROP TRIGGER needed. The
-- initialization RPC below runs via the service_role client, so
-- is_service_role() returns true and its writes still pass (same proven
-- pattern as select_quote_atomic / admin_update_provider_status_atomic).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_providers_immutable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_service_role()) THEN
    IF (NEW.status IS DISTINCT FROM OLD.status)
       OR (NEW.verified_badge IS DISTINCT FROM OLD.verified_badge)
       OR (NEW.rating IS DISTINCT FROM OLD.rating)
       OR (NEW.plan IS DISTINCT FROM OLD.plan)
       OR (NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id)
       OR (NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id)
       OR (NEW.stripe_current_period_start IS DISTINCT FROM OLD.stripe_current_period_start)
       OR (NEW.stripe_current_period_end IS DISTINCT FROM OLD.stripe_current_period_end)
       OR (NEW.jobs_this_month IS DISTINCT FROM OLD.jobs_this_month)
       OR (NEW.jobs_reset_at IS DISTINCT FROM OLD.jobs_reset_at)
       OR (NEW.visibility_reduced IS DISTINCT FROM OLD.visibility_reduced)
       OR (NEW.sla_failure_count IS DISTINCT FROM OLD.sla_failure_count)
       OR (NEW.job_credit_balance IS DISTINCT FROM OLD.job_credit_balance)
       OR (NEW.ppj_recovery_credits IS DISTINCT FROM OLD.ppj_recovery_credits)
       OR (NEW.release_count IS DISTINCT FROM OLD.release_count)
       OR (NEW.provider_side_cancellation_count IS DISTINCT FROM OLD.provider_side_cancellation_count)
       OR (NEW.unable_to_complete_count IS DISTINCT FROM OLD.unable_to_complete_count)
       OR (NEW.last_upgrade_bonus_key IS DISTINCT FROM OLD.last_upgrade_bonus_key)
       OR (NEW.documents IS DISTINCT FROM OLD.documents)
       OR (NEW.first_activation_at IS DISTINCT FROM OLD.first_activation_at)
    THEN
      RAISE EXCEPTION 'provider_protected_field_change_not_allowed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 058.4 Atomic first-activation initialization RPC (Q3)
-- Single atomic conditional UPDATE: only applies when this provider has never
-- been initialized (first_activation_at IS NULL) AND its status is the app's
-- one authoritative "activated" status (providers.status = 'active' — the
-- only value the webhook's resolveStripeStatus() ever transitions a
-- non-KYC-protected provider to; verified against
-- src/app/api/stripe/webhook/route.ts and the providers.status CHECK
-- constraint). Never touches job_credit_balance. The RETURNING clause is the
-- affected-row proof of which invocation won: concurrent/duplicate callers
-- (webhook retries, duplicate Stripe deliveries) see initialized = FALSE with
-- no further writes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_first_subscription_atomic(
  p_provider_id  UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end   TIMESTAMPTZ
)
RETURNS TABLE (
  success     BOOLEAN,
  initialized BOOLEAN,
  reason      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF p_provider_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, 'invalid_arguments'::TEXT;
    RETURN;
  END IF;

  UPDATE public.providers
  SET jobs_this_month             = 0,
      jobs_reset_at               = p_period_start,
      stripe_current_period_start = p_period_start,
      stripe_current_period_end   = p_period_end,
      first_activation_at         = now()
  WHERE id = p_provider_id
    AND first_activation_at IS NULL
    AND status = 'active'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT TRUE, FALSE, 'not_eligible_or_already_initialized'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, TRUE, 'initialized'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_first_subscription_atomic(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.initialize_first_subscription_atomic(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
-- Callable role proof: called exclusively from
-- src/app/api/stripe/webhook/route.ts via the admin (service_role) Supabase
-- client, immediately after the subscription-sync provider update succeeds.

COMMIT;
