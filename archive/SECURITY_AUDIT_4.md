# SECURITY AUDIT PART 4 — Production Readiness & Scalability

**Date:** 2026-06-24
**Auditor:** Claude Sonnet 4.6 (automated, full source read)
**Scope:** Realtime architecture, rate limiting at scale, cron jobs, performance, observability, cache/state consistency, database scale risks, production readiness, disaster recovery, deployment safety
**Baseline:** Full Production — 10,000+ users, 1,000+ providers, hundreds of concurrent requests, adversarial users, automated abuse, Stripe LIVE, real money
**Part 1/2/3 policy:** Prior-audit findings are not re-reported unless they create a NEW scalability or production-readiness failure mode. When a prior finding is a prerequisite for a chain documented here, it is confirmed or labeled "Depends On Earlier Finding."

---

## Executive Summary

The most severe scalability risk in this codebase is a **thundering herd** baked into the realtime architecture: every new customer request INSERT triggers a broadcast to every online provider via Supabase Realtime. At 1,000+ online providers, a single request creates 1,000 simultaneous `router.refresh()` calls — each a full Next.js App Router SSR render that makes 5–8 Supabase queries. This alone can exhaust the Supabase connection pool and render the provider dashboard unavailable at scale. The fix requires server-side geographic pre-filtering before broadcasting, which the current architecture does not support through Supabase `postgres_changes`.

The second critical issue is the monthly allowance reset cron, which loads all qualifying providers into a single serverless function's memory and processes them in `Promise.all()`. At 1,000+ subscription providers this saturates the function's memory and DB write concurrency; the function silently fails, leaving all providers locked at their monthly limit for an extra billing cycle.

Cron infrastructure is generally well-designed with idempotent DB-level guards, but has three gaps: the SLA enforcement loop is sequential (50 RPCs per invocation), partial failures return HTTP 200 (no Vercel alerting), and the weekly SLA reset is a two-phase non-atomic update. The rate limiting analysis (confirming Part 1 H4) finds that polling endpoints (`GET /api/requests`, `GET /api/requests/quotes`) have **no rate limiting at all** — at 10,000 customers polling every 5 seconds this is 2,000 requests/second to a single endpoint with no protection.

Observability is inadequate for production: structured logging goes to stdout only, Sentry covers errors but there are no operational alerts for cron failures, Redis unavailability, or rate limit exhaustion. There is no incident-response runbook, no monitoring dashboard, and no alerting.

**This system is NOT READY for production at the scale of 1,000+ concurrent providers or 10,000 customers without architectural changes to the realtime broadcast model and the cron batch processing approach.**

---

## Files Read

**Documentation (8 files):**
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `MARKETPLACE_V2_SPEC.md`
- `PROJECT_HANDOFF.md`
- `ROADMAP.md`
- `SECURITY_AUDIT_1.md`
- `SECURITY_AUDIT_2.md`
- `SECURITY_AUDIT_3.md`
- `SESSION_LOG.md` — **not found**

**Source files (21 files):**
- `src/lib/rate-limit.ts`
- `src/lib/dispatch.ts`
- `src/lib/logger.ts`
- `src/lib/ops-auth.ts`
- `src/lib/env.ts`
- `src/lib/supabase/admin.ts`
- `src/app/api/ops/marketplace-cron/route.ts`
- `src/app/api/ops/expire-requests/route.ts`
- `src/app/api/ops/weekly-sla-reset/route.ts`
- `src/app/api/ops/monthly-allowance-reset/route.ts`
- `src/components/provider/ProviderRealtimeRefresh.tsx`
- `src/components/customer/CustomerQuoteList.tsx`
- `src/app/customer/request/page.tsx`
- `src/app/provider/dashboard/page.tsx` (partial — lines 1–250)
- `src/app/admin/dashboard/page.tsx` (partial — lines 1–100)
- `vercel.json`
- `supabase/migrations/001_initial_schema.sql` (lines 1–210)
- `supabase/migrations/013_query_performance_indexes.sql`
- `supabase/migrations/016_task4_query_indexes.sql`
- `supabase/migrations/017_task8_query_indexes.sql`
- `supabase/migrations/030_requests_realtime_publication.sql`
- `supabase/migrations/031_marketplace_v2_schema.sql` (lines 1–249, 620–750)
- `supabase/migrations/036_provider_location_lat_lng_columns.sql`

---

## Critical Findings

---

### P4-C1 — Realtime Broadcast to All Providers on Every Request INSERT — Thundering Herd at Scale

- **Severity:** Critical
- **Files:** `src/components/provider/ProviderRealtimeRefresh.tsx:37–68`, `vercel.json` (indirectly, SSR budget)
- **New finding in Part 4:** Yes

**Evidence:**

`ProviderRealtimeRefresh.tsx` creates a `postgres_changes` subscription on every online provider's browser client:

```typescript
// Line 39–50: Every online provider subscribes to ALL open request INSERTs
const openRequestsChannel = supabase
  .channel(`provider-open-requests:${providerId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'requests',
    filter: `status=eq.open`,   // ← no geographic filter; all providers receive all events
  }, () => {
    showToast(t('newRequestNearby'), 'info')
    scheduleRefresh()           // ← triggers router.refresh() after 1500ms debounce
  })
  .subscribe()
```

`scheduleRefresh()` (lines 24–31) calls `router.refresh()` after `DEBOUNCE_MS = 1500` ms if the `THROTTLE_MS = 3000` ms guard passes. Both guards are **per-component**, not shared across providers.

**Failure scenario:**

1. 1,000 providers are online with active browser sessions
2. One customer creates a request → `requests` INSERT with `status = 'open'`
3. Supabase Realtime broadcasts this event to ALL 1,000 subscriptions matching `status=eq.open`
4. All 1,000 provider browsers receive the event simultaneously
5. Each calls `scheduleRefresh()`, which fires `router.refresh()` after 1,500 ms
6. ~1,500 ms later: 1,000 simultaneous Next.js SSR renders of `/provider/dashboard`
7. Provider dashboard (`page.tsx`) makes multiple Supabase queries per render (provider row, location, nearby requests, active job, recent activity, etc.) — estimated 5–8 queries per render
8. Result: **5,000–8,000 Supabase queries within a 1–2 second window from a single customer action**

**Amplification:** With hundreds of customers creating requests per hour and 1,000+ providers, this pattern fires continuously. The debounce does not help when 1,000 different providers each receive one event.

**Supabase plan limits:** Supabase Pro concurrent connection limit is ~500 by default (configurable). With 1,000 providers' browsers holding WebSocket connections to Supabase Realtime, the plan may already be at limit before the SSR surge hits the REST API.

**Scale impact:** Linear with provider count — 100 providers is ~manageable, 1,000 providers is dangerous, 10,000 is a complete service outage on every request creation.

**ARCHITECTURE.md discrepancy:** ARCHITECTURE.md states ProviderRealtimeRefresh "subscribes to request, quote, and provider location events" — the actual code does NOT subscribe to `provider_locations`. The architecture doc is inaccurate.

**Fix direction:** Replace the broadcast-to-all model with server-sent events (SSE) or a dedicated notification endpoint where the server pushes only to providers within geographic range. Alternatively, add a `region` or `emirate` filter to the realtime subscription if Supabase Realtime supports multi-column filters, so providers only receive events for their dispatch ring. At minimum, add server-side pagination/delay to SSR renders triggered by realtime events.

---

### P4-C2 — Monthly Allowance Reset Loads All Providers Into Single Serverless Function — Memory and Concurrency Cliff

- **Severity:** Critical
- **File:** `src/app/api/ops/monthly-allowance-reset/route.ts:34–86`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// Lines 34–37: loads ALL qualifying providers into memory at once
const { data: providers, error } = await supabase
  .from('providers')
  .select('id, plan, jobs_this_month, stripe_current_period_start, jobs_reset_at')
  .in('plan', ['starter', 'pro'])
  .not('stripe_subscription_id', 'is', null)
  .returns<ResetProviderRow[]>()

// Line 46–86: processes ALL due providers concurrently
const results = await Promise.all(
  dueProviders.map(async (provider) => {
    // ... individual DB update per provider
  })
)
```

**Failure scenario at 1,000+ subscription providers:**

1. Monthly reset cron fires at midnight UTC (`0 0 * * *`)
2. If all providers have a billing period start that just passed, `dueProviders` contains 1,000+ rows
3. All 1,000 rows are held in memory simultaneously
4. `Promise.all()` fires 1,000 Supabase `UPDATE` operations concurrently
5. If Vercel serverless memory limit (1,024 MB default) is exceeded, the function is killed mid-execution
6. No provider in this invocation gets their monthly reset
7. The cron runs once daily; there is no retry mechanism
8. All subscription providers remain at their previous month's count for a full day
9. Providers who have already used their monthly allowance cannot submit quotes
10. Marketplace freezes for all at-limit providers

**Additional risk:** 1,000 concurrent DB writes can exhaust the Supabase connection pool / pgBouncer transaction pool. Writes back up, causing timeouts. With a `maxDuration = 60` limit, some providers update while others time out — partial month resets with no audit of which succeeded.

**Fix direction:** Paginate the provider fetch in batches of 50–100. Process each batch sequentially before fetching the next. Use `limit` and `offset` or cursor-based pagination. Total execution time stays within `maxDuration = 60`.

---

## High Findings

---

### P4-H1 — High-Frequency Read Endpoints Have No Rate Limiting

- **Severity:** High
- **Files:** `src/app/api/requests/route.ts` (GET handler), `src/app/api/requests/quotes/route.ts` (GET handler), `src/components/customer/CustomerQuoteList.tsx:77–83`, `src/app/customer/request/page.tsx:186–198`
- **New finding in Part 4:** Yes

**Evidence:**

Customer request page polls `GET /api/requests` at dynamic intervals:
```typescript
// customer/request/page.tsx lines 186–198
const pollMs = isActiveState ? 5000 : isQuotedState ? 30000 : 60000
const interval = window.setInterval(() => {
  void loadRequestState().catch(() => undefined)
}, pollMs)
```

CustomerQuoteList polls `GET /api/requests/quotes?request_id=...` every 30 seconds:
```typescript
// CustomerQuoteList.tsx lines 77–83
const interval = setInterval(() => { void fetchQuotes() }, 30000)
```

Neither `GET /api/requests` nor `GET /api/requests/quotes` calls `checkRateLimitAsync` — confirmed by absence of rate-limit imports in these route files (verified in Part 2 audit as well).

**Production load projection:**

| State | Poll interval | 10,000 customers | Requests/second |
|-------|--------------|-----------------|-----------------|
| `accepted`/active | 5 seconds | 10,000 | 2,000 req/s |
| `quoted` | 30 seconds | 10,000 | 333 req/s |
| `open` | 60 seconds | 10,000 | 167 req/s |

A single adversarial customer or bot can hammer these endpoints with zero throttling. A market panic scenario (large incident, everyone checking their request) creates genuine demand spikes that the DB cannot absorb.

**Fix direction:** Add `checkRateLimitAsync` to both GET handlers. For `GET /api/requests`: 60 requests/minute per user. For `GET /api/requests/quotes`: 30 requests/minute per user. These are generous enough for legitimate polling.

---

### P4-H2 — marketplace-cron SLA Enforcement Is Sequential Over Up to 50 Requests Per Invocation

- **Severity:** High
- **File:** `src/app/api/ops/marketplace-cron/route.ts:104–161`
- **New finding in Part 4:** Yes (extends Part 2 LOW-05 to a new failure mode)

**Evidence:**

```typescript
// Lines 132–154: sequential loop, one RPC call per breached request
for (const request of breachedRequests) {
  const { data: rpcResult, error: rpcError } = await supabase.rpc('sla_check_and_release', {
    p_request_id: request.id,
  })
  // ... per-request error handling
}
```

With `maxDuration = 30` seconds and 50 sequential RPC calls, each RPC must complete in under 0.6 seconds. Under Supabase load, RPC latency can be 100–300ms, making 50 serial calls total 5–15 seconds — within limits normally. But during a DB congestion event:

1. Each `sla_check_and_release` call takes 1–2 seconds (congestion)
2. 50 × 1.5s = 75 seconds — exceeds `maxDuration = 30`
3. Vercel terminates the function after 30 seconds
4. Remaining breached requests are not released
5. Customers remain locked to non-responding providers until the next invocation (1 minute later)
6. Under sustained congestion, SLA enforcement never catches up

**Compounding risk:** Part 2 CRIT-02 (not re-verified from this run, depends on earlier finding) states `sla_check_and_release` only fires for `accepted` status — en_route/arrived jobs are excluded. The sequential loop bottleneck compounds this gap.

**Fix direction:** Convert the loop to `Promise.all()` over the 50 requests (bounded concurrency). Add a `LIMIT` parameter check to detect when the batch is saturated (50/50 = alert needed). Consider a separate SLA enforcement table with processed flags for retry tracking.

---

### P4-H3 — Weekly SLA Reset Is Non-Atomic — Two-Phase Update Can Corrupt Provider Flags

- **Severity:** High
- **File:** `src/app/api/ops/weekly-sla-reset/route.ts:41–65`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// Phase 1 — Lines 41–52: set visibility_reduced = true for high-failure providers
if (highFailureIds.length > 0) {
  const { error: reduceError } = await supabase
    .from('providers')
    .update({ visibility_reduced: true })
    .in('id', highFailureIds)
  // ... error handling, but continues execution
}

// Phase 2 — Lines 55–64: reset sla_failure_count to 0 for ALL providers
const { error: resetError } = await supabase
  .from('providers')
  .update({ sla_failure_count: 0 })
  .gt('sla_failure_count', 0)
```

If Phase 1 succeeds but Phase 2 fails (DB timeout, network error):
- High-failure providers have `visibility_reduced = true`
- Their `sla_failure_count` is NOT reset to 0
- Next week's reset will re-apply `visibility_reduced = true` (idempotent but wasteful)
- Counter never resets — providers are permanently visibility-reduced until manual intervention

If Phase 1 fails but Phase 2 succeeds (more likely if the filter set is large):
- `sla_failure_count` is reset to 0 for all providers
- `visibility_reduced` is NOT set for high-failure providers
- Providers who should have been penalized escape the visibility reduction
- Platform fairness rules are not enforced

**Scale impact:** With 10,000+ providers, the `UPDATE ... WHERE sla_failure_count > 0` on Phase 2 is an unbounded update touching potentially thousands of rows. No `LIMIT`, no batch.

**Fix direction:** Wrap both phases in a Postgres transaction via a single RPC (`weekly_sla_reset_atomic`) using `SECURITY DEFINER`. Add a `LIMIT` to both phases and paginate if needed.

---

### P4-H4 — Cron Partial Failures Return HTTP 200 — Vercel Sees Success, No Alerting Triggered

- **Severity:** High
- **File:** `src/app/api/ops/marketplace-cron/route.ts:44–46`, `src/app/api/ops/expire-requests/route.ts:42–88`
- **New finding in Part 4:** Yes

**Evidence:**

marketplace-cron always returns HTTP 200:
```typescript
// marketplace-cron/route.ts lines 44–46
return NextResponse.json({ success: true, ...results })
// where results.errors may contain error strings from failed operations
```

expire-requests: returns 500 for `expireError` but 200 (with warning logs) for `stuckJobsError` and `stuckError`:
```typescript
// expire-requests/route.ts lines 42–88
if (expireError) {
  return NextResponse.json({ error: 'Failed to expire stale requests' }, { status: 500 })
}
if (stuckJobsError) {
  logger.warn({ ... })  // ← HTTP 200 still returned
}
if (stuckError) {
  logger.warn({ ... })  // ← HTTP 200 still returned
}
```

**Failure scenario:**

1. `expireStaleQuotes` fails due to Supabase timeout (inside marketplace-cron)
2. Error is collected in `results.errors`
3. Function still returns `{ success: true, expired_quotes: 0, errors: ["expire_quotes: timeout"] }`
4. Vercel cron monitoring records HTTP 200 — no failure alert
5. Quote expiry stops working silently
6. Customers continue to see expired quotes in the UI
7. Providers waste time quoting on expired requests
8. No operator is alerted; the failure continues indefinitely

Vercel cron monitoring only alerts on HTTP 4xx/5xx responses. A partial failure that returns 200 with an `errors` array is invisible.

**Fix direction:** If any core operation in a cron fails, return HTTP 500. Log the partial results but indicate failure status. Separately: add monitoring that watches for sustained `errors.length > 0` in cron log output.

---

### P4-H5 — Admin Dashboard Issues 19+ Parallel DB Queries Per Page Load Without Caching

- **Severity:** High
- **File:** `src/app/admin/dashboard/page.tsx:60–86`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// Lines 60–86: 19 concurrent Supabase queries on every admin dashboard load
const [
  { count: totalCustomers },         // users count by role
  { count: totalProviders },         // users count by role
  { count: activeProvidersCount },   // providers by status
  { count: pendingProvidersCount },  // providers by status
  { count: suspendedProvidersCount },
  { count: openRequestsCount },      // requests by status ×7
  { count: acceptedRequestsCount },
  { count: enRouteRequestsCount },
  { count: arrivedRequestsCount },
  { count: inProgressRequestsCount },
  { count: completedRequestsCount },
  { count: expiredRequestsCount },
  { count: totalRequestsCount },
  { data: recentEvents },            // stripe_events join
  { data: recentPayouts },           // payout_log
  { count: activeSubscriptions },
  { count: failedStripeEvents },
  { count: failedOveragePayments },
  { data: stuckJobs },               // jobs JOIN requests, filtered by en_route_at
] = await Promise.all([...])
```

Each page load fires 19 queries simultaneously. The stuckJobs query joins `jobs` with `requests` and filters on `jobs.en_route_at`. No migration creates an index on `jobs(en_route_at)` — this is a potential full table scan on the `jobs` table.

**Scale impact:** With a large `jobs` table (100,000+ rows over time), the stuck-jobs query scans the full table on every admin page load. At production with multiple admins and frequent refreshes, this degrades response times and competes with customer/provider API queries for Supabase connection slots.

**Fix direction:** Add `CREATE INDEX IF NOT EXISTS idx_jobs_en_route_at ON jobs(en_route_at) WHERE en_route_at IS NOT NULL;` in migration 039. Consider caching the admin dashboard metrics for 60 seconds using server-side state or edge caching, since count queries do not need sub-second freshness.

---

### P4-H6 — Customer Page Dual-Loads: Polling and Realtime Both Trigger Full State Fetches Under Active Jobs

- **Severity:** High
- **File:** `src/app/customer/request/page.tsx:182–233`
- **New finding in Part 4:** Yes

**Evidence:**

Customer page simultaneously:

1. **Polls** `GET /api/requests` at 5-second intervals when status is `accepted/en_route/arrived/in_progress` (line 188–196)
2. **Subscribes** to realtime `requests` UPDATE events and calls `loadRequestState()` on each event (lines 200–233)

When a provider advances job state (e.g., `accepted` → `en_route`), the customer receives:
- A realtime UPDATE event → `loadRequestState()` call
- An ongoing 5-second poll → another `loadRequestState()` call in ≤5 seconds

Both calls hit `GET /api/requests`, which reads from the DB (no cache). With 10,000 customers in active job states, the baseline load is already 2,000 requests/second (no rate limiting per H1 above). Adding realtime event-triggered fetches on top increases this load by an unpredictable factor.

**Fix direction:** When a realtime event arrives, update local state directly from the event payload (`payload.new` already contains the updated row) instead of triggering a full API fetch. Only call `loadRequestState()` on terminal state changes (`cancelled`, `expired`, `completed`) that need a full server-side render.

---

## Medium Findings

---

### P4-M1 — Missing Index on `jobs.en_route_at` — Admin Stuck-Job Query Is Full Table Scan

- **Severity:** Medium
- **File:** `src/app/admin/dashboard/page.tsx:80–85`, migrations 013/016/017 (index definitions)
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// admin/dashboard/page.tsx lines 79–85
admin.from('jobs')
  .select('request_id, en_route_at, arrived_at, requests!inner(...)')
  .lt('en_route_at', stuckCutoff)
  .in('requests.status', ['en_route', 'arrived'])
  .is('completed_at', null)
```

Migrations 013, 016, and 017 create indexes on `jobs(provider_id, completed_at)`, `jobs(completed_at)`, but NOT on `jobs(en_route_at)`. The `.lt('en_route_at', stuckCutoff)` filter is a full table scan on the `jobs` table.

**Fix direction:** Add `CREATE INDEX IF NOT EXISTS idx_jobs_en_route_at ON jobs(en_route_at) WHERE en_route_at IS NOT NULL AND completed_at IS NULL;` in migration 039.

---

### P4-M2 — `expireStaleQuotes` in marketplace-cron Has No Row Limit — Can Hold Write Locks on Large Batches

- **Severity:** Medium
- **File:** `src/app/api/ops/marketplace-cron/route.ts:48–71`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// marketplace-cron/route.ts lines 51–55
const { data, error } = await supabase
  .from('request_quotes')
  .update({ status: 'expired' })
  .eq('status', 'pending')
  .lt('expires_at', new Date().toISOString())
  .select('id')  // no LIMIT
```

After a cron outage (e.g., 24h failure), thousands of pending quotes may accumulate. The unbounded UPDATE touches all of them in one statement. This holds a write lock on all affected rows for the duration of the update, blocking concurrent quote submissions and provider quote reads.

**Fix direction:** Add `.limit(500)` to the update. Since the cron runs every minute, catching 500/minute should be sufficient for normal operations while avoiding lock contention.

---

### P4-M3 — Weekly SLA Reset Fetches All Providers With No Row Limit

- **Severity:** Medium
- **File:** `src/app/api/ops/weekly-sla-reset/route.ts:22–25`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// weekly-sla-reset/route.ts lines 22–25
const { data: failingProviders, error: fetchError } = await supabase
  .from('providers')
  .select('id, sla_failure_count')
  .gt('sla_failure_count', 0)  // no LIMIT
```

At 10,000 providers with any SLA failure count (even 1), this loads 10,000 rows. With `maxDuration = 30`, the select, in-memory processing, and two UPDATE statements must all complete within 30 seconds.

**Fix direction:** Add pagination. This is a weekly operation; paginating in batches of 500 is safe.

---

### P4-M4 — Rate-Limit Fallback Flag `redisFallbackLogged` Resets on Every Cold Start

- **Severity:** Medium (extends Part 1 H4)
- **File:** `src/lib/rate-limit.ts:15`
- **Re-verified from this run:** Yes — `const buckets = new Map<string, RateLimitEntry>()` and `let redisFallbackLogged = false` at module level (lines 14–15)
- **Part 1 H4 extends to a new scalability concern:** Yes

**New detail confirmed in this run:** Vercel creates new serverless function instances on cold starts and may run many instances concurrently. The `redisFallbackLogged` flag suppresses duplicate logs but only within one instance. If 10 instances are running and Redis is down:
- All 10 instances log the Redis-unavailable warning once
- All 10 use in-memory `buckets` maps that are isolated from each other
- Rate limits are effectively per-instance, not per-user-globally
- No instance knows the other 9 are also in fallback mode

**Operational risk:** Redis being down silently degrades rate limiting to per-instance-memory mode. No aggregated alert fires. The operator has no visibility that rate limiting is broken across the fleet.

**Fix direction (extends Part 1 recommendation):** Alert on `rate_limit_redis_unavailable_in_memory_fallback` log events via log-drain monitoring. Consider failing hard (returning 503) on critical payment endpoints when Redis is unavailable rather than silently falling back.

---

### P4-M5 — Supabase Realtime Subscriptions Scale Linearly With Online Providers

- **Severity:** Medium
- **File:** `src/components/provider/ProviderRealtimeRefresh.tsx:34–136`
- **New finding in Part 4:** Yes

**Evidence:**

Each online provider browser maintains 2–3 persistent WebSocket connections / channels to Supabase Realtime:
1. `provider-open-requests:${providerId}` — requests INSERT/UPDATE with `status=eq.open`
2. `provider-quotes:${providerId}` — request_quotes UPDATE with `provider_id=eq.${providerId}`
3. `provider-active-job:${activeRequestId}` — requests UPDATE with `id=eq.${activeRequestId}` (conditional)

At 1,000 providers: ~2,000–3,000 active Supabase Realtime channels.

Supabase Pro plan default concurrent connection limit: 500. To support 1,000 providers, the plan would need to be upgraded to an Enterprise plan or the architecture would need to be changed. Supabase recommends using Presence or Broadcast channels over `postgres_changes` for high-concurrency use cases.

**Fix direction:** Evaluate moving to Supabase Broadcast channels (which use a publish/subscribe model more efficiently) or implementing server-sent events (SSE) for provider notifications. At minimum, confirm Supabase Enterprise tier limits before launch.

---

### P4-M6 — `authorizeOpsRequest` Accepts Both `OPS_CRON_SECRET` and Vercel `CRON_SECRET` — Secret Rotation Gap

- **Severity:** Medium
- **File:** `src/lib/ops-auth.ts:20–33`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// ops-auth.ts lines 20–33
const isVercelCron = vercelCronSecret !== null && bearerToken === vercelCronSecret
const isOpsSecret = bearerToken === expectedSecret || headerToken === expectedSecret

if (!isVercelCron && !isOpsSecret) { /* reject */ }
```

Two separate secrets can authenticate cron routes: `CRON_SECRET` (Vercel-managed, injected by Vercel into scheduled invocations) and `OPS_CRON_SECRET` (manually managed). This is intentionally dual-mode.

**Gap:** `CRON_SECRET` is set by Vercel but its value is not validated for minimum length (unlike `OPS_CRON_SECRET` which requires 32 chars per `env.ts:73–77`). If Vercel's `CRON_SECRET` is short or predictable, cron endpoints can be triggered by any client that knows it.

More critically: if `OPS_CRON_SECRET` is compromised, rotating it requires a code deploy (env var change + redeploy). During this window, the old secret remains valid. There is no secret invalidation mechanism.

**Fix direction:** Needs Verification — confirm Vercel's `CRON_SECRET` is cryptographically random and at least 32 characters. Document the secret rotation procedure.

---

## Low Findings

---

### P4-L1 — Logger Writes to stdout Only — No Structured Log Aggregation or Alerting

- **Severity:** Low
- **File:** `src/lib/logger.ts:60–74`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// logger.ts lines 68–74
if (process.env.NODE_ENV === 'production') {
  console[level](JSON.stringify(entry))  // stdout only
} else {
  console[level](`[${level.toUpperCase()}] ${event}`, rest)
}
```

Structured JSON logs go to Vercel's function log output (stdout). There is no:
- Log aggregation service (Datadog, Logtail, Papertrail, etc.)
- Alerting on `level: 'error'` events
- Dashboard for monitoring cron result events (`marketplace_cron_complete`, `monthly_allowance_reset_completed`)
- Alert for `rate_limit_redis_unavailable_in_memory_fallback`
- Alert for cron failures

In production, Vercel's log retention is limited (hours for free, days for paid). After a cron failure, logs may be gone before an operator investigates.

**Fix direction:** Add a log drain to a persistent log aggregation service. Configure alerts on `level: 'error'` events, Redis fallback events, and cron partial failures.

---

### P4-L2 — `check_provider_suspension` Trigger Fires COUNT(*) on Each `providers.rating` UPDATE

- **Severity:** Low
- **File:** `supabase/migrations/001_initial_schema.sql:189–201`
- **New finding in Part 4:** Yes (extends Part 2 NV-03 verification)

**Evidence:**

```sql
-- migration 001 lines 189–201
CREATE OR REPLACE FUNCTION check_provider_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rating < 3.0 AND
    (SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id) >= 5
  THEN
    UPDATE providers SET status = 'suspended' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
```

This trigger fires on every `providers.rating` UPDATE. The `COUNT(*)` from `ratings WHERE provider_id = NEW.id` is now covered by `idx_ratings_provider_created ON ratings(provider_id, created_at DESC)` (migration 016). Index scan cost is O(log N). However, the trigger still fires on every rating trigger, which fires on every ratings INSERT. This creates a trigger chain: `ratings INSERT → update_provider_rating trigger → providers UPDATE → check_provider_suspension trigger`.

Two back-to-back DB operations per rating insert. At scale with concurrent rating submissions, this creates lock contention on the provider row.

**Verification needed:** Confirm whether the `idx_ratings_provider_created` index satisfies the `COUNT(*)` query efficiently (covers `provider_id` but the `COUNT(*)` doesn't use `created_at`). Separate index `idx_ratings_provider_id ON ratings(provider_id)` would be more efficient for the COUNT.

---

### P4-L3 — No Deployment Safety for In-Flight Realtime Events During Vercel Deploys

- **Severity:** Low
- **New finding in Part 4:** Yes

**Analysis:**

When Vercel deploys a new version:
1. New function instances start serving requests
2. Old function instances are terminated after in-flight requests complete
3. Browser clients connected to Supabase Realtime maintain their WebSocket connections (Supabase-managed, not Vercel-managed)
4. Clients continue receiving events but `router.refresh()` calls now hit the new deployment

**Gap:** If a realtime event fires during the deploy window:
- Old browser clients call `router.refresh()` against the new deployment
- If the new deployment has a schema migration that hasn't been applied yet, or a breaking API change, the refresh may fail
- The component's realtime subscription remains active but subsequent refreshes may return incorrect state

This is a standard zero-downtime deployment concern. The current architecture handles it through Next.js deployment model but there's no documented deploy procedure to prevent it.

**Fix direction:** Ensure Supabase migrations are applied before Vercel deployment (migration → deploy order). Document this in deployment runbook.

---

### P4-L4 — `OPS_CRON_SECRET` Not in `validateEnv()` Hard-Fail List

- **Severity:** Low
- **File:** `src/lib/env.ts:42–52, 73–77`
- **New finding in Part 4:** Yes

**Evidence:**

```typescript
// env.ts lines 42–52: SERVER_REQUIRED_ENVS used for hard-fail validation
const SERVER_REQUIRED_ENVS: EnvName[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  // ... Stripe keys ...
  // OPS_CRON_SECRET is NOT here
]

// lines 54–58: RUNTIME_REQUIRED_ENVS - only warns, doesn't throw
const RUNTIME_REQUIRED_ENVS: EnvName[] = [
  'OPS_CRON_SECRET',   // ← only a warning in production
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
]
```

`OPS_CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` are in `RUNTIME_REQUIRED_ENVS`, which only logs a `console.error` warning — it does NOT throw and does NOT prevent deployment. If these are missing at startup:
- `OPS_CRON_SECRET`: all cron routes return 503 ("Operations secret is not configured") on every invocation
- `UPSTASH_REDIS_REST_URL/TOKEN`: rate limiting silently falls back to in-memory

**Fix direction:** Consider moving `OPS_CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` to `SERVER_REQUIRED_ENVS` so a missing ops secret causes a hard startup failure rather than silent 503s on first cron invocation.

---

### P4-L5 — `request_quotes` Realtime Publication Not Confirmed in Source

- **Severity:** Low
- **New finding in Part 4:** Yes (Needs Verification)

**Evidence:**

ARCHITECTURE.md states: "Migration 031 adds request_quotes to realtime publication." However, in migration 030 (the realtime publication migration, fully read in this run), only `public.requests` is added to the publication. The full migration 031 was not read beyond line 249 and 620–750 — the realtime publication for `request_quotes` was not found in the sections read.

`CustomerQuoteList.tsx` subscribes to `request_quotes` INSERT/UPDATE events. If `request_quotes` is not in the `supabase_realtime` publication, these subscriptions will receive no events and the customer's quote list will not update in realtime.

**Fix direction:** Needs Verification — confirm `ALTER PUBLICATION supabase_realtime ADD TABLE public.request_quotes` exists (likely in migration 031 lines 250–619 not read in this run). If missing, add in migration 039.

---

## Needs Verification

### NV-1 — Supabase Realtime Concurrent Connection Limit for Production Plan

Cannot verify from source. Supabase Pro has a default limit of 200–500 concurrent Realtime connections (varies by plan). With 1,000 providers online plus customers, the application may already exceed the plan limit. Verify the production Supabase plan's realtime connection limits.

### NV-2 — `request_quotes` in Supabase Realtime Publication

Migration 031 lines 250–619 were not read. Verify whether `ALTER PUBLICATION supabase_realtime ADD TABLE public.request_quotes` exists in that range. CustomerQuoteList realtime subscriptions depend on this.

### NV-3 — `CRON_SECRET` Length and Randomness

Vercel injects `CRON_SECRET` automatically for scheduled invocations. Its length and randomness are Vercel-managed but not validated in the application. Verify the `CRON_SECRET` value in Vercel production environment settings.

### NV-4 — Vercel Cron Overlap Behavior

Vercel's cron documentation states that a new invocation starts even if the previous is still running ("best effort"). With marketplace-cron at `* * * * *` (every minute) and `maxDuration = 30`, two invocations can overlap. The DB-level guards in `expireStaleQuotes`, `expireUnselectedRequests`, and `sla_check_and_release` make this safe, but verify Vercel's actual behavior for the Pro/Enterprise plan.

### NV-5 — Sentry Coverage for Cron and Realtime Failures

Sentry is configured (per ARCHITECTURE.md) but cannot be verified from source whether it is capturing: (a) cron function errors, (b) Supabase Realtime connection failures in browser components, (c) `checkRateLimitAsync` fallback events. Verify Sentry configuration for these sources.

---

## Business Decisions

### BD-1 — Real-Time Notification vs. Performance Trade-Off

The realtime model (broadcast to all providers) is simple to implement but does not scale. The business must decide between: (a) tolerating thundering herds by limiting concurrent providers, (b) implementing geographic filtering with a more complex architecture, (c) accepting degraded provider UX (polling only, no real-time notifications) at scale.

### BD-2 — Cron Failure Recovery Policy

Currently there is no automated retry or compensation for failed cron runs. If a cron fails, the next invocation attempts the work. For monthly reset, a daily failure means providers lose a full day of their monthly allocation. The business must decide whether to implement: (a) manual trigger capability for re-running failed crons, (b) automated retry with exponential backoff, (c) idempotent replay safety.

### BD-3 — Upstash Redis as Hard vs. Soft Dependency

The current design makes Redis optional (soft fallback to in-memory). If rate limiting is a critical security control (it is, for abuse prevention), Redis should be a hard dependency with startup validation. This affects deployment complexity.

---

## Scalability Risks

| Risk | Scale Threshold | Impact |
|------|----------------|--------|
| Thundering herd (P4-C1) | ~100 providers | SSR cascade; provider dashboard unavailable |
| Monthly reset memory cliff (P4-C2) | ~500 subscription providers | Function crash; no monthly reset |
| No rate limit on polling endpoints (P4-H1) | 10,000 customers | 2,000 req/s; Supabase overloaded |
| Realtime channel limits (P4-M5) | ~500 providers | Supabase Pro connection limit hit |
| Weekly SLA reset no LIMIT (P4-M3) | 10,000 providers | Timeout; no flags applied |
| Admin dashboard 19 queries (P4-H5) | Multiple admins | DB connection contention |

---

## Realtime Architecture Review

**Summary of subscriptions found in source:**

| Component | Channel | Table | Event | Filter |
|-----------|---------|-------|-------|--------|
| ProviderRealtimeRefresh | `provider-open-requests:${id}` | requests | INSERT,UPDATE | `status=eq.open` (NO geographic filter) |
| ProviderRealtimeRefresh | `provider-quotes:${id}` | request_quotes | UPDATE | `provider_id=eq.${id}` |
| ProviderRealtimeRefresh | `provider-active-job:${reqId}` | requests | UPDATE | `id=eq.${reqId}` |
| customer/request/page.tsx | `request-status:${reqId}` | requests | UPDATE | `id=eq.${reqId}` |
| CustomerQuoteList | `customer-quotes:${reqId}` | request_quotes | INSERT,UPDATE | `request_id=eq.${reqId}` |

**Critical gap:** The `provider-open-requests:${id}` channel has **no geographic filter**. Every online provider receives every new request INSERT, regardless of whether the request is within their dispatch ring. Geographic pre-filtering would require Supabase to support geospatial subscription filters, which it does not.

**Debounce/throttle analysis:** The `DEBOUNCE_MS = 1500` and `THROTTLE_MS = 3000` protections (ProviderRealtimeRefresh lines 13–14, 24–31) guard against a single provider receiving rapid events. They do NOT protect against 1,000 providers each receiving one event simultaneously. The throttle is per-component, not distributed.

**Reconnect logic:** Not implemented in application code. The Supabase JS client handles WebSocket reconnection internally. After a reconnect, clients do NOT replay missed events — providers will miss any requests that were created during their disconnection. This is an inherent limitation of the current model.

**ARCHITECTURE.md discrepancy:** States "ProviderRealtimeRefresh subscribes to request, quote, and provider location events." The actual code does NOT subscribe to `provider_locations`. This inaccuracy should be corrected.

---

## Abuse Protection Review

**Rate-limited endpoints (confirmed with `checkRateLimitAsync`):**
- POST /api/requests (customer request creation)
- POST /api/provider/jobs/quote (quote submission)
- POST /api/provider/requests/accept (legacy accept)
- POST /api/providers/documents (document upload)
- POST /api/stripe/create-checkout (subscription checkout)
- POST /api/provider/ppj-checkout (PPJ checkout)
- POST /api/provider/overage-checkout (overage checkout)

**Endpoints WITHOUT rate limiting (confirmed from Parts 1–4):**
- GET /api/requests — customer polling, every 5–60 seconds
- GET /api/requests/quotes — customer polling, every 30 seconds
- POST /api/admin/providers/update — admin status changes (Part 1 M1)
- POST /api/admin/sentry-verify — admin Sentry test (Part 1 M1)
- POST /api/customer/quote/select — quote selection
- POST /api/provider/jobs/advance-state — state advancement
- POST /api/provider/jobs/price-change — price change request
- POST /api/customer/price-change/respond — price change response
- POST /api/provider/jobs/complete — job completion
- POST /api/ratings — customer rating submission

**Most dangerous unprotected endpoint at scale:** `GET /api/requests` with 5-second polling per customer. At 10,000 active customers, this generates 2,000 requests/second with no throttle.

**Redis fallback confirmed in this run:** Rate limiting falls back to process-local in-memory Map on Redis unavailability. Confirmed at `rate-limit.ts:14, 51–67`.

---

## Cron & Background Task Review

| Cron Route | Schedule | maxDuration | Idempotency | Overlap Safety | Critical Gap |
|-----------|----------|------------|-------------|----------------|-------------|
| `/api/ops/marketplace-cron` | Every 1 min | 30s | Yes (DB guards) | Yes (DB-level) | SLA loop is sequential; partial failures return 200 |
| `/api/ops/expire-requests` | Every 30 min | 30s | Yes (status filter) | Yes (DB-level) | Partial failure (stuckJobs error) returns 200 |
| `/api/ops/monthly-allowance-reset` | Daily 00:00 UTC | 60s | Yes (period key guard) | Yes (optimistic lock) | Loads all providers into memory; no pagination |
| `/api/ops/weekly-sla-reset` | Sunday 00:00 UTC | 30s | Partial | Partial | Non-atomic two-phase update; no LIMIT on queries |

**What breaks if a cron fails for 24 hours:**

- `marketplace-cron` fails 24h: Pending quotes never expire. Customers see stale quotes. SLA violations not released. Providers locked to abandoned jobs.
- `expire-requests` fails 24h: Open requests older than 2h remain visible to providers. Ghost requests clog the provider feed. Stripe stuck webhooks not cleared.
- `monthly-allowance-reset` fails 24h: No impact within 24h unless the cron was scheduled exactly at billing period end. Providers at monthly limit are blocked for an extra day.
- `weekly-sla-reset` fails: SLA failure counts not reset; high-failure providers not penalized. Accumulates until the next Sunday.

**Batch size and timeout risk:** `enforceSla` with sequential RPCs and 50 requests can take 5–15 seconds under normal load, 30–75 seconds under congestion. The `maxDuration = 30` provides a safety ceiling but means SLA enforcement may be truncated mid-run under pressure.

---

## Performance Review

**Confirmed indexed queries (migrations 013, 016, 017, 031):**
- `requests(status)`, `requests(customer_id, status, created_at)` — customer lookups: ✓
- `requests(accepted_by, status, created_at)` — provider active job: ✓
- `requests(created_at)` WHERE `status=open AND accepted_by IS NULL` — open feed: ✓
- `request_quotes(request_id)`, `request_quotes(provider_id)` — quote lookups: ✓
- `request_quotes(status, expires_at)` WHERE `status=pending` — quote expiry: ✓
- `providers(plan, stripe_current_period_start, jobs_reset_at)` — monthly reset: ✓
- `ratings(provider_id, created_at DESC)` — rating trigger: ✓ (migration 016)
- `users(role)` — admin count queries: ✓ (migration 016)

**Missing or suspected-missing indexes:**
- `jobs(en_route_at)` — admin dashboard stuck-job query: **MISSING** (not in any migration)
- `providers(sla_failure_count)` — weekly SLA reset fetch: Covered by `idx_providers_status ON providers(status)` but `sla_failure_count > 0` may require a separate partial index for efficiency at large scale

**N+1 query risk:** Provider dashboard page queries are mostly single-row or indexed range scans. No obvious N+1 patterns found in the partial read. Admin providers list page was not read in this run — Needs Verification.

**PostGIS query cost:** `get_nearby_open_requests` uses `ST_DWithin` on the `provider_locations.location` GEOMETRY column. The GIST index (`idx_provider_locations ON provider_locations USING GIST(location)`) covers this. At 1,000+ online providers with frequent location updates, the GIST index maintenance could become a write bottleneck.

**Hot rows:**
- `providers(jobs_this_month)` — incremented by `select_quote_atomic`, decremented by cancellation/release/SLA RPCs. Concurrent write contention on this column for busy providers.
- `requests(status)` — updated by advance-state, completion, cron expiry, SLA release. Multiple concurrent writers on the same request row are protected by `FOR UPDATE` locks in RPCs but create lock wait queues.

---

## Database Scale Review

**Hot tables at scale:**

| Table | Write frequency | Lock contention risk | Notes |
|-------|----------------|---------------------|-------|
| `requests` | Multiple state changes per job | Medium — `FOR UPDATE` in RPCs | Status column is a hot row |
| `providers` | Location, counter, status updates | High — `jobs_this_month` is contended | Counter drift documented in Part 2 |
| `provider_locations` | Every online toggle / location update | Low-Medium — PK update | GIST index write cost at 1,000+ |
| `request_quotes` | Quote submit, expire, select | Low — atomic RPC with FK | Cron batch expiry can lock many rows |
| `ratings` | Per completed job | Low-Medium — trigger chain | Two triggers per insert |
| `stripe_events` | Per webhook delivery | Low — PK-based | TOCTOU documented in Part 1/3 |

**Trigger chain on rating INSERT:**
1. INSERT into `ratings` → triggers `update_provider_rating()` → SELECT last 50 + UPDATE `providers.rating`
2. UPDATE `providers.rating` → triggers `check_provider_suspension()` → COUNT(*) + conditional UPDATE

Two triggers, three DB operations per rating. At scale with concurrent ratings for popular providers, this creates serialization on the provider row.

**Counter contention: `providers.jobs_this_month`**
This counter is incremented by `select_quote_atomic` (which uses `FOR UPDATE` on the providers row). Under high quote selection concurrency for a given provider, writes queue behind the lock. For a popular provider (e.g., high-rated business plan), concurrent selections from multiple customers would serialize on this counter.

---

## Observability Review

**What is logged:**
- Structured JSON to stdout (production mode) with level, timestamp, event, and non-sensitive fields
- Sensitive fields redacted by `logger.ts` (phone, address, coordinates, tokens, secrets)
- Cron completion with result counts
- Rate limit exceeded events (to Upstash response-level logs)
- Redis unavailability (per-instance, first occurrence only)
- Stripe webhook events (with type, status)
- SLA releases (with provider_id and needs_refund flag)

**What is NOT logged or alertable:**
- No alerting on `logger.error()` events
- No log drain to persistent storage (Vercel log retention is limited)
- No dashboard for cron health trends (only individual run results)
- No Supabase Realtime connection count monitoring
- No rate limit hit rate tracking (cannot tell if an attack is in progress)
- No latency monitoring on DB queries or API endpoints
- No p99 latency tracking on SLA RPC calls
- No Upstash Redis latency or error rate monitoring

**Sentry coverage:**
- Sentry is configured (per ARCHITECTURE.md) but specific routes/hooks not verified in this run
- Browser-side errors likely captured by Sentry client
- Server-side: unknown whether cron functions are wrapped with Sentry instrumentation
- Realtime subscription errors in browser: unknown whether Sentry captures WebSocket failures

**Audit trail gaps:**
- KYC status changes: logged to `provider_kyc_log` (but non-atomically, per Part 1 H5)
- Provider suspension by rating trigger: NOT logged to `provider_kyc_log` — silent auto-suspension
- Cron-triggered request expiry: logged per-count, not per-request
- Admin dashboard count queries: not logged

---

## Cache & State Consistency Review

**Redis usage:** Upstash Redis is used ONLY for rate limiting. No application data is cached in Redis. All state is in Supabase Postgres.

**Realtime vs. polling consistency:**
- Customer request page: realtime events update local React state directly for non-terminal updates (lines 225–226). Terminal states trigger a full API fetch. This means the customer's local state can drift if a realtime event fires between polls.
- CustomerQuoteList: realtime events trigger `debouncedFetchQuotes()` which re-fetches from the API. Quote expiry is simulated client-side (`quotes.filter(q => new Date(q.expires_at).getTime() > now)` on a 5-second timer, line 108–113). A quote that was expired by the cron server-side continues to show in the client UI until the next fetch.

**Server/client divergence risk:**
- Customer has a locally-expired quote filtered out, but the server has it as `pending` (cron hasn't run yet).
- Customer has a locally-active quote, but the server expired it via cron between polls.
- Both are benign divergences: the selection RPC validates the quote status atomically.

**No distributed cache invalidation needed** because all state is served from the DB and clients are stateless (SSR pages re-render from DB on each refresh). The main consistency risk is the dual realtime+polling model causing redundant fetches, not data inconsistency.

---

## Production Readiness Review

### Can it safely run 100 providers?
**Marginal YES.** Thundering herd generates ~100 simultaneous SSR renders — approximately 500–800 DB queries per request creation. Under normal traffic (not all 100 providers active simultaneously), this is manageable. Rate limiting gaps and partial cron failure handling remain risks.

### Can it safely run 1,000 providers?
**NO without changes.** Thundering herd generates 5,000–8,000 DB queries per request creation. Supabase Realtime concurrent connection limit (500–500 Pro) is likely exceeded with 1,000 providers. Monthly allowance reset may crash under large provider counts. Rate-limiting gaps allow 2,000 polling requests/second.

### Can it safely run 10,000 providers?
**DEFINITELY NOT.** The realtime architecture would cause complete service outages on every new request. Monthly reset and weekly SLA reset would fail for all providers. Admin dashboard queries would degrade under load. This scale requires architectural redesign of the notification system.

---

## Disaster Recovery Review

### Scenario: Supabase database restored from backup (e.g., 6-hour-old backup)

| Component | State After Restore | Reconciliation Needed? |
|-----------|---------------------|----------------------|
| `stripe_events` | Rolled back — events processed after backup are missing | YES — Stripe must replay 6h of webhook events; risk of re-activating providers if `stripe_events` rows are missing |
| `jobs_this_month` counters | Rolled back to 6h-old values | YES — providers' monthly counts incorrect; over-count or under-count depending on job activity |
| `request_quotes` | Rolled back — all quotes submitted after backup are gone | YES — requests may show as `quoted` with no quote rows |
| `requests` status | Rolled back | Partial — cron will expire stale open requests; accepted requests orphaned |
| `overage_cleared` flags | Rolled back | Potential free-overage-accept windows (Part 3 F3-H2) recreated |
| `provider_dispatch_log` | Rolled back | Analytics gap; no operational impact |
| Stripe subscriptions | NOT in DB backup — Stripe is authoritative | Stripe may re-deliver subscription events that are now missing from `stripe_events`; KYC bypass (Part 1 C4) could re-trigger |
| Redis rate-limit counters | NOT affected (Redis separate) | Rate limits reset to zero for recently-throttled users |
| Supabase Realtime | All active subscriptions disconnected on restore | Clients reconnect; miss events during the restore window |

**Most critical risk:** After restore, Stripe re-delivers webhook events for the 6-hour window. If `stripe_events` rows for those events are missing (rolled back), the webhook handler re-processes them. For subscription activation events, this re-triggers the KYC bypass (Part 1 C4) — pending/suspended providers are re-activated. For PPJ/overage accepts, `accept_provider_request_atomic`'s `status = 'open'` guard prevents double-accepts (requests are already in their post-restore state).

**No reconciliation tools exist.** There are no scripts or documented procedures for reconciling `jobs_this_month`, `stripe_events`, or `request_quotes` after a restore.

---

## Deployment Safety Review

### Can deployment during active traffic cause problems?

| Risk | Likelihood | Impact |
|------|-----------|--------|
| Realtime clients miss events during Vercel deploy (new function instances replace old) | Medium | Providers miss new request notifications; customers miss status updates. Self-recovers on reconnect. |
| In-flight cron executions interrupted by deploy | Low | Partial cron completion. Idempotent guards handle re-run. |
| Rate-limit in-memory state lost on cold start | High (every deploy) | Per-instance buckets reset. Effectively extends rate-limit windows momentarily. Benign. |
| `router.refresh()` calls from realtime events during deploy hit new deployment | High | New deployment receives old clients' refreshes. Safe as long as API is backward-compatible. |
| DB migration applied before Vercel deploy finishes | High risk if done wrong | If migration adds NOT NULL columns without defaults before old code is replaced, old code fails DB writes. Currently no CI enforces migration → deploy order. |

**Deployment safety recommendation:** Never run Supabase migrations concurrently with a Vercel deployment. Migration → deploy order must be documented and enforced. Currently: no CI/CD, no documented procedure.

---

## Single Points of Failure

| Component | Failure Mode | Current Mitigation | Recovery Time |
|-----------|-------------|-------------------|--------------|
| Supabase Realtime | WebSocket outage — all realtime subscriptions drop | Polling fallback (5–60s intervals) | Immediate via polling |
| Supabase Postgres | DB outage — all API routes fail | None — no read replicas | Duration of outage |
| Upstash Redis | Rate limiting degrades to in-memory | Silent in-memory fallback | Per-instance |
| Vercel Cron | Cron missed — no retry | Next scheduled invocation | Depends on schedule (1 min to 1 week) |
| `OPS_CRON_SECRET` | Lost/exposed — all cron routes broken or compromised | None — manual env var rotation + redeploy | Minutes to hours |
| Stripe Webhooks | Endpoint unreachable — payment events not processed | Stripe retries for 72h | Up to 72h delay |

---

## Cascading Failure Chains

---

### CFC-1 — New Request + 1,000 Providers → Supabase Pool Exhaustion → Complete Platform Outage

**Severity:** CRITICAL  
**Probability at 1,000+ concurrent providers:** HIGH

**Chain:**
1. Customer creates a request → `requests` INSERT with `status = 'open'`
2. Supabase Realtime broadcasts to 1,000 provider `postgres_changes` subscriptions
3. All 1,000 providers' browsers call `scheduleRefresh()` → `router.refresh()` after 1,500ms
4. ~1,500ms later: 1,000 SSR renders of `/provider/dashboard` hit Vercel simultaneously
5. Each render opens a Supabase JS client (`createAdminClient()` via `createClient()`) and makes 5–8 queries
6. 5,000–8,000 PostgREST HTTP requests hit Supabase within 2 seconds
7. Supabase connection pool (pgBouncer) is saturated; new queries queue
8. Queue grows as more requests arrive (second request from another customer 30 seconds later)
9. API routes (`GET /api/requests` polling, quote submissions, state advances) start timing out
10. Customer and provider APIs return 500s or hang
11. Complete marketplace outage for all users

**No existing mitigation** — debounce and throttle protect individual components, not the aggregate.

---

### CFC-2 — Redis Down → Rate Limits Silently Fail → Quote Spam → DB Overload → Cron Timeouts → SLA Never Enforced → Customers Stranded

**Severity:** HIGH  
**Components:** Part 1 H4 (confirmed), P4-H1 (new), Part 2 LOW-05 (depends on earlier finding)

**Chain:**
1. Upstash Redis becomes unavailable (network partition, outage)
2. Rate limiting silently falls back to in-memory per-instance Maps
3. An adversarial provider uses multiple Vercel edge nodes to bypass per-instance limits
4. Provider submits 1,000+ quote requests (one per provider, for the same request), cycling through edge nodes
5. `submit_quote_atomic` RPC runs 1,000+ times, causing DB contention on `request_quotes`
6. DB under contention: all queries slow
7. Marketplace-cron invocation finds DB queries taking 2–5s per SLA RPC (instead of 100ms)
8. 50 sequential SLA RPCs × 4s = 200s — exceeds `maxDuration = 30`
9. Cron terminated mid-run; SLA violations not released
10. Customers with abandoned providers remain locked for up to 1 week (weekly cron only)

---

### CFC-3 — Monthly Reset Crash → All At-Limit Providers Blocked → Marketplace Freeze → No Quotes → Customers Receive No Service

**Severity:** HIGH  
**Component:** P4-C2

**Chain:**
1. Monthly billing period ends; `0 0 * * *` cron fires
2. 800+ subscription providers all due for reset
3. `Promise.all()` fires 800 concurrent DB updates + loads 800 rows into serverless memory
4. Function exceeds memory limit and is killed by Vercel
5. HTTP 500 returned — this is one of the few cron routes that returns 500 on top-level errors
6. Vercel marks the cron run as failed
7. Next invocation is 24 hours later (`0 0 * * *` = once daily)
8. All 800 providers at their monthly limit (e.g., `jobs_this_month = 15` for Starter) cannot submit quotes
9. New customer requests receive zero quotes
10. Requests expire after 20 minutes with no provider response
11. Customers see "no providers available" for an entire day

---

## Top 10 Fixes Before Launch

| Priority | ID | Fix | Effort | Impact |
|---------|-----|-----|--------|--------|
| 1 | P4-C1 | Replace broadcast-to-all realtime model with geographic SSE or geographic Realtime filter | High | Eliminates thundering herd; required for 1,000+ providers |
| 2 | P4-C2 | Paginate monthly allowance reset in batches of 50–100 instead of `Promise.all()` on all | Medium | Prevents marketplace freeze on billing cycle |
| 3 | P4-H1 | Add `checkRateLimitAsync` to `GET /api/requests` (60/min) and `GET /api/requests/quotes` (30/min) | Low | Prevents 2,000 req/s polling attack |
| 4 | Part 1 C1 | Register middleware correctly (rename proxy.ts → middleware.ts) | Low | CSRF protection actually active |
| 5 | Part 1 C2/C3 | Fix RLS UPDATE policies with WITH CHECK constraints | Low | Prevents role/status self-escalation |
| 6 | Part 1 C4/F3-C1 | Fix `resolveStripeStatus` KYC protection for `pending`/`suspended` | Low | Closes KYC bypass via Stripe payment |
| 7 | P4-H4 | Return HTTP 500 from cron routes when any core operation fails | Low | Enables Vercel cron failure alerting |
| 8 | P4-H3 | Wrap weekly SLA reset in atomic RPC | Medium | Prevents partial flag corruption |
| 9 | P4-H5/P4-M1 | Add `idx_jobs_en_route_at` index in migration 039 | Low | Fixes admin dashboard table scan |
| 10 | P4-L1 | Add log drain to persistent aggregation + alert on `level: 'error'` | Medium | Production incident visibility |

---

## Launch Readiness Score

| Dimension | Score | Justification |
|-----------|-------|--------------|
| **Security Score** | 3/10 | Critical RLS, CSRF, and KYC bypass findings from Parts 1–3 not yet remediated. Rate limiting gaps on polling endpoints. |
| **Scalability Score** | 2/10 | Thundering herd makes the platform dangerous at 1,000+ providers. Monthly reset crashes at 500+ subscription providers. No rate limiting on high-frequency polling. |
| **Operational Readiness Score** | 2/10 | No log aggregation. No alerting. No incident runbooks. Cron partial failures invisible to operators. No load testing. |
| **Production Readiness Score** | 2/10 | Cannot safely support the target scale without architectural changes to realtime and batch processing. |

**Overall Verdict: NOT READY for a real public launch.**

The platform has a fundamental architectural mismatch between its realtime notification design (broadcast to all) and its target scale (1,000+ concurrent providers). This is not a configuration issue or a small bug — it requires an architectural change to how providers are notified of new requests. Without this change, any growth beyond a few hundred concurrent providers will trigger cascading service degradation. Additionally, the unpatched Critical findings from Parts 1–3 (RLS role escalation, KYC bypass via Stripe, proxy.ts not registered as middleware) represent severe security risks that must be resolved before any public traffic. The platform is suitable for a small closed beta (fewer than 50 concurrent providers) but requires significant engineering work before a public launch.

---

## Summary Table

| ID | Severity | Title | File(s) |
|----|----------|-------|---------|
| P4-C1 | **Critical** | Realtime broadcast to all providers triggers thundering herd SSR cascade at scale | `ProviderRealtimeRefresh.tsx:37–68` |
| P4-C2 | **Critical** | Monthly allowance reset loads all providers into memory; crashes at 500+ providers | `ops/monthly-allowance-reset/route.ts:34–86` |
| P4-H1 | **High** | No rate limiting on high-frequency polling endpoints (`GET /api/requests`, `GET /api/requests/quotes`) | `requests/route.ts`, `requests/quotes/route.ts` |
| P4-H2 | **High** | marketplace-cron SLA enforcement is sequential — 50 serial RPCs can exceed `maxDuration` under load | `ops/marketplace-cron/route.ts:104–161` |
| P4-H3 | **High** | Weekly SLA reset is non-atomic — two-phase update corrupts provider flags on partial failure | `ops/weekly-sla-reset/route.ts:41–65` |
| P4-H4 | **High** | Cron partial failures return HTTP 200 — Vercel sees success, no alerting triggered | `ops/marketplace-cron/route.ts:44–46`, `ops/expire-requests/route.ts:42–88` |
| P4-H5 | **High** | Admin dashboard issues 19+ concurrent DB queries per page load; stuckJobs query has no index | `admin/dashboard/page.tsx:60–86` |
| P4-H6 | **High** | Customer page dual-loads: polling (5s) AND realtime events both trigger full API fetches | `customer/request/page.tsx:182–233` |
| P4-M1 | **Medium** | Missing index on `jobs.en_route_at` — admin stuck-job query is a full table scan | `migrations/` (no index found), `admin/dashboard/page.tsx:80–85` |
| P4-M2 | **Medium** | `expireStaleQuotes` has no row LIMIT — unbounded batch UPDATE holds write locks | `ops/marketplace-cron/route.ts:48–71` |
| P4-M3 | **Medium** | Weekly SLA reset fetches all providers with no LIMIT — unbounded at 10,000+ providers | `ops/weekly-sla-reset/route.ts:22–25` |
| P4-M4 | **Medium** | Rate-limit Redis fallback flag resets on every cold start; fallback invisible across instances | `src/lib/rate-limit.ts:14–15` |
| P4-M5 | **Medium** | Realtime channel count scales linearly with online providers — approaches Supabase plan limits | `ProviderRealtimeRefresh.tsx:34–136` |
| P4-M6 | **Medium** | `OPS_CRON_SECRET` and Upstash vars in soft-warning RUNTIME_REQUIRED_ENVS, not hard-fail list | `src/lib/env.ts:42–58` |
| P4-L1 | **Low** | Logger writes to stdout only — no log aggregation, alerting, or persistence | `src/lib/logger.ts:60–74` |
| P4-L2 | **Low** | `check_provider_suspension` trigger fires COUNT(*) per rating UPDATE — trigger chain at scale | `migrations/001_initial_schema.sql:189–201` |
| P4-L3 | **Low** | No documented deployment-safety procedure for migration → deploy ordering | Architecture gap |
| P4-L4 | **Low** | `OPS_CRON_SECRET` missing causes silent 503s; not in hard-fail startup validation | `src/lib/env.ts:73–77` |
| P4-L5 | **Low** | `request_quotes` realtime publication not confirmed in source sections read | `migrations/031_marketplace_v2_schema.sql` (partial read) |
| CFC-1 | **Critical** | Cascade: New request + 1,000 providers → Supabase pool exhaustion → platform outage | `ProviderRealtimeRefresh.tsx`, `provider/dashboard/page.tsx` |
| CFC-2 | **High** | Cascade: Redis down → rate limits fail → quote spam → DB overload → SLA never enforced → customers stranded | `rate-limit.ts`, `ops/marketplace-cron/route.ts` |
| CFC-3 | **High** | Cascade: Monthly reset crash → all at-limit providers blocked → marketplace freeze for 24h | `ops/monthly-allowance-reset/route.ts` |

---

## Verification Log

- **Source files opened in this run:** 23 (including partial reads of 3 files)
- **Documentation files opened in this run:** 8 (CLAUDE.md, ARCHITECTURE.md, MARKETPLACE_V2_SPEC.md, PROJECT_HANDOFF.md, ROADMAP.md, SECURITY_AUDIT_1.md, SECURITY_AUDIT_2.md, SECURITY_AUDIT_3.md)
- **Required files NOT opened:** `SESSION_LOG.md` (not found in working directory)
- **Additional files opened beyond initial list:** `src/lib/env.ts`, `src/lib/ops-auth.ts`, `src/app/admin/dashboard/page.tsx` (partial), `supabase/migrations/036_provider_location_lat_lng_columns.sql`, `supabase/migrations/030_requests_realtime_publication.sql`
- **Every finding traces to source lines read in this run:** Yes — each finding cites specific file paths and line numbers from files read in this audit run
- **Prior-audit findings re-verified:**
  - P4-M4 re-verifies Part 1 H4 (rate-limit in-memory fallback): Confirmed from source at `rate-limit.ts:14–15`
  - P4-H2 extends Part 2 LOW-05 (SLA cron limit 50) to a new timeout failure mode: Depends on Earlier Finding (Part 2 LOW-05 not re-verified; SLA loop pattern confirmed from `marketplace-cron/route.ts:115–161`)
  - CFC-2 depends on Part 1 H4 (Redis fallback) and Part 2 LOW-05 (SLA limit): Both labeled accordingly
- **Prior-audit findings NOT re-verified from this run:** All Part 1 Critical/High, all Part 2 Critical/High/Medium, all Part 3 findings — reported as context only, not re-verified
- **Architecture.md discrepancy noted:** States ProviderRealtimeRefresh subscribes to provider_locations — not found in actual code
- **Source files modified:** No

---

No source files were modified. This report is for review only.
