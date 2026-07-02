-- ============================================================
-- Migration 047: LB-7 overage gate in select_quote_atomic
--                LB-10 atomic weekly SLA reset RPC
-- Addresses PROJECT_STATUS.md §6 LB-7 and LB-10.
-- ============================================================

-- ------------------------------------------------------------
-- LB-7: Add overage gate to select_quote_atomic subscriber path.
-- Previously a subscriber at their monthly limit could be selected
-- in V2 and receive a job without paying the overage fee.
-- ------------------------------------------------------------

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

  SELECT * INTO v_provider FROM providers
  WHERE id = v_provider_id;

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

-- ------------------------------------------------------------
-- LB-10: Atomic weekly SLA reset RPC.
-- Replaces two non-transactional UPDATEs in weekly-sla-reset/route.ts
-- with a single atomic function. LIMIT 500 prevents unbounded fetch.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.weekly_sla_reset_atomic()
RETURNS TABLE (providers_reset INT, visibility_reduced_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failing_ids      UUID[];
  v_high_failure_ids UUID[];
  v_reset_count      INT := 0;
  v_reduced_count    INT := 0;
BEGIN
  SELECT ARRAY_AGG(id) INTO v_failing_ids
  FROM (
    SELECT id FROM public.providers
    WHERE sla_failure_count > 0
    LIMIT 500
  ) sub;

  IF v_failing_ids IS NULL OR array_length(v_failing_ids, 1) = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_high_failure_ids
  FROM public.providers
  WHERE id = ANY(v_failing_ids) AND sla_failure_count >= 3;

  IF v_high_failure_ids IS NOT NULL
     AND array_length(v_high_failure_ids, 1) > 0
  THEN
    UPDATE public.providers
    SET visibility_reduced = TRUE
    WHERE id = ANY(v_high_failure_ids);
    v_reduced_count := array_length(v_high_failure_ids, 1);
  END IF;

  UPDATE public.providers
  SET sla_failure_count = 0
  WHERE id = ANY(v_failing_ids);
  v_reset_count := array_length(v_failing_ids, 1);

  RETURN QUERY SELECT v_reset_count, v_reduced_count;
END;
$$;

REVOKE ALL ON FUNCTION public.weekly_sla_reset_atomic()
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_sla_reset_atomic()
  TO service_role;
