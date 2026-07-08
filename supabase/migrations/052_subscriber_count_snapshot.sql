-- ============================================================================
-- Migration 052 — Tiered Dispatch: Phase 1 schema foundation (gap closure)
-- Closes a gap left in migration 051: providers_in_range_at_creation alone
-- cannot distinguish "15 providers, some subscribers" from "15 providers,
-- all PPJ" — same count, opposite dispatch behavior (zero-subscriber
-- fallback). This migration is SCHEMA ONLY:
--   - NO RPC changes, NO trigger changes, NO lifecycle changes,
--     NO realtime changes, NO API changes, NO pricing changes,
--     NO dispatch implementation, NO other objects.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 052.1  requests: online-subscriber snapshot count
-- ----------------------------------------------------------------------------
-- Second raw count alongside 051's providers_in_range_at_creation (untouched
-- by this migration). Storing the count rather than a boolean keeps read-time
-- derivation flexible, allows future policy tuning to use the subscriber
-- count directly, is useful for analytics, costs the same as a boolean, and
-- stays consistent with the raw-count philosophy established in 051.
-- NULL for all existing rows and for every row until the request-creation
-- API is updated in a later phase to populate it (no backfill possible —
-- the historical online-subscriber count at each past request's creation
-- time cannot be reconstructed).
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS subscribers_in_range_at_creation INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.requests.subscribers_in_range_at_creation IS
'Frozen count of online subscribers (starter/pro/business, fresh GPS <=5min) within 150km at request creation.
NULL = pre-052 row.
0 = zero-subscriber fallback (everyone sees immediately).
Populated by the request-creation API in the API phase.
No live code writes it yet.';

COMMIT;
