-- Migration 018 — capture get_nearby_open_requests RPC into version control
-- This function already exists in production (applied manually before migrations tracked it).
-- This migration is tracking-only — no logic changes, no index changes.
-- Ensures a fresh restore from migrations produces an identical database to production.

CREATE OR REPLACE FUNCTION public.get_nearby_open_requests(
  p_radius integer DEFAULT 5000,
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
  distance_meters double precision
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH current_provider AS (
    SELECT pl.location
    FROM providers p
    JOIN provider_locations pl ON pl.provider_id = p.id
    WHERE
      p.id = auth.uid()
      AND p.status = 'active'
      AND pl.updated_at >= p_stale_threshold
    LIMIT 1
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
    ST_Distance(r.location::geography, cp.location::geography) AS distance_meters
  FROM requests r
  CROSS JOIN current_provider cp
  WHERE
    r.status = 'open'
    AND r.accepted_by IS NULL
    AND ST_DWithin(r.location::geography, cp.location::geography, p_radius)
  ORDER BY distance_meters ASC, r.created_at DESC
  LIMIT p_limit;
$function$;
