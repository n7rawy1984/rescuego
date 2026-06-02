-- Phase 1B.3 query performance indexes.
-- These indexes match existing high-frequency filters/orderings without
-- changing request lifecycle, billing, or auth behavior.

-- Customer active request recovery, duplicate guard, history, and cancellation counts.
CREATE INDEX IF NOT EXISTS idx_requests_customer_status_created
  ON requests (customer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_requests_customer_cancelled_late
  ON requests (customer_id, cancelled_at DESC)
  WHERE status = 'cancelled'
    AND cancellation_actor = 'customer'
    AND accepted_by IS NOT NULL;

-- Provider active job lookups and recent customer-cancellation notices.
CREATE INDEX IF NOT EXISTS idx_requests_accepted_status_created
  ON requests (accepted_by, status, created_at DESC)
  WHERE accepted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_accepted_customer_cancelled
  ON requests (accepted_by, cancelled_at DESC)
  WHERE status = 'cancelled'
    AND cancellation_actor = 'customer'
    AND accepted_by IS NOT NULL;

-- Provider open-feed fallback, admin requests, and stale-open-request expiry.
CREATE INDEX IF NOT EXISTS idx_requests_open_unassigned_created
  ON requests (created_at DESC)
  WHERE status = 'open'
    AND accepted_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_status_created
  ON requests (status, created_at DESC);

-- Provider dashboard recent activity, customer history, ratings recovery, and admin lookups.
CREATE INDEX IF NOT EXISTS idx_jobs_provider_completed
  ON jobs (provider_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_completed
  ON jobs (completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- PPJ/payment webhook lookup, dashboard return-state lookup, and cancelled-payment protection.
CREATE INDEX IF NOT EXISTS idx_ppj_payments_stripe_intent
  ON ppj_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ppj_payments_provider_status_created
  ON ppj_payments (provider_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ppj_payments_request_paid_unrestored
  ON ppj_payments (request_id, status, created_at DESC)
  WHERE status = 'paid'
    AND recovery_credit_restored_at IS NULL;

-- Overage payment webhook lookup.
CREATE INDEX IF NOT EXISTS idx_overage_payments_stripe_intent
  ON overage_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Admin dashboard webhook/error visibility.
CREATE INDEX IF NOT EXISTS idx_stripe_events_status_updated
  ON stripe_events (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_events_updated
  ON stripe_events (updated_at DESC);

-- Monthly allowance reset scan.
CREATE INDEX IF NOT EXISTS idx_providers_plan_subscription_period_reset
  ON providers (plan, stripe_current_period_start, jobs_reset_at)
  WHERE stripe_subscription_id IS NOT NULL;
