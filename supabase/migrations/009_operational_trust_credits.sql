-- Operational trust hardening for cancellations, release tracking, and PPJ recovery credits.
-- Recovery credits are usage-only credits, not wallet money and not withdrawable.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS ppj_recovery_credits INTEGER NOT NULL DEFAULT 0 CHECK (ppj_recovery_credits >= 0),
  ADD COLUMN IF NOT EXISTS release_count INTEGER NOT NULL DEFAULT 0 CHECK (release_count >= 0),
  ADD COLUMN IF NOT EXISTS unable_to_complete_count INTEGER NOT NULL DEFAULT 0 CHECK (unable_to_complete_count >= 0),
  ADD COLUMN IF NOT EXISTS provider_side_cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_side_cancellation_count >= 0);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0),
  ADD COLUMN IF NOT EXISTS late_cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (late_cancellation_count >= 0);

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_actor TEXT CHECK (cancellation_actor IN ('customer', 'provider', 'admin')),
  ADD COLUMN IF NOT EXISTS cancellation_compensated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_compensation_type TEXT CHECK (cancellation_compensation_type IN ('ppj_recovery_credit', 'subscription_usage_restore', 'none'));

CREATE INDEX IF NOT EXISTS idx_requests_cancelled_by ON requests(cancelled_by);
