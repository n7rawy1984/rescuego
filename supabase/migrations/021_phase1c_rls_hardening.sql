-- Migration 021 — Phase 1C Deep RLS Hardening (Findings 1–6).
-- All changes are DROP/ALTER POLICY only — no schema changes, no data changes.
-- Safe to apply without downtime. Smoke test: verify provider dashboard,
-- customer dashboard, and request flow work after applying.
--
-- All legitimate reads on these tables go through createAdminClient()
-- (service_role) in API routes, or through SECURITY DEFINER RPCs.
-- No user-facing functionality depends on these client-side RLS policies.

-- Finding 1 (HIGH): request_locks — all authenticated users could read all
-- lock rows, exposing which provider is mid-payment on which request.
-- API routes use service_role for all lock reads — policy not needed.
DROP POLICY IF EXISTS "Providers read locks" ON request_locks;

-- Finding 2 (HIGH): requests — customers could UPDATE any column on their
-- own open request directly from the browser. No WITH CHECK constraint.
-- All request mutations go through cancel_request_and_compensate_atomic RPC.
DROP POLICY IF EXISTS "Customers cancel own open request" ON requests;

-- Finding 5 (MEDIUM): requests — active providers could SELECT all columns
-- on any open request (full address, customer_id, note, exact coordinates).
-- Migration 010 masked this data in the get_nearby_open_requests RPC but the
-- raw table policy was never updated. Providers must use the RPC only.
DROP POLICY IF EXISTS "Active providers read open requests" ON requests;

-- Finding 4 (MEDIUM): providers — customers could SELECT all columns on any
-- active provider, including Stripe IDs, billing counters, and documents.
-- Customer-facing provider data is served through API routes with column-narrowing.
DROP POLICY IF EXISTS "Customers read active providers" ON providers;

-- Finding 3 (MEDIUM): ratings — anon (unauthenticated) users could read all
-- individual rating rows. Only aggregate rating (providers.rating) is needed
-- for public pages. Replace with authenticated-only read.
DROP POLICY IF EXISTS "Public read ratings" ON ratings;
DROP POLICY IF EXISTS "Authenticated read ratings" ON ratings;

CREATE POLICY "Authenticated read ratings"
  ON ratings FOR SELECT
  TO authenticated
  USING (true);

-- Finding 6 (LOW): provider_locations — any active provider could read the
-- exact coordinates of every other active provider directly from the table,
-- bypassing the distance-only output of the get_nearby_providers RPC.
-- All legitimate reads go through the SECURITY DEFINER RPC or service_role.
DROP POLICY IF EXISTS "Active providers location visible" ON provider_locations;
