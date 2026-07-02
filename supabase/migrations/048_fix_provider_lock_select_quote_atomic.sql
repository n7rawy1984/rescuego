-- ============================================================
-- Migration 048: Add FOR UPDATE on provider row in select_quote_atomic
-- ------------------------------------------------------------
-- Migration 047 was applied to Supabase BEFORE the provider-row lock
-- correction was discovered. Migration 047 is immutable and must remain
-- the exact version already applied. This migration is the corrective
-- follow-up: it recreates select_quote_atomic with the SINGLE functional
-- change of adding FOR UPDATE to the provider row SELECT.
--
-- Why the lock is needed (TOCTOU):
-- Without locking the provider row, two concurrent select_quote_atomic
-- calls selecting the same at-limit provider (via two different requests)
-- could both read jobs_this_month below the plan limit, both pass the
-- overage gate, and both increment jobs_this_month -- bypassing the
-- monthly limit. The requests FOR UPDATE does not protect the provider
-- row across two different requests.
--
-- Everything else in this function body is byte-for-byte identical to
-- migration 047 as applied.
-- ============================================================

DROP FUNCTION IF EXISTS public.select_quote_atomic(UUID, UUID, UUID);

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
  v_request   requests%ROWTYPE;
  v_quote     request_quotes%ROWTYPE;
  v_provider  providers%ROWTYPE;
  v_user      users%ROWTYPE;
  v_provider_id UUID;
  v_plan_limit  INT;
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

  -- ONLY functional change vs migration 047: FOR UPDATE on the provider row.
  SELECT * INTO v_provider FROM providers
  WHERE id = v_provider_id
  FOR UPDATE;

  -- PPJ BRANCH: unchanged from migration 045.
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

  -- SUBSCRIBER BRANCH: overage gate added (LB-7).
  v_plan_limit := CASE v_provider.plan
    WHEN 'starter'  THEN 15
    WHEN 'pro'      THEN 35
    ELSE -1  -- business = unlimited
  END;

  IF v_plan_limit > 0
     AND COALESCE(v_provider.jobs_this_month, 0) >= v_plan_limit
     AND NOT COALESCE(v_request.overage_cleared, FALSE)
  THEN
    RETURN QUERY SELECT FALSE, 'overage_required'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
    RETURN;
  END IF;

  -- Subscriber assignment: identical to pre-047 behavior.
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

REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID)
  TO service_role;
