-- Migration 024 — Overage guard inside accept_provider_request_atomic.
--
-- TOCTOU fix: the overage check in accept/route.ts reads jobs_this_month
-- before the atomic RPC acquires the FOR UPDATE lock on the provider row.
-- Two concurrent accepts against different requests by the same provider
-- at their monthly limit could both pass the pre-flight check before either
-- increments jobs_this_month.
--
-- Fix: add p_plan_limit parameter to the RPC. When provided (>= 0), the RPC
-- re-checks jobs_this_month under the FOR UPDATE lock and returns
-- 'overage_required' if the live value >= limit.
-- The API route passes allowance.effectiveLimit; the RPC enforces it
-- atomically. The pre-flight check in the route remains as a fast-fail
-- optimisation only.
--
-- p_plan_limit = -1 means no limit (business plan / PPJ) — skip the check.

CREATE OR REPLACE FUNCTION public.accept_provider_request_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_increment_jobs BOOLEAN DEFAULT TRUE,
  p_consume_ppj_credit BOOLEAN DEFAULT FALSE,
  p_plan_limit INTEGER DEFAULT -1
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

  -- Overage guard: re-check jobs_this_month under the FOR UPDATE lock.
  -- p_plan_limit >= 0 means a monthly limit applies.
  -- Uses the live v_provider.jobs_this_month (read under lock) not the
  -- stale pre-flight value from the API route.
  IF p_plan_limit >= 0 AND COALESCE(v_provider.jobs_this_month, 0) >= p_plan_limit THEN
    RETURN QUERY SELECT FALSE, 'overage_required', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
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
      accepted_by = p_provider_id
  WHERE id = p_request_id
    AND status = 'open'
    AND accepted_by IS NULL
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_unavailable', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, p_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

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

REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) TO service_role;
-- Migration 024 — Overage guard inside accept_provider_request_atomic.
--
-- TOCTOU fix: the overage check in accept/route.ts reads jobs_this_month
-- before the atomic RPC acquires the FOR UPDATE lock on the provider row.
-- Two concurrent accepts against different requests by the same provider
-- at their monthly limit could both pass the pre-flight check before either
-- increments jobs_this_month.
--
-- Fix: add p_plan_limit parameter to the RPC. When provided (>= 0), the RPC
-- re-checks jobs_this_month under the FOR UPDATE lock and returns
-- 'overage_required' if the live value >= limit.
-- The API route passes allowance.effectiveLimit; the RPC enforces it
-- atomically. The pre-flight check in the route remains as a fast-fail
-- optimisation only.
--
-- p_plan_limit = -1 means no limit (business plan / PPJ) — skip the check.

CREATE OR REPLACE FUNCTION public.accept_provider_request_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_increment_jobs BOOLEAN DEFAULT TRUE,
  p_consume_ppj_credit BOOLEAN DEFAULT FALSE,
  p_plan_limit INTEGER DEFAULT -1
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

  -- Overage guard: re-check jobs_this_month under the FOR UPDATE lock.
  -- p_plan_limit >= 0 means a monthly limit applies.
  -- Uses the live v_provider.jobs_this_month (read under lock) not the
  -- stale pre-flight value from the API route.
  IF p_plan_limit >= 0 AND COALESCE(v_provider.jobs_this_month, 0) >= p_plan_limit THEN
    RETURN QUERY SELECT FALSE, 'overage_required', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
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
      accepted_by = p_provider_id
  WHERE id = p_request_id
    AND status = 'open'
    AND accepted_by IS NULL
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_unavailable', v_provider.jobs_this_month, v_provider.ppj_recovery_credits;
    RETURN;
  END IF;

  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, p_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

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

REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER) TO service_role;
