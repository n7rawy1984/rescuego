-- Pay Per Job flat-fee payment tracking
CREATE TABLE IF NOT EXISTS ppj_payments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id              UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  request_id               UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  fee_aed                  INTEGER NOT NULL CHECK (fee_aed > 0),
  distance_meters          INTEGER NOT NULL DEFAULT 0,
  stripe_payment_intent_id TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
  promo_applied            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id, request_id)
);

-- Row-level security
ALTER TABLE ppj_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "providers_read_own_ppj_payments"
  ON ppj_payments FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "admin_full_ppj_payments"
  ON ppj_payments FOR ALL
  USING (is_admin());

-- Add distance tracking to requests (for reference after accept)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS distance_to_provider_m INTEGER;

-- Add overage_cleared to requests for overage payment flow
ALTER TABLE requests ADD COLUMN IF NOT EXISTS overage_cleared BOOLEAN DEFAULT FALSE;
