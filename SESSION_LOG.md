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

### Next Task: Migration 016

**Goal:** Add the 4 missing indexes from Task 4 profiling.

SQL to run manually in Supabase SQL Editor:

```sql
-- Phase 1A Task 4 — Missing query performance indexes

-- Admin dashboard user count queries (full table scan on users.role)
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users (role);

-- Overage payment dashboard + admin count queries
CREATE INDEX IF NOT EXISTS idx_overage_payments_provider_status_created
  ON overage_payments (provider_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_overage_payments_status
  ON overage_payments (status);

-- Admin dashboard recent payouts
CREATE INDEX IF NOT EXISTS idx_payout_log_created
  ON payout_log (created_at DESC);

-- update_provider_rating() trigger (fires on every rating INSERT)
CREATE INDEX IF NOT EXISTS idx_ratings_provider_created
  ON ratings (provider_id, created_at DESC);
```

After running: create `supabase/migrations/016_task4_query_indexes.sql` with the same SQL and update `DEPLOYMENT_STATUS.md`.

Then: Phase 1A Task 4 code fixes — location route (Finding 5) and accept route (Finding 6) `Promise.all` parallelization.

---

### Files changed this session (June 4)

- `src/app/admin/dashboard/page.tsx` — Finding 1 (count queries) + Finding 4 (role check parallelized)
- `src/app/provider/dashboard/page.tsx` — Finding 2 (sequential cascade parallelized)
- `src/app/api/requests/route.ts` — Finding 3 (unrated count merged into response)
- `src/app/customer/request/page.tsx` — Finding 3 (second fetch removed)
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
