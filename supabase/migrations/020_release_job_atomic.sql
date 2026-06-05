-- Migration 020 — Atomic job release RPC.
-- Fixes Phase 1B Task 5 Finding 1: release/route.ts returned success even when
-- cleanup steps (jobs reset, request_locks delete, provider counter increment)
-- partially failed after the request status was already set back to 'open'.
--
-- This RPC wraps all five mutations in one Postgres transaction:
--   1. Lock provider row (FOR UPDATE)
--   2. Update request → 'open', accepted_by = NULL
--   3. Reset stale job fields
--   4. Delete request_locks
--   5. Increment provider release counters
--
-- provider_locations DELETE is intentionally excluded from the RPC — it is a
-- best-effort offline signal, not a correctness requirement. The route handles
-- it as a post-RPC fire-and-forget step, consistent with the existing pattern.

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
  -- Lock the provider row for the duration of the transaction.
  SELECT * INTO v_provider
  FROM providers
  WHERE id = p_provider_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'provider_not_found';
    RETURN;
  END IF;

  -- Verify the request is still owned by this provider and releasable.
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'in_progress')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_releasable';
    RETURN;
  END IF;

  -- Step 1: Release the request back to open.
  UPDATE requests
  SET status      = 'open',
      accepted_by = NULL
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'in_progress')
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_status_changed';
    RETURN;
  END IF;

  -- Step 2: Reset stale job fields so a re-accept starts clean.
  UPDATE jobs
  SET commission_rate          = NULL,
      commission_amount        = NULL,
      stripe_payment_intent_id = NULL
  WHERE request_id  = p_request_id
    AND provider_id = p_provider_id
    AND completed_at IS NULL;

  -- Step 3: Remove any active lock on the request.
  DELETE FROM request_locks
  WHERE request_id = p_request_id;

  -- Step 4: Increment provider release counters.
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
