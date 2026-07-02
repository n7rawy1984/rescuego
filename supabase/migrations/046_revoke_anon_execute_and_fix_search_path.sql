-- Migration 046: Revoke anon EXECUTE on application RPCs + fix function_search_path_mutable
--
-- Addresses Supabase Security Advisor warnings (44 total) in three categories:
--
-- CATEGORY A (FALSE POSITIVES — NOT TOUCHED):
--   - st_estimatedextent variants       — PostGIS system function
--   - extension_in_public (postgis)     — system extension, intentional
--   - enforce_users_immutable_columns   — trigger function, not callable directly
--   - enforce_providers_immutable_columns — trigger function, not callable directly
--   - update_provider_rating            — trigger function (search_path fixed below;
--                                         anon EXECUTE warning is a false positive
--                                         because triggers cannot be called via REST)
--   - check_provider_suspension         — trigger function (same; search_path fixed below)
--   - is_admin                          — intentionally callable by authenticated role
--   - rls_policy_always_true on payout_log / stripe_events — intentional "no direct write"
--
-- CATEGORY B (REAL — anon role can call application RPCs via REST):
--   Pre-audit: 10 functions listed. After grepping all 001–045 migrations:
--   Already revoked in prior migrations:
--     admin_update_provider_status_atomic  (migration 041)
--     select_quote_atomic                  (migrations 040 + 045)
--     finalize_ppj_selection_atomic        (migration 045)
--     request_price_change_atomic          (migration 040)
--     respond_price_change_atomic          (migration 040)
--     expire_ppj_payment_selection_atomic  (migration 045)
--     get_nearby_open_requests             (migration 039 — REVOKE ALL FROM PUBLIC)
--     release_target_status                (migration 040)
--     reset_monthly_job_counters           (migration 022 — REVOKE ALL FROM PUBLIC/anon/
--                                          authenticated/service_role)
--   Still needs REVOKE in this migration:
--     expire_stale_open_requests           (defined in 007, never revoked from anon)
--     get_nearby_providers                 (defined in 002, never revoked from anon)
--
-- CATEGORY C (REAL — function_search_path_mutable):
--   Pre-audit: 4 functions listed. After grepping all 001–045 migrations:
--   Already fixed:
--     expire_stale_open_requests           (migration 007 line 18: SET search_path = public)
--     get_nearby_open_requests             (migration 039 line 360: SET search_path = public)
--   Still needs SET search_path = public:
--     get_nearby_providers                 (migration 002 — LANGUAGE sql, no SET search_path)
--     reset_monthly_job_counters           (migration 002 — LANGUAGE sql, no SET search_path)
--     update_provider_rating               (migration 001 — LANGUAGE plpgsql, no SET search_path)
--     check_provider_suspension            (migration 001 — LANGUAGE plpgsql, no SET search_path)
--
-- Idempotent: safe to re-run.
-- Does NOT modify any function logic, signatures, SECURITY DEFINER status, or RLS policies.

BEGIN;

-- ============================================================================
-- SECTION 1 — REVOKE EXECUTE FROM anon (Category B: remaining 2 functions)
-- ============================================================================

-- expire_stale_open_requests: called by cron only; anon must not call it.
-- Signature from migration 007 line 14: expire_stale_open_requests(p_cutoff TIMESTAMPTZ)
REVOKE EXECUTE ON FUNCTION public.expire_stale_open_requests(TIMESTAMPTZ) FROM anon;

-- get_nearby_providers: called by authenticated providers only; anon must not call it.
-- Signature from migration 002 lines 1–5:
--   get_nearby_providers(p_lng DOUBLE PRECISION, p_lat DOUBLE PRECISION,
--                        p_radius INTEGER DEFAULT 5000,
--                        p_stale_threshold TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes')
REVOKE EXECUTE ON FUNCTION public.get_nearby_providers(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TIMESTAMPTZ) FROM anon;

-- ============================================================================
-- SECTION 2 — ADD SET search_path = public (Category C: 4 functions)
-- Each function is recreated with CREATE OR REPLACE preserving the exact
-- signature, body, SECURITY DEFINER, and LANGUAGE. Only SET search_path
-- is added. Bodies are byte-for-byte identical to the originals.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1  get_nearby_providers
--      Original: migration 002 lines 1–45
--      Change: add SET search_path = public after LANGUAGE sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_nearby_providers(
  p_lng DOUBLE PRECISION,
  p_lat DOUBLE PRECISION,
  p_radius INTEGER DEFAULT 5000,
  p_stale_threshold TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes'
)
RETURNS TABLE (
  id UUID,
  plan TEXT,
  rating NUMERIC,
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.plan,
    p.rating,
    ST_Distance(
      pl.location::geography,
      ST_Point(p_lng, p_lat)::geography
    ) AS distance_meters
  FROM providers p
  JOIN provider_locations pl ON p.id = pl.provider_id
  WHERE
    p.status = 'active'
    AND pl.updated_at >= p_stale_threshold
    AND ST_DWithin(
      pl.location::geography,
      ST_Point(p_lng, p_lat)::geography,
      p_radius
    )
  ORDER BY
    CASE p.plan
      WHEN 'business' THEN 1
      WHEN 'pro' THEN 2
      WHEN 'starter' THEN 3
      WHEN 'pay_per_job' THEN 4
    END ASC,
    p.rating DESC,
    distance_meters ASC
  LIMIT 20;
$$;

-- ----------------------------------------------------------------------------
-- 2.2  reset_monthly_job_counters
--      Original: migration 002 lines 47–53
--      Change: add SET search_path = public after LANGUAGE sql
--      Note: all role privileges were already revoked in migration 022.
--      This recreate does not change privilege state; REVOKE in 022 persists.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_monthly_job_counters()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE providers SET jobs_this_month = 0 WHERE status = 'active';
$$;

-- Re-apply the privilege lockdown from migration 022 to ensure it survives
-- the CREATE OR REPLACE (which resets grants to default on some Postgres versions).
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM anon;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_monthly_job_counters() TO service_role;

-- ----------------------------------------------------------------------------
-- 2.3  update_provider_rating
--      Original: migration 001 lines 142–183
--      Change: add SET search_path = public after LANGUAGE plpgsql
--      This is a trigger function — not callable via REST directly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_provider_rating()
RETURNS TRIGGER AS $$
DECLARE
  new_rating NUMERIC;
BEGIN
  SELECT COALESCE(AVG(score), 0) INTO new_rating
  FROM (
    SELECT score
    FROM ratings
    WHERE provider_id = NEW.provider_id
    ORDER BY created_at DESC
    LIMIT 50
  ) last50;

  UPDATE providers
  SET rating = new_rating
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ----------------------------------------------------------------------------
-- 2.4  check_provider_suspension
--      Original: migration 001 lines 189–197
--      Change: add SET search_path = public after LANGUAGE plpgsql
--      This is a trigger function — not callable via REST directly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_provider_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rating < 3.0 AND (SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id) >= 5 THEN
    UPDATE providers SET status = 'suspended' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
