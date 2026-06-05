-- Phase 1A Task 8 — Missing query performance indexes (findings 3, 4, 6)
-- No schema changes — index additions only. Safe to run without downtime.

-- Finding 3: admin/revenue ppj_payments filtered by status only (no provider_id filter).
-- idx_ppj_payments_provider_status_created leads with provider_id — unusable for admin-wide query.
-- This index covers the status filter + created_at sort used by the revenue page.
CREATE INDEX IF NOT EXISTS idx_ppj_payments_status_created
  ON ppj_payments (status, created_at DESC);

-- Finding 4: admin/revenue overage_payments filtered by status only (no provider_id filter).
-- idx_overage_payments_status exists but has no created_at — Postgres must sort after the scan.
-- This index eliminates the post-scan sort for the revenue page query.
CREATE INDEX IF NOT EXISTS idx_overage_payments_status_created
  ON overage_payments (status, created_at DESC);

-- Finding 6: admin/requests all-requests scan ordered by created_at, no status filter.
-- idx_requests_status_created leads with status — unusable without a status predicate.
-- This plain index supports the unfiltered ORDER BY created_at DESC LIMIT 100 scan pattern.
CREATE INDEX IF NOT EXISTS idx_requests_created
  ON requests (created_at DESC);
