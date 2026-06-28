-- ============================================================================
-- Migration 045 — PPJ post-selection fee gate (re-enable Pay Per Job, new model)
-- ============================================================================
--
-- MODEL (see DEFERRED_PRODUCT_BACKLOG.md P7):
--   PPJ providers quote like everyone (submit_quote_atomic unchanged). The only
--   difference is at/after customer selection:
--     - Subscriber (starter/pro/business): selection assigns immediately and
--       reveals contact details — EXACTLY as today (this path is preserved
--       byte-for-byte below).
--     - pay_per_job: selection puts the request in 'selected_pending_payment',
--       withholds contact details, holds competing quotes as 'pending' (NOT
--       rejected), and opens a 10-minute payment window. On fee payment the
--       webhook calls finalize_ppj_selection_atomic (status -> 'accepted',
--       accepted_at = now() => SLA starts only here). If unpaid after 10 min,
--       the cron calls expire_ppj_payment_selection_atomic (release back to
--       'quoted'/'open', NO SLA penalty, customer told why via a reason flag).
--
-- SAFETY (Batch 1-4 preserved):
--   - H1: no provider KYC documents are ever returned (only name/phone/rating).
--   - CRIT-02 SLA: sla_check_and_release only acts on accepted/en_route/arrived,
--     so 'selected_pending_payment' is structurally immune (no SLA penalty for an
--     unpaid-but-selected PPJ provider). This migration does NOT touch that RPC.
--   - C5 fair-price validation, CRIT-01/HIGH-06 price-change atomicity,
--     release_job_atomic, advance_provider_job_state: untouched.
--
-- Idempotent: safe to re-run (CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS,
-- constraint dropped+re-added).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 045.1  requests: new status value + payment-window + timeout-reason columns
-- ----------------------------------------------------------------------------
-- Add 'selected_pending_payment' to the requests.status CHECK.
-- Previous (migration 031): open, quoted, accepted, en_route, arrived,
--   in_progress, completed, cancelled, expired.
ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN (
    'open',
    'quoted',
    'selected_pending_payment',
    'accepted',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'cancelled',
    'expired'
  ));

-- Payment-window clock for PPJ selection. SEPARATE from accepted_at (the SLA clock).
-- Set when a PPJ quote is selected; cleared on payment (finalize) or timeout (expire).
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS payment_window_started_at TIMESTAMPTZ DEFAULT NULL;

-- Customer-facing reason flag so the UI can distinguish a PPJ payment-timeout
-- release from an ordinary refresh/state change (mandatory customer negative-path
-- experience; ties to backlog P11). Cleared whenever a new selection starts.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS last_release_reason TEXT DEFAULT NULL;

-- Index for the cron's payment-window expiry sweep (partial: only pending-payment rows).
CREATE INDEX IF NOT EXISTS idx_requests_payment_window_pending
  ON public.requests (payment_window_started_at)
  WHERE status = 'selected_pending_payment';

-- Allow the new audit event for the payment-window timeout in provider_dispatch_log.
-- Previous (migration 031): quote_submitted, quote_selected, sla_failure, completion.
ALTER TABLE public.provider_dispatch_log
  DROP CONSTRAINT IF EXISTS provider_dispatch_log_event_type_check;
ALTER TABLE public.provider_dispatch_log
  ADD CONSTRAINT provider_dispatch_log_event_type_check
  CHECK (event_type IN (
    'quote_submitted',
    'quote_selected',
    'sla_failure',
    'completion',
    'ppj_payment_timeout'
  ));

-- ----------------------------------------------------------------------------
-- 045.2  select_quote_atomic — plan-branched (subscriber path UNCHANGED)
-- ----------------------------------------------------------------------------
-- Return shape gains `payment_required` (last column) so the route can tell the
-- customer "awaiting provider payment" WITHOUT contact details for PPJ. For the
-- subscriber path, payment_required = FALSE and name/phone/rating are returned
-- exactly as before (H1: still no KYC documents).
--
-- DROP is required here: this re-creation CHANGES the return type (adds the
-- payment_required column), and CREATE OR REPLACE cannot change an existing
-- function's return type (Postgres error 42P13). DROP removes the function's
-- existing grants, so the REVOKE/GRANT block immediately below re-applies them.
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
  provider_rating NUMERIC,
  payment_required BOOLEAN
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
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  IF v_request.status <> 'quoted' THEN
    RETURN QUERY SELECT FALSE, 'request_not_in_quoted_status'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  SELECT * INTO v_quote
  FROM request_quotes
  WHERE id = p_quote_id
    AND request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'quote_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  IF v_quote.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'quote_not_pending'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  IF v_quote.expires_at < now() THEN
    RETURN QUERY SELECT FALSE, 'quote_expired'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  v_provider_id := v_quote.provider_id;

  SELECT * INTO v_provider
  FROM providers
  WHERE id = v_provider_id;

  -- ==========================================================================
  -- PPJ BRANCH: fee gate. Do NOT assign, do NOT set accepted_at (no SLA clock),
  -- do NOT reject competitors (held pending so the request can return cleanly to
  -- 'quoted' on timeout). Withhold contact details until payment.
  -- ==========================================================================
  IF v_provider.plan = 'pay_per_job' THEN
    UPDATE requests
    SET status                    = 'selected_pending_payment',
        accepted_by               = v_provider_id,   -- marks WHO must pay; NOT an assignment
        selected_quote_id         = p_quote_id,
        payment_window_started_at = now(),
        last_release_reason       = NULL,            -- new selection clears any prior reason
        accepted_at               = NULL             -- SLA clock stays unset until payment
    WHERE id = p_request_id;

    UPDATE request_quotes
    SET status = 'selected',
        selected_at = now()
    WHERE id = p_quote_id;

    -- Competing quotes are intentionally LEFT 'pending' (held) for the window.

    UPDATE provider_dispatch_log
    SET was_selected = TRUE
    WHERE provider_id = v_provider_id
      AND request_id = p_request_id
      AND event_type = 'quote_submitted';

    -- H1: no contact details, no documents. Tell the route a fee is required.
    RETURN QUERY SELECT
      TRUE,
      'selected_pending_payment'::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::NUMERIC,
      TRUE;   -- payment_required
    RETURN;
  END IF;

  -- ==========================================================================
  -- SUBSCRIBER BRANCH: identical to the pre-045 behavior (assign immediately,
  -- reveal contact, reject competitors). Preserved byte-for-byte.
  -- ==========================================================================
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

  SELECT * INTO v_user
  FROM users
  WHERE id = v_provider_id;

  -- H1: provider documents (KYC paths) are intentionally NOT returned.
  RETURN QUERY SELECT
    TRUE,
    'selected'::TEXT,
    v_user.name,
    v_user.phone,
    v_provider.rating,
    FALSE;   -- payment_required
END;
$$;

REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 045.3  finalize_ppj_selection_atomic — called by the webhook on fee payment
-- ----------------------------------------------------------------------------
-- Transitions 'selected_pending_payment' -> 'accepted', sets accepted_at = now()
-- (SLA STARTS HERE), confirms the job, increments jobs_this_month, rejects the
-- held competitors, and returns contact details. Verifies the paying provider is
-- THE selected provider for this request (defense-in-depth alongside the route).
CREATE OR REPLACE FUNCTION public.finalize_ppj_selection_atomic(
  p_provider_id UUID,
  p_request_id UUID
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
  v_provider providers%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Idempotency: if it was already finalized to this provider, treat as success.
  IF v_request.status = 'accepted' AND v_request.accepted_by = p_provider_id THEN
    SELECT * INTO v_provider FROM providers WHERE id = p_provider_id;
    SELECT * INTO v_user FROM users WHERE id = p_provider_id;
    RETURN QUERY SELECT TRUE, 'already_finalized'::TEXT, v_user.name, v_user.phone, v_provider.rating;
    RETURN;
  END IF;

  -- Must still be in the payment window and assigned to the paying provider.
  IF v_request.status <> 'selected_pending_payment' THEN
    RETURN QUERY SELECT FALSE, 'request_not_pending_payment'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_request.accepted_by IS DISTINCT FROM p_provider_id THEN
    RETURN QUERY SELECT FALSE, 'not_selected_provider'::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Assign + start the SLA clock.
  UPDATE requests
  SET status                    = 'accepted',
      accepted_at               = now(),
      payment_window_started_at = NULL,
      last_release_reason       = NULL
  WHERE id = p_request_id;

  -- Now reject the held competitors (the selection is final).
  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND id <> v_request.selected_quote_id
    AND status = 'pending';

  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, p_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

  UPDATE providers
  SET jobs_this_month = COALESCE(jobs_this_month, 0) + 1
  WHERE id = p_provider_id;

  SELECT * INTO v_provider FROM providers WHERE id = p_provider_id;
  SELECT * INTO v_user FROM users WHERE id = p_provider_id;

  -- H1: no KYC documents returned.
  RETURN QUERY SELECT TRUE, 'finalized'::TEXT, v_user.name, v_user.phone, v_provider.rating;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ppj_selection_atomic(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ppj_selection_atomic(UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 045.4  expire_ppj_payment_selection_atomic — called by cron on 10-min timeout
-- ----------------------------------------------------------------------------
-- Releases a 'selected_pending_payment' request whose window has elapsed:
--   - selected quote -> 'rejected'
--   - request -> 'quoted' (held competitors still selectable) or 'open'
--   - clears accepted_by / selected_quote_id / payment_window_started_at
--   - sets last_release_reason = 'ppj_payment_timeout' (customer-facing flag)
--   - marks the pending ppj_payments row 'failed' (audit)
--   - NO SLA penalty, NO jobs_this_month change (nothing was consumed; accepted_at
--     was never set so the provider was never assigned).
CREATE OR REPLACE FUNCTION public.expire_ppj_payment_selection_atomic(
  p_request_id UUID,
  p_window INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  released_provider_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_provider_id UUID;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_request.status <> 'selected_pending_payment' THEN
    RETURN QUERY SELECT FALSE, 'not_pending_payment'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_request.payment_window_started_at IS NULL
     OR (now() - v_request.payment_window_started_at) < p_window THEN
    RETURN QUERY SELECT FALSE, 'window_not_elapsed'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  v_provider_id := v_request.accepted_by;

  -- Release the selected quote.
  UPDATE request_quotes
  SET status = 'rejected'
  WHERE id = v_request.selected_quote_id
    AND status = 'selected';

  -- Return to 'quoted' if any pending non-expired quote remains, else 'open'.
  v_new_status := public.release_target_status(p_request_id);

  UPDATE requests
  SET status                    = v_new_status,
      accepted_by               = NULL,
      selected_quote_id         = NULL,
      payment_window_started_at = NULL,
      last_release_reason       = 'ppj_payment_timeout'   -- customer-facing flag
  WHERE id = p_request_id;

  -- Audit: mark the unpaid PPJ payment row failed (if a pending one exists).
  UPDATE ppj_payments
  SET status = 'failed'
  WHERE request_id = p_request_id
    AND provider_id = v_provider_id
    AND status = 'pending';

  -- Audit log; NOT counted as an SLA failure.
  INSERT INTO provider_dispatch_log (
    provider_id, request_id, sla_met, event_type, is_soft_launch
  ) VALUES (
    v_provider_id, p_request_id, NULL, 'ppj_payment_timeout',
    COALESCE(current_setting('app.soft_launch_mode', TRUE), 'false') = 'true'
  );

  RETURN QUERY SELECT TRUE, 'released'::TEXT, v_provider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_ppj_payment_selection_atomic(UUID, INTERVAL) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ppj_payment_selection_atomic(UUID, INTERVAL) TO service_role;

COMMIT;
