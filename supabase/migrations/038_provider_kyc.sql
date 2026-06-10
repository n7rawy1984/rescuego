-- Migration 038 — Provider KYC: Status Expansion + Audit Log
-- Phase 5: Provider KYC & UAE Compliance (Soft Launch)
--
-- Changes:
--   1. Extend providers.status CHECK to include 'under_review' and 'rejected'
--   2. Create provider_kyc_log table (immutable audit history)
--   3. RLS policies on provider_kyc_log
--   4. Indexes for performance
--
-- Backward compatible: existing 'pending'/'active'/'suspended' values unchanged.
-- No data migration needed — existing providers retain their current status.
-- Safe to re-run (idempotent via IF NOT EXISTS + DO blocks).
-- Smoke test: admin can approve/reject providers; dispatch only serves active providers.

-- ============================================================
-- STEP 1: Extend providers.status CHECK constraint
-- Drop existing constraint and re-add with the two new values.
-- Existing data ('pending','active','suspended') remains valid.
-- ============================================================

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_status_check;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_status_check
  CHECK (status IN ('pending', 'under_review', 'active', 'rejected', 'suspended'));

-- ============================================================
-- STEP 2: Create provider_kyc_log table
-- Immutable audit trail: INSERT only, no UPDATE/DELETE.
-- Tracks every status transition made by an admin.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_kyc_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  admin_id      UUID NOT NULL REFERENCES public.users(id),
  action        TEXT NOT NULL
    CHECK (action IN ('submitted', 'under_review', 'approved', 'rejected', 'suspended', 'reactivated')),
  previous_status TEXT NOT NULL,
  new_status      TEXT NOT NULL,
  notes           TEXT DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- STEP 3: Indexes on provider_kyc_log
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_kyc_log_provider_id
  ON public.provider_kyc_log(provider_id);

CREATE INDEX IF NOT EXISTS idx_kyc_log_created_at
  ON public.provider_kyc_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_log_action
  ON public.provider_kyc_log(action);

-- ============================================================
-- STEP 4: RLS on provider_kyc_log
-- ============================================================

ALTER TABLE public.provider_kyc_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_kyc_log FORCE ROW LEVEL SECURITY;

-- Admin: full read access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_kyc_log'
      AND policyname = 'Admin read kyc log'
  ) THEN
    CREATE POLICY "Admin read kyc log" ON public.provider_kyc_log
      FOR SELECT USING (is_admin());
  END IF;
END $$;

-- Provider: read own KYC history only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_kyc_log'
      AND policyname = 'Provider reads own kyc log'
  ) THEN
    CREATE POLICY "Provider reads own kyc log" ON public.provider_kyc_log
      FOR SELECT USING (provider_id = auth.uid());
  END IF;
END $$;

-- No direct INSERT/UPDATE/DELETE for any authenticated user
-- All writes go through service_role (admin API route)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_kyc_log'
      AND policyname = 'No direct write on kyc log'
  ) THEN
    CREATE POLICY "No direct write on kyc log" ON public.provider_kyc_log
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;
