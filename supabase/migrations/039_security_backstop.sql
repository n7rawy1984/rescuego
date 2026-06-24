-- Migration 039 — Security Backstop (Batch 1)
-- Database-level enforcement for the existential security findings.
--
-- Contents:
--   C2  — BEFORE UPDATE trigger on users: block self-escalation of `role`.
--   C3  — BEFORE UPDATE trigger on providers: lock sensitive billing/KYC columns.
--   C5  — Re-enable fair-price validation in submit_quote_atomic (D2: configurable
--         bounds from fair_price_config, no hard-coded values).
--   D8  — Add fuzzy_latitude / fuzzy_longitude to get_nearby_open_requests.
--   F3-H1 — Add overage_payments.accept_failed for manual-review tracking.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER/POLICY IF EXISTS,
-- ADD COLUMN IF NOT EXISTS. Safe to re-run.

-- ============================================================
-- Helper: detect genuine service_role (server-side) context.
-- auth.uid() IS NULL is NOT sufficient — the anon role also has a
-- NULL uid. We inspect the JWT `role` claim so anonymous/authenticated
-- browser contexts can never satisfy the server-side guard. Fails closed
-- when the claims GUC is unset.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO anon, authenticated, service_role;

-- ============================================================
-- C2 — users.role immutability
-- RLS policy "Users update own data" gates row ownership; this trigger
-- gates the privilege column. Both OLD and NEW are needed, which only a
-- trigger can provide (WITH CHECK sees NEW only).
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_users_immutable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_service_role()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role_change_not_allowed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_immutable_columns ON public.users;
CREATE TRIGGER trg_users_immutable_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_users_immutable_columns();

-- ============================================================
-- C3 — providers sensitive-column immutability
-- A provider may edit normal profile fields but cannot self-activate,
-- change plan, or tamper with billing/allowance/KYC columns.
-- NOTE: max_active_jobs and completed_jobs_count intentionally omitted —
-- those columns do not exist on the providers table (verified against the
-- full migration history). The plan ceiling is derived from `plan`, which
-- is itself protected here.
-- ============================================================

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
    THEN
      RAISE EXCEPTION 'provider_protected_field_change_not_allowed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_providers_immutable_columns ON public.providers;
CREATE TRIGGER trg_providers_immutable_columns
  BEFORE UPDATE ON public.providers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_providers_immutable_columns();

-- ============================================================
-- F3-H1 — overage payment manual-review flag
-- Set TRUE when a paid overage accept fails (e.g. request taken in a race)
-- so admins have a DB-queryable signal. No automatic refund logic here.
-- ============================================================

ALTER TABLE public.overage_payments
  ADD COLUMN IF NOT EXISTS accept_failed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_overage_payments_accept_failed
  ON public.overage_payments(accept_failed)
  WHERE accept_failed = true;

-- ============================================================
-- C5 — Re-enable fair-price validation in submit_quote_atomic (D2)
-- Bounds come exclusively from fair_price_config (no hard-coded prices).
-- Fallback policy:
--   - no row for the request's service_type  -> use the 'other' config row
--   - no config row at all (v_config.id NULL) -> skip range check, validity=10
--     (fail-open on validity only; an attacker cannot force this state because
--      seed rows always exist; a missing-all-config state is an ops error, and
--      rejecting honest providers there would harm availability).
-- All other steps preserved from migration 032.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_quote_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_proposed_price NUMERIC(10,2),
  p_distance_km NUMERIC(6,2) DEFAULT 0,
  p_is_soft_launch BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  quote_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_provider providers%ROWTYPE;
  v_config fair_price_config%ROWTYPE;
  v_active_count INTEGER;
  v_daily_count INTEGER;
  v_max_active INTEGER;
  v_daily_limit INTEGER;
  v_quote_id UUID;
  v_validity_minutes INTEGER;
  v_is_first_quote BOOLEAN;
  v_price_per_km NUMERIC(8,2);
  v_min_fair NUMERIC(10,2);
  v_max_fair NUMERIC(10,2);
BEGIN
  -- 1. Lock and validate request
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_request.status NOT IN ('open', 'quoted') THEN
    RETURN QUERY SELECT FALSE, 'request_not_quotable'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 2. Lock and validate provider
  SELECT * INTO v_provider
  FROM providers
  WHERE id = p_provider_id
  FOR UPDATE;

  IF NOT FOUND OR v_provider.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, 'provider_not_active'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 3. Check existing quote from this provider
  IF EXISTS (
    SELECT 1 FROM request_quotes
    WHERE request_id = p_request_id AND provider_id = p_provider_id
  ) THEN
    RETURN QUERY SELECT FALSE, 'already_quoted'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 4. Determine plan limits
  v_max_active := CASE v_provider.plan
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 2
    WHEN 'business' THEN 5
    WHEN 'pay_per_job' THEN 1
    ELSE 1
  END;

  v_daily_limit := CASE v_provider.plan
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 10
    WHEN 'business' THEN 20
    WHEN 'pay_per_job' THEN 3
    ELSE 3
  END;

  -- 5. Check active job capacity
  SELECT COUNT(*) INTO v_active_count
  FROM requests
  WHERE accepted_by = p_provider_id
    AND status IN ('accepted', 'en_route', 'arrived', 'in_progress');

  IF v_active_count >= v_max_active THEN
    RETURN QUERY SELECT FALSE, 'capacity_full'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 6. Check daily quote limit (quotes sent today)
  SELECT COUNT(*) INTO v_daily_count
  FROM request_quotes
  WHERE provider_id = p_provider_id
    AND sent_at::DATE = CURRENT_DATE;

  IF v_daily_count >= v_daily_limit THEN
    RETURN QUERY SELECT FALSE, 'daily_limit_reached'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 7. Validate price range from fair_price_config (C5 / D2 re-enabled)
  SELECT * INTO v_config
  FROM fair_price_config
  WHERE service_type = v_request.problem_type;

  IF NOT FOUND THEN
    SELECT * INTO v_config
    FROM fair_price_config
    WHERE service_type = 'other';
  END IF;

  IF v_config.id IS NOT NULL THEN
    v_min_fair := v_config.base_fee + (p_distance_km * v_config.min_price_per_km);
    v_max_fair := v_config.base_fee + (p_distance_km * v_config.max_price_per_km);

    IF p_proposed_price < v_min_fair THEN
      RETURN QUERY SELECT FALSE, 'price_too_low'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    IF p_proposed_price > v_max_fair THEN
      RETURN QUERY SELECT FALSE, 'price_too_high'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    v_validity_minutes := v_config.quote_validity_minutes;
  ELSE
    -- No config available at all: fail open on validity only (see header note).
    v_validity_minutes := 10;
  END IF;

  -- 8. Compute price_per_km for analytics
  IF p_distance_km > 0 THEN
    v_price_per_km := (p_proposed_price - COALESCE(v_config.base_fee, 0)) / p_distance_km;
  ELSE
    v_price_per_km := NULL;
  END IF;

  -- 9. Insert quote
  INSERT INTO request_quotes (request_id, provider_id, proposed_price, expires_at)
  VALUES (
    p_request_id,
    p_provider_id,
    p_proposed_price,
    now() + (v_validity_minutes || ' minutes')::INTERVAL
  )
  RETURNING id INTO v_quote_id;

  -- 10. If first quote, update request status to 'quoted'
  v_is_first_quote := (v_request.status = 'open');
  IF v_is_first_quote THEN
    UPDATE requests
    SET status = 'quoted',
        quoted_at = now()
    WHERE id = p_request_id;
  END IF;

  -- 11. Log to dispatch log
  INSERT INTO provider_dispatch_log (
    provider_id, request_id, distance_km, proposed_price,
    service_type, price_per_km, is_soft_launch, event_type
  ) VALUES (
    p_provider_id, p_request_id, p_distance_km, p_proposed_price,
    v_request.problem_type, v_price_per_km, p_is_soft_launch, 'quote_submitted'
  );

  RETURN QUERY SELECT TRUE, 'quote_submitted'::TEXT, v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO service_role;

-- ============================================================
-- D8 — get_nearby_open_requests: add fuzzy_latitude / fuzzy_longitude
-- The primary RPC path (migration 035) omitted these, breaking the
-- emirate/area badge in the provider dashboard. Preserve all existing
-- returned columns (including destination + destination_area from 035).
-- Drop then recreate because the return type changes.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_nearby_open_requests(integer, integer, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_nearby_open_requests(
  p_radius integer DEFAULT 5000,
  p_limit integer DEFAULT 20,
  p_stale_threshold timestamp with time zone DEFAULT (now() - '00:05:00'::interval)
)
RETURNS TABLE(
  id uuid,
  customer_id uuid,
  location_address text,
  problem_type text,
  note text,
  status text,
  accepted_by uuid,
  price_estimate_min integer,
  price_estimate_max integer,
  final_price integer,
  created_at timestamptz,
  distance_meters double precision,
  destination text,
  destination_area text,
  fuzzy_latitude numeric,
  fuzzy_longitude numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH current_provider AS (
    SELECT pl.location
    FROM providers p
    JOIN provider_locations pl ON pl.provider_id = p.id
    WHERE
      p.id = auth.uid()
      AND p.status = 'active'
      AND pl.updated_at >= p_stale_threshold
    LIMIT 1
  )
  SELECT
    r.id,
    NULL::UUID AS customer_id,
    NULL::TEXT AS location_address,
    r.problem_type,
    NULL::TEXT AS note,
    r.status,
    r.accepted_by,
    r.price_estimate_min,
    r.price_estimate_max,
    NULL::INTEGER AS final_price,
    r.created_at,
    ST_Distance(r.location::geography, cp.location::geography) AS distance_meters,
    r.destination,
    r.destination_area,
    r.fuzzy_latitude,
    r.fuzzy_longitude
  FROM requests r
  CROSS JOIN current_provider cp
  WHERE
    r.status IN ('open', 'quoted')
    AND r.accepted_by IS NULL
    AND ST_DWithin(r.location::geography, cp.location::geography, p_radius)
  ORDER BY distance_meters ASC, r.created_at DESC
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_nearby_open_requests(integer, integer, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_open_requests(integer, integer, timestamp with time zone) TO authenticated, service_role;
