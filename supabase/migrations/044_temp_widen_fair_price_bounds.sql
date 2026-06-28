-- ============================================================================
-- Migration 044 — TEMPORARY: WIDEN fair_price_config bounds for testing
-- ============================================================================
--
--  ⚠️  TEMPORARY TESTING CHANGE — READ BEFORE TOUCHING  ⚠️
--
--  WHAT THIS DOES:
--    Widens (does NOT disable) the fair-price min/max per-km bounds in
--    fair_price_config so that any reasonable test quote passes during
--    testing. It sets min_price_per_km = 0.01 and max_price_per_km = 10000
--    for every service_type row. base_fee is intentionally left unchanged.
--
--  WHAT THIS DOES NOT DO:
--    - It does NOT disable validation. The submit_quote_atomic RPC
--      (migration 039) still runs its full price-range check on every quote:
--          v_min_fair = base_fee + (distance_km * min_price_per_km)
--          v_max_fair = base_fee + (distance_km * max_price_per_km)
--          reject if proposed_price < v_min_fair  -> price_too_low
--          reject if proposed_price > v_max_fair  -> price_too_high
--      Only the per-km coefficients are widened; the RPC logic is untouched.
--    - It does NOT change base_fee, so amounts BELOW the base_fee floor are
--      still (correctly) rejected as price_too_low. That is expected, not a bug.
--    - It does NOT touch PPJ, dispatch, or any other logic.
--
--  ⚠️  NOT A RESTORE TARGET — THE FORMULA WILL BE REDESIGNED BEFORE LAUNCH  ⚠️
--    Do NOT "restore" the previous values listed below at go-live. The entire
--    fair-price model is being redesigned. The current formula measures only
--    ONE distance leg (provider -> customer). The redesigned model must measure
--    TWO legs:
--        leg 1: provider        -> breakdown location
--        leg 2: breakdown       -> destination (where the recovery tows the car)
--    tied to a mandatory 7-emirate destination dropdown. The widened values
--    here are throwaway test scaffolding; the launch formula will replace them
--    entirely. See backlog items P9 / P1 / P2 (DEFERRED_PRODUCT_BACKLOG.md).
--
--  PREVIOUS SEEDED VALUES — FOR REFERENCE ONLY, *NOT* A RESTORE TARGET
--  (from migration 031; the formula will be redesigned, not reverted to these):
--    service_type | min_price_per_km | max_price_per_km | base_fee
--    -------------+------------------+------------------+---------
--    tow          | 3.00             | 8.00             | 100.00
--    battery      | 2.00             | 5.00             |  80.00
--    flat_tire    | 2.00             | 5.00             |  60.00
--    fuel         | 2.00             | 5.00             |  50.00
--    lockout      | 2.00             | 6.00             |  70.00
--    other        | 2.00             | 6.00             |  80.00
--
--  Idempotent: re-running this migration is safe (the UPDATE is absolute, not
--  relative, and only widens already-present rows; no row creation).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SNAPSHOT BEFORE (for the migration record / manual run output)
-- ---------------------------------------------------------------------------
-- SELECT service_type, min_price_per_km, max_price_per_km, base_fee, updated_at
-- FROM public.fair_price_config
-- ORDER BY service_type;

-- ---------------------------------------------------------------------------
-- WIDEN bounds for ALL service types (validation stays active; base_fee kept)
-- ---------------------------------------------------------------------------
UPDATE public.fair_price_config
SET min_price_per_km = 0.01,
    max_price_per_km = 10000,
    updated_at       = now();

-- ---------------------------------------------------------------------------
-- VERIFICATION SNAPSHOT AFTER — expect every row at 0.01 / 10000,
-- base_fee unchanged from the "previous values" table above.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unwidened INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_unwidened
  FROM public.fair_price_config
  WHERE min_price_per_km <> 0.01 OR max_price_per_km <> 10000;

  IF v_unwidened > 0 THEN
    RAISE EXCEPTION 'Migration 044 failed: % fair_price_config row(s) were not widened', v_unwidened;
  END IF;

  RAISE NOTICE 'Migration 044 applied: all fair_price_config rows widened to 0.01 / 10000 (base_fee unchanged).';
END $$;

-- Manual confirmation query (run after applying):
-- SELECT service_type, min_price_per_km, max_price_per_km, base_fee, updated_at
-- FROM public.fair_price_config
-- ORDER BY service_type;
