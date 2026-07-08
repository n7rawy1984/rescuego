-- ============================================================================
-- Migration 051 — Tiered Dispatch: Phase 1 schema foundation
-- See TIERED_DISPATCH_051_ANALYSIS.md (D1–D6) and the session resolutions
-- (R1–R6) for full context. This migration is SCHEMA ONLY:
--   - NO RPC changes, NO trigger changes, NO lifecycle changes,
--     NO realtime changes, NO API changes, NO pricing changes,
--     NO dispatch implementation.
--   - get_provider_limits() below is a brand-new, additive, STABLE lookup
--     function. It is not called by any existing RPC. Runtime adoption is
--     Phase 3.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + re-add,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 051.1  requests: online-provider snapshot count (D1/Q2/R1)
-- ----------------------------------------------------------------------------
-- Raw count ONLY, frozen at request-creation time. The tier bucket (e.g.
-- <=10 / 11-20 / 21+) is deliberately NOT stored here — it must always be
-- derived from this count using current policy at read time (Phase 2/3),
-- so a future policy change never requires a backfill or risks a stale
-- stored label drifting from the live threshold definition.
-- NULL for all existing rows and for every row until the Phase 2/3 write
-- path populates it (no backfill possible — the historical online-provider
-- count at each past request's creation time cannot be reconstructed).
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS providers_in_range_at_creation INTEGER DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 051.2  requests: destination emirate (R6)
-- ----------------------------------------------------------------------------
-- Foundation column for future two-leg pricing (LB-1, deferred). Nullable —
-- only tow requests will populate it once a later phase wires the API/UI.
-- CHECK constraint enforces exactly the seven UAE emirates, using the same
-- English spellings already used by src/lib/geo.ts's UAE_REGIONS, so a
-- future write from getUaeLocation() can never violate this constraint.
-- Free text remains available via the existing `destination` / `destination_area`
-- columns (migration 031) for non-emirate descriptive detail.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS destination_emirate TEXT DEFAULT NULL;

ALTER TABLE public.requests DROP CONSTRAINT IF EXISTS requests_destination_emirate_check;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_destination_emirate_check
  CHECK (destination_emirate IS NULL OR destination_emirate IN (
    'Dubai',
    'Abu Dhabi',
    'Sharjah',
    'Ajman',
    'Ras Al Khaimah',
    'Fujairah',
    'Umm Al Quwain'
  ));

-- ----------------------------------------------------------------------------
-- 051.3  request_quotes: refund marker (D5)
-- ----------------------------------------------------------------------------
-- Single nullable TIMESTAMPTZ, set once, mirroring the existing idempotent
-- marker pattern already proven in this codebase (ppj_payments.recovery_
-- credit_restored_at, migration 012; requests.cancellation_compensated_at,
-- migration 049). No separate refund-reason/type column: D5's effect is
-- uniform (exclude this one quote row from the future daily-quote-count
-- query in submit_quote_atomic) regardless of which cancellation path
-- triggered it, so there is no second outcome to record.
-- Partial index targets the exact predicate shape the Phase 3 daily-count
-- query will use (provider_id + sent_at range, excluding refunded rows).
ALTER TABLE public.request_quotes
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_request_quotes_provider_daily_unrefunded
  ON public.request_quotes (provider_id, sent_at)
  WHERE refunded_at IS NULL;

-- ----------------------------------------------------------------------------
-- 051.4  get_provider_limits(plan) — single source of truth (R5)
-- ----------------------------------------------------------------------------
-- Consolidates the plan-limit numbers currently duplicated three times:
--   - submit_quote_atomic (migration 039, LIVE, unmodified by this migration)
--   - select_quote_atomic (migration 047, LIVE, unmodified by this migration)
--   - src/types/index.ts (DAILY_VISIBILITY_LIMITS, MAX_ACTIVE_JOBS, SUBSCRIPTION_PLANS)
--   - src/lib/provider-allowance.ts (getMaxActiveJobs, getDailyVisibilityLimit)
--
-- Values below are EXACT LIVE-BEHAVIOR PARITY with the current production
-- RPCs — verified line-by-line against 039_security_backstop.sql:213-227
-- (v_max_active / v_daily_limit) and 047_overage_gate_v2_and_sla_reset_
-- atomic.sql:104-108 (v_plan_limit). No values are changed here:
--   - monthly_limit:      starter 15, pro 35, business NULL (unlimited),
--                         pay_per_job NULL (no monthly cap, per D4/Q4 —
--                         PPJ must never be given a monthly cap)
--   - daily_quote_limit:  starter 5, pro 10, business 20, pay_per_job 3
--                         (NOT uniform — confirmed live in 039; a uniform
--                         value would silently change subscriber behavior
--                         once Phase 3 wires this function in)
--   - concurrent_limit:   starter 1, pro 2, business 5, pay_per_job 1
--
-- This function has no callers yet (Phase 1 = schema only). Phase 3 rewrites
-- submit_quote_atomic / select_quote_atomic to call this instead of their own
-- hardcoded CASE blocks, and the plan-limit numbers in src/types/index.ts and
-- src/lib/provider-allowance.ts are retired in favor of it at that time.
CREATE OR REPLACE FUNCTION public.get_provider_limits(p_plan TEXT)
RETURNS TABLE (
  monthly_limit INTEGER,
  daily_quote_limit INTEGER,
  concurrent_limit INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (CASE p_plan
      WHEN 'starter' THEN 15
      WHEN 'pro' THEN 35
      WHEN 'business' THEN NULL
      WHEN 'pay_per_job' THEN NULL
      ELSE NULL
    END)::INTEGER AS monthly_limit,
    (CASE p_plan
      WHEN 'starter' THEN 5
      WHEN 'pro' THEN 10
      WHEN 'business' THEN 20
      WHEN 'pay_per_job' THEN 3
      ELSE 3
    END)::INTEGER AS daily_quote_limit,
    (CASE p_plan
      WHEN 'starter' THEN 1
      WHEN 'pro' THEN 2
      WHEN 'business' THEN 5
      WHEN 'pay_per_job' THEN 1
      ELSE 1
    END)::INTEGER AS concurrent_limit;
$$;

COMMENT ON FUNCTION public.get_provider_limits(TEXT) IS
'Phase 1 foundation only.
Values mirror the live production behavior as of migration 039.
No live RPC consumes this function yet.
Runtime adoption begins in Phase 3.';

REVOKE ALL ON FUNCTION public.get_provider_limits(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_provider_limits(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_limits(TEXT) TO service_role;

COMMIT;
