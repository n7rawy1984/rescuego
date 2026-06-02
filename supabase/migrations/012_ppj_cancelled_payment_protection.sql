-- PPJ cancelled-payment protection.
-- If a provider has already paid but the customer cancels before assignment
-- completes, restore one usage-only PPJ recovery credit exactly once.

ALTER TABLE ppj_payments
  ADD COLUMN IF NOT EXISTS recovery_credit_restored_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.restore_ppj_credit_for_cancelled_paid_request(
  p_provider_id UUID,
  p_request_id UUID,
  p_payment_intent_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  ppj_recovery_credits INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_request requests%ROWTYPE;
  v_credits INTEGER;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT *
  INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found', NULL::INTEGER;
    RETURN;
  END IF;

  IF v_request.status <> 'cancelled' OR v_request.cancellation_actor <> 'customer' THEN
    RETURN QUERY SELECT FALSE, 'request_not_customer_cancelled', NULL::INTEGER;
    RETURN;
  END IF;

  SELECT id
  INTO v_payment_id
  FROM ppj_payments
  WHERE provider_id = p_provider_id
    AND request_id = p_request_id
    AND status = 'paid'
    AND recovery_credit_restored_at IS NULL
    AND (
      p_payment_intent_id IS NULL
      OR stripe_payment_intent_id = p_payment_intent_id
    )
  FOR UPDATE;

  IF v_payment_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'no_uncredited_paid_payment', NULL::INTEGER;
    RETURN;
  END IF;

  UPDATE providers
  SET ppj_recovery_credits = COALESCE(providers.ppj_recovery_credits, 0) + 1
  WHERE id = p_provider_id
  RETURNING providers.ppj_recovery_credits INTO v_credits;

  IF v_credits IS NULL THEN
    RETURN QUERY SELECT FALSE, 'provider_not_found', NULL::INTEGER;
    RETURN;
  END IF;

  UPDATE ppj_payments
  SET recovery_credit_restored_at = v_now
  WHERE id = v_payment_id
    AND recovery_credit_restored_at IS NULL;

  UPDATE requests
  SET cancellation_compensation_type = 'ppj_recovery_credit',
      cancellation_compensated_at = COALESCE(cancellation_compensated_at, v_now)
  WHERE id = p_request_id;

  RETURN QUERY SELECT TRUE, 'ppj_credit_restored', v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_ppj_credit_for_cancelled_paid_request(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_ppj_credit_for_cancelled_paid_request(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.restore_ppj_credit_for_cancelled_paid_request(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.restore_ppj_credit_for_cancelled_paid_request(UUID, UUID, TEXT) TO service_role;
