-- Migration 036: Add lat/lng generated columns to provider_locations
-- Supabase REST returns GEOMETRY(Point,4326) as hex WKB, not GeoJSON.
-- Adding generated columns that expose plain numeric coordinates allows
-- server-side code to read coordinates without PostGIS parsing overhead.

ALTER TABLE public.provider_locations
  ADD COLUMN IF NOT EXISTS lat double precision
    GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  ADD COLUMN IF NOT EXISTS lng double precision
    GENERATED ALWAYS AS (ST_X(location::geometry)) STORED;

-- Also add plain numeric coord columns to requests for fallback distance calc
-- (fuzzy_latitude/fuzzy_longitude already exist, but exact coords are needed
-- for the provider to compute accurate distance — these are kept server-side only)
-- No change needed: requests.fuzzy_latitude and fuzzy_longitude already exist
-- and are plain NUMERIC(10,7) columns usable for approximate distance.
