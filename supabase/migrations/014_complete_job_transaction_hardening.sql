-- Complete-job transactional hardening.
-- Keeps the existing completion semantics, while ensuring request completion
-- and job completion timestamp are committed together or rolled back together.

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
    AND completed_at IS NULL
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
    AND provider_id = p_provider_id
    AND completed_at IS NULL;

  RETURN QUERY SELECT TRUE, 'completed', v_job_id, v_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) TO service_role;
