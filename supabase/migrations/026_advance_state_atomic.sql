-- Migration 026: atomic advance_provider_job_state RPC
-- Wraps the two-step (requests UPDATE + jobs timestamp) in a single
-- Postgres transaction so a partial write is impossible.
-- Returns: success, reason, next_status

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
AS $$
DECLARE
  v_affected INTEGER;
  v_now      TIMESTAMPTZ := now();
BEGIN
  -- Advance request status, guarding with from-status and provider ownership
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

  -- Write timestamp to jobs if applicable
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

REVOKE ALL ON FUNCTION public.advance_provider_job_state(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_provider_job_state(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
