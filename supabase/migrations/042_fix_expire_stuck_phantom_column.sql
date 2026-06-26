-- Migration 042: Fix phantom column in expire_stuck_active_requests (Batch 3 runtime hotfix)
--
-- Runtime finding:
--   The weekly stuck-request cleanup RPC expire_stuck_active_requests (last redefined in
--   migration 040, finding LOW-03) filters candidates with `r.updated_at < p_stuck_cutoff`.
--   The `requests` table has NO `updated_at` column — verified against the schema:
--     * 001_initial_schema.sql:32-45  → requests has created_at only.
--     * 031_marketplace_v2_schema.sql → adds en_route_at/arrived_at etc., never updated_at.
--   At runtime this RPC therefore throws `column requests.updated_at does not exist`, exactly
--   like the marketplace-cron SLA path did before its Batch 3 hotfix. The weekly cleanup never
--   ran. (The other `updated_at` references in the codebase belong to provider_locations,
--   stripe_events, fair_price_config, overage_payments — all legitimate columns and untouched.)
--
-- Fix:
--   Supersede the deployed RPC with CREATE OR REPLACE FUNCTION, replacing the single phantom
--   reference `r.updated_at` with `r.created_at`. `created_at` is verified to exist on requests
--   and is monotonic, so "stuck longer than the cutoff" is evaluated against request age — a
--   stable proxy that cannot reference a non-existent column.
--
-- Constraints honoured (per task):
--   * Deployed migrations 028 and 040 are NOT edited.
--   * Function signature unchanged: (p_stuck_cutoff TIMESTAMPTZ) RETURNS INTEGER.
--   * SECURITY DEFINER preserved.
--   * SET search_path = public preserved.
--   * Same REVOKE (anon, authenticated) + GRANT (service_role) pattern preserved.
--   * ALL Batch 2 / LOW-03 logic preserved verbatim:
--       - jobs_this_month decremented ONLY when a V2 slot was consumed (selected_quote_id present),
--       - GREATEST(0, .. - 1) guards against double-decrement / negative balances,
--       - release cleanup (requests reset, jobs nulled, request_locks deleted, counters bumped).
--   The ONLY change from migration 040's body is `r.updated_at` -> `r.created_at`.

CREATE OR REPLACE FUNCTION public.expire_stuck_active_requests(
  p_stuck_cutoff TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row   RECORD;
BEGIN
  FOR v_row IN
    SELECT r.id AS request_id,
           r.accepted_by AS provider_id,
           (r.selected_quote_id IS NOT NULL) AS slot_consumed
    FROM requests r
    WHERE r.status IN ('accepted', 'en_route', 'arrived')
      AND r.created_at < p_stuck_cutoff
      AND r.accepted_by IS NOT NULL
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE requests
    SET status            = 'open',
        accepted_by       = NULL,
        selected_quote_id = NULL,
        accepted_at       = NULL,
        overage_cleared   = FALSE
    WHERE id = v_row.request_id;

    UPDATE jobs
    SET commission_rate = NULL,
        commission_amount = NULL,
        stripe_payment_intent_id = NULL,
        en_route_at = NULL,
        arrived_at = NULL
    WHERE request_id = v_row.request_id
      AND provider_id = v_row.provider_id
      AND completed_at IS NULL;

    DELETE FROM request_locks
    WHERE request_id = v_row.request_id;

    -- LOW-03: decrement subscription allowance only when a slot was consumed.
    UPDATE providers
    SET release_count = COALESCE(release_count, 0) + 1,
        provider_side_cancellation_count = COALESCE(provider_side_cancellation_count, 0) + 1,
        jobs_this_month = CASE
          WHEN v_row.slot_consumed THEN GREATEST(0, COALESCE(jobs_this_month, 0) - 1)
          ELSE jobs_this_month
        END
    WHERE id = v_row.provider_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stuck_active_requests(TIMESTAMPTZ) TO service_role;
