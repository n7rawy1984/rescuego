-- ============================================================================
-- Migration 053 — Tiered Dispatch Phase 2: get_nearby_open_requests redesign
-- Implements D1/D2 (tier-delay visibility), R1 (frozen <10-provider radius
-- expansion), R3 (elapsed time from created_at only), Q5 (visibility_reduced
-- +5min), and the approved Q-A/Q-B/Q-C resolutions from the Phase 2 design
-- review (see TIERED_DISPATCH_051_ANALYSIS.md §5).
--
-- RETURN TYPE CHANGES (adds visible_at) -> CREATE OR REPLACE cannot alter a
-- return type in place. DROP FUNCTION with the exact live argument list is
-- required first (same lesson as migration 047's drop-and-recreate), then
-- CREATE, then the exact live grants are re-applied verbatim (verified
-- against 039_security_backstop.sql:399-400 before writing this file — this
-- function has only a PUBLIC revoke + an authenticated/service_role grant,
-- NOT the anon+authenticated double-revoke pattern used by other RPCs).
--
-- Everything not explicitly required by D1/D2/R1/R3/Q5/Q-A/Q-B/Q-C is
-- preserved byte-identical to the live 039 body: the current_provider CTE's
-- join/filter conditions, the full masked SELECT list (customer_id/
-- location_address/note/final_price -> NULL), destination/destination_area/
-- fuzzy_latitude/fuzzy_longitude passthrough, status/accepted_by filter,
-- ORDER BY, LIMIT, LANGUAGE/STABLE/SECURITY DEFINER/search_path.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_nearby_open_requests(integer, integer, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_nearby_open_requests(
  p_radius integer DEFAULT 150000,
  p_limit integer DEFAULT 20,
  p_stale_threshold timestamp with time zone DEFAULT (now() - '00:05:00'::interval)
)
RETURNS TABLE(
  id uuid,
  customer_id uuid,
  location_address text,
  problem_type text,
  note text,
  status text,
  accepted_by uuid,
  price_estimate_min integer,
  price_estimate_max integer,
  final_price integer,
  created_at timestamptz,
  distance_meters double precision,
  destination text,
  destination_area text,
  fuzzy_latitude numeric,
  fuzzy_longitude numeric,
  visible_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH current_provider AS (
    SELECT pl.location, p.plan, p.visibility_reduced
    FROM providers p
    JOIN provider_locations pl ON pl.provider_id = p.id
    WHERE
      p.id = auth.uid()
      AND p.status = 'active'
      AND pl.updated_at >= p_stale_threshold
    LIMIT 1
  ),
  -- New CTE (Phase 2 addition). Computes each request's total tier-delay in
  -- minutes, once, so both the visibility gate and visible_at reuse the same
  -- value instead of duplicating the CASE expression.
  -- Q3/zero-subscriber fallback is an absolute override (0, including the
  -- visibility_reduced penalty). Otherwise: NULL providers_in_range_at_creation
  -- (legacy/pre-population row) resolves to 0 tier-delay via COALESCE - this
  -- never hides a request, it is always at least as visible as a populated
  -- row. visibility_reduced adds +5min on top in the non-fallback branch.
  visible_requests AS (
    SELECT
      r.id,
      (
        CASE
          WHEN r.subscribers_in_range_at_creation = 0 THEN 0
          ELSE
            COALESCE(
              CASE
                WHEN r.providers_in_range_at_creation <= 10 THEN
                  CASE cp.plan
                    WHEN 'business' THEN 0
                    WHEN 'pro' THEN 2
                    WHEN 'starter' THEN 4
                    WHEN 'pay_per_job' THEN 6
                    ELSE 6
                  END
                WHEN r.providers_in_range_at_creation <= 20 THEN
                  CASE cp.plan
                    WHEN 'business' THEN 0
                    WHEN 'pro' THEN 3
                    WHEN 'starter' THEN 6
                    WHEN 'pay_per_job' THEN 9
                    ELSE 9
                  END
                WHEN r.providers_in_range_at_creation > 20 THEN
                  CASE cp.plan
                    WHEN 'business' THEN 0
                    WHEN 'pro' THEN 4
                    WHEN 'starter' THEN 8
                    WHEN 'pay_per_job' THEN 12
                    ELSE 12
                  END
              END,
              0
            )
            + CASE WHEN cp.visibility_reduced THEN 5 ELSE 0 END
        END
      ) AS total_delay_minutes
    FROM requests r
    CROSS JOIN current_provider cp
  )
  SELECT
    r.id,
    NULL::UUID AS customer_id,
    NULL::TEXT AS location_address,
    r.problem_type,
    NULL::TEXT AS note,
    r.status,
    r.accepted_by,
    r.price_estimate_min,
    r.price_estimate_max,
    NULL::INTEGER AS final_price,
    r.created_at,
    ST_Distance(r.location::geography, cp.location::geography) AS distance_meters,
    r.destination,
    r.destination_area,
    r.fuzzy_latitude,
    r.fuzzy_longitude,
    r.created_at + (vd.total_delay_minutes * INTERVAL '1 minute') AS visible_at
  FROM requests r
  CROSS JOIN current_provider cp
  JOIN visible_requests vd ON vd.id = r.id
  WHERE
    r.status IN ('open', 'quoted')
    AND r.accepted_by IS NULL
    -- R1 (frozen expansion) + Q-A: a recorded (non-NULL) count strictly below
    -- 10 drops the distance filter entirely - no cap, nearest-first ordering
    -- still applies via ORDER BY below. Visibility remains this function's
    -- only responsibility; economic viability of a long trip is left to the
    -- provider, who sees the real distance_meters value (Q-C: always real,
    -- never zeroed/masked, regardless of which branch of this OR matched).
    AND (
      (r.providers_in_range_at_creation IS NOT NULL AND r.providers_in_range_at_creation < 10)
      OR ST_DWithin(r.location::geography, cp.location::geography, p_radius)
    )
    -- D1/D2/R3/Q5 tier-delay gate. Elapsed time measured from created_at only.
    AND (now() - r.created_at) >= (vd.total_delay_minutes * INTERVAL '1 minute')
  ORDER BY distance_meters ASC, r.created_at DESC
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_nearby_open_requests(integer, integer, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_open_requests(integer, integer, timestamp with time zone) TO authenticated, service_role;

COMMIT;
