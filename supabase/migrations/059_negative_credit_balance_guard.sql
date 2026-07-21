-- ============================================================================
-- Migration 059 — Phase 2 Billing-Period Integrity, Part 2: negative-counter
-- guard (defense-in-depth) for job_credit_balance in select_quote_atomic.
--
-- providers.job_credit_balance already has CHECK (job_credit_balance >= 0)
-- (migration 008 — verified against the live migration file) and the
-- existing decrement site in select_quote_atomic (migration 057) is already
-- read-guarded (only decrements when job_credit_balance > 0, under the
-- provider row's FOR UPDATE lock taken earlier in the same function) —
-- verified: across every migration, select_quote_atomic (057) is the ONLY
-- site that performs an arithmetic `job_credit_balance - 1` write. This
-- migration adds GREATEST(0, ...) at that single site as defense-in-depth
-- against any future change to the surrounding guard logic. The CHECK
-- constraint is verified present here, not re-added.
--
-- Deeper cancellation-attribution defects remain a separate backlog item
-- (out of scope here).
--
-- Split from migration 058 for a clean rollback boundary (058 is the
-- billing-period package; this is an unrelated DB-function hardening
-- change).
--
-- Idempotent: CREATE OR REPLACE FUNCTION (signature/return shape unchanged
-- from migration 057), followed by unconditional REVOKE/GRANT restoring the
-- migration-057 baseline. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 059.0 Verify-first assertions
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'select_quote_atomic'
  ) THEN
    RAISE EXCEPTION 'Migration 059 aborted: public.select_quote_atomic not found — re-verify the live function before proceeding.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'providers'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%job_credit_balance%>= 0%'
  ) THEN
    RAISE EXCEPTION 'Migration 059 aborted: expected CHECK (job_credit_balance >= 0) constraint (migration 008) not found on public.providers.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 059.1 select_quote_atomic — floor-at-zero on the credit decrement.
-- Body is byte-identical to migration 057 EXCEPT the single line noted below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.select_quote_atomic(
  p_customer_id UUID,
  p_request_id  UUID,
  p_quote_id    UUID
)
RETURNS TABLE (
  success          BOOLEAN,
  reason           TEXT,
  provider_name    TEXT,
  provider_phone   TEXT,
  provider_rating  NUMERIC,
  payment_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request       requests%ROWTYPE;
  v_quote         request_quotes%ROWTYPE;
  v_provider      providers%ROWTYPE;
  v_user          users%ROWTYPE;
  v_provider_id   UUID;
  v_monthly_limit INT;
BEGIN
  SELECT * INTO v_request FROM requests
  WHERE id = p_request_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_request.status <> 'quoted' THEN
    RETURN QUERY SELECT FALSE, 'request_not_in_quoted_status'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  SELECT * INTO v_quote FROM request_quotes
  WHERE id = p_quote_id AND request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'quote_not_found'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_quote.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'quote_not_pending'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_quote.expires_at < now() THEN
    RETURN QUERY SELECT FALSE, 'quote_expired'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  v_provider_id := v_quote.provider_id;

  SELECT * INTO v_provider FROM providers
  WHERE id = v_provider_id
  FOR UPDATE;

  IF v_provider.plan = 'pay_per_job' THEN
    UPDATE requests
    SET status                    = 'selected_pending_payment',
        accepted_by               = v_provider_id,
        selected_quote_id         = p_quote_id,
        payment_window_started_at = now(),
        last_release_reason       = NULL,
        accepted_at               = NULL
    WHERE id = p_request_id;

    UPDATE request_quotes
    SET status = 'selected', selected_at = now()
    WHERE id = p_quote_id;

    UPDATE provider_dispatch_log
    SET was_selected = TRUE
    WHERE provider_id = v_provider_id
      AND request_id = p_request_id
      AND event_type = 'quote_submitted';

    RETURN QUERY SELECT TRUE, 'selected_pending_payment'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, TRUE;
    RETURN;
  END IF;

  SELECT monthly_limit INTO v_monthly_limit
  FROM public.get_provider_limits(v_provider.plan);

  IF v_monthly_limit IS NOT NULL
     AND COALESCE(v_provider.jobs_this_month, 0) >= v_monthly_limit
     AND NOT COALESCE(v_request.overage_cleared, FALSE)
  THEN
    IF COALESCE(v_provider.job_credit_balance, 0) > 0 THEN
      -- 059: GREATEST(0, ...) floor — defense-in-depth. The IF guard above and
      -- the FOR UPDATE lock already make a negative value unreachable in
      -- practice; this makes it structurally unreachable regardless of any
      -- future change to the surrounding guard.
      UPDATE providers
      SET job_credit_balance = GREATEST(0, job_credit_balance - 1)
      WHERE id = v_provider_id;
    ELSE
      RETURN QUERY SELECT FALSE, 'overage_required'::TEXT,
        NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
      RETURN;
    END IF;
  END IF;

  UPDATE requests
  SET status            = 'accepted',
      accepted_by       = v_provider_id,
      selected_quote_id = p_quote_id,
      accepted_at       = now()
  WHERE id = p_request_id;

  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND id <> p_quote_id
    AND status = 'pending';

  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, v_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

  UPDATE providers
  SET jobs_this_month = COALESCE(jobs_this_month, 0) + 1
  WHERE id = v_provider_id;

  UPDATE provider_dispatch_log
  SET was_selected = TRUE
  WHERE provider_id = v_provider_id
    AND request_id = p_request_id
    AND event_type = 'quote_submitted';

  SELECT * INTO v_user FROM users WHERE id = v_provider_id;

  RETURN QUERY SELECT TRUE, 'selected'::TEXT,
    v_user.name, v_user.phone, v_provider.rating, FALSE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 059.2 Grants — restore the verified 057 baseline exactly.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) TO service_role;

COMMIT;
