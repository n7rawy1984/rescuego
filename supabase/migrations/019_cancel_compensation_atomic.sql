-- Migration 019 — Atomic cancellation + provider compensation.
-- Fixes double-compensation bug in cancel/route.ts (Phase 1B Task 5 Finding 2).
--
-- Previously: cancel update, provider lookup, credit/restore update, and
-- cancellation_compensated_at mark were separate round-trips. If the mark
-- failed and the client retried, the provider received compensation twice.
--
-- Fix: wrap all four steps in one plpgsql transaction with FOR UPDATE on the
-- request row as the idempotency anchor. The RPC is safe to call multiple
-- times — the FOR UPDATE + IS NULL guard on cancellation_compensated_at
-- ensures compensation is applied exactly once.

CREATE OR REPLACE FUNCTION public.cancel_request_and_compensate_atomic(
  p_customer_id   UUID,
  p_request_id    UUID,
  p_now           TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  success               BOOLEAN,
  reason                TEXT,
  late_cancellation     BOOLEAN,
  compensation_type     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request           requests%ROWTYPE;
  v_provider          providers%ROWTYPE;
  v_retrying          BOOLEAN;
  v_is_late           BOOLEAN;
  v_compensation_type TEXT := 'none';
BEGIN
  -- Lock the request row for the entire transaction.
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found', FALSE, NULL::TEXT;
    RETURN;
  END IF;

  -- Determine if this is a retry of a previously cancelled-but-uncompensated request.
  v_retrying := v_request.status = 'cancelled'
    AND v_request.accepted_by IS NOT NULL
    AND v_request.cancellation_compensated_at IS NULL;

  -- Terminal states that cannot be cancelled.
  IF v_request.status IN ('completed', 'expired')
      OR (v_request.status = 'cancelled' AND NOT v_retrying) THEN
    RETURN QUERY SELECT FALSE, 'request_not_cancellable', FALSE, NULL::TEXT;
    RETURN;
  END IF;

  v_is_late := v_request.accepted_by IS NOT NULL
    AND (v_retrying OR v_request.status IN ('accepted', 'in_progress'));

  -- Step 1: Cancel the request (skip if retrying compensation on already-cancelled row).
  IF NOT v_retrying THEN
    UPDATE requests
    SET status                       = 'cancelled',
        cancelled_at                 = p_now,
        cancelled_by                 = p_customer_id,
        cancellation_actor           = 'customer',
        cancellation_compensation_type  = CASE WHEN v_is_late THEN NULL ELSE 'none' END,
        cancellation_compensated_at  = CASE WHEN v_is_late THEN NULL ELSE p_now END
    WHERE id = p_request_id
      AND customer_id = p_customer_id
      AND status IN ('open', 'accepted', 'in_progress');

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'request_status_changed', FALSE, NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Step 2: Late-cancellation provider compensation (exactly once).
  IF v_is_late
      AND v_request.accepted_by IS NOT NULL
      AND v_request.cancellation_compensated_at IS NULL THEN

    -- Lock the provider row.
    SELECT * INTO v_provider
    FROM providers
    WHERE id = v_request.accepted_by
    FOR UPDATE;

    IF NOT FOUND THEN
      -- Provider deleted — log via caller, mark compensated to prevent retry loop.
      UPDATE requests
      SET cancellation_compensated_at     = p_now,
          cancellation_compensation_type  = 'none'
      WHERE id = p_request_id;

      RETURN QUERY SELECT TRUE, 'provider_not_found_compensation_skipped', TRUE, 'none'::TEXT;
      RETURN;
    END IF;

    IF v_provider.plan = 'pay_per_job' THEN
      UPDATE providers
      SET ppj_recovery_credits = GREATEST(0, COALESCE(ppj_recovery_credits, 0) + 1)
      WHERE id = v_provider.id;
      v_compensation_type := 'ppj_recovery_credit';

    ELSIF v_provider.plan IN ('starter', 'pro') THEN
      UPDATE providers
      SET jobs_this_month = GREATEST(0, COALESCE(jobs_this_month, 0) - 1)
      WHERE id = v_provider.id;
      v_compensation_type := 'subscription_usage_restore';
    END IF;

    -- Step 3: Mark compensation as applied — idempotency anchor.
    UPDATE requests
    SET cancellation_compensated_at     = p_now,
        cancellation_compensation_type  = v_compensation_type
    WHERE id = p_request_id
      AND cancellation_compensated_at IS NULL;
  END IF;

  RETURN QUERY SELECT TRUE, 'cancelled', v_is_late, v_compensation_type;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_request_and_compensate_atomic(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_request_and_compensate_atomic(UUID, UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_request_and_compensate_atomic(UUID, UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_request_and_compensate_atomic(UUID, UUID, TIMESTAMPTZ) TO service_role;
