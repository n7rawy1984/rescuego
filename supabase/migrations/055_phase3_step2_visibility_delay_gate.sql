-- ============================================================================
-- Migration 055 — Tiered Dispatch Phase 3, Step 2: submit-time tier-delay
-- enforcement (Items A+B, TIERED_DISPATCH_051_ANALYSIS.md "Phase 3 Step 2").
--
-- Live-verification performed before writing this file (the "053 lesson"):
--   SELECT pg_get_functiondef('public.submit_quote_atomic(uuid,uuid,numeric,numeric,boolean)'::regprocedure);
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_schema='public' AND routine_name='submit_quote_atomic' ORDER BY grantee;
-- Confirmed: the live body is functionally/structurally identical to
-- 039_security_backstop.sql:145-319 (same 11 steps, same order, same
-- signature, SECURITY DEFINER, SET search_path = public) — no migration
-- between 040 and 054 redefines it. Live grants: service_role EXECUTE +
-- postgres (owner, implicit) EXECUTE only — no anon, no authenticated,
-- exactly matching 039's REVOKE ALL FROM PUBLIC/anon/authenticated + GRANT
-- TO service_role pattern, preserved verbatim below.
--
-- SCOPE (binding, Option A — see TIERED_DISPATCH_051_ANALYSIS.md Phase 3
-- Step 2 note): this migration enforces TIER-DELAY authorization ONLY. It
-- does NOT enforce online/GPS-freshness or radius/reachability eligibility
-- (053 applies those for the read path; the write path's GPS-freshness
-- check already exists in the route via QUOTE_STALE_MINUTES). After this
-- migration, "Can Quote" matches "Can See" for TIER TIMING ONLY, not full
-- eligibility parity. The "Quote Reachability Parity" item (reconciling the
-- route's 15-minute GPS-staleness allowance against 053's 5-minute rule,
-- plus write-path radius/reachability enforcement) is a NAMED, MANDATORY
-- Phase 3 follow-up — Phase 3 must not be marked "server-side enforcement
-- complete" until it ships. `compute_request_visibility_delay` below stays
-- delay-math only by design; a future `provider_can_quote_request` will
-- compose delay + active-capacity + GPS-freshness + reachability. Do not
-- merge those responsibilities into this helper.
--
-- BUG FIX vs. live 053 (Blocker 2, confirmed real defect in 053 as
-- currently deployed): 053's legacy-NULL branch
-- (providers_in_range_at_creation IS NULL) falls through to
-- COALESCE(<tier CASE>, 0) = 0 correctly, but the `+ visibility_reduced`
-- penalty is added OUTSIDE that COALESCE, so a legacy row with a
-- visibility_reduced provider gets a live 5-minute delay it should not
-- have, per the approved rule "legacy and zero-subscriber fallback = 0
-- delay, no penalty". This helper adds an explicit
-- `WHEN p_providers_in_range IS NULL THEN 0` short-circuit (mirroring the
-- zero-subscriber branch) so the bug is not carried into
-- submit_quote_atomic. 053 itself is intentionally NOT touched by this
-- migration (out of Step 2 scope) — it continues to carry this bug live
-- until Step 5 (053 helper adoption) fixes it by construction.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, unconditional REVOKE/GRANT.
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 055.0  Verify-first assertions (per the 046/054 lesson)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'requests'
      AND column_name = 'providers_in_range_at_creation'
  ) THEN
    RAISE EXCEPTION 'Migration 055 aborted: public.requests.providers_in_range_at_creation not found (expected from migration 051).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'requests'
      AND column_name = 'subscribers_in_range_at_creation'
  ) THEN
    RAISE EXCEPTION 'Migration 055 aborted: public.requests.subscribers_in_range_at_creation not found (expected from migration 052).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'visibility_reduced'
  ) THEN
    RAISE EXCEPTION 'Migration 055 aborted: public.providers.visibility_reduced not found (expected from migration 031).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_quote_atomic'
  ) THEN
    RAISE EXCEPTION 'Migration 055 aborted: public.submit_quote_atomic not found — re-verify the live function before proceeding.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 055.1  compute_request_visibility_delay — shared tier-delay helper
-- ----------------------------------------------------------------------------
-- Same tier-delay math as 053's visible_requests CTE (D1/D2/Q5), extracted
-- into a reusable STABLE SQL function so 053 (read path, Step 5) and
-- submit_quote_atomic (write path, this migration) compute an IDENTICAL
-- delay for the same inputs. Delay-math ONLY — no active-capacity, no
-- GPS-freshness, no reachability. See scope note above.
--
-- Inputs are the raw snapshot values + the calling provider's plan/flag,
-- not a request/provider row, so it can be unit-tested and called from
-- either RPC without a join.
CREATE OR REPLACE FUNCTION public.compute_request_visibility_delay(
  p_providers_in_range INTEGER,
  p_subscribers_in_range INTEGER,
  p_plan TEXT,
  p_visibility_reduced BOOLEAN
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    -- Q3 / zero-subscriber fallback: absolute override, 0 delay, no penalty.
    WHEN p_subscribers_in_range = 0 THEN 0
    -- Legacy pre-052 row (NULL snapshots): same treatment as zero-subscriber
    -- fallback — 0 delay, no penalty. This is the corrected branch (fixes
    -- the live 053 defect described above); it must never be merged back
    -- into the COALESCE below, or the penalty leak returns.
    WHEN p_providers_in_range IS NULL THEN 0
    ELSE
      COALESCE(
        CASE
          WHEN p_providers_in_range <= 10 THEN
            CASE p_plan
              WHEN 'business' THEN 0
              WHEN 'pro' THEN 2
              WHEN 'starter' THEN 4
              WHEN 'pay_per_job' THEN 6
              ELSE 6
            END
          WHEN p_providers_in_range <= 20 THEN
            CASE p_plan
              WHEN 'business' THEN 0
              WHEN 'pro' THEN 3
              WHEN 'starter' THEN 6
              WHEN 'pay_per_job' THEN 9
              ELSE 9
            END
          WHEN p_providers_in_range > 20 THEN
            CASE p_plan
              WHEN 'business' THEN 0
              WHEN 'pro' THEN 4
              WHEN 'starter' THEN 8
              WHEN 'pay_per_job' THEN 12
              ELSE 12
            END
        END,
        0
      )
      + CASE WHEN p_visibility_reduced THEN 5 ELSE 0 END
  END;
$$;

COMMENT ON FUNCTION public.compute_request_visibility_delay(INTEGER, INTEGER, TEXT, BOOLEAN) IS
  'Shared tier-delay math (D1/D2/Q5) for get_nearby_open_requests (053, read path) and submit_quote_atomic (055, write path). Delay-math ONLY -- does not compose active-capacity, GPS-freshness, or reachability (future provider_can_quote_request handles that). Fixes a live defect in 053: legacy NULL-snapshot rows resolve to 0 delay with no visibility_reduced penalty, matching the zero-subscriber fallback branch. 053 itself is not yet updated to call this helper (planned Step 5).';

REVOKE ALL ON FUNCTION public.compute_request_visibility_delay(INTEGER, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_request_visibility_delay(INTEGER, INTEGER, TEXT, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_request_visibility_delay(INTEGER, INTEGER, TEXT, BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 055.2  submit_quote_atomic — Step 2b tier-delay authorization gate
-- ----------------------------------------------------------------------------
-- Every step below is byte-identical to the live body (039_security_backstop.sql
-- lines 145-319), confirmed via the live pg_get_functiondef query cited above.
-- The ONLY change is the new Step 2b, inserted after Step 2 (provider lock/
-- validation) and before the existing Step 3 (already-quoted check) — it
-- needs v_request (Step 1) and v_provider (Step 2), so it cannot run earlier.
-- Return signature is unchanged (TABLE(success, reason, quote_id)), so
-- CREATE OR REPLACE is used in place -- no DROP FUNCTION needed (unlike 053,
-- which changed its return columns).
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
  v_min_fair NUMERIC(10,2);
  v_max_fair NUMERIC(10,2);
  v_visibility_delay_minutes INTEGER;
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

  -- 2b. Tier-delay authorization gate (055 / Phase 3 Item A). Mirrors
  -- get_nearby_open_requests' (053) delay math via the shared
  -- compute_request_visibility_delay() helper so "Can Quote" matches
  -- "Can See" for TIER TIMING ONLY (binding scope decision, Option A --
  -- see TIERED_DISPATCH_051_ANALYSIS.md). Does NOT enforce GPS-freshness or
  -- radius/reachability -- those remain the route's/053's responsibility
  -- until the future "Quote Reachability Parity" item ships. Wrapped in its
  -- own exception handler: a computation failure must reject the quote
  -- with a diagnosable reason, not abort the whole transaction opaquely.
  BEGIN
    v_visibility_delay_minutes := public.compute_request_visibility_delay(
      v_request.providers_in_range_at_creation,
      v_request.subscribers_in_range_at_creation,
      v_provider.plan,
      v_provider.visibility_reduced
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, 'visibility_calc_failed'::TEXT, NULL::UUID;
    RETURN;
  END;

  IF v_visibility_delay_minutes IS NULL THEN
    RETURN QUERY SELECT FALSE, 'visibility_calc_failed'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF (now() - v_request.created_at) < (v_visibility_delay_minutes * INTERVAL '1 minute') THEN
    RETURN QUERY SELECT FALSE, 'visibility_window_not_open'::TEXT, NULL::UUID;
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

  -- 7. Validate price range from fair_price_config (C5 / D2 re-enabled)
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
    -- No config available at all: fail open on validity only (see header note).
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

-- Grants: identical to the live grants confirmed above -- no anon, no
-- authenticated, service_role only (plus the implicit postgres owner grant).
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO service_role;

COMMIT;
