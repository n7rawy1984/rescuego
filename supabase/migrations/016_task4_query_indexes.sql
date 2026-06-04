-- Phase 1A Task 4 — Missing query performance indexes.
-- Addresses 4 findings from query profiling audit (June 4, 2026).
-- No schema changes — index additions only. Safe to run without downtime.

-- Admin dashboard fires 2 HEAD count queries on users filtered by role on every load.
-- Without this index, both are full table scans.
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users (role);

-- Admin dashboard: overage_payments.eq('status', 'failed') count — full scan without index.
-- Provider dashboard: overage_payments filtered by provider_id + status + ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_overage_payments_provider_status_created
  ON overage_payments (provider_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_overage_payments_status
  ON overage_payments (status);

-- Admin dashboard: payout_log.order('created_at', DESC).limit(5) — full scan without index.
CREATE INDEX IF NOT EXISTS idx_payout_log_created
  ON payout_log (created_at DESC);

-- update_provider_rating() trigger fires on every rating INSERT.
-- Trigger query: SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50.
-- Without this index, trigger cost grows with provider rating count.
CREATE INDEX IF NOT EXISTS idx_ratings_provider_created
  ON ratings (provider_id, created_at DESC);
