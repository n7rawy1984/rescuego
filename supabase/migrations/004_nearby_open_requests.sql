CREATE OR REPLACE FUNCTION get_nearby_open_requests(
  p_radius INTEGER DEFAULT 5000,
  p_limit INTEGER DEFAULT 20,
  p_stale_threshold TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes'
)
RETURNS TABLE (
  id UUID,
  customer_id UUID,
  location_address TEXT,
  problem_type TEXT,
  note TEXT,
  status TEXT,
  accepted_by UUID,
  price_estimate_min INTEGER,
  price_estimate_max INTEGER,
  final_price INTEGER,
  created_at TIMESTAMPTZ,
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    r.customer_id,
    r.location_address,
    r.problem_type,
    r.note,
    r.status,
    r.accepted_by,
    r.price_estimate_min,
    r.price_estimate_max,
    r.final_price,
    r.created_at,
    ST_Distance(r.location::geography, cp.location::geography) AS distance_meters
  FROM requests r
  CROSS JOIN current_provider cp
  WHERE
    r.status = 'open'
    AND ST_DWithin(r.location::geography, cp.location::geography, p_radius)
  ORDER BY distance_meters ASC, r.created_at DESC
  LIMIT p_limit;
$$;
