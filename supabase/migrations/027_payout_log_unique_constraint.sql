-- Migration 027 — Add UNIQUE constraint on payout_log.stripe_payout_id
-- Required for onConflict upsert to work correctly and prevent duplicate payout rows.
-- Safe to apply without downtime (no data loss, additive index only).
-- Idempotent: skips if constraint already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payout_log_stripe_payout_id_key'
  ) THEN
    ALTER TABLE payout_log
      ADD CONSTRAINT payout_log_stripe_payout_id_key UNIQUE (stripe_payout_id);
  END IF;
END
$$;
