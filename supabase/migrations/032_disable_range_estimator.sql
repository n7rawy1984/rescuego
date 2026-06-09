-- Migration 032: Temporarily disable range estimator price validation
-- RANGE_ESTIMATOR_DISABLED — re-enable before soft launch

CREATE OR REPLACE FUNCTION public.submit_quote_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_proposed_price NUMERIC(10,2),
  p_distance_km NUMERIC(6,2) DEFAULT 0,
  p_is_soft_launch BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  quote_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_provider providers%ROWTYPE;
  v_config fair_price_config%ROWTYPE;
  v_active_count INTEGER;
  v_daily_count INTEGER;
  v_max_active INTEGER;
  v_daily_limit INTEGER;
  v_quote_id UUID;
  v_validity_minutes INTEGER;
  v_is_first_quote BOOLEAN;
  v_price_per_km NUMERIC(8,2);
BEGIN
  -- 1. Lock and validate request
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_request.status NOT IN ('open', 'quoted') THEN
    RETURN QUERY SELECT FALSE, 'request_not_quotable'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 2. Lock and validate provider
  SELECT * INTO v_provider
  FROM providers
  WHERE id = p_provider_id
  FOR UPDATE;

  IF NOT FOUND OR v_provider.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, 'provider_not_active'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 3. Check existing quote from this provider
  IF EXISTS (
    SELECT 1 FROM request_quotes
    WHERE request_id = p_request_id AND provider_id = p_provider_id
  ) THEN
    RETURN QUERY SELECT FALSE, 'already_quoted'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 4. Determine plan limits
  v_max_active := CASE v_provider.plan
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 2
    WHEN 'business' THEN 5
    WHEN 'pay_per_job' THEN 1
    ELSE 1
  END;

  v_daily_limit := CASE v_provider.plan
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 10
    WHEN 'business' THEN 20
    WHEN 'pay_per_job' THEN 3
    ELSE 3
  END;

  -- 5. Check active job capacity
  SELECT COUNT(*) INTO v_active_count
  FROM requests
  WHERE accepted_by = p_provider_id
    AND status IN ('accepted', 'en_route', 'arrived', 'in_progress');

  IF v_active_count >= v_max_active THEN
    RETURN QUERY SELECT FALSE, 'capacity_full'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 6. Check daily quote limit (quotes sent today)
  SELECT COUNT(*) INTO v_daily_count
  FROM request_quotes
  WHERE provider_id = p_provider_id
    AND sent_at::DATE = CURRENT_DATE;

  IF v_daily_count >= v_daily_limit THEN
    RETURN QUERY SELECT FALSE, 'daily_limit_reached'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- 7. RANGE_ESTIMATOR_DISABLED — re-enable before soft launch
  -- Price range validation is temporarily bypassed. Any price > 0 is accepted.
  -- Original logic checked fair_price_config bounds and rejected price_too_low / price_too_high.
  SELECT * INTO v_config
  FROM fair_price_config
  WHERE service_type = v_request.problem_type;

  IF NOT FOUND THEN
    SELECT * INTO v_config
    FROM fair_price_config
    WHERE service_type = 'other';
  END IF;

  IF v_config.id IS NOT NULL THEN
    v_validity_minutes := v_config.quote_validity_minutes;
  ELSE
    v_validity_minutes := 10;
  END IF;

  -- 8. Compute price_per_km for analytics
  IF p_distance_km > 0 THEN
    v_price_per_km := (p_proposed_price - COALESCE(v_config.base_fee, 0)) / p_distance_km;
  ELSE
    v_price_per_km := NULL;
  END IF;

  -- 9. Insert quote
  INSERT INTO request_quotes (request_id, provider_id, proposed_price, expires_at)
  VALUES (
    p_request_id,
    p_provider_id,
    p_proposed_price,
    now() + (v_validity_minutes || ' minutes')::INTERVAL
  )
  RETURNING id INTO v_quote_id;

  -- 10. If first quote, update request status to 'quoted'
  v_is_first_quote := (v_request.status = 'open');
  IF v_is_first_quote THEN
    UPDATE requests
    SET status = 'quoted',
        quoted_at = now()
    WHERE id = p_request_id;
  END IF;

  -- 11. Log to dispatch log
  INSERT INTO provider_dispatch_log (
    provider_id, request_id, distance_km, proposed_price,
    service_type, price_per_km, is_soft_launch, event_type
  ) VALUES (
    p_provider_id, p_request_id, p_distance_km, p_proposed_price,
    v_request.problem_type, v_price_per_km, p_is_soft_launch, 'quote_submitted'
  );

  RETURN QUERY SELECT TRUE, 'quote_submitted'::TEXT, v_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO service_role;
