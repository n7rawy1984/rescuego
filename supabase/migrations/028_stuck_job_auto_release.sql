-- Migration 028 — Update release_job_atomic to support en_route/arrived states
-- + Add expire_stuck_active_requests() RPC for cron auto-release.
--
-- Phase 4 added en_route and arrived as intermediate states between accepted
-- and in_progress. The release RPC and the stuck-job auto-release cron need
-- to handle these states.

-- 1. Update release_job_atomic to allow en_route/arrived states
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
  v_provider  providers%ROWTYPE;
  v_request   requests%ROWTYPE;
  v_updated   UUID;
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

  UPDATE requests
  SET status      = 'open',
      accepted_by = NULL
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

  UPDATE providers
  SET release_count                    = COALESCE(release_count, 0) + 1,
      provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1
  WHERE id = p_provider_id;

  RETURN QUERY SELECT TRUE, 'released';
END;
$$;

REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_job_atomic(UUID, UUID) TO service_role;

-- 2. New RPC: auto-release stuck active requests (for cron use)
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
    SELECT r.id AS request_id, r.accepted_by AS provider_id
    FROM requests r
    WHERE r.status IN ('accepted', 'en_route', 'arrived')
      AND r.updated_at < p_stuck_cutoff
      AND r.accepted_by IS NOT NULL
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    -- Release the request back to open
    UPDATE requests
    SET status = 'open', accepted_by = NULL
    WHERE id = v_row.request_id;

    -- Reset job fields
    UPDATE jobs
    SET commission_rate = NULL,
        commission_amount = NULL,
        stripe_payment_intent_id = NULL,
        en_route_at = NULL,
        arrived_at = NULL
    WHERE request_id = v_row.request_id
      AND provider_id = v_row.provider_id
      AND completed_at IS NULL;

    -- Remove locks
    DELETE FROM request_locks
    WHERE request_id = v_row.request_id;

    -- Increment provider release counters (auto-release counts as provider-side)
    UPDATE providers
    SET release_count = COALESCE(release_count, 0) + 1,
        provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1
    WHERE id = v_row.provider_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) TO service_role;
-- Migration 028 — Update release_job_atomic to support en_route/arrived states
-- + Add expire_stuck_active_requests() RPC for cron auto-release.
--
-- Phase 4 added en_route and arrived as intermediate states between accepted
-- and in_progress. The release RPC and the stuck-job auto-release cron need
-- to handle these states.

-- 1. Update release_job_atomic to allow en_route/arrived states
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
  v_provider  providers%ROWTYPE;
  v_request   requests%ROWTYPE;
  v_updated   UUID;
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

  UPDATE requests
  SET status      = 'open',
      accepted_by = NULL
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

  UPDATE providers
  SET release_count                    = COALESCE(release_count, 0) + 1,
      provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1
  WHERE id = p_provider_id;

  RETURN QUERY SELECT TRUE, 'released';
END;
$$;

REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.release_job_atomic(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_job_atomic(UUID, UUID) TO service_role;

-- 2. New RPC: auto-release stuck active requests (for cron use)
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
    SELECT r.id AS request_id, r.accepted_by AS provider_id
    FROM requests r
    WHERE r.status IN ('accepted', 'en_route', 'arrived')
      AND r.updated_at < p_stuck_cutoff
      AND r.accepted_by IS NOT NULL
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    -- Release the request back to open
    UPDATE requests
    SET status = 'open', accepted_by = NULL
    WHERE id = v_row.request_id;

    -- Reset job fields
    UPDATE jobs
    SET commission_rate = NULL,
        commission_amount = NULL,
        stripe_payment_intent_id = NULL,
        en_route_at = NULL,
        arrived_at = NULL
    WHERE request_id = v_row.request_id
      AND provider_id = v_row.provider_id
      AND completed_at IS NULL;

    -- Remove locks
    DELETE FROM request_locks
    WHERE request_id = v_row.request_id;

    -- Increment provider release counters (auto-release counts as provider-side)
    UPDATE providers
    SET release_count = COALESCE(release_count, 0) + 1,
        provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1
    WHERE id = v_row.provider_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) TO service_role;
