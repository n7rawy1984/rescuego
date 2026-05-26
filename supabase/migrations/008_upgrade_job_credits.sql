-- Temporary in-cycle job credits for subscription upgrades.
-- These credits preserve upgrade fairness without changing jobs_this_month.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS job_credit_balance INTEGER NOT NULL DEFAULT 0 CHECK (job_credit_balance >= 0),
  ADD COLUMN IF NOT EXISTS last_upgrade_bonus_key TEXT;
