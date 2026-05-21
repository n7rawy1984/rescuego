CREATE OR REPLACE FUNCTION get_nearby_providers(
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

CREATE OR REPLACE FUNCTION reset_monthly_job_counters()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE providers SET jobs_this_month = 0 WHERE status = 'active';
$$;
