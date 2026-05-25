-- Billing stability improvements for Stripe webhook idempotency and overage tracking.

ALTER TABLE stripe_events
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IN ('processing', 'processed', 'failed'))
    DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE stripe_events
SET status = 'processed'
WHERE status IS NULL;

CREATE TABLE IF NOT EXISTS overage_payments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id              UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  request_id               UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  fee_aed                  INTEGER NOT NULL CHECK (fee_aed > 0),
  stripe_payment_intent_id TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id, request_id)
);

ALTER TABLE overage_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "providers_read_own_overage_payments"
  ON overage_payments FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "admin_full_overage_payments"
  ON overage_payments FOR ALL
  USING (is_admin());
