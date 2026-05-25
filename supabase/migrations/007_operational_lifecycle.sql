-- Operational lifecycle support.
-- Subscription allowance resets are tied to Stripe billing periods, not calendar months.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS stripe_current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS jobs_reset_at TIMESTAMPTZ;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('open','accepted','in_progress','completed','cancelled','expired'));

CREATE OR REPLACE FUNCTION expire_stale_open_requests(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE requests r
  SET status = 'expired'
  WHERE r.status = 'open'
    AND r.created_at < p_cutoff
    AND COALESCE(r.overage_cleared, FALSE) = FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM request_locks rl
      WHERE rl.request_id = r.id
        AND rl.locked_until > now()
    );

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
