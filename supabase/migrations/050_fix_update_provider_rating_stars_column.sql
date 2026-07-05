-- Migration 050: Fix update_provider_rating — restore 'stars' column (046 regression)
--
-- Root cause:
--   Migration 046 recreated the update_provider_rating trigger function to add
--   SET search_path = public, but its rewritten body referenced a non-existent
--   column `score` (SELECT COALESCE(AVG(score), 0) ... SELECT score FROM ratings).
--   The ratings table column is `stars` (migration 001). PL/pgSQL does not
--   validate column references at CREATE time, so 046 applied cleanly and every
--   subsequent INSERT INTO ratings fails inside the AFTER INSERT trigger with
--   Postgres error 42703 (column "score" does not exist), surfacing as a 500
--   from POST /api/ratings. Confirmed live in production via pg_proc.prosrc.
--
-- Fix:
--   Restore the ORIGINAL function body from migration 001 (lines 170–183):
--   ROUND(AVG(stars)::NUMERIC, 2) over the provider's last 50 ratings ordered
--   by created_at DESC, written to providers.rating. The ONLY addition kept
--   from 046 is the security option SET search_path = public (the legitimate
--   goal of the 046 recreation).
--
-- Scope:
--   - CREATE OR REPLACE FUNCTION public.update_provider_rating() only.
--   - The trigger binding trigger_update_provider_rating (AFTER INSERT ON
--     ratings, migration 001) is NOT touched — CREATE OR REPLACE preserves it.
--   - No grants/revokes needed: trigger functions are not callable via REST
--     (046 Category A documents the anon EXECUTE warning as a false positive).
--   - Migration 046 itself is NOT modified (applied migrations are immutable).
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.update_provider_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE providers
  SET rating = (
    SELECT ROUND(AVG(stars)::NUMERIC, 2)
    FROM (
      SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50
    ) last50
  )
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
