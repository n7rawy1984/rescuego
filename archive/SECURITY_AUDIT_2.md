# SECURITY AUDIT PART 2 — Business Logic, API Routes, Input Validation, Data Integrity

**Date:** 2026-06-23
**Auditor:** Claude AI (automated)
**Scope:** Part 2 — Business Logic, Dispatch, State Machine, Input Validation, Data Integrity, Ratings
**Baseline:** Full Production (real users, real money, Stripe live)

---

## Executive Summary

The codebase implements a competitive-quote marketplace with atomic RPCs, FOR UPDATE locking, and layered eligibility guards. The most critical new finding in Part 2 is a race condition in the price-change route that allows a provider to permanently record two price changes on a single job by exploiting the TOCTOU window between the read of `price_change_count` and the non-atomic increment. A second critical finding is that the SLA auto-release RPC (`sla_check_and_release`) only fires on requests still in `accepted` status — jobs that have progressed to `en_route` or `arrived` are never auto-released when the SLA timer expires, creating an unbounded active-job lock. Additional high-severity gaps include missing UUID validation on the `GET /api/requests/quotes` query parameter, an unguarded client-side request expiry that mutates state on a GET handler and can race with the cron job, and counter drift when `release_job_atomic` does not decrement `jobs_this_month` on V2 releases. The overall risk posture at production scale is elevated. Several findings from Part 1 (fair-price validation disabled, KYC doc paths leaked, overage not collected) are prerequisites to fixing Part 2 findings and are noted as cross-references only.

---

## Files Read

**Documentation (5 files read, 2 not found):**
- `d:\emergancy\موقع سيو\NEXT\rescuego\CLAUDE.md`
- `d:\emergancy\موقع سيو\NEXT\rescuego\ARCHITECTURE.md`
- `d:\emergancy\موقع سيو\NEXT\rescuego\MARKETPLACE_V2_SPEC.md`
- `d:\emergancy\موقع سيو\NEXT\rescuego\PROJECT_HANDOFF.md`
- `d:\emergancy\موقع سيو\NEXT\rescuego\SECURITY_AUDIT_1.md` (read for deduplication only)
- `ROADMAP.md` — not found
- `SESSION_LOG.md` — not found

**API Routes (12 files):**
- `src/app/api/provider/jobs/quote/route.ts`
- `src/app/api/customer/quote/select/route.ts`
- `src/app/api/requests/quotes/route.ts`
- `src/app/api/provider/jobs/price-change/route.ts`
- `src/app/api/customer/price-change/respond/route.ts`
- `src/app/api/provider/jobs/complete/route.ts`
- `src/app/api/provider/jobs/advance-state/route.ts`
- `src/app/api/provider/jobs/release/route.ts`
- `src/app/api/requests/route.ts`
- `src/app/api/requests/cancel/route.ts`
- `src/app/api/ratings/route.ts`
- `src/app/api/ops/marketplace-cron/route.ts`

**Lib files (3 files):**
- `src/lib/dispatch.ts`
- `src/lib/provider-score.ts`
- `src/lib/range-estimator.ts`

**Types (2 files):**
- `src/types/database.ts`
- `src/types/index.ts`

**Migrations (13 files):**
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/020_release_job_atomic.sql`
- `supabase/migrations/026_advance_state_atomic.sql`
- `supabase/migrations/028_stuck_job_auto_release.sql`
- `supabase/migrations/029_rpc_add_en_route_arrived_statuses.sql`
- `supabase/migrations/031_marketplace_v2_schema.sql`
- `supabase/migrations/032_disable_range_estimator.sql`
- `supabase/migrations/033_nearby_requests_include_quoted.sql`
- `supabase/migrations/034_cancel_allow_quoted_status.sql`
- `supabase/migrations/035_nearby_requests_add_destination.sql`
- `supabase/migrations/037_rls_force_and_explicit_deny.sql`
- `supabase/migrations/038_provider_kyc.sql`

**Note:** `033_marketplace_v2_helpers.sql` was not found at that path; actual file is `033_nearby_requests_include_quoted.sql`. `036_provider_location_lat_lng_columns.sql` was found via glob but not fully read.

---

## Critical Findings

---

### CRIT-01 — Price-Change Count Enforced by Read-Then-Write (Race Allows Two Price Changes)

- **Severity:** Critical
- **File(s):** `src/app/api/provider/jobs/price-change/route.ts:44–74`
- **Attack / Failure Scenario:**
  The route reads `price_change_count` from the DB at lines 44–46, then checks `if (request.price_change_count >= 1)` at line 65, then performs a separate `admin.from('requests').update({price_change_count: (request.price_change_count ?? 0) + 1, ...})` at lines 69–78. There is no database-level lock or atomic compare-and-swap on this increment.

  Two simultaneous POST requests from the same provider for the same `request_id` (double-click, network retry, scripted race) can both read `price_change_count = 0`, both pass the `>= 1` guard, and both execute the update — resulting in `price_change_count = 2` and two separate `price_change_requested` values written. The final `price_change_requested` on the row is whichever write arrived last. More critically: the second price-change event overwrites `price_change_status` back to `'pending'`, resetting a customer's prior `rejected` decision. The customer sees a fresh pending request for a second (higher) price and may approve it, thinking it is a first request.
- **Exploitability:** Medium — requires two concurrent requests within milliseconds; achievable with scripted retry, double-click, or HTTP race tool.
- **Production Impact:** Provider can obtain approval for a price change the customer had already rejected. The approved price becomes the final job price via `complete_provider_job_atomic`'s price-derivation logic (migration 031 lines 773–780). Customer pays more than intended.
- **Fix Direction:** Move enforcement into the DB. Create an RPC that does `UPDATE requests SET price_change_count = price_change_count + 1, price_change_requested = $new_price, price_change_status = 'pending' WHERE id = $id AND accepted_by = $provider_id AND status = 'in_progress' AND price_change_count = 0 RETURNING id`. Return failure if row count is 0.

---

### CRIT-02 — SLA Auto-Release Only Fires on `accepted` Status; `en_route` and `arrived` Jobs Permanently Locked Until Weekly Cron

- **Severity:** Critical
- **File(s):** `src/app/api/ops/marketplace-cron/route.ts:115–121`, `supabase/migrations/031_marketplace_v2_schema.sql:641–644`
- **Attack / Failure Scenario:**
  The `enforceSla` function in marketplace-cron (lines 115–121) queries `WHERE status = 'accepted'`. The `sla_check_and_release` RPC (migration 031 line 642) requires `v_request.status <> 'accepted'` to return early. Once a provider advances a job to `en_route` or `arrived`, the marketplace cron never picks it up for SLA enforcement — regardless of how long the provider remains unresponsive.

  A provider can accept a job, immediately call `advance-state` to move it to `en_route` (taking it out of the marketplace cron's SLA scope), and then abandon the job. The customer is locked to this provider with no automated recovery path. The only release mechanisms available are:
  1. Customer manually cancels (requires customer awareness and action).
  2. Provider manually releases (requires provider cooperation — not applicable for abandonment).
  3. The weekly `expire_stuck_active_requests` cron (`/api/ops/weekly-sla-reset`) — runs at most once per week.
- **Exploitability:** Easy — a provider who wants to block a customer from re-querying the marketplace simply accepts, marks `en_route`, and disappears.
- **Production Impact:** Customer cannot get service. Request remains locked to a non-responding provider for up to one week. Active job slot is occupied, causing `jobs_this_month` counter inflation (HIGH-04). Customer's only self-service recovery is manual cancellation, which may not be obvious from the UI.
- **Fix Direction:** Extend `enforceSla` in marketplace-cron to query `status IN ('accepted', 'en_route', 'arrived')`. Extend `sla_check_and_release` to handle release from these states, or create a new RPC for en_route/arrived SLA release that sets the request back to `quoted` or `open` as appropriate.

---

## High Findings

---

### HIGH-01 — `GET /api/requests/quotes` Accepts Unvalidated String as `request_id` Query Parameter

- **Severity:** High
- **File(s):** `src/app/api/requests/quotes/route.ts:45–84`
- **Attack / Failure Scenario:**
  The `request_id` query parameter is read directly from `req.nextUrl.searchParams.get('request_id')` at line 45 and passed without format validation to `admin.from('requests').select(...).eq('id', requestId)` at line 68. There is no `z.string().uuid()` check. This differs from every other route in the codebase that accepts a request/quote ID in the body — all of those use Zod UUID validation.

  Consequences:
  1. Any arbitrary string (including empty string, very long strings, or values that trigger unusual PostgREST error formatting) is sent to the DB. PostgreSQL will cast-fail on non-UUID values and return a 400 or empty result, but the specific error message varies and may leak internal information about the query structure.
  2. Any authenticated user of any role (provider, admin) can call this endpoint. The ownership check `request.customer_id !== user.id` at line 83 is the only access gate — but it only runs if the DB returns a row. Non-UUID inputs get caught by the DB before ownership is checked, yielding a different response path from "not found."
  3. Without UUID validation, an attacker can enumerate request ID format behavior: a valid UUID with no matching row returns `{ data: [], count: 0 }` (via the `request.status !== 'quoted'` path at line 88). A malformed non-UUID returns a DB error mapped to a different HTTP status.
- **Exploitability:** Low direct exploit risk; medium for response-timing/format probing.
- **Production Impact:** Inconsistent error responses for malformed input. A provider or admin can probe the endpoint to distinguish "UUID that exists but not customer-owned" from "malformed input" — leaking information about ID validity.
- **Fix Direction:** Add `if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId))` check after line 47, or use `z.string().uuid().safeParse(requestId)`.

---

### HIGH-02 — Client-Side Request Expiry in `GET /api/requests` Performs a State-Mutating Write on a Read Endpoint

- **Severity:** High
- **File(s):** `src/app/api/requests/route.ts:136–149`
- **Attack / Failure Scenario:**
  The GET handler for customer requests performs an unconditional DB write when a `quoted` request is older than 20 minutes (lines 136–149):
  ```typescript
  await admin.from('requests').update({ status: 'expired' })
    .eq('id', activeRequest.id).eq('status', 'quoted')
  activeRequest = null
  ```
  Problems:
  1. **HTTP semantics violation:** GET endpoints must be idempotent. This GET mutates DB state on every call when the condition is met. Every customer dashboard poll triggers the mutation.
  2. **No error handling:** The update has no `catch` or error check. If the update fails (DB timeout, network error), `activeRequest = null` is still set, so the customer sees "no active request" but the DB row is still `quoted`. Providers continue to see and quote this expired-in-UI request.
  3. **Race with marketplace-cron:** Both this handler and `expireUnselectedRequests` in the cron can attempt to set `status = 'expired'` simultaneously. The `.eq('status', 'quoted')` guard makes the data side idempotent, but two concurrent DB writes are generated.
  4. **Race with quote selection:** If the customer loads the dashboard while simultaneously selecting a quote (two browser tabs or two devices), the GET expiry may see `quoted` (stale snapshot) and attempt to expire it while `select_quote_atomic` is transitioning to `accepted`. The update's WHERE clause (`.eq('status', 'quoted')`) provides protection — if the RPC committed first, the expiry update finds no `quoted` row. But the GET still returns `active_request: null`, misleading the customer.
- **Exploitability:** Not directly exploitable; this is a reliability and correctness concern.
- **Production Impact:** Stale data inconsistency under DB write failures. Unnecessary write load from high-frequency customer polling. Customer may see a misleading "no active request" state.
- **Fix Direction:** Remove the inline expiry logic from the GET handler entirely. Rely on the marketplace-cron for all request expiry. The cron runs frequently enough to handle the 20-minute window.

---

### HIGH-03 — `release_job_atomic` Does Not Decrement `jobs_this_month` for V2 Jobs

- **Severity:** High
- **File(s):** `supabase/migrations/028_stuck_job_auto_release.sql:61–78`, `supabase/migrations/031_marketplace_v2_schema.sql:566–569`
- **Attack / Failure Scenario:**
  `select_quote_atomic` increments `providers.jobs_this_month` at line 568 when a V2 quote is selected. The `cancel_request_and_compensate_atomic` RPC (migration 034, lines 163–168) correctly decrements `jobs_this_month` when the customer cancels. However, `release_job_atomic` (migration 028, lines 61–78) increments `release_count` and `provider_side_cancellation_count` but does NOT decrement `jobs_this_month`.

  A Starter-plan provider (limit: 15 jobs/month) who accepts-then-releases 5 jobs effectively loses 5 monthly slots permanently (for that month), reducing their usable quota to 10. If they reach their computed `jobs_this_month = 15` through a mix of real completions and releases, they are blocked from quoting even if they have not completed 15 real jobs.
- **Exploitability:** Not an external exploit — this is a business-logic data integrity defect.
- **Production Impact:** Provider monthly allowance under-counted for every released V2 job. Provider may be false-positive blocked from quoting. Monthly billing may be inaccurate.
- **Fix Direction:** Add to `release_job_atomic` (migration 028): `jobs_this_month = GREATEST(0, COALESCE(jobs_this_month, 0) - 1)` in the providers UPDATE, conditional on whether the request had a `selected_quote_id` (V2 path). Add a migration 039 to update the existing RPC.

---

### HIGH-04 — `jobs_this_month` Permanently Inflated for Stuck `en_route`/`arrived` Jobs (Consequence of CRIT-02)

- **Severity:** High
- **File(s):** `supabase/migrations/031_marketplace_v2_schema.sql:692–698`, `src/app/api/ops/marketplace-cron/route.ts:115–121`
- **Attack / Failure Scenario:**
  `sla_check_and_release` correctly decrements `jobs_this_month` when it releases an SLA-breached job (line 696). But as established in CRIT-02, `sla_check_and_release` only runs for `accepted` status. Jobs that advanced to `en_route` or `arrived` and are then abandoned remain in those states until the weekly `expire_stuck_active_requests` cron fires. That cron does NOT decrement `jobs_this_month` (see LOW-03). Result: for a stuck `en_route`/`arrived` job, `jobs_this_month` is incremented by `select_quote_atomic` and never decremented until the monthly reset.
- **Exploitability:** Not directly exploitable; consequence of CRIT-02.
- **Production Impact:** For each stuck `en_route`/`arrived` job between weekly cron runs, the provider's monthly slot is consumed even though no service was delivered. At scale this compounds with HIGH-03 to create significant counter drift.
- **Fix Direction:** Fix CRIT-02 first. The decrement logic in `sla_check_and_release` is correct and should be preserved in the extended version.

---

### HIGH-05 — Rating Row Does Not Store `customer_id` — No Audit Trail Linking Rating to Submitting Customer

- **Severity:** High
- **File(s):** `src/app/api/ratings/route.ts:77–85`, `supabase/migrations/001_initial_schema.sql:57–64`
- **Attack / Failure Scenario:**
  The rating insert at lines 77–85 writes: `{ job_id, provider_id, stars, comment }`. The `ratings` table (migration 001 lines 57–64) has no `customer_id` column. Rating ownership is enforced at query time (route line 63 checks job ownership via session user), but the submitted rating does not record which customer submitted it.

  Consequences:
  1. If a malicious or disputed rating is submitted, there is no DB record linking the `ratings` row to the customer who created it. Only application logs contain this association.
  2. Audit queries like "show me all ratings by customer X" require a JOIN through `jobs` and `requests`, which works if the data is intact — but if any row in that chain is deleted or modified, the attribution is lost.
  3. The `update_provider_rating` trigger (migration 001 lines 170–183) computes provider average rating from the last 50 ratings using `WHERE provider_id = NEW.provider_id`. There is no fraud detection — any rating that passes the route-level ownership check is included in the average.
- **Exploitability:** Not directly exploitable — route-level ownership prevents unauthorized submissions.
- **Production Impact:** Under UAE consumer dispute resolution requirements, a rating that cannot be definitively attributed to a customer in the DB is an audit gap. Provider disputes over ratings have no DB-level attribution evidence.
- **Fix Direction:** Add `customer_id UUID REFERENCES users(id)` to the `ratings` table in migration 039. Include `customer_id: user.id` in the insert.

---

### HIGH-06 — Price-Change Respond Route Update Lacks `status = 'in_progress'` Guard

- **Severity:** High
- **File(s):** `src/app/api/customer/price-change/respond/route.ts:67–73`
- **Attack / Failure Scenario:**
  The respond route reads `request.status` at line 44–46 and checks `request.status !== 'in_progress'` at line 61. The subsequent UPDATE at lines 67–73 is:
  ```typescript
  await admin.from('requests').update({ price_change_status: newStatus })
    .eq('id', parsed.data.request_id)
    .eq('customer_id', user.id)
    .eq('price_change_status', 'pending')
  ```
  There is no `.eq('status', 'in_progress')` guard on the UPDATE. Between the route's read (line 44) and the update (line 67), the request can transition from `in_progress` to `completed` (via the provider calling `/api/provider/jobs/complete`). The `complete_provider_job_atomic` RPC derives `final_price` at the moment of completion — using the selected quote price since `price_change_status = 'pending'` (not yet approved). After completion, the customer's respond call arrives and sets `price_change_status = 'approved'` on the now-completed request. The DB state becomes: `status = 'completed'`, `price_change_status = 'approved'`, `final_price = <quote price>`. The customer is shown "price change approved" but was charged the quote price, not the approved price change.
- **Exploitability:** Low — requires an unlikely timing race between provider completion and customer response.
- **Production Impact:** Misleading data state. Customer UI may display "price change approved" when the actual charge used the original quote price. Creates billing dispute surface.
- **Fix Direction:** Add `.eq('status', 'in_progress')` to the UPDATE WHERE clause at line 67–73.

---

## Medium Findings

---

### MED-01 — Ring Eligibility and Visibility Reduction Not Enforced in Quote Submission API

- **Severity:** Medium
- **File(s):** `src/lib/dispatch.ts:37–73`, `src/app/api/provider/jobs/quote/route.ts:82–101`
- **Attack / Failure Scenario:**
  `filterDispatchCandidates` in `dispatch.ts` enforces two rules not present in the quote API:
  1. **PPJ ring-1 exclusion** (line 37): `if (candidate.plan === 'pay_per_job' && currentRing === 1) return false`. PPJ providers within 5 km of a request can quote freely via the API — the ring restriction is only enforced in the provider dashboard view helper.
  2. **Visibility reduction** (line 73): `if (candidate.visibilityReduced) excluded`. A provider with `visibility_reduced = true` (3+ SLA failures) can still submit quotes via the API. The API checks `provider.status !== 'active'` (line 82) but does not read `visibility_reduced`.

  Neither the quote route nor `submit_quote_atomic` (migration 032) checks `visibility_reduced` or ring eligibility based on PPJ status.
- **Exploitability:** Easy — any active PPJ provider can quote ring-1 requests directly. Any visibility-reduced provider can bypass their penalty by submitting quotes through the API.
- **Production Impact:** Marketplace priority/fairness rules are not enforced at the server level. PPJ providers gain unfair access to near requests. Penalized providers (SLA failures) continue quoting without penalty.
- **Fix Direction:** Add `visibility_reduced` check to the quote route (line 82 block): `if (provider.visibility_reduced) return 403`. For PPJ ring-1 exclusion: add distance and plan check in the route or in `submit_quote_atomic`.

---

### MED-02 — Provider Score Uses Monthly Job Counter as Lifetime Completions

- **Severity:** Medium
- **File(s):** `src/app/api/requests/quotes/route.ts:172–180`, `src/lib/provider-score.ts:31`
- **Attack / Failure Scenario:**
  The quote scoring passes `provider.jobs_this_month` as `completedJobs` to `computeProviderScore` (line 172–180). `computeProviderScore` uses `completedJobs` for the new-provider boost threshold check (`completedJobs < NEW_PROVIDER_BOOST_THRESHOLD = 10`, line 31). Since `jobs_this_month` resets monthly, a provider with 200 lifetime jobs qualifies for the new-provider rating boost (+0.5 stars) at the start of every new month, every month. The boost was intended for genuinely new providers.

  Additionally, `computeAcceptanceRate` at line 180 is called with `(provider.jobs_this_month, provider.jobs_this_month + 1)`, producing `jobs_this_month / (jobs_this_month + 1)` — always near 1.0 regardless of actual quote-to-win ratio.
- **Exploitability:** Not an external exploit — scoring algorithm defect.
- **Production Impact:** New-provider boost fires for experienced providers every month. Acceptance rate scoring is non-functional. Quote rankings are degraded; customers may see sub-optimal providers ranked higher than deserved.
- **Fix Direction:** Use a lifetime completed job count (derived from `jobs` table count or a persistent counter) for `completedJobs`. Track quote submission and win counts in `provider_dispatch_log` for meaningful acceptance rate.

---

### MED-03 — Customer Cancellation Counters Updated Outside RPC — Drift on Failure

- **Severity:** Medium
- **File(s):** `src/app/api/requests/cancel/route.ts:158–170`
- **Attack / Failure Scenario:**
  After the atomic cancellation RPC succeeds, the route performs a non-atomic counter update on the `users` table:
  ```typescript
  await admin.from('users').update({
    cancellation_count: (profile.cancellation_count ?? 0) + 1,
    late_cancellation_count: (profile.late_cancellation_count ?? 0) + (isLateCancellation ? 1 : 0),
  }).eq('id', user.id).eq('cancellation_count', profile.cancellation_count ?? 0)
  ```
  If the update fails (DB error, optimistic lock failure — the `.eq('cancellation_count', ...)` guard fails when concurrent updates change the value), the error is silently swallowed (no error check after line 170 — the function proceeds to logging and returns success). The request is cancelled in the DB but the customer counter is not incremented. Late cancellations go uncounted.
- **Exploitability:** Not actively exploitable — requires timing a race. A determined actor could attempt concurrent cancellations to keep their counter low.
- **Production Impact:** Customer cancellation and late-cancellation counters drift downward under concurrent cancel or DB failures. Platform enforcement based on these counters becomes unreliable.
- **Fix Direction:** Move `cancellation_count` and `late_cancellation_count` increments into `cancel_request_and_compensate_atomic` to ensure they are part of the same atomic transaction.

---

### MED-04 — `release_job_atomic` Resets Request to `open` Ignoring Existing Pending Quotes

- **Severity:** Medium
- **File(s):** `supabase/migrations/028_stuck_job_auto_release.sql:48–54`
- **Attack / Failure Scenario:**
  `release_job_atomic` (migration 028, lines 48–54) sets `status = 'open'` unconditionally. For V2 jobs, when a provider releases, other non-expired pending quotes may still exist in `request_quotes`. The `sla_check_and_release` RPC (migration 031, lines 663–670) correctly checks for pending quotes and sets status to `quoted` or `open` accordingly. `release_job_atomic` does not mirror this behavior — it always resets to `open`.

  Additionally, `release_job_atomic` does not clear `selected_quote_id` from the `requests` row. After release, the request has `status = 'open'`, `accepted_by = NULL`, but `selected_quote_id` still points to the previously selected (now-rejected or dangling) quote. Future code reading `selected_quote_id IS NOT NULL` to detect V2 requests will see a false positive on released requests.
- **Exploitability:** Not directly exploitable.
- **Production Impact:** Released V2 requests lose their quote context (customers must wait for providers to re-quote). Stale `selected_quote_id` creates misleading DB state. Customer UI may behave unexpectedly when re-quoting a released request.
- **Fix Direction:** Update `release_job_atomic` to check for remaining pending non-expired quotes and set status to `quoted` or `open` accordingly. Clear `selected_quote_id = NULL` on release.

---

### MED-05 — Scoring Acceptance Rate Calculation Is Tautological

- **Severity:** Medium
- **File(s):** `src/app/api/requests/quotes/route.ts:180`, `src/lib/provider-score.ts:65–71`
- **Attack / Failure Scenario:**
  At line 180:
  ```typescript
  acceptanceRate: computeAcceptanceRate(provider.jobs_this_month ?? 0, (provider.jobs_this_month ?? 0) + 1)
  ```
  `computeAcceptanceRate(completed, total)` returns `completed / total` (lines 65–71). The arguments are `(jobs_this_month, jobs_this_month + 1)`, producing `jobs_this_month / (jobs_this_month + 1)`. This approaches 1.0 for any provider with >0 monthly jobs. It is identical for a provider who wins 1 in 100 quotes vs. 1 in 1 quote. The `acceptanceScore` (weighted 10% of total) is therefore uniform across all non-zero-jobs-month providers.
- **Exploitability:** Not an external exploit.
- **Production Impact:** Quote ranking does not penalize providers with low acceptance rates. Customers may be presented with providers who rarely complete accepted jobs.
- **Fix Direction:** Track `total_quotes_submitted` in the providers table or compute from `provider_dispatch_log`. Use actual quote-win ratio as acceptance rate.

---

## Low Findings

---

### LOW-01 — `advance_provider_job_state` RPC Missing `SET search_path = public`

- **Severity:** Low
- **File(s):** `supabase/migrations/026_advance_state_atomic.sql:19–20`
- **Attack / Failure Scenario:**
  All other security-definer RPCs in the codebase include `SET search_path = public`. `advance_provider_job_state` (migration 026) defines the function as `SECURITY DEFINER` but omits `SET search_path = public`. Without the search path pin, a malicious schema manipulation could redirect table references if the Postgres session's `search_path` is altered. In Supabase hosted environments, this is low-risk but inconsistent with the project's defensive pattern.
- **Exploitability:** Very low.
- **Production Impact:** Negligible in hosted Supabase. Consistency risk if search_path manipulation is ever possible.
- **Fix Direction:** Add `SET search_path = public` to `advance_provider_job_state` in migration 039.

---

### LOW-02 — Customer RLS on `request_quotes` Exposes Rejected and Expired Quotes Including Provider UUIDs

- **Severity:** Low
- **File(s):** `supabase/migrations/031_marketplace_v2_schema.sql:93–106`
- **Attack / Failure Scenario:**
  The RLS policy "Customer reads quotes on own requests" (lines 93–106) has no status filter — a customer using the Supabase JS client directly can SELECT `rejected` and `expired` quotes including `provider_id` columns. The API route (`GET /api/requests/quotes`) filters to `status = 'pending'` before returning data, so the customer UI never shows stale quotes. But a customer making direct Supabase client calls can enumerate all historical provider UUIDs who quoted their requests, including those who were rejected.

  Combined with Part 1 finding L3 (provider anonymous ID is first 4 chars of UUID), this allows a customer to trivially de-anonymize providers from rejected quotes.
- **Exploitability:** Low — requires direct Supabase client use with the anon key + session.
- **Production Impact:** Provider identity (UUID) leaks for rejected/expired quotes. Undermines the anonymity model before quote selection.
- **Fix Direction:** Add `AND status = 'pending'` to the customer RLS SELECT policy on `request_quotes`, or serve quotes exclusively through the authenticated API route.

---

### LOW-03 — `expire_stuck_active_requests` Does Not Decrement `jobs_this_month`

- **Severity:** Low
- **File(s):** `supabase/migrations/028_stuck_job_auto_release.sql:88–145`
- **Attack / Failure Scenario:**
  The weekly `expire_stuck_active_requests` cron RPC (lines 88–145) releases stuck `accepted`/`en_route`/`arrived` requests. It increments `release_count` and `provider_side_cancellation_count` but does not decrement `jobs_this_month`. Providers whose stuck jobs are weekly-auto-released lose their monthly job slot permanently for that month, even if they did not complete a job.
- **Exploitability:** Not exploitable.
- **Production Impact:** Same nature as HIGH-03 but lower frequency (weekly cron). Compounds counter drift over time.
- **Fix Direction:** Add `jobs_this_month = GREATEST(0, COALESCE(jobs_this_month, 0) - 1)` to the provider update in `expire_stuck_active_requests`.

---

### LOW-04 — `advance_provider_job_state` RPC Does Not Whitelist Valid `p_to_status` Values

- **Severity:** Low
- **File(s):** `supabase/migrations/026_advance_state_atomic.sql:25–52`
- **Attack / Failure Scenario:**
  The RPC accepts `p_to_status TEXT` without validating it against the allowed set of status values. The route-level `VALID_TRANSITIONS` map in `advance-state/route.ts:8–12` provides the whitelist at the API layer. The DB `requests_status_check` constraint (migration 031 line 17) is the final backstop. The RPC itself has no internal whitelist.

  If the RPC were called directly with service_role access (e.g., from a future internal tool or a misuse of the admin SDK), any string could be attempted (constrained only by the DB CHECK).
- **Exploitability:** Very low — requires service_role access.
- **Production Impact:** None in current implementation. The DB constraint provides the backstop. Defense-in-depth concern.
- **Fix Direction:** Add a CASE/IF whitelist validation inside the RPC for `p_to_status` values.

---

### LOW-05 — Marketplace Cron SLA Enforcement Processes at Most 50 Requests Per Run

- **Severity:** Low
- **File(s):** `src/app/api/ops/marketplace-cron/route.ts:121`
- **Attack / Failure Scenario:**
  `enforceSla` queries breached requests with `.limit(50)` (line 121). If more than 50 SLA breaches accumulate between cron runs (e.g., after a cron outage or spike in activity), only 50 are processed per run. The remainder accumulate.
- **Exploitability:** Not exploitable — occurs under cron failure or high volume.
- **Production Impact:** SLA enforcement backlog during incidents. Penalized providers escape consequences temporarily. Customers remain locked longer.
- **Fix Direction:** Paginate or remove the limit. Add monitoring to alert when the batch is full (count >= 50).

---

### LOW-06 — Migration Files 033 and 034 Contain Duplicate Function Bodies

- **Severity:** Low
- **File(s):** `supabase/migrations/033_nearby_requests_include_quoted.sql`, `supabase/migrations/034_cancel_allow_quoted_status.sql`
- **Attack / Failure Scenario:**
  Both migration files contain the same function defined twice within the same file (observed during read — each file defines the same `CREATE OR REPLACE FUNCTION` body twice). On idempotent re-run this is safe (the second definition overwrites the first), but it indicates a copy-paste error in the migration files. Future developers reading these migrations may be confused about which definition is authoritative, and text-based diff tools will show duplicate content.
- **Exploitability:** None.
- **Production Impact:** No functional impact. Code maintenance/clarity concern.
- **Fix Direction:** Remove duplicate function bodies from both migration files (documentation-only fix; do not modify deployed migrations, note for migration 039 comments).

---

## Needs Verification

### NV-01 — Auto-Suspension Trigger May Be Vulnerable to Coordinated Fake Rating Campaign

- **Context:** The `check_provider_suspension` trigger (migration 001, lines 189–201) auto-suspends a provider when `rating < 3.0` after 5+ ratings. The rating route requires a completed job owned by the submitting customer. A coordinated campaign of real customers submitting 1-star ratings across 5 different completed jobs could trigger auto-suspension without recourse. There is no rate-limit on the number of distinct customers who can rate a provider in a given time window.
- **What Needs Verification:** Whether any abuse detection (e.g., manual review queue for auto-suspensions, minimum time between ratings per customer-provider pair) is configured outside the source code.

### NV-02 — `SOFT_LAUNCH_MODE` in Production

- **Context:** `SOFT_LAUNCH_MODE` is passed to `submit_quote_atomic` as `p_is_soft_launch` but only affects the dispatch log (migration 032). If `SOFT_LAUNCH_MODE = true` in production, the intended behavior (PPJ fee = 0, no Stripe capture) suppresses real charges. The source cannot confirm the production env var value.
- **What Needs Verification:** Confirm `NEXT_PUBLIC_SOFT_LAUNCH_MODE = false` in Vercel production environment before enabling real payments.

### NV-03 — Provider Ratings Trigger Table Scan on Each Insert

- **Context:** `update_provider_rating` (migration 001, lines 170–183) and `check_provider_suspension` (lines 189–201) fire on every rating insert. `check_provider_suspension` does `SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id` — a potentially full table scan if no index exists on `ratings(provider_id)`. Migration 001 does not create this index. At scale with many ratings, this could be slow.
- **What Needs Verification:** Check whether a later migration adds `CREATE INDEX ON ratings(provider_id)`.

---

## Business Decisions

### BD-01 — PPJ Providers Excluded From Ring 1 Is a Business Rule Enforced Only in Dashboard

The dispatch.ts ring-1 exclusion for PPJ providers is a business model decision. Whether it should be enforced at the API level (quote submission) is a product decision. See MED-01 for the implementation gap.

### BD-02 — One Price Change Per Job Is Business Policy

The limit of one price change per job (`price_change_count >= 1`) is an intentional business rule. The implementation has a race condition (CRIT-01) that violates the rule, but the rule itself is not in question.

### BD-03 — Commission at Zero for Current Phase

Commission hardcoded to zero in `complete_provider_job_atomic` (migration 031, lines 795–796) is a deliberate soft-launch phase decision. Noted as M5 in Part 1; not re-investigated here.

### BD-04 — Legacy Accept Endpoint Coexistence

The legacy `/api/provider/requests/accept` endpoint remaining active alongside V2 is a known business decision. Noted as HIGH-02 in Part 1.

---

## Data Integrity Risks at Scale

1. **`jobs_this_month` drift (upward):** Incremented by `select_quote_atomic` (V2 acceptance). Decremented by `cancel_request_and_compensate_atomic` (customer cancel) and `sla_check_and_release` (SLA breach, accepted-only). NOT decremented by `release_job_atomic` (provider release) or `expire_stuck_active_requests` (weekly cron release). Net drift: every provider release and every weekly auto-release permanently inflates the counter within the month.

2. **`cancellation_count` / `late_cancellation_count` drift (downward):** Updated outside the atomic cancellation RPC. Silent failure under DB error or optimistic lock collision results in under-counting. Platform enforcement based on these counters degrades over time.

3. **`sla_failure_count` / `visibility_reduced` under-counting:** `sla_failure_count` is only incremented by `sla_check_and_release`, which only processes `accepted` status. Providers who advance to `en_route` before abandoning jobs never have their SLA failures counted. The `visibility_reduced` flag is therefore never triggered for this class of bad actor.

4. **`price_change_count` invariant violation:** Under concurrent requests, `price_change_count` can exceed 1 (CRIT-01). The "maximum one price change per job" invariant is not enforced atomically.

5. **`selected_quote_id` stale FK after `release_job_atomic`:** After a provider-initiated release, `requests.selected_quote_id` retains the old quote UUID while `accepted_by = NULL`. This FK points to a quote row in `rejected` or `selected` status. Future queries using `selected_quote_id IS NOT NULL` to detect V2 requests return false positives for released requests.

6. **Duplicate migration function definitions:** Migrations 033 and 034 each define their respective functions twice in the same file. Safe on re-run (CREATE OR REPLACE), but creates maintenance confusion.

---

## Summary Table

| ID | Severity | Title | File |
|----|----------|-------|------|
| CRIT-01 | Critical | Price-change count is TOCTOU read-then-write; race allows two price changes and resetting a customer's reject | `provider/jobs/price-change/route.ts:44–74` |
| CRIT-02 | Critical | SLA auto-release only fires on `accepted`; `en_route`/`arrived` jobs permanently locked until weekly cron | `ops/marketplace-cron/route.ts:115–121`, `031_marketplace_v2_schema.sql:641–644` |
| HIGH-01 | High | `GET /api/requests/quotes` accepts unvalidated string `request_id` — no UUID format check | `requests/quotes/route.ts:45–84` |
| HIGH-02 | High | `GET /api/requests` performs state-mutating expiry write with no error handling | `requests/route.ts:136–149` |
| HIGH-03 | High | `release_job_atomic` does not decrement `jobs_this_month` — V2 provider allowance under-counted | `028_stuck_job_auto_release.sql:61–78`, `031_marketplace_v2_schema.sql:566–569` |
| HIGH-04 | High | `jobs_this_month` permanently inflated for stuck `en_route`/`arrived` jobs (consequence of CRIT-02) | `031_marketplace_v2_schema.sql:692–698`, `ops/marketplace-cron/route.ts:115–121` |
| HIGH-05 | High | Rating row does not store `customer_id` — no DB-level audit trail linking rating to submitting customer | `ratings/route.ts:77–85`, `001_initial_schema.sql:57–64` |
| HIGH-06 | High | Price-change respond UPDATE lacks `status = 'in_progress'` guard — stale approval possible on completed job | `customer/price-change/respond/route.ts:67–73` |
| MED-01 | Medium | Ring eligibility (PPJ ring-1) and `visibility_reduced` penalty not enforced in quote submission API | `dispatch.ts:37–73`, `provider/jobs/quote/route.ts:82–101` |
| MED-02 | Medium | Provider score uses `jobs_this_month` as lifetime completions — new-provider boost fires every month | `requests/quotes/route.ts:172–180`, `provider-score.ts:31` |
| MED-03 | Medium | Customer cancel counter updated outside RPC — silently under-counts on DB failure | `requests/cancel/route.ts:158–170` |
| MED-04 | Medium | `release_job_atomic` resets to `open` ignoring pending quotes; stale `selected_quote_id` not cleared | `028_stuck_job_auto_release.sql:48–54` |
| MED-05 | Medium | Acceptance rate in scoring is tautological (`jobs_this_month / (jobs_this_month + 1)`) | `requests/quotes/route.ts:180`, `provider-score.ts:65–71` |
| LOW-01 | Low | `advance_provider_job_state` RPC missing `SET search_path = public` | `026_advance_state_atomic.sql:19` |
| LOW-02 | Low | Customer RLS on `request_quotes` exposes rejected/expired quotes with provider UUIDs | `031_marketplace_v2_schema.sql:93–106` |
| LOW-03 | Low | `expire_stuck_active_requests` weekly cron does not decrement `jobs_this_month` | `028_stuck_job_auto_release.sql:88–145` |
| LOW-04 | Low | `advance_provider_job_state` RPC does not whitelist valid `p_to_status` values | `026_advance_state_atomic.sql:25–52` |
| LOW-05 | Low | SLA enforcement cron processes at most 50 requests per run — backlog under outage | `ops/marketplace-cron/route.ts:121` |
| LOW-06 | Low | Migration files 033 and 034 each contain their function body defined twice | `033_nearby_requests_include_quoted.sql`, `034_cancel_allow_quoted_status.sql` |

---

## Verification Log

- Source files read in this run: 31
- Documentation files read in this run: 5 (CLAUDE.md, ARCHITECTURE.md, MARKETPLACE_V2_SPEC.md, PROJECT_HANDOFF.md, SECURITY_AUDIT_1.md; ROADMAP.md and SESSION_LOG.md not found in working directory)
- Required files NOT opened: `033_marketplace_v2_helpers.sql` (file not found at that path; actual filename is `033_nearby_requests_include_quoted.sql` — read under that name)
- Additional files opened beyond required list: `supabase/migrations/029_rpc_add_en_route_arrived_statuses.sql`, `supabase/migrations/033_nearby_requests_include_quoted.sql`, `supabase/migrations/034_cancel_allow_quoted_status.sql`, `supabase/migrations/037_rls_force_and_explicit_deny.sql`, `supabase/migrations/038_provider_kyc.sql`
- Every finding traces to source lines read in this run: Yes
- Findings inferred from old SECURITY_AUDIT_2.md: No (SECURITY_AUDIT_2.md did not exist before this run; only SECURITY_AUDIT_1.md was read for deduplication)
- Source files modified: No

---

No source files were modified. This report is for review only.
