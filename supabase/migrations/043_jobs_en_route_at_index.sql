-- Migration 043: Index for the admin stuck-job query (Security Remediation Batch 4 — P4-M1)
--
-- Finding P4-M1 (SECURITY_AUDIT_4): the admin dashboard stuck-job query is a full table scan.
--   src/app/admin/dashboard/page.tsx:80-85 runs:
--     SELECT request_id, en_route_at, arrived_at, requests!inner(...)
--     FROM jobs
--     WHERE en_route_at < <2h cutoff>
--       AND requests.status IN ('en_route','arrived')
--       AND completed_at IS NULL
--   With no index on jobs.en_route_at this scans the entire jobs table on every dashboard load.
--
-- Schema verification (not assumed — we have hit phantom columns before):
--   * jobs.en_route_at and jobs.arrived_at are added in 025_provider_state_machine.sql:19-21
--     (ALTER TABLE public.jobs ADD COLUMN ... TIMESTAMPTZ). Both columns exist on the jobs table.
--   * Existing job indexes (013_query_performance_indexes.sql) cover (provider_id, completed_at)
--     and (completed_at) only — neither serves an en_route_at range scan.
--
-- Fix: a PARTIAL index on en_route_at limited to active (not-yet-completed) jobs. This mirrors the
-- query's `completed_at IS NULL` predicate, so the index stays small (only in-flight jobs) and the
-- planner can satisfy the `en_route_at < cutoff` range scan directly. Idempotent (IF NOT EXISTS).
-- Focused: this migration adds ONLY this index.

CREATE INDEX IF NOT EXISTS idx_jobs_en_route_at_active
  ON public.jobs (en_route_at)
  WHERE completed_at IS NULL;
