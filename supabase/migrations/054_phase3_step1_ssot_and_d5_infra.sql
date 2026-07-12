-- ============================================================================
-- Migration 054 — Tiered Dispatch Phase 3, Step 1: silent infrastructure
-- See TIERED_DISPATCH_051_ANALYSIS.md (Phase 3 detailed design, pending
-- approval note) for full context. This migration is SILENT INFRASTRUCTURE
-- ONLY — nothing here is called by any existing RPC or route yet:
--   - NO changes to submit_quote_atomic, select_quote_atomic, or
--     cancel_request_and_compensate_atomic. Items A-F land in later,
--     separately-reviewed migrations per the approved sequencing.
--   - get_customer_abuse_limits() below is a brand-new, additive, STABLE
--     lookup function mirroring get_provider_limits' shape (051.4). Unused
--     until Items E (D5 restoration) and F (creation/cancellation limits)
--     wire it in.
--   - idx_request_quotes_provider_refunded_at is a brand-new, additive index
--     supporting the D5 pair-cap query Item E adds later. Zero effect on any
--     live query today — no existing query filters on refunded_at IS NOT NULL.
--   - NO schema change for request_quotes.selected_at: verified below (and
--     in the DO block) that the column already exists since migration 031
--     and is reused as-is. No duplicate column added.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- unconditional REVOKE/GRANT. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 054.0  Verify-first assertions
-- Every assumption the Phase 3 design relies on, checked at deploy time.
-- Aborts the whole migration (transactional) with a clear message if any
-- schema assumption has drifted since the design was written.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  -- request_quotes.selected_at: added migration 031 line 71
  -- (`selected_at TIMESTAMPTZ DEFAULT NULL`). Item D (later) populates it for
  -- the subscriber selection branch; this migration does not touch it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_quotes'
      AND column_name = 'selected_at' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Migration 054 aborted: public.request_quotes.selected_at not found (expected since migration 031). Re-verify Phase 3 design before proceeding.';
  END IF;

  -- request_quotes.refunded_at: added migration 051.3. D5's restoration
  -- marker; this migration adds only the missing pair-cap index, not the
  -- column itself.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_quotes'
      AND column_name = 'refunded_at' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Migration 054 aborted: public.request_quotes.refunded_at not found (expected from migration 051.3).';
  END IF;

  -- provider_id / request_id: join keys for the D5 pair-cap query (Item E).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_quotes' AND column_name = 'provider_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_quotes' AND column_name = 'request_id'
  ) THEN
    RAISE EXCEPTION 'Migration 054 aborted: public.request_quotes.provider_id or request_id not found (expected from migration 031).';
  END IF;

  -- requests.customer_id: join target for the D5 pair-cap query.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'customer_id'
  ) THEN
    RAISE EXCEPTION 'Migration 054 aborted: public.requests.customer_id not found.';
  END IF;

  -- get_provider_limits(): this migration's new function mirrors its shape
  -- and grant pattern; if it is missing, something upstream regressed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_provider_limits'
  ) THEN
    RAISE EXCEPTION 'Migration 054 aborted: public.get_provider_limits() not found (expected from migration 051.4).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 054.1  D5 pair-cap index (D-Restore)
-- ----------------------------------------------------------------------------
-- idx_request_quotes_provider_daily_unrefunded (051.3) covers
-- WHERE refunded_at IS NULL (daily-quote-count exclusion, for the future
-- Item B/C submit-time count). The D5 pair-cap query needs the OPPOSITE
-- predicate — count a (customer, provider) pair's refunded_at rows in the
-- trailing 24h:
--   SELECT COUNT(*) FROM request_quotes rq
--   JOIN requests r ON r.id = rq.request_id
--   WHERE rq.provider_id = :provider_id
--     AND r.customer_id = :customer_id
--     AND rq.refunded_at >= now() - interval '24 hours';
-- This index lets Postgres find the (small) set of a given provider's
-- refunded quotes in the lookback window before joining to requests to
-- filter by customer_id.
CREATE INDEX IF NOT EXISTS idx_request_quotes_provider_refunded_at
  ON public.request_quotes (provider_id, refunded_at)
  WHERE refunded_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 054.2  get_customer_abuse_limits() — D-SSOT for D-Create / D-Cancel /
-- D-Restore numeric thresholds (Phase 3 detailed design, Phase-wide §1)
-- ----------------------------------------------------------------------------
-- Mirrors get_provider_limits' shape and grant pattern exactly (051.4): a
-- brand-new, additive, STABLE, no-argument lookup function. Not called by
-- any existing RPC or route yet — Items E (restoration window/pair-cap) and
-- F (creation/cancellation rate limits) wire it in later. Unlike
-- get_provider_limits, these thresholds are NOT plan-tier-dependent (same
-- values for every customer), so no parameter is needed.
--
-- Values are the approved D-Create / D-Cancel (harm-tiered) / D-Restore
-- decisions verbatim:
--   create_per_hour / create_per_24h             = 5 / 15
--   cancel_early_per_hour / cancel_early_per_24h  = 5 / 15  (before selection)
--   cancel_post_per_hour / cancel_post_per_24h    = 2 / 5   (after selection/acceptance)
--   restore_window_minutes                        = 15  (from request_quotes.selected_at)
--   restore_pair_cap_24h                          = 3   (same customer+provider pair)
CREATE OR REPLACE FUNCTION public.get_customer_abuse_limits()
RETURNS TABLE (
  create_per_hour INTEGER,
  create_per_24h INTEGER,
  cancel_early_per_hour INTEGER,
  cancel_early_per_24h INTEGER,
  cancel_post_per_hour INTEGER,
  cancel_post_per_24h INTEGER,
  restore_window_minutes INTEGER,
  restore_pair_cap_24h INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 5, 15, 5, 15, 2, 5, 15, 3;
$$;

COMMENT ON FUNCTION public.get_customer_abuse_limits() IS
  'Single source of truth for D-Create/D-Cancel/D-Restore numeric thresholds (Phase 3 detailed design). Not plan-tier-dependent. Silent infra as of migration 054 -- not yet called by any RPC or route; Items E/F wire it in.';

-- Grants: identical pattern to get_provider_limits (051.4) — internal-only,
-- callable solely by the service_role RPCs/routes that will consume it.
REVOKE ALL ON FUNCTION public.get_customer_abuse_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_abuse_limits() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_abuse_limits() TO service_role;

COMMIT;
