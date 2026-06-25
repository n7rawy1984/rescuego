-- Migration 040: RPC integrity & state-machine safety (Security Remediation Batch 2)
--
-- Addresses audit findings:
--   CRIT-01  Price-change request atomicity (new request_price_change_atomic RPC)
--   CRIT-02  SLA auto-release must also handle en_route/arrived breaches
--   HIGH-03  release_job_atomic must decrement jobs_this_month for consumed V2 slots
--   HIGH-04  SLA release must decrement jobs_this_month for V2 jobs (already correct; preserved)
--   HIGH-05  ratings.customer_id column + deterministic backfill
--   HIGH-06  Price-change response atomicity with in_progress guard inside the RPC
--   MED-04   release_job_atomic must return to quoted/open (shared helper), clear selected_quote_id
--   LOW-01   advance_provider_job_state must SET search_path = public
--   LOW-03   expire_stuck_active_requests must decrement jobs_this_month for consumed V2 slots
--   LOW-04   advance_provider_job_state must whitelist p_to_status values
--   F3-H2    release must clear overage_cleared so the next provider does not inherit a free slot
--   H1       select_quote_atomic must not leak provider KYC documents to the customer
--
-- ONE block per RPC. All RPCs keep SECURITY DEFINER, SET search_path = public,
-- and the revoke-from-anon/authenticated + grant-to-service_role pattern.
-- Idempotent: safe to re-run.
--
-- Schema verified (not assumed from docs):
--   requests.accepted_at        (031), requests.selected_quote_id (031),
--   requests.overage_cleared    (005), requests.price_change_*    (031)
--   jobs.en_route_at / jobs.arrived_at (025), providers.jobs_this_month (001)
--   ratings.customer_id         did NOT exist before this migration.

BEGIN;

-- ============================================================================
-- 2.1  Shared release-target helper (D6, MED-04)
--      READ-ONLY: returns the correct post-release status for a request.
--      'quoted' if at least one quote is still pending and not expired, else 'open'.
--      It must NOT modify any quote statuses or any row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_target_status(
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM request_quotes
    WHERE request_id = p_request_id
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RETURN 'quoted';
  END IF;
  RETURN 'open';
END;
$$;

REVOKE ALL ON FUNCTION public.release_target_status(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_target_status(UUID) TO service_role;

-- ============================================================================
-- 2.3  release_job_atomic  (HIGH-03 + MED-04 + F3-H2)  — single block
--      Preserves the existing (success, reason) return shape.
--      Changes:
--        - MED-04 : post-release status from release_target_status() (quoted/open)
--        - MED-04 : clear selected_quote_id on release
--        - F3-H2  : clear overage_cleared (next provider must not inherit a free slot)
--        - clear  : accepted_by, accepted_at (verified to exist) on release
--        - HIGH-03: decrement jobs_this_month ONLY when a V2 slot was consumed
--                   (selected_quote_id was present before release) — GREATEST(0, .. - 1)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_job_atomic(
  p_provider_id UUID,
  p_request_id  UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider          providers%ROWTYPE;
  v_request           requests%ROWTYPE;
  v_updated           UUID;
  v_slot_consumed     BOOLEAN := FALSE;
  v_target_status     TEXT;
BEGIN
  SELECT * INTO v_provider
  FROM providers
  WHERE id = p_provider_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'provider_not_found';
    RETURN;
  END IF;

  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_releasable';
    RETURN;
  END IF;

  -- Capture whether a V2 subscription slot was consumed BEFORE we clear it.
  v_slot_consumed := v_request.selected_quote_id IS NOT NULL;

  -- D6 / MED-04: return to 'quoted' if valid pending quotes remain, else 'open'.
  v_target_status := public.release_target_status(p_request_id);

  UPDATE requests
  SET status            = v_target_status,
      accepted_by       = NULL,
      selected_quote_id = NULL,   -- MED-04: do not leave stale selection
      accepted_at       = NULL,   -- clear stale accept timestamp
      overage_cleared   = FALSE   -- F3-H2: next provider must not inherit a free overage slot
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_status_changed';
    RETURN;
  END IF;

  UPDATE jobs
  SET commission_rate          = NULL,
      commission_amount        = NULL,
      stripe_payment_intent_id = NULL,
      en_route_at              = NULL,
      arrived_at               = NULL
  WHERE request_id  = p_request_id
    AND provider_id = p_provider_id
    AND completed_at IS NULL;

  DELETE FROM request_locks
  WHERE request_id = p_request_id;

  -- HIGH-03: only decrement the subscription allowance when a slot was actually consumed.
  UPDATE providers
  SET release_count                    = COALESCE(release_count, 0) + 1,
      provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1,
      jobs_this_month = CASE
        WHEN v_slot_consumed THEN GREATEST(0, COALESCE(jobs_this_month, 0) - 1)
        ELSE jobs_this_month
      END
  WHERE id = p_provider_id;

  RETURN QUERY SELECT TRUE, 'released';
END;
$$;

REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_job_atomic(UUID, UUID) TO service_role;

-- ============================================================================
-- 2.2  sla_check_and_release  (CRIT-02 + HIGH-04)  — single block
--      Preserves the existing (success, reason, released_provider_id, needs_refund)
--      return shape used by the marketplace-cron.
--      Changes:
--        - CRIT-02: release from status IN ('accepted','en_route','arrived')
--                   (was 'accepted' only). Breach is computed INSIDE the RPC against
--                   the timestamp appropriate to the current state.
--        - Thresholds (named constants, easy to tune later):
--                   accepted  -> 20 minutes vs requests.accepted_at
--                   en_route  -> 2 hours   vs jobs.en_route_at
--                   arrived   -> 60 minutes vs jobs.arrived_at
--        - D6     : post-release status from release_target_status() (quoted/open)
--        - HIGH-04: jobs_this_month decremented (GREATEST(0, .. - 1)) — preserved.
--                   No double-decrement: this RPC does not call release_job_atomic.
--        - clears : accepted_by, selected_quote_id, accepted_at + overage_cleared (F3-H2)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sla_check_and_release(
  p_request_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  released_provider_id UUID,
  needs_refund BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- SLA breach thresholds per state (tune here).
  c_accepted_threshold CONSTANT INTERVAL := INTERVAL '20 minutes';
  c_en_route_threshold CONSTANT INTERVAL := INTERVAL '2 hours';
  c_arrived_threshold  CONSTANT INTERVAL := INTERVAL '60 minutes';

  v_request      requests%ROWTYPE;
  v_provider     providers%ROWTYPE;
  v_provider_id  UUID;
  v_is_ppj       BOOLEAN;
  v_sla_failures INTEGER;
  v_new_status   TEXT;
  v_breach_time  TIMESTAMPTZ;   -- the relevant timestamp for the current state
  v_threshold    INTERVAL;
  v_breached     BOOLEAN := FALSE;
  v_slot_consumed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- CRIT-02: handle the active SLA states, not just 'accepted'.
  IF v_request.status NOT IN ('accepted', 'en_route', 'arrived') THEN
    RETURN QUERY SELECT FALSE, 'not_in_releasable_status'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  v_provider_id := v_request.accepted_by;

  -- Determine the breach timestamp + threshold for the current state.
  IF v_request.status = 'accepted' THEN
    v_breach_time := v_request.accepted_at;
    v_threshold   := c_accepted_threshold;
  ELSE
    -- en_route / arrived timestamps live on the jobs table.
    SELECT
      CASE WHEN v_request.status = 'en_route' THEN j.en_route_at ELSE j.arrived_at END
    INTO v_breach_time
    FROM jobs j
    WHERE j.request_id = p_request_id
      AND j.provider_id = v_provider_id
      AND j.completed_at IS NULL
    LIMIT 1;

    v_threshold := CASE WHEN v_request.status = 'en_route'
                        THEN c_en_route_threshold
                        ELSE c_arrived_threshold END;
  END IF;

  IF v_breach_time IS NULL OR (now() - v_breach_time) < v_threshold THEN
    RETURN QUERY SELECT FALSE, 'sla_not_breached'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  v_breached := TRUE;

  -- Capture slot consumption before clearing.
  v_slot_consumed := v_request.selected_quote_id IS NOT NULL;

  -- Mark the selected quote as rejected (if any selection exists).
  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND provider_id = v_provider_id
    AND status = 'selected';

  -- D6: return to 'quoted' if valid pending quotes remain, else 'open'.
  v_new_status := public.release_target_status(p_request_id);

  UPDATE requests
  SET status            = v_new_status,
      accepted_by       = NULL,
      selected_quote_id = NULL,
      accepted_at       = NULL,
      overage_cleared   = FALSE   -- F3-H2
  WHERE id = p_request_id;

  -- Delete the active job record for this provider.
  DELETE FROM jobs
  WHERE request_id = p_request_id
    AND provider_id = v_provider_id
    AND completed_at IS NULL;

  -- Penalize provider; HIGH-04: decrement subscription allowance only when consumed.
  SELECT * INTO v_provider
  FROM providers
  WHERE id = v_provider_id
  FOR UPDATE;

  v_is_ppj       := (v_provider.plan = 'pay_per_job');
  v_sla_failures := COALESCE(v_provider.sla_failure_count, 0) + 1;

  UPDATE providers
  SET sla_failure_count = v_sla_failures,
      jobs_this_month = CASE
        WHEN v_slot_consumed THEN GREATEST(0, COALESCE(jobs_this_month, 0) - 1)
        ELSE jobs_this_month
      END,
      visibility_reduced = CASE WHEN v_sla_failures >= 3 THEN TRUE ELSE visibility_reduced END
  WHERE id = v_provider_id;

  INSERT INTO provider_dispatch_log (
    provider_id, request_id, sla_met, event_type, is_soft_launch
  ) VALUES (
    v_provider_id, p_request_id, FALSE, 'sla_failure',
    COALESCE(current_setting('app.soft_launch_mode', TRUE), 'false') = 'true'
  );

  RETURN QUERY SELECT TRUE, 'released'::TEXT, v_provider_id, v_is_ppj;
END;
$$;

REVOKE ALL ON FUNCTION public.sla_check_and_release(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sla_check_and_release(UUID) TO service_role;

-- ============================================================================
-- 2.4  expire_stuck_active_requests  (LOW-03)  — single block
--      Preserves RETURNS INTEGER and the (p_stuck_cutoff TIMESTAMPTZ) signature.
--      Change: decrement jobs_this_month for V2 jobs (selected_quote_id present)
--              released by this weekly cleanup. GREATEST(0, .. - 1), no double-decrement.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_stuck_active_requests(
  p_stuck_cutoff TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row   RECORD;
BEGIN
  FOR v_row IN
    SELECT r.id AS request_id,
           r.accepted_by AS provider_id,
           (r.selected_quote_id IS NOT NULL) AS slot_consumed
    FROM requests r
    WHERE r.status IN ('accepted', 'en_route', 'arrived')
      AND r.updated_at < p_stuck_cutoff
      AND r.accepted_by IS NOT NULL
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE requests
    SET status            = 'open',
        accepted_by       = NULL,
        selected_quote_id = NULL,
        accepted_at       = NULL,
        overage_cleared   = FALSE
    WHERE id = v_row.request_id;

    UPDATE jobs
    SET commission_rate = NULL,
        commission_amount = NULL,
        stripe_payment_intent_id = NULL,
        en_route_at = NULL,
        arrived_at = NULL
    WHERE request_id = v_row.request_id
      AND provider_id = v_row.provider_id
      AND completed_at IS NULL;

    DELETE FROM request_locks
    WHERE request_id = v_row.request_id;

    -- LOW-03: decrement subscription allowance only when a slot was consumed.
    UPDATE providers
    SET release_count = COALESCE(release_count, 0) + 1,
        provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1,
        jobs_this_month = CASE
          WHEN v_row.slot_consumed THEN GREATEST(0, COALESCE(jobs_this_month, 0) - 1)
          ELSE jobs_this_month
        END
    WHERE id = v_row.provider_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- 2.5  advance_provider_job_state  (LOW-01 + LOW-04)  — single block
--      LOW-01: add SET search_path = public.
--      LOW-04: whitelist p_to_status to the valid forward transitions.
--      Signature + return shape preserved.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.advance_provider_job_state(
  p_provider_id UUID,
  p_request_id  UUID,
  p_from_status TEXT,
  p_to_status   TEXT,
  p_timestamp_field TEXT  -- 'en_route_at' | 'arrived_at' | NULL
)
RETURNS TABLE (
  success     BOOLEAN,
  reason      TEXT,
  next_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected INTEGER;
  v_now      TIMESTAMPTZ := now();
BEGIN
  -- LOW-04: only allow advancing into a known forward state.
  IF p_to_status NOT IN ('en_route', 'arrived', 'in_progress') THEN
    RETURN QUERY SELECT FALSE, 'invalid_target_status'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.requests
  SET    status = p_to_status
  WHERE  id          = p_request_id
    AND  accepted_by = p_provider_id
    AND  status      = p_from_status;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected = 0 THEN
    RETURN QUERY SELECT FALSE, 'no_matching_request'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF p_timestamp_field = 'en_route_at' THEN
    UPDATE public.jobs
    SET    en_route_at = v_now
    WHERE  request_id  = p_request_id
      AND  provider_id = p_provider_id;
  ELSIF p_timestamp_field = 'arrived_at' THEN
    UPDATE public.jobs
    SET    arrived_at  = v_now
    WHERE  request_id  = p_request_id
      AND  provider_id = p_provider_id;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, p_to_status;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_provider_job_state(UUID, UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_provider_job_state(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- 2.6  request_price_change_atomic  (CRIT-01)  — new RPC
--      Atomic count-check + update in a single statement; no race window.
--      One price change per job total: guarded by price_change_count = 0.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_price_change_atomic(
  p_provider_id UUID,
  p_request_id  UUID,
  p_new_price   NUMERIC
)
RETURNS TABLE (
  success BOOLEAN,
  reason  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
BEGIN
  UPDATE requests
  SET price_change_count     = price_change_count + 1,
      price_change_requested = p_new_price,
      price_change_status    = 'pending'
  WHERE id                = p_request_id
    AND accepted_by       = p_provider_id
    AND status            = 'in_progress'
    AND price_change_count = 0
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT FALSE, 'price_change_not_allowed'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'requested'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.request_price_change_atomic(UUID, UUID, NUMERIC) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_price_change_atomic(UUID, UUID, NUMERIC) TO service_role;

-- ============================================================================
-- 2.7  respond_price_change_atomic  (HIGH-06)  — new RPC
--      Customer approve/reject with the status='in_progress' guard INSIDE the RPC.
--      Rules:
--        - approve -> price_change_status='approved', final_price = price_change_requested
--        - reject  -> price_change_status='rejected', final_price = NULL
--                     (never writes the requested price as final)
--        - price_change_count is NOT touched here -> stays 1 after either response,
--          so no second price-change request is possible.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.respond_price_change_atomic(
  p_customer_id UUID,
  p_request_id  UUID,
  p_action      TEXT   -- 'approve' | 'reject'
)
RETURNS TABLE (
  success     BOOLEAN,
  reason      TEXT,
  final_price NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_status TEXT;
  v_requested  NUMERIC;
  v_updated    UUID;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN QUERY SELECT FALSE, 'invalid_action'::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  v_new_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE requests
  SET price_change_status = v_new_status
  WHERE id                  = p_request_id
    AND customer_id         = p_customer_id
    AND status              = 'in_progress'        -- HIGH-06: guard inside the RPC
    AND price_change_status = 'pending'
  RETURNING price_change_requested INTO v_requested;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN QUERY SELECT FALSE, 'no_pending_price_change'::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  -- approve returns the agreed price; reject never surfaces the requested price as final.
  RETURN QUERY SELECT
    TRUE,
    'responded'::TEXT,
    CASE WHEN p_action = 'approve' THEN v_requested ELSE NULL::NUMERIC END;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_price_change_atomic(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_price_change_atomic(UUID, UUID, TEXT) TO service_role;

-- ============================================================================
-- 2.8  ratings.customer_id  (HIGH-05)
--      Add the column + index, then deterministically backfill existing rows
--      via jobs -> requests. Each rating maps to exactly one job (ratings.job_id
--      is UNIQUE, migration 022) and each job maps to exactly one request, so the
--      customer is unambiguous. New rows are populated by the API route.
-- ============================================================================
ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_ratings_customer_id ON public.ratings(customer_id);

UPDATE public.ratings r
SET customer_id = req.customer_id
FROM jobs j
JOIN requests req ON req.id = j.request_id
WHERE r.job_id = j.id
  AND r.customer_id IS NULL
  AND req.customer_id IS NOT NULL;

-- ============================================================================
-- 2.9  select_quote_atomic  (H1)  — single block
--      Remove provider_documents (KYC paths) from the return value.
--      Customer still receives provider name, phone, rating — NOT the documents.
--      Return shape changes from 6 -> 5 columns; the route is updated to match.
-- ============================================================================
DROP FUNCTION IF EXISTS public.select_quote_atomic(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.select_quote_atomic(
  p_customer_id UUID,
  p_request_id UUID,
  p_quote_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  provider_name TEXT,
  provider_phone TEXT,
  provider_rating NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_quote request_quotes%ROWTYPE;
  v_provider_id UUID;
  v_provider providers%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_request.status <> 'quoted' THEN
    RETURN QUERY SELECT FALSE, 'request_not_in_quoted_status'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  SELECT * INTO v_quote
  FROM request_quotes
  WHERE id = p_quote_id
    AND request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'quote_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_quote.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'quote_not_pending'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_quote.expires_at < now() THEN
    RETURN QUERY SELECT FALSE, 'quote_expired'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  v_provider_id := v_quote.provider_id;

  UPDATE requests
  SET status = 'accepted',
      accepted_by = v_provider_id,
      selected_quote_id = p_quote_id,
      accepted_at = now()
  WHERE id = p_request_id;

  UPDATE request_quotes
  SET status = 'selected',
      selected_at = now()
  WHERE id = p_quote_id;

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

  SELECT * INTO v_provider
  FROM providers
  WHERE id = v_provider_id;

  SELECT * INTO v_user
  FROM users
  WHERE id = v_provider_id;

  -- H1: provider documents (KYC paths) are intentionally NOT returned.
  RETURN QUERY SELECT
    TRUE,
    'selected'::TEXT,
    v_user.name,
    v_user.phone,
    v_provider.rating;
END;
$$;

REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) TO service_role;

COMMIT;
