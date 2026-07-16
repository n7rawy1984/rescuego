-- ============================================================================
-- Migration 057 — Tiered Dispatch Phase 3, Step 3: credit consumption at
-- selection + SSOT wiring (Items C+D, TIERED_DISPATCH_051_ANALYSIS.md).
--
-- Live-verification performed before writing this file (the "046/053/055
-- lesson"): Medo ran, in the Supabase SQL Editor, on July 16, 2026:
--   SELECT pg_get_functiondef('public.select_quote_atomic(uuid,uuid,uuid)'::regprocedure);
--   SELECT pg_get_functiondef('public.submit_quote_atomic(uuid,uuid,numeric,numeric,boolean)'::regprocedure);
--   SELECT has_function_privilege('public'/'anon'/'authenticated'/'service_role', ...)
-- Confirmed: submit_quote_atomic's live body matches migration 055 exactly
-- (tier-delay gate present, unchanged return shape). select_quote_atomic's
-- live body was diffed in full against migration 048 as the first
-- implementation step of this session -- no drift found; the body below is
-- migration 048's body verbatim except for the approved changes in Section
-- 057.2. Live grants for both functions, confirmed as of July 16, 2026:
-- PUBLIC=false, anon=false, authenticated=false, service_role=true -- this
-- is restored byte-for-byte at the end of this migration (Section 057.3).
--
-- BINDING ACCOUNTING SEMANTICS (approved design, do not reopen):
--   - jobs_this_month is the factual monthly consumed-job-slot counter. It
--     increments on every successful subscriber selection, unconditionally,
--     regardless of whether the selection used base allowance, a credit, or
--     request-specific overage. It is decremented only by existing
--     qualifying release paths (unchanged) and reset only by the existing
--     monthly reset mechanism (unchanged).
--   - job_credit_balance is consumed ONLY at customer-selection time, ONLY
--     after the base monthly limit is reached, and NEVER when
--     requests.overage_cleared = TRUE for the request being selected.
--     Submitting many quotes and being selected zero times consumes zero
--     credits (job_credit_balance is not touched by submit_quote_atomic,
--     before or after this migration).
--   - The previously live formula "monthly_limit + job_credit_balance" (used
--     nowhere in SQL, but mirrored in the application layer's
--     getProviderAllowance()) becomes invalid the moment credits become
--     consumable here: each credit-funded selection increments
--     jobs_this_month by 1 AND would decrement a limit that already
--     included that credit, double-counting the consumption. This
--     migration does not touch the application layer (see the accompanying
--     non-SQL diff for the corrected src/lib/provider-allowance.ts formula:
--     remaining = max(0, planLimit - jobsThisMonth) + creditBalance).
--   - D5 restoration remains OUT OF SCOPE (blocked on the Item E abuse-review
--     persistence mechanism, per migration 054's header and LB-12).
--   - Submission blocking on exhaustion is explicitly DEFERRED (see
--     DEFERRED_PRODUCT_BACKLOG.md new backlog item): the current
--     pre-submission/pre-quote overage-payment path is unreachable in the
--     live V2 marketplace UI (the only trigger, the legacy
--     /api/provider/requests/accept 402 branch, is dead code per LB-6's
--     unconditional V2_QUOTE_REQUIRED guard), requests.overage_cleared has
--     no live pre-quote writer, and the current request-bound overage model
--     has no refund/reuse if a provider pays and is never selected.
--     Hard-blocking submission today would be a genuine dead end for an
--     exhausted provider. The exhaustion WARNING is therefore implemented
--     entirely in the application layer (src/app/api/provider/jobs/quote/
--     route.ts, best-effort, additive `warning_code` field) -- NOT inside
--     submit_quote_atomic. This RPC's contract (signature, return shape,
--     executable logic) is otherwise completely unchanged by this
--     migration; only the hardcoded Step 4 plan-limit CASE blocks are
--     replaced with get_provider_limits() calls (SSOT wiring, no behavior
--     change -- the values are identical, verified against 051's own
--     line-by-line parity comment).
--   - Period-boundary ordering with the monthly reset mechanism: both
--     select_quote_atomic's provider-row FOR UPDATE lock (this migration)
--     and the existing monthly reset job operate under standard row-level
--     locking. Whichever transaction commits first determines which
--     allowance period a given selection is attributed to. This is a
--     normal, serialized ordering guarantee -- not an uncontrolled race and
--     not a financial-loss condition -- because the credit decrement and the
--     jobs_this_month increment happen inside the SAME already-locked
--     transaction as every other write in this function.
--
-- Idempotent: CREATE OR REPLACE FUNCTION (both signatures/return shapes are
-- unchanged from the live versions -- no DROP needed, avoiding the grant-
-- reset risk documented in AGENTS.md / the migration-048 lesson), followed
-- by unconditional REVOKE/GRANT. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 057.0  Verify-first assertions (per the 046/053/054/055 lesson)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_provider_limits'
  ) THEN
    RAISE EXCEPTION 'Migration 057 aborted: public.get_provider_limits not found (expected from migration 051).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'job_credit_balance'
  ) THEN
    RAISE EXCEPTION 'Migration 057 aborted: public.providers.job_credit_balance not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'overage_cleared'
  ) THEN
    RAISE EXCEPTION 'Migration 057 aborted: public.requests.overage_cleared not found (expected from migration 047).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'select_quote_atomic'
  ) THEN
    RAISE EXCEPTION 'Migration 057 aborted: public.select_quote_atomic not found — re-verify the live function before proceeding.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_quote_atomic'
  ) THEN
    RAISE EXCEPTION 'Migration 057 aborted: public.submit_quote_atomic not found — re-verify the live function before proceeding.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 057.1  select_quote_atomic — credit consumption at selection (Items C+D)
-- ----------------------------------------------------------------------------
-- Body is byte-identical to migration 048 EXCEPT:
--   (a) v_plan_limit (hardcoded CASE) replaced with v_monthly_limit, sourced
--       from get_provider_limits() -- binding decision #6, single source of
--       truth (SSOT).
--   (b) The overage gate block (048 lines 114-128) is replaced with the
--       four-case subscriber-selection behavior below. Case D's returned
--       row (FALSE, 'overage_required', ...) is textually identical to
--       048's existing behavior -- callers see no contract change for that
--       reason code.
-- Everything else (request/quote validation, PPJ branch, request/quote
-- status updates, the unconditional jobs_this_month increment, the jobs
-- insert, dispatch-log update, return row) is preserved unchanged.
CREATE OR REPLACE FUNCTION public.select_quote_atomic(
  p_customer_id UUID,
  p_request_id  UUID,
  p_quote_id    UUID
)
RETURNS TABLE (
  success          BOOLEAN,
  reason           TEXT,
  provider_name    TEXT,
  provider_phone   TEXT,
  provider_rating  NUMERIC,
  payment_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request       requests%ROWTYPE;
  v_quote         request_quotes%ROWTYPE;
  v_provider      providers%ROWTYPE;
  v_user          users%ROWTYPE;
  v_provider_id   UUID;
  v_monthly_limit INT;
BEGIN
  SELECT * INTO v_request FROM requests
  WHERE id = p_request_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_request.status <> 'quoted' THEN
    RETURN QUERY SELECT FALSE, 'request_not_in_quoted_status'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  SELECT * INTO v_quote FROM request_quotes
  WHERE id = p_quote_id AND request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'quote_not_found'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_quote.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'quote_not_pending'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  IF v_quote.expires_at < now() THEN
    RETURN QUERY SELECT FALSE, 'quote_expired'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE; RETURN;
  END IF;

  v_provider_id := v_quote.provider_id;

  -- Unchanged since migration 048: FOR UPDATE on the provider row. This same
  -- lock now also serializes the credit-consumption UPDATE below (057).
  SELECT * INTO v_provider FROM providers
  WHERE id = v_provider_id
  FOR UPDATE;

  -- PPJ BRANCH: unchanged from migration 045.
  IF v_provider.plan = 'pay_per_job' THEN
    UPDATE requests
    SET status                    = 'selected_pending_payment',
        accepted_by               = v_provider_id,
        selected_quote_id         = p_quote_id,
        payment_window_started_at = now(),
        last_release_reason       = NULL,
        accepted_at               = NULL
    WHERE id = p_request_id;

    UPDATE request_quotes
    SET status = 'selected', selected_at = now()
    WHERE id = p_quote_id;

    UPDATE provider_dispatch_log
    SET was_selected = TRUE
    WHERE provider_id = v_provider_id
      AND request_id = p_request_id
      AND event_type = 'quote_submitted';

    RETURN QUERY SELECT TRUE, 'selected_pending_payment'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::NUMERIC, TRUE;
    RETURN;
  END IF;

  -- SUBSCRIBER BRANCH: monthly limit now sourced from get_provider_limits()
  -- (051 SSOT) instead of a hardcoded CASE (binding decision #6). NULL
  -- monthly_limit (business) means "never at/over limit" by construction --
  -- unchanged behavior vs. 048's ELSE -1 sentinel.
  SELECT monthly_limit INTO v_monthly_limit
  FROM public.get_provider_limits(v_provider.plan);

  IF v_monthly_limit IS NOT NULL
     AND COALESCE(v_provider.jobs_this_month, 0) >= v_monthly_limit
     AND NOT COALESCE(v_request.overage_cleared, FALSE)
  THEN
    -- At/over the monthly limit and this request's overage is not cleared.
    -- Case B: a credit is available -- consume exactly one, column-relative,
    -- under the provider-row lock already held above, then fall through to
    -- the unchanged assignment logic below (057 Item C+D, decision #2).
    -- Case D: no credit available -- preserve the existing overage_required
    -- result verbatim (identical to 048's prior unconditional block).
    IF COALESCE(v_provider.job_credit_balance, 0) > 0 THEN
      UPDATE providers
      SET job_credit_balance = job_credit_balance - 1
      WHERE id = v_provider_id;
    ELSE
      RETURN QUERY SELECT FALSE, 'overage_required'::TEXT,
        NULL::TEXT, NULL::TEXT, NULL::NUMERIC, FALSE;
      RETURN;
    END IF;
  END IF;
  -- Case A (under limit) and Case C (overage_cleared = TRUE) fall through
  -- here with no credit consumed -- unchanged assignment behavior below.

  -- Subscriber assignment: identical to pre-047 behavior.
  UPDATE requests
  SET status            = 'accepted',
      accepted_by       = v_provider_id,
      selected_quote_id = p_quote_id,
      accepted_at       = now()
  WHERE id = p_request_id;

  UPDATE request_quotes
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND id <> p_quote_id
    AND status = 'pending';

  INSERT INTO jobs (request_id, provider_id)
  VALUES (p_request_id, v_provider_id)
  ON CONFLICT (request_id)
  DO UPDATE SET provider_id = EXCLUDED.provider_id;

  -- Unconditional on every successful subscriber selection, regardless of
  -- whether base allowance, a credit, or cleared overage funded it
  -- (binding decision #1) -- unchanged from 048.
  UPDATE providers
  SET jobs_this_month = COALESCE(jobs_this_month, 0) + 1
  WHERE id = v_provider_id;

  UPDATE provider_dispatch_log
  SET was_selected = TRUE
  WHERE provider_id = v_provider_id
    AND request_id = p_request_id
    AND event_type = 'quote_submitted';

  SELECT * INTO v_user FROM users WHERE id = v_provider_id;

  RETURN QUERY SELECT TRUE, 'selected'::TEXT,
    v_user.name, v_user.phone, v_provider.rating, FALSE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 057.2  submit_quote_atomic — SSOT wiring ONLY (no behavior change)
-- ----------------------------------------------------------------------------
-- Body is byte-identical to migration 055 EXCEPT Step 4: the two hardcoded
-- CASE blocks (v_max_active, v_daily_limit) are replaced with a single call
-- to get_provider_limits() (051 SSOT). Values are unchanged (verified
-- against 051's own line-by-line live-parity comment) -- this is wiring
-- only, not a limit change. No new steps, no new reason codes, no
-- exhaustion/credit logic added here (binding decision #3 -- the
-- exhaustion warning lives entirely in the application layer).
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

  -- 2b. Tier-delay authorization gate (055 / Phase 3 Item A). Unchanged.
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

  -- 4. Determine plan limits -- SSOT wiring (057): get_provider_limits()
  -- replaces the two hardcoded CASE blocks that lived here since migration
  -- 039. Values are identical (verified against 051's live-parity comment):
  -- concurrent_limit = starter 1 / pro 2 / business 5 / pay_per_job 1;
  -- daily_quote_limit = starter 5 / pro 10 / business 20 / pay_per_job 3.
  SELECT daily_quote_limit, concurrent_limit
  INTO v_daily_limit, v_max_active
  FROM public.get_provider_limits(v_provider.plan);

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

-- ----------------------------------------------------------------------------
-- 057.3  Grants — restore the verified pre-057 baseline exactly
-- ----------------------------------------------------------------------------
-- Per AGENTS.md Function Grant Discipline: every CREATE OR REPLACE restates
-- REVOKE ALL FROM PUBLIC/anon/authenticated, then GRANT EXECUTE only to the
-- roles proven necessary. Both functions here are called exclusively via
-- admin (service_role) clients:
--   - select_quote_atomic: src/app/api/customer/quote/select/route.ts (admin client)
--   - submit_quote_atomic: src/app/api/provider/jobs/quote/route.ts (admin client)
-- Not relying on migration 056's default privileges (explicit restatement,
-- per this session's instruction) -- CREATE OR REPLACE does not reset an
-- existing ACL, but it is verified against the live grant here, not assumed.
REVOKE ALL ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_quote_atomic(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote_atomic(UUID, UUID, NUMERIC, NUMERIC, BOOLEAN) TO service_role;

COMMIT;
