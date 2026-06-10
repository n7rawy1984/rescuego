-- Migration 037 — Explicit RLS Hardening: FORCE RLS + explicit deny policies
-- Background: Supabase security alert rls_disabled_in_public.
-- Root cause: spatial_ref_sys (PostGIS system table) has rowsecurity=false but
-- cannot be altered — it is owned by the PostGIS extension, not the project user.
-- The alert is suppressed by moving spatial_ref_sys to the extensions schema
-- (Supabase recommended pattern) or by acknowledging it is unmodifiable.
-- This migration hardens all 15 application-owned tables instead.
--
-- Safe to re-run (all CREATE POLICY wrapped in IF NOT EXISTS guards).
-- No schema changes. No data changes.
-- Smoke test: provider dashboard, customer request flow, admin panel.

-- ============================================================
-- STEP 1: FORCE ROW LEVEL SECURITY on all application tables.
-- Ensures even the table-owner role is subject to RLS policies.
-- service_role still bypasses RLS by design (Supabase behaviour) —
-- this is intentional and unchanged.
-- ============================================================

ALTER TABLE public.users                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.providers              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_locations     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.requests               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ratings                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.request_locks          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payout_log             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.price_estimates        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ppj_payments           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.overage_payments       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.request_quotes         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_dispatch_log  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fair_price_config      FORCE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: jobs — explicit INSERT/UPDATE/DELETE block for authenticated users.
-- All mutations go through SECURITY DEFINER RPCs:
--   accept_request_atomic, complete_provider_job_atomic, release_job_atomic.
-- Existing policies: "Provider reads own jobs" (SELECT), "Admin full access" (ALL).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs'
      AND policyname = 'No direct insert on jobs'
  ) THEN
    CREATE POLICY "No direct insert on jobs" ON public.jobs
      FOR INSERT WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs'
      AND policyname = 'No direct update on jobs'
  ) THEN
    CREATE POLICY "No direct update on jobs" ON public.jobs
      FOR UPDATE USING (false);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jobs'
      AND policyname = 'No direct delete on jobs'
  ) THEN
    CREATE POLICY "No direct delete on jobs" ON public.jobs
      FOR DELETE USING (false);
  END IF;
END $$;

-- ============================================================
-- STEP 3: request_locks — explicit deny for all authenticated users.
-- Migration 021 dropped the SELECT policy intentionally (all access via
-- service_role RPCs). Admin retains full access via existing "Admin full access".
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'request_locks'
      AND policyname = 'No direct access on request_locks'
  ) THEN
    CREATE POLICY "No direct access on request_locks" ON public.request_locks
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ============================================================
-- STEP 4: stripe_events — explicit deny for authenticated users.
-- Only the webhook handler (service_role) writes here.
-- Existing policy: "Admin full access only" (ALL, USING is_admin()).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stripe_events'
      AND policyname = 'No direct write on stripe_events'
  ) THEN
    CREATE POLICY "No direct write on stripe_events" ON public.stripe_events
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ============================================================
-- STEP 5: payout_log — explicit deny for authenticated users.
-- Only admin RPCs and cron jobs (service_role) write here.
-- Existing policy: "Admin full access only" (ALL, USING is_admin()).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payout_log'
      AND policyname = 'No direct write on payout_log'
  ) THEN
    CREATE POLICY "No direct write on payout_log" ON public.payout_log
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;
