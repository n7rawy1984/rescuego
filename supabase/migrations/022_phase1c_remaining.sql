-- Migration 022 — Phase 1C remaining items.

-- Item 1: Orphaned reset_monthly_job_counters RPC (Task 5 Finding 8).
-- Predates Stripe-billing-period-aware reset logic (migration 007).
-- Resets ALL active providers unconditionally — dangerous if called in production.
-- Not called from any route or migration. Revoke and mark deprecated.
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM anon;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM authenticated;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM service_role;

COMMENT ON FUNCTION public.reset_monthly_job_counters() IS
  'DEPRECATED — do not call. Superseded by monthly-allowance-reset cron route (migration 007). '
  'Resets all active providers unconditionally without Stripe billing period awareness. '
  'Revoked from all roles in migration 022.';

-- Item 2: ratings table UNIQUE(job_id) constraint (Task 5 Finding 7).
-- Prevents duplicate ratings for the same job if the duplicate-check read
-- in ratings/route.ts races with a concurrent submission.
-- UNIQUE constraint already implied by "job_id UUID UNIQUE" in migration 001
-- (ratings table definition). This is a safety re-assertion — ADD CONSTRAINT
-- IF NOT EXISTS is not supported in PostgreSQL for named constraints, so we
-- use DO $$ to guard against duplicate constraint errors on re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ratings'::regclass
      AND contype = 'u'
      AND conname = 'ratings_job_id_key'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ratings'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND conkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.ratings'::regclass
          AND attname = 'job_id'
      )
  ) THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_job_id_unique UNIQUE (job_id);
  END IF;
END $$;
-- Migration 022 — Phase 1C remaining items.

-- Item 1: Orphaned reset_monthly_job_counters RPC (Task 5 Finding 8).
-- Predates Stripe-billing-period-aware reset logic (migration 007).
-- Resets ALL active providers unconditionally — dangerous if called in production.
-- Not called from any route or migration. Revoke and mark deprecated.
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM anon;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM authenticated;
REVOKE ALL ON FUNCTION public.reset_monthly_job_counters() FROM service_role;

COMMENT ON FUNCTION public.reset_monthly_job_counters() IS
  'DEPRECATED — do not call. Superseded by monthly-allowance-reset cron route (migration 007). '
  'Resets all active providers unconditionally without Stripe billing period awareness. '
  'Revoked from all roles in migration 022.';

-- Item 2: ratings table UNIQUE(job_id) constraint (Task 5 Finding 7).
-- Prevents duplicate ratings for the same job if the duplicate-check read
-- in ratings/route.ts races with a concurrent submission.
-- UNIQUE constraint already implied by "job_id UUID UNIQUE" in migration 001
-- (ratings table definition). This is a safety re-assertion — ADD CONSTRAINT
-- IF NOT EXISTS is not supported in PostgreSQL for named constraints, so we
-- use DO $$ to guard against duplicate constraint errors on re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ratings'::regclass
      AND contype = 'u'
      AND conname = 'ratings_job_id_key'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ratings'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND conkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.ratings'::regclass
          AND attname = 'job_id'
      )
  ) THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_job_id_unique UNIQUE (job_id);
  END IF;
END $$;
