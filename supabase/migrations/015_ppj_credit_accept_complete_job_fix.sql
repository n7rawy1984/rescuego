-- Fix PPJ recovery-credit reaccept completion.
-- Reopened requests reuse jobs.request_id because the table has a unique
-- request_id constraint. When accepting a reopened request, reset stale job
-- completion fields so the active assignment can be completed normally.

CREATE OR REPLACE FUNCTION public.accept_provider_request_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_increment_jobs BOOLEAN DEFAULT TRUE,
  p_consume_ppj_credit BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  jobs_this_month INTEGER,
  ppj_recovery_credits INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider providers%ROWTYPE;
  v_request_id UUID;
  v_active_request_id UUID;
  v_lock_provider_id UUID;
BEGIN
  SELECT *
  INTO v_provider
  FROM providers
  WHERE id = p_provider_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'provider_not_found', NULL::INTEGER, NULL::INTEGER;
    RETURN;
  END IF;

  SELECT id
  INTO v_active_request_id
  FROM requests
  WHERE accepted_by = p_provider_id
    AND status IN ('accepted', 'in_progress')
    AND id <> p_request_id
  LIMIT 1
  FOR UPDATE;

  IF v_active_request_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'active_job_exists', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  IF p_consume_ppj_credit AND COALESCE(v_provider.ppj_recovery_credits, 0) <= 0 THEN
    RETURN QUERY SELECT FALSE, 'no_recovery_credit', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  SELECT provider_id
  INTO v_lock_provider_id
  FROM request_locks
  WHERE request_id = p_request_id
    AND locked_until > now()
  FOR UPDATE;

  IF v_lock_provider_id IS NOT NULL AND v_lock_provider_id <> p_provider_id THEN
    RETURN QUERY SELECT FALSE, 'locked_by_another_provider', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  UPDATE requests
  SET status = 'accepted',
      accepted_by = p_provider_id,
      final_price = NULL
  WHERE id = p_request_id
    AND status = 'open'
    AND accepted_by IS NULL
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_unavailable', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  INSERT INTO jobs (
    request_id,
    provider_id,
    commission_rate,
    commission_amount,
    stripe_payment_intent_id,
    completed_at
  )
  VALUES (
    p_request_id,
    p_provider_id,
    NULL,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (request_id)
  DO UPDATE SET
    provider_id = EXCLUDED.provider_id,
    commission_rate = NULL,
    commission_amount = NULL,
    stripe_payment_intent_id = NULL,
    completed_at = NULL;

  UPDATE providers
  SET jobs_this_month = COALESCE(providers.jobs_this_month, 0) + CASE WHEN p_increment_jobs THEN 1 ELSE 0 END,
      ppj_recovery_credits = GREATEST(
        0,
        COALESCE(providers.ppj_recovery_credits, 0) - CASE WHEN p_consume_ppj_credit THEN 1 ELSE 0 END
      )
  WHERE id = p_provider_id
  RETURNING providers.jobs_this_month, providers.ppj_recovery_credits
  INTO v_provider.jobs_this_month, v_provider.ppj_recovery_credits;

  DELETE FROM request_locks
  WHERE request_id = p_request_id;

  RETURN QUERY SELECT TRUE, 'accepted', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_provider_job_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_final_price INTEGER
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  job_id UUID,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_completed_at TIMESTAMPTZ := now();
  v_request_id UUID;
BEGIN
  IF p_final_price IS NULL OR p_final_price < 1 OR p_final_price > 10000 THEN
    RETURN QUERY SELECT FALSE, 'invalid_final_price', NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT id
  INTO v_job_id
  FROM jobs
  WHERE request_id = p_request_id
    AND provider_id = p_provider_id
  FOR UPDATE;

  IF v_job_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'job_not_found', NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE requests
  SET status = 'completed',
      final_price = p_final_price
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'in_progress')
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_completable', v_job_id, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  UPDATE jobs
  SET commission_rate = 0,
      commission_amount = 0,
      completed_at = v_completed_at
  WHERE id = v_job_id
    AND provider_id = p_provider_id;

  RETURN QUERY SELECT TRUE, 'completed', v_job_id, v_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) TO service_role;
