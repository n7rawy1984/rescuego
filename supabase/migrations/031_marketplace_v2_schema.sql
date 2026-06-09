-- Migration 031 — Marketplace V2: Competitive Quotes + Dispatch + Pricing
-- Adds: request_quotes, provider_dispatch_log, fair_price_config tables
-- Adds: new columns to requests and providers
-- Adds: RPCs (submit_quote_atomic, select_quote_atomic, sla_check_and_release)
-- Updates: complete_provider_job_atomic to derive final_price from quote/price_change
-- Idempotent: safe to re-run

-- ============================================================
-- STEP 1: Update requests status CHECK to include 'quoted'
-- ============================================================

ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_status_check;

ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('open', 'quoted', 'accepted', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'));

-- ============================================================
-- STEP 2: Add new columns to requests table
-- ============================================================

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS destination TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_area TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_latitude NUMERIC(10,7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destination_longitude NUMERIC(10,7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fuzzy_latitude NUMERIC(10,7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fuzzy_longitude NUMERIC(10,7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS selected_quote_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_change_requested NUMERIC(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_change_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_change_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;

-- Add CHECK constraint for price_change_status (idempotent via name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requests_price_change_status_check'
  ) THEN
    ALTER TABLE public.requests
      ADD CONSTRAINT requests_price_change_status_check
      CHECK (price_change_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- ============================================================
-- STEP 3: Add new columns to providers table
-- ============================================================

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS sla_failure_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility_reduced BOOLEAN DEFAULT FALSE;

-- ============================================================
-- STEP 4: Create request_quotes table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.request_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  proposed_price NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'selected', 'rejected', 'expired')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  selected_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(request_id, provider_id)
);

ALTER TABLE public.request_quotes ENABLE ROW LEVEL SECURITY;

-- RLS: Provider sees own quotes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'request_quotes' AND policyname = 'Provider reads own quotes'
  ) THEN
    CREATE POLICY "Provider reads own quotes" ON public.request_quotes
      FOR SELECT USING (provider_id = auth.uid());
  END IF;
END $$;

-- RLS: Customer sees quotes on their requests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'request_quotes' AND policyname = 'Customer reads quotes on own requests'
  ) THEN
    CREATE POLICY "Customer reads quotes on own requests" ON public.request_quotes
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.requests
          WHERE requests.id = request_quotes.request_id
            AND requests.customer_id = auth.uid()
        )
      );
  END IF;
END $$;

-- RLS: Admin full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'request_quotes' AND policyname = 'Admin full access'
  ) THEN
    CREATE POLICY "Admin full access" ON public.request_quotes
      FOR ALL USING (is_admin());
  END IF;
END $$;

-- ============================================================
-- STEP 5: Create provider_dispatch_log table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  distance_km NUMERIC(6,2) DEFAULT NULL,
  proposed_price NUMERIC(10,2) DEFAULT NULL,
  service_type TEXT DEFAULT NULL,
  price_per_km NUMERIC(8,2) DEFAULT NULL,
  was_selected BOOLEAN DEFAULT FALSE,
  sla_met BOOLEAN DEFAULT NULL,
  is_soft_launch BOOLEAN DEFAULT FALSE,
  event_type TEXT DEFAULT 'quote_submitted'
    CHECK (event_type IN ('quote_submitted', 'quote_selected', 'sla_failure', 'completion')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_dispatch_log ENABLE ROW LEVEL SECURITY;

-- RLS: Provider sees own logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'provider_dispatch_log' AND policyname = 'Provider reads own dispatch logs'
  ) THEN
    CREATE POLICY "Provider reads own dispatch logs" ON public.provider_dispatch_log
      FOR SELECT USING (provider_id = auth.uid());
  END IF;
END $$;

-- RLS: Admin full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'provider_dispatch_log' AND policyname = 'Admin full access'
  ) THEN
    CREATE POLICY "Admin full access" ON public.provider_dispatch_log
      FOR ALL USING (is_admin());
  END IF;
END $$;

-- ============================================================
-- STEP 6: Create fair_price_config table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fair_price_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT UNIQUE NOT NULL,
  min_price_per_km NUMERIC(8,2) NOT NULL,
  max_price_per_km NUMERIC(8,2) NOT NULL,
  base_fee NUMERIC(8,2) NOT NULL DEFAULT 0,
  quote_validity_minutes INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fair_price_config ENABLE ROW LEVEL SECURITY;

-- RLS: All authenticated can read (providers need range hints in UI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fair_price_config' AND policyname = 'Authenticated read fair_price_config'
  ) THEN
    CREATE POLICY "Authenticated read fair_price_config" ON public.fair_price_config
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- RLS: Admin full access (insert/update/delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'fair_price_config' AND policyname = 'Admin full access'
  ) THEN
    CREATE POLICY "Admin full access" ON public.fair_price_config
      FOR ALL USING (is_admin());
  END IF;
END $$;

-- Seed initial config (UAE market estimates)
INSERT INTO public.fair_price_config (service_type, min_price_per_km, max_price_per_km, base_fee, quote_validity_minutes)
VALUES
  ('tow',       3.00, 8.00,  100.00, 10),
  ('battery',   2.00, 5.00,   80.00, 10),
  ('flat_tire', 2.00, 5.00,   60.00, 10),
  ('fuel',      2.00, 5.00,   50.00, 10),
  ('lockout',   2.00, 6.00,   70.00, 10),
  ('other',     2.00, 6.00,   80.00, 10)
ON CONFLICT (service_type) DO NOTHING;

-- ============================================================
-- STEP 7: Indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_request_quotes_request_id
  ON public.request_quotes(request_id);

CREATE INDEX IF NOT EXISTS idx_request_quotes_provider_id
  ON public.request_quotes(provider_id);

CREATE INDEX IF NOT EXISTS idx_request_quotes_status_expires
  ON public.request_quotes(status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_request_quotes_provider_daily
  ON public.request_quotes(provider_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_provider_id
  ON public.provider_dispatch_log(provider_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_request_id
  ON public.provider_dispatch_log(request_id);

CREATE INDEX IF NOT EXISTS idx_requests_quoted_at
  ON public.requests(quoted_at)
  WHERE status = 'quoted';

CREATE INDEX IF NOT EXISTS idx_requests_accepted_at
  ON public.requests(accepted_at)
  WHERE status = 'accepted';

-- ============================================================
-- STEP 8: Add selected_quote_id FK (deferred to avoid circular ref)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requests_selected_quote_id_fkey'
  ) THEN
    ALTER TABLE public.requests
      ADD CONSTRAINT requests_selected_quote_id_fkey
      FOREIGN KEY (selected_quote_id) REFERENCES public.request_quotes(id);
  END IF;
END $$;

-- ============================================================
-- STEP 9: Add request_quotes to realtime publication
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'request_quotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.request_quotes;
  END IF;
END $$;

-- ============================================================
-- STEP 10: submit_quote_atomic RPC
-- Parameters:
--   p_provider_id   — the quoting provider
--   p_request_id    — the service request
--   p_proposed_price — provider's quote in AED
--   p_distance_km   — Haversine distance computed by API route
--   p_is_soft_launch — whether SOFT_LAUNCH_MODE is active
-- ============================================================

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
  v_min_fair NUMERIC(10,2);
  v_max_fair NUMERIC(10,2);
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

  -- 7. Validate price range from fair_price_config
  SELECT * INTO v_config
  FROM fair_price_config
  WHERE service_type = v_request.problem_type;

  IF NOT FOUND THEN
    SELECT * INTO v_config
    FROM fair_price_config
    WHERE service_type = 'other';
  END IF;

  IF v_config.id IS NOT NULL THEN
    v_min_fair := v_config.base_fee + (p_distance_km * v_config.min_price_per_km);
    v_max_fair := v_config.base_fee + (p_distance_km * v_config.max_price_per_km);

    IF p_proposed_price < v_min_fair THEN
      RETURN QUERY SELECT FALSE, 'price_too_low'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    IF p_proposed_price > v_max_fair THEN
      RETURN QUERY SELECT FALSE, 'price_too_high'::TEXT, NULL::UUID;
      RETURN;
    END IF;

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

-- ============================================================
-- STEP 11: select_quote_atomic RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.select_quote_atomic(
  p_customer_id UUID,
  p_request_id UUID,
  p_quote_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  provider_name TEXT,
  provider_phone TEXT,
  provider_documents JSONB,
  provider_rating NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_quote request_quotes%ROWTYPE;
  v_provider_id UUID;
  v_provider providers%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  -- 1. Lock and validate request
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_request.status <> 'quoted' THEN
    RETURN QUERY SELECT FALSE, 'request_not_in_quoted_status'::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::NUMERIC;
    RETURN;
  END IF;

  -- 2. Lock and validate quote
  SELECT * INTO v_quote
  FROM request_quotes
  WHERE id = p_quote_id
    AND request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'quote_not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_quote.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'quote_not_pending'::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_quote.expires_at < now() THEN
    RETURN QUERY SELECT FALSE, 'quote_expired'::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB, NULL::NUMERIC;
    RETURN;
  END IF;

  v_provider_id := v_quote.provider_id;

  -- 3. Update request: accepted + link quote
  UPDATE requests
  SET status = 'accepted',
      accepted_by = v_provider_id,
      selected_quote_id = p_quote_id,
      accepted_at = now()
  WHERE id = p_request_id;

  -- 4. Update selected quote
  UPDATE request_quotes
  SET status = 'selected',
      selected_at = now()
  WHERE id = p_quote_id;

  -- 5. Reject all other pending quotes for this request
  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND id <> p_quote_id
    AND status = 'pending';

  -- 6. Create job record
  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, v_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

  -- 7. Increment provider's jobs_this_month
  UPDATE providers
  SET jobs_this_month = COALESCE(jobs_this_month, 0) + 1
  WHERE id = v_provider_id;

  -- 8. Update dispatch log
  UPDATE provider_dispatch_log
  SET was_selected = TRUE
  WHERE provider_id = v_provider_id
    AND request_id = p_request_id
    AND event_type = 'quote_submitted';

  -- 9. Fetch provider details to reveal
  SELECT * INTO v_provider
  FROM providers
  WHERE id = v_provider_id;

  SELECT * INTO v_user
  FROM users
  WHERE id = v_provider_id;

  RETURN QUERY SELECT
    TRUE,
    'selected'::TEXT,
    v_user.name,
    v_user.phone,
    v_provider.documents,
    v_provider.rating;
END;
$$;

REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) TO service_role;

-- ============================================================
-- STEP 12: sla_check_and_release RPC
-- Adjusted: after release, checks if remaining pending quotes exist
-- to determine correct status (open vs quoted)
-- ============================================================

CREATE OR REPLACE FUNCTION public.sla_check_and_release(
  p_request_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  released_provider_id UUID,
  needs_refund BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request requests%ROWTYPE;
  v_provider providers%ROWTYPE;
  v_provider_id UUID;
  v_is_ppj BOOLEAN;
  v_sla_failures INTEGER;
  v_pending_quotes_exist BOOLEAN;
  v_new_status TEXT;
BEGIN
  -- 1. Lock request
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- Only release if still in 'accepted' (no state advance happened)
  IF v_request.status <> 'accepted' THEN
    RETURN QUERY SELECT FALSE, 'not_in_accepted_status'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- Check 20 min elapsed since accepted_at
  IF v_request.accepted_at IS NULL OR (now() - v_request.accepted_at) < INTERVAL '20 minutes' THEN
    RETURN QUERY SELECT FALSE, 'sla_not_breached'::TEXT, NULL::UUID, FALSE;
    RETURN;
  END IF;

  v_provider_id := v_request.accepted_by;

  -- 2. Mark the selected quote as rejected
  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND provider_id = v_provider_id
    AND status = 'selected';

  -- 3. Check if other pending (non-expired) quotes exist
  SELECT EXISTS (
    SELECT 1 FROM request_quotes
    WHERE request_id = p_request_id
      AND status = 'pending'
      AND expires_at > now()
  ) INTO v_pending_quotes_exist;

  v_new_status := CASE WHEN v_pending_quotes_exist THEN 'quoted' ELSE 'open' END;

  -- 4. Release the request
  UPDATE requests
  SET status = v_new_status,
      accepted_by = NULL,
      selected_quote_id = NULL,
      accepted_at = NULL
  WHERE id = p_request_id;

  -- 5. Delete job record
  DELETE FROM jobs
  WHERE request_id = p_request_id
    AND provider_id = v_provider_id;

  -- 6. Penalize provider
  SELECT * INTO v_provider
  FROM providers
  WHERE id = v_provider_id
  FOR UPDATE;

  v_is_ppj := (v_provider.plan = 'pay_per_job');
  v_sla_failures := COALESCE(v_provider.sla_failure_count, 0) + 1;

  UPDATE providers
  SET sla_failure_count = v_sla_failures,
      jobs_this_month = GREATEST(0, COALESCE(jobs_this_month, 0) - 1),
      visibility_reduced = CASE WHEN v_sla_failures >= 3 THEN TRUE ELSE visibility_reduced END
  WHERE id = v_provider_id;

  -- 7. Log SLA failure
  INSERT INTO provider_dispatch_log (
    provider_id, request_id, sla_met, event_type, is_soft_launch
  ) VALUES (
    v_provider_id, p_request_id, FALSE, 'sla_failure',
    COALESCE(current_setting('app.soft_launch_mode', TRUE), 'false') = 'true'
  );

  RETURN QUERY SELECT TRUE, 'released'::TEXT, v_provider_id, v_is_ppj;
END;
$$;

REVOKE ALL ON FUNCTION public.sla_check_and_release(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sla_check_and_release(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.sla_check_and_release(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sla_check_and_release(UUID) TO service_role;

-- ============================================================
-- STEP 13: Update complete_provider_job_atomic to derive final_price
-- Backward compatible: p_final_price still accepted for legacy requests
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_provider_job_atomic(
  p_provider_id UUID,
  p_request_id UUID,
  p_final_price INTEGER DEFAULT NULL
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
  v_request requests%ROWTYPE;
  v_derived_price INTEGER;
BEGIN
  -- Lock job
  SELECT id
  INTO v_job_id
  FROM jobs
  WHERE request_id = p_request_id
    AND provider_id = p_provider_id
  FOR UPDATE;

  IF v_job_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'job_not_found'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Get request for price derivation
  SELECT * INTO v_request
  FROM requests
  WHERE id = p_request_id
    AND accepted_by = p_provider_id
    AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_completable'::TEXT, v_job_id, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Derive final_price:
  -- Priority 1: approved price change
  -- Priority 2: selected quote's proposed_price
  -- Priority 3: legacy p_final_price parameter (backward compat for pre-V2 requests)
  IF v_request.price_change_status = 'approved' AND v_request.price_change_requested IS NOT NULL THEN
    v_derived_price := v_request.price_change_requested::INTEGER;
  ELSIF v_request.selected_quote_id IS NOT NULL THEN
    SELECT proposed_price::INTEGER INTO v_derived_price
    FROM request_quotes
    WHERE id = v_request.selected_quote_id;
  ELSE
    v_derived_price := p_final_price;
  END IF;

  IF v_derived_price IS NULL OR v_derived_price < 1 THEN
    RETURN QUERY SELECT FALSE, 'cannot_derive_final_price'::TEXT, v_job_id, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Complete
  UPDATE requests
  SET status = 'completed',
      final_price = v_derived_price
  WHERE id = p_request_id;

  UPDATE jobs
  SET commission_rate = 0,
      commission_amount = 0,
      completed_at = v_completed_at
  WHERE id = v_job_id;

  RETURN QUERY SELECT TRUE, 'completed'::TEXT, v_job_id, v_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_provider_job_atomic(UUID, UUID, INTEGER) TO service_role;
