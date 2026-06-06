-- Migration 025 — Provider state machine: en_route and arrived states.
--
-- Adds two new intermediate request statuses between accepted and in_progress:
--   accepted → en_route → arrived → in_progress → completed
--
-- Also adds en_route_at and arrived_at timestamp columns to the jobs table
-- for operational analytics and customer-facing timeline display.

-- Step 1: Drop the existing CHECK constraint on requests.status.
ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_status_check;

-- Step 2: Re-add with the two new values included.
ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('open', 'accepted', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'));

-- Step 3: Add timestamp columns to jobs table.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ DEFAULT NULL;

-- Step 4: Index on requests.status to keep the new values queryable.
-- (existing idx_requests_status from migration 013 covers this — no new index needed)

-- Step 5: Update expire_stale_open_requests RPC to not accidentally expire
-- en_route/arrived requests (they are actively being served).
-- The existing RPC already only expires status = 'open' — no change needed.
-- Migration 025 — Provider state machine: en_route and arrived states.
--
-- Adds two new intermediate request statuses between accepted and in_progress:
--   accepted → en_route → arrived → in_progress → completed
--
-- Also adds en_route_at and arrived_at timestamp columns to the jobs table
-- for operational analytics and customer-facing timeline display.

-- Step 1: Drop the existing CHECK constraint on requests.status.
ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_status_check;

-- Step 2: Re-add with the two new values included.
ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('open', 'accepted', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'));

-- Step 3: Add timestamp columns to jobs table.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ DEFAULT NULL;

-- Step 4: Index on requests.status to keep the new values queryable.
-- (existing idx_requests_status from migration 013 covers this — no new index needed)

-- Step 5: Update expire_stale_open_requests RPC to not accidentally expire
-- en_route/arrived requests (they are actively being served).
-- The existing RPC already only expires status = 'open' — no change needed.
