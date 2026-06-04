# RescueGo — Session Log

---

## Session: June 3, 2026

### What was done

1. **Phase 1 marked complete.**
   - Sentry DSN + NEXT_PUBLIC_SENTRY_DSN confirmed on Vercel (May 31).
   - Sentry smoke verification confirmed done by user.
   - CLAUDE.md + DEPLOYMENT_STATUS.md updated accordingly.

2. **Correction: Finding 1 (Task 1) was wrong.**
   - Original finding said "no middleware.ts" — token refresh missing.
   - In Next.js 16, middleware is renamed to `proxy.ts`. `src/proxy.ts` already exists and correctly implements Supabase token refresh via `supabase.auth.getUser()`.
   - Real issue found: proxy was doing a live DB role check on every protected request (every `/provider/*`, `/admin/*`, `/customer/*` navigation). Next.js auth docs explicitly warn against this.
   - **Fix applied:** Removed the `supabase.from('users').select('role')` call and all role-based redirect logic from `src/proxy.ts`. Proxy now only does token refresh + unauthenticated redirect. Role enforcement remains at page level + RLS.

3. **Phase 1A Task 1 — Auth/login performance audit (findings, no code changes except proxy fix).**

4. **Phase 1A Task 2 — Logout lag investigation (findings only).**
   - Fix applied: `signOut({ scope: 'local' })` in `Navbar.tsx` — eliminates 200–500ms server round-trip and Navbar flash on logout.

5. **Phase 1A Task 3 — Dashboard loading optimization audit (findings only, no fixes yet).**

---

### Phase 1A — Task 1 Correction: proxy.ts DB call removed

**File changed:** `src/proxy.ts`
- Removed: `PROVIDER_PREFIXES` constant
- Removed: `if (user && isProtected)` block — DB role check + 3 role-based redirect conditions
- Kept: token refresh (getUser), unauthenticated redirect, PROTECTED_PREFIXES, matcher
- Security: no gap — page-level checks and RLS still enforce role access

Remaining Task 1 findings (not yet fixed):

| # | Finding | Status |
|---|---|---|
| 2 | Sequential role fetch after login (login/page.tsx:135) | Deferred |
| 3 | Navbar duplicates auth + role on every page | Deferred |
| 4 | router.refresh() + 1200ms fallback timer (login/page.tsx:57) | Deferred |
| 5 | Prefetches all 3 dashboards for every visitor | Deferred |
| 6 | getUser() on login mount for unauthed users | Deferred (low) |
| 7 | bundlePagesRouterDependencies: true in next.config.ts | Deferred (negligible) |

---

### Phase 1A — Task 2 Findings: Logout Lag

**Fix applied:** `src/components/layout/Navbar.tsx:131`
- Changed `supabase.auth.signOut()` → `supabase.auth.signOut({ scope: 'local' })`
- Eliminates server round-trip to Supabase auth server (~200–500ms)
- SIGNED_OUT event fires instantly → no Navbar flash on landing page after logout
- Security trade-off: refresh token not invalidated server-side (acceptable — local-only logout)

Remaining logout findings (not fixed):

| # | Finding | Status |
|---|---|---|
| 1 | getViewerState() in home page runs 2–3 sequential DB queries during logout nav | Deferred — affects all home page visits, separate pass |
| 4 | Logout navigates to `/` (heaviest page) | Deferred |

---

### Phase 1A — Task 3 Findings: Dashboard Loading Optimization

#### Finding 1 — Admin dashboard: full table scans (HIGH) ✅ FIXED Jun 4
#### Finding 2 — Provider dashboard: sequential cascade (MEDIUM) ✅ FIXED Jun 4
#### Finding 3 — Customer request page: sequential API calls (MEDIUM) ✅ FIXED Jun 4
#### Finding 4 — Admin sequential role check (LOW) ✅ FIXED Jun 4

#### Finding 5 — Provider dashboard: fallback requests sequential after nearby RPC (LOW)
`src/app/provider/dashboard/page.tsx:378–403`
Fallback open requests query fires sequentially if nearby RPC returns empty.
Status: Deferred

#### Finding 6 — All loading.tsx skeletons incomplete (LOW)
None match actual page layout — causes layout shift on load.
Customer loading.tsx is unreachable at runtime (page is 'use client').
Status: Deferred

---

## Session: June 4, 2026

### What was done

1. **Phase 1A Finding 1 fix — Admin dashboard full table scans.**
2. **Phase 1A Finding 2 fix — Provider dashboard sequential cascade.**
3. **Phase 1A Finding 3 fix — Customer request sequential API calls.**
4. **Phase 1A Finding 4 fix — Admin sequential role check.**
5. **Phase 1A Task 4 — Supabase query profiling audit (findings only, no changes).**

---

### Phase 1A Finding 1 Fix: Admin dashboard full table scans

**File changed:** `src/app/admin/dashboard/page.tsx`

Replaced 2 unbounded selects with 7 targeted HEAD count queries inside the same `Promise.all`:
- `providers.select('status')` (fetched ALL rows) → 3 count queries: active / pending / suspended
- `requests.select('status')` (fetched ALL rows) → 3 count queries: open / completed / expired + 1 total count
- Removed 7 client-side `.filter().length` expressions (lines 43–50)
- All 7 new queries use `{ count: 'exact', head: true }` — zero rows transferred
- No JSX changes — variable names preserved via `?? 0` normalization

---

### Phase 1A Finding 2 Fix: Provider dashboard sequential cascade

**File changed:** `src/app/provider/dashboard/page.tsx`

Parallelized `recentCustomerCancellation` and `recentPpjPayment` — both gated on `!activeRequest` only, no dependency on each other:
- Before: 4 sequential awaits after Promise.all(3): activeCustomer → cancellation → ppjPayment → overagePayment
- After: activeCustomer sequential (true dependency — needs customer_id), then `Promise.all([cancellation, ppjPayment])` in parallel
- `recentOveragePayment` stays sequential (depends on `!recentPpjPayment`)
- Saves 1 roundtrip in normal loads (no active job) and 1 more in payment-return flow
- All logger.warn calls preserved

---

### Phase 1A Finding 3 Fix: Customer request sequential API calls

**Files changed:** `src/app/api/requests/route.ts`, `src/app/customer/request/page.tsx`

Merged unrated-jobs count into `/api/requests` response — eliminates the sequential second fetch:
- In `route.ts`: split `unratedJob` derivation into `unratedJobs` array, added `unratedJobsCount`, included `unrated_jobs_count` in both response branches (no extra DB query — computed from existing `completedJobs` + `ratedJobIds` data already in memory)
- In `page.tsx`: added `unrated_jobs_count` to `ActiveRequestResponse` type; added `setUnratedJobsCount` call inside `loadRequestState`; removed `loadUnratedJobsCount` function + its `useEffect`
- Every 12-second poll now also refreshes the unrated count from server

---

### Phase 1A Finding 4 Fix: Admin sequential role check

**File changed:** `src/app/admin/dashboard/page.tsx`

Merged role query into the main `Promise.all` — fires in parallel with all 14 data queries:
- Before: `getUser()` → role check → Promise.all(14 queries) — 3 sequential phases
- After: `getUser()` → Promise.all(role query + 14 data queries) → validate role — 2 sequential phases
- Saves ~50–100ms on every admin dashboard load
- Role redirect moved to after Promise.all — fires before any data is rendered
- Security: unchanged — RLS protects data independently; redirect fires before rendering

---

### Phase 1A Task 4: Supabase Query Profiling — Findings

#### Finding 1 — Missing `users.role` index (HIGH)
- Admin dashboard fires 2 HEAD count queries on `users` filtered by `role` on every load — full table scan without index
- `is_admin()` RLS function also uses `role` but filters by `id` PK first — less critical
- **Proposed fix (migration 016):** `CREATE INDEX idx_users_role ON users(role);`

#### Finding 2 — Missing `overage_payments` indexes (MEDIUM)
- Admin dashboard: `overage_payments.eq('status', 'failed')` count — full scan, no `status` index
- Provider dashboard: `overage_payments.eq('provider_id', ...).in('status', [...]).order('created_at')` — no composite index
- Migration 013 only covered `overage_payments_stripe_intent` (webhook lookup)
- **Proposed fix (migration 016):**
  ```sql
  CREATE INDEX idx_overage_payments_provider_status_created
    ON overage_payments (provider_id, status, created_at DESC);
  CREATE INDEX idx_overage_payments_status
    ON overage_payments (status);
  ```

#### Finding 3 — Missing `payout_log.created_at` index (MEDIUM)
- Admin dashboard: `payout_log.order('created_at', DESC).limit(5)` — full scan, no `created_at` index
- **Proposed fix (migration 016):** `CREATE INDEX idx_payout_log_created ON payout_log(created_at DESC);`

#### Finding 4 — Missing `ratings(provider_id, created_at DESC)` index (MEDIUM)
- `update_provider_rating()` DB trigger fires on every rating INSERT
- Trigger query: `SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50`
- No composite index — sequential scan that grows with provider rating count
- **Proposed fix (migration 016):** `CREATE INDEX idx_ratings_provider_created ON ratings(provider_id, created_at DESC);`

#### Finding 5 — Location route: 2 sequential PK lookups (LOW)
- `src/app/api/provider/location/route.ts` — called every ~30–60s by all online providers
- `users.select('role').eq('id', ...)` → `providers.select('id, status').eq('id', ...)` — sequential PK lookups
- Both only need `user.id`; parallelizable with `Promise.all`
- **Proposed fix:** Code change — `Promise.all`

#### Finding 6 — Accept route: 4 sequential checks before atomic RPC (LOW)
- `src/app/api/provider/requests/accept/route.ts`
- 4 sequential checks (users role, provider status, provider_locations, active job) all need only `user.id`
- All 4 can be parallelized before the RPC
- **Proposed fix:** Code change — `Promise.all`

---

### Phase 1A Task 4 Code Fixes: Location + Accept Route

**Files changed:**
- `src/app/api/provider/location/route.ts` — Finding 5: 2 sequential PK lookups → `Promise.all([users.role, providers.status])`. Saves 1 round-trip per location ping.
- `src/app/api/provider/requests/accept/route.ts` — Finding 6: 4 sequential checks → `Promise.all([users.role, providers, provider_locations, active job])`. `admin` client + `onlineSince` moved above the await. Guard order preserved: role → 404 → status → offline → active job. Saves 3 round-trips per accept attempt.

**Note from audit:** location route is button-triggered only (not auto-polled). `MIN_UPDATE_INTERVAL_MS = 2min`, `MIN_MOVEMENT_METERS = 250m` throttle on client side. The "30–60s" estimate in the Task 4 report was wrong — parallelization still correct.

---

### Migration 016 Applied

- `supabase/migrations/016_task4_query_indexes.sql` created and applied in Supabase SQL Editor.
- `DEPLOYMENT_STATUS.md` updated: migration 016 ✅, Tasks 1–4 marked complete, date updated to June 4.
- 5 indexes applied: `idx_users_role`, `idx_overage_payments_provider_status_created`, `idx_overage_payments_status`, `idx_payout_log_created`, `idx_ratings_provider_created`.

---

### Phase 1A Task 5: Polling Reduction Audit + Fix

**Audit finding:** Only ONE active polling loop in the entire app — customer request page 12s `setInterval`. Location updates are manual/button-triggered only. No other background polling.

**Fix applied:** `src/app/customer/request/page.tsx:162`
- Added `const pollMs = activeRequest.status === 'open' ? 20000 : 12000`
- `open` status: 20s (waiting for any provider — infrequent state changes)
- `accepted` / `in_progress`: 12s (provider en route — more time-sensitive)
- `visibilitychange` + `online` listeners (lines 171–187) already handle immediate refresh on tab return — makes longer background interval safe
- Saves ~40% polls/hour for requests in `open` state

---

### Phase 1A Task 6: Core Web Vitals Baseline Audit

**6 findings:**

| # | Finding | Metric | Severity |
|---|---|---|---|
| 1 | Sentry client config missing — no production CWV data | All | HIGH |
| 2 | Navbar CLS: skeleton→content shift on every page | CLS | HIGH |
| 3 | Home page LCP blocked by sequential getViewerState() | LCP/TTFB | MEDIUM |
| 4 | customer/request/loading.tsx unreachable (page is 'use client') | FCP | MEDIUM |
| 5 | Provider dashboard skeleton: rough match only | CLS | LOW |
| 6 | No preconnect for client-side Supabase auth calls | LCP/Navbar | LOW |

**Finding 2 note:** Navbar is 'use client'. Server renders skeleton (`loading: true`), then client-side auth resolves (`getUser()` + `users.select('role')`), causing CLS on every page. Requires architectural change — defer to Phase 2B.

**Finding 3 note:** `getViewerState()` in `src/app/page.tsx:150–204` has 3 sequential DB queries for provider users. Blocks entire home page HTML stream. Deferred — Task 2 carry-over.

**Fix applied (Finding 6):** `src/app/layout.tsx`
```tsx
{process.env.NEXT_PUBLIC_SUPABASE_URL && (
  <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
)}
```
`crossOrigin="anonymous"` required — Supabase browser calls use `Authorization: Bearer` headers (CORS, not cookies). Without it, browser won't reuse the preconnected socket for CORS fetch pool.

---

### Phase 1A Task 6 — Finding 1: sentry.client.config.ts ✅ DONE Jun 4 (session 2)

**File created:** `sentry.client.config.ts` (project root)

Matches `sentry.server.config.ts` exactly except:
- `NEXT_PUBLIC_SENTRY_DSN` instead of `SENTRY_DSN` (only public env var is accessible in browser bundle)
- `NEXT_PUBLIC_VERCEL_ENV` instead of `VERCEL_ENV` (same reason — public system var Vercel auto-sets to "production"/"preview"/"development")
- No `profilesSampleRate` line (client-side Sentry SDK doesn't support profiling)

Privacy rules preserved:
- `sendDefaultPii: false`
- `scrubSentryErrorEvent` + `scrubSentryTransactionEvent` hooks — same pipeline as server/edge
- No replay (webpack config already excludes all replay modules)
- `tracesSampleRate: 0` — matches server

**Important finding — CWV capture deferred:**
`next.config.ts:108` has `removeTracing: true` in the Sentry webpack config. This tree-shakes all tracing code from the bundle, making `browserTracingIntegration` (needed for INP/LCP/CLS) a no-op at build time. CWV capture via Sentry requires removing that flag — flagged as a follow-up for Task 7 or a dedicated CWV pass.

### Next Task: Phase 1A Task 7 — Bundle Size Review

Audit the production bundle for oversized chunks, unnecessary imports, and opportunities to reduce JS payload.
Entry points to examine: `next.config.ts` (Sentry webpack flags including `removeTracing`), `package.json` (dependencies), page-level bundle splits.

---

### Files changed this session (June 4 — continued)

- `supabase/migrations/016_task4_query_indexes.sql` — created (5 indexes, applied in Supabase)
- `DEPLOYMENT_STATUS.md` — migration 016 added, Phase 1A tasks 1–4 checked off; Task 4 code fixes + Task 5 + Task 6 Finding 1 checked off in session 2
- `src/app/api/provider/location/route.ts` — Task 4 Finding 5 (2 sequential → Promise.all)
- `src/app/api/provider/requests/accept/route.ts` — Task 4 Finding 6 (4 sequential → Promise.all)
- `src/app/customer/request/page.tsx` — Task 5 (adaptive polling interval)
- `src/app/layout.tsx` — Task 6 Finding 6 (Supabase preconnect)
- `sentry.client.config.ts` — created (Task 6 Finding 1: client-side Sentry)
- `SESSION_LOG.md` — updated (this file)

---

### Deferred Issues (ongoing)

- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Storage bucket `provider-documents` — 0 RLS policies (review SETUP.md §4)
- CSP violations review — report-only has been running since Phase 1
- Stripe still on test/sandbox keys — live keys before real launch (Phase 10)
- `npm run lint && npm run build` — user needs to run after all code changes this session
- Phase 1A Task 1 deferred findings: login sequential role fetch, Navbar duplicated auth, router.refresh() + 1200ms fallback, prefetch all 3 dashboards
- Phase 1A Task 2 deferred: getViewerState() sequential queries on home page, logout navigates to `/`
- Phase 1A Task 3 deferred: Finding 5 (provider fallback sequential), Finding 6 (skeleton completeness)
- Phase 1A Tasks 5–8: polling reduction, Core Web Vitals baseline, bundle size review, production slow-query identification
