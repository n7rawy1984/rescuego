# RescueGo — Session Log

---

## Session: June 6, 2026 (continued) — Bugs, Phase 3 Finding 6, proxy fix

### What was done

1. **Bug fix — `subscription.updated` race condition overwrites `pay_per_job` reset**
   - Root cause: Stripe fires `customer.subscription.updated` with `status: canceled` before (and sometimes after) `customer.subscription.deleted`. The `updated` handler was resolving the plan name and writing it back, overwriting the `pay_per_job` reset written by the `deleted` handler when events arrive out of order.
   - Fix: added `sub.status === 'canceled'` early-return guard at the top of the `subscription.created/updated` handler. When status is `canceled`, applies identical reset payload (`suspended`, `pay_per_job`, nulled subscription fields) and returns before any plan-resolution logic runs.
   - File: `src/app/api/stripe/webhook/route.ts`

2. **Bug fix — `/provider/register` redirected unauthenticated users to login**
   - Root cause: `proxy.ts` — `PROTECTED_PREFIXES` includes `'/provider'`; `/provider/register`.startsWith(`'/provider'`) → true → unauthenticated users redirected to `/auth/login`.
   - Fix: added `PUBLIC_OVERRIDES` list (`/provider/register`, `/provider/subscribe`) checked before `isProtected`. `isProtected` short-circuits to `false` when pathname matches any override.
   - File: `src/proxy.ts`

3. **Phase 3 Finding 5 — PPJ distance always `0` on first checkout (under-charge bug)**
   - Root cause: `ppj-checkout/route.ts` used `existing?.distance_meters ?? 0` — no existing row on first attempt → `getPayPerJobFee(0)` always returned near fee.
   - Fix: `distanceMeters` imported from `@/lib/geo`. Provider location fetch now selects `location` column. Request fetch now selects `location` column. Live Haversine distance calculated from both GeoJSON `coordinates` arrays. Falls back to `0` with `logger.warn` only if geometry is unparseable. Existing row reused on retry (idempotent).
   - File: `src/app/api/provider/ppj-checkout/route.ts`

4. **Phase 3 Finding 6 — Payment pages `client_secret` re-fetch fallback**
   - Root cause: both `ppj-pay` and `overage-pay` pages read `client_secret` from `sessionStorage` only — no recovery if storage cleared, new tab opened, or page refreshed.
   - Fix: both pages now fall through to a `fetch()` POST to the checkout API when `sessionStorage` miss. API reuses existing live `PaymentIntent` (already idempotent). Secret written back to `sessionStorage`. Specific error messages from API surfaced in error state. "Back to Dashboard" button added to error state. PPJ page also handles `credit_applied` response → redirects to `/provider/dashboard?payment=credit_applied`.
   - Files: `src/app/provider/ppj-pay/page.tsx`, `src/app/provider/overage-pay/page.tsx`

### Files changed
- `src/app/api/stripe/webhook/route.ts` — `subscription.updated` canceled guard
- `src/proxy.ts` — `PUBLIC_OVERRIDES` list, `isProtected` guard
- `src/app/api/provider/ppj-checkout/route.ts` — live distance calculation
- `src/app/provider/ppj-pay/page.tsx` — re-fetch fallback
- `src/app/provider/overage-pay/page.tsx` — re-fetch fallback

### Deferred issues (updated)
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events (low priority)
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (consistency, low priority)
- Phase 1B Task 5 Finding 5 — overage TOCTOU in `accept/route.ts`
- Phase 1B Task 5 Finding 4 — complete/route.ts sequential pre-flight → Promise.all
- Storage bucket `provider-documents` — 0 RLS policies (requires migration)
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- `removeTracing: true` vs CWV capture — decision required
- `npm uninstall` 12 dead dependencies — safe to run any time

---

## Session: June 6, 2026 — Phases 2A, 2B, 2C, 1D, 3, 4 complete

### What was done

1. **Phase 2A Task 4 — `/provider/ratings` page** (`src/app/provider/ratings/page.tsx`)
   - Auth-gated server component. Fetches last 50 ratings via admin client.
   - Aggregate card: average score, filled/empty star row, per-star breakdown bar chart.
   - Rating list: problem type label, stars, comment, date. Empty state with icon.

2. **Phase 2A Task 5 — `/provider/plan` page** (`src/app/provider/plan/page.tsx`)
   - Current plan card: plan name, promo-aware price, feature list (job limit, overage, commission, queue priority).
   - Monthly usage card (subscription plans only): jobs used/remaining, colour-coded progress bar, overage warning.
   - Recovery credits card (PPJ only): shown when `ppj_recovery_credits > 0`.
   - Plan actions card: upgrade link, Stripe billing portal link (when `stripe_subscription_id` present), support email.
   - `ProviderDashboardHeader.tsx`: plan badge converted to `<Link href="/provider/plan">`.

3. **Phase 2B — Customer-Facing UI Polish (5 changes):**
   - 2B-1: `customer/request/page.tsx` — status badge: `replace('_',' ')` → explicit human labels.
   - 2B-2: Step 4 "Service complete" added to request progress stepper.
   - 2B-3: Cancel dialog copy includes provider name when available (`visibleRequest.provider_name`).
   - 2B-4: `customer/history/page.tsx` — open/accepted/in_progress rows get "View active →" link to `/customer/request`.
   - 2B-5: "Needs rating" static badge → `<Link href="/customer/ratings">Rate now</Link>`.

4. **Phase 2C — Admin Dashboard Hardening (5 changes):**
   - 2C-1: `admin/requests/page.tsx` — status badge casing fixed (`in progress` → `In Progress`).
   - 2C-2: `admin/dashboard/page.tsx` — admin role check moved before `Promise.all`; non-admins no longer trigger 14 DB queries.
   - 2C-3: `admin/providers/page.tsx` — filter tabs now show count badges per status; badge inverts on active tab.
   - 2C-4: `admin/requests/page.tsx` — full rewrite with status filter tabs (All/Open/Accepted/In Progress/Completed/Cancelled/Expired); DB query scoped by filter.
   - 2C-5: `admin/revenue/page.tsx` — `commission_amount` display corrected (removed erroneous `/ 100`).

5. **Phase 1D — Server-Only Guards & Code Hygiene:**
   - `server-only` package installed.
   - `import 'server-only'` added to: `supabase/admin.ts`, `supabase/server.ts`, `ops-auth.ts`, `stripe.ts`, `rate-limit.ts`.
   - `env.ts` — `NEXT_PUBLIC_SITE_URL` advisory `console.warn` added for production when unset.

6. **Phase 3 — Stripe Billing Hardening (Findings 1–4):**
   - Finding 1: `customer.subscription.deleted` webhook now resets `plan: 'pay_per_job'` (previously left stale plan on suspended provider).
   - Finding 2: `monthlyJobAllowance()` in webhook replaced with canonical `SUBSCRIPTION_PLANS` lookup (no more hardcoded `starter=15, pro=35`).
   - Finding 3: Local `SUBSCRIPTION_PLANS = ['starter','pro','business']` redefinition in `create-checkout/route.ts` removed; replaced with `SUBSCRIPTION_PLAN_IDS` derived from canonical source.
   - Finding 4: `SERVER_REQUIRED_ENVS` in `env.ts` extended with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` + 3 price ID env vars — missing any now throws at startup.

7. **Phase 4 — Performance & Observability:**
   - 4-1: `loading.tsx` skeletons created for all 4 new provider pages: `history`, `pending`, `plan`, `ratings`.
   - 4-2: `providers/documents` upload route rate-limited: 5 attempts/hour per provider; `429` + `Retry-After` on breach.
   - 4-3: Rate limiting added to `providers/plan` (10/hour) and `provider/jobs/complete` (20/hour).

### Files changed
- `src/app/provider/ratings/page.tsx` — created
- `src/app/provider/ratings/loading.tsx` — created
- `src/app/provider/plan/page.tsx` — created
- `src/app/provider/plan/loading.tsx` — created
- `src/app/provider/history/loading.tsx` — created
- `src/app/provider/pending/loading.tsx` — created
- `src/components/provider/dashboard/ProviderDashboardHeader.tsx` — plan badge → Link
- `src/app/customer/request/page.tsx` — status badge, stepper step 4, cancel dialog copy
- `src/app/customer/history/page.tsx` — active request link, rate now link
- `src/app/admin/requests/page.tsx` — badge casing fix + full rewrite with status filter tabs
- `src/app/admin/dashboard/page.tsx` — role check before Promise.all
- `src/app/admin/providers/page.tsx` — count badges on filter tabs
- `src/app/admin/revenue/page.tsx` — commission_amount divide-by-100 fix
- `src/lib/supabase/admin.ts` — `import 'server-only'`
- `src/lib/supabase/server.ts` — `import 'server-only'`
- `src/lib/ops-auth.ts` — `import 'server-only'`
- `src/lib/stripe.ts` — `import 'server-only'`
- `src/lib/rate-limit.ts` — `import 'server-only'`
- `src/lib/env.ts` — NEXT_PUBLIC_SITE_URL warning + Stripe price IDs in SERVER_REQUIRED_ENVS
- `src/app/api/stripe/webhook/route.ts` — plan reset on deletion + SUBSCRIPTION_PLANS import + monthlyJobAllowance fix
- `src/app/api/stripe/create-checkout/route.ts` — canonical SUBSCRIPTION_PLAN_IDS
- `src/app/api/providers/documents/route.ts` — rate limiting (5/hour)
- `src/app/api/providers/plan/route.ts` — rate limiting (10/hour)
- `src/app/api/provider/jobs/complete/route.ts` — rate limiting (20/hour)

### Deferred issues (ongoing)
- Storage bucket `provider-documents` — 0 RLS policies
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Phase 3 Finding 5 — PPJ distance always 0 on first checkout (under-charge bug)
- Phase 3 Finding 6 — Payment pages have no client_secret re-fetch fallback
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (consistency)
- Phase 1A deferred: login sequential role fetch, Navbar duplicated auth, router.refresh() 1200ms, prefetch all dashboards
- Phase 1A deferred: getViewerState() sequential queries, logout navigates to `/`
- `removeTracing: true` vs CWV capture — decision required
- `npm uninstall` 12 dead dependencies — safe to run any time

### New env vars required in Vercel (additions from this session)
- `NEXT_PUBLIC_SUPPORT_EMAIL=support@rescuego.ae`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — already needed, now validated at startup
- `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` — now validated at startup
- `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — now validated at startup
- `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` — now validated at startup

---

## Session: June 5, 2026 — Phase 1B + 1C complete

### What was done

1. **Phase 1B Task 2** — `LAUNCH_PROMO` hardcoded `true` → `process.env.NEXT_PUBLIC_LAUNCH_PROMO === 'true'`. Safe fallback: off if env var missing.

2. **Phase 1B Task 3** — PPJ fee constants (`PAY_PER_JOB_FEE_NEAR_AED`, `PAY_PER_JOB_FEE_FAR_AED`, `PAY_PER_JOB_DISTANCE_THRESHOLD_M`, `PAY_PER_JOB_PROMO_FEE_AED`) moved to `NEXT_PUBLIC_PPJ_*` env vars. Safe numeric fallbacks to original hardcoded values.
   - File changed: `src/types/index.ts`

3. **Phase 1B Task 4 — Cron reliability (6 findings fixed):**
   - Finding 1: `vercel.json` created — `expire-requests` every 30 min, `monthly-allowance-reset` daily 00:00 UTC.
   - `ops-auth.ts` — added Vercel `CRON_SECRET` fallback so native cron injection works without manual secret alignment.
   - Both routes: added `GET` handler delegating to shared handler function (Vercel Cron calls GET).
   - Finding 3: `monthly-allowance-reset` serial UPDATE loop → `Promise.all` parallel updates.
   - Finding 4: `maxDuration = 30` on `expire-requests`, `maxDuration = 60` on `monthly-allowance-reset`.
   - Finding 5: `REQUEST_EXPIRY_HOURS` → `OPS_REQUEST_EXPIRY_HOURS` env var, fallback `2`.
   - Finding 6: `validateEnv()` — minimum 32-char length check on `OPS_CRON_SECRET`.

4. **Phase 1B Task 5 Finding 2 — Cancel double-compensation bug fixed:**
   - New RPC `cancel_request_and_compensate_atomic` (migration 019) — wraps cancel + provider compensation in one Postgres transaction with `FOR UPDATE` on request + provider rows. `cancellation_compensated_at IS NULL` guard is idempotency anchor.
   - `src/app/api/requests/cancel/route.ts` rewritten to call RPC. 230 lines → 176 lines.

5. **Phase 1B Task 5 Finding 1 — Release cleanup atomicity fixed:**
   - New RPC `release_job_atomic` (migration 020) — wraps request status update, jobs field reset, request_locks delete, and provider counter increment in one transaction. `provider_locations` delete remains post-RPC best-effort.
   - `src/app/api/provider/jobs/release/route.ts` rewritten to call RPC. 133 lines → 85 lines.

6. **Phase 1C — Deep RLS Hardening (migration 021):**
   - DROP `"Providers read locks"` on `request_locks` — all authenticated users could read all lock rows.
   - DROP `"Customers cancel own open request"` on `requests` — customers could UPDATE any column directly.
   - DROP `"Active providers read open requests"` on `requests` — bypassed migration 010 privacy masking.
   - DROP `"Customers read active providers"` on `providers` — exposed Stripe IDs + billing columns.
   - DROP `"Public read ratings"` + CREATE `"Authenticated read ratings"` — removed anon access.
   - DROP `"Active providers location visible"` on `provider_locations` — cross-provider location exposure.

7. **Phase 1C remaining (migration 022):**
   - REVOKE ALL on `reset_monthly_job_counters()` from all roles. COMMENT marking deprecated.
   - `ratings UNIQUE(job_id)` constraint confirmed via idempotent `DO $$` guard.

8. **Migration 020 duplication bug fixed** — file was doubled by file_write tool; duplicate block removed.

### Files changed
- `src/types/index.ts` — LAUNCH_PROMO + PPJ fee env vars
- `src/lib/ops-auth.ts` — CRON_SECRET fallback
- `src/app/api/ops/expire-requests/route.ts` — GET handler, maxDuration, env var expiry hours
- `src/app/api/ops/monthly-allowance-reset/route.ts` — GET handler, Promise.all, maxDuration
- `src/lib/env.ts` — OPS_CRON_SECRET minimum length validation
- `src/app/api/requests/cancel/route.ts` — RPC-based rewrite
- `src/app/api/provider/jobs/release/route.ts` — RPC-based rewrite
- `vercel.json` — created (cron schedule)
- `supabase/migrations/019_cancel_compensation_atomic.sql` — created + applied
- `supabase/migrations/020_release_job_atomic.sql` — created + applied (duplication fixed)
- `supabase/migrations/021_phase1c_rls_hardening.sql` — created + applied
- `supabase/migrations/022_phase1c_remaining.sql` — created + applied

### Deferred items (carried forward)
- Phase 1A Task 1: login sequential role fetch, Navbar auth duplication, router.refresh() 1200ms fallback, prefetch all dashboards
- Phase 1A Task 2: getViewerState() sequential queries, logout navigates to `/`
- Phase 1A Task 3: provider fallback sequential (Finding 5), skeleton completeness (Finding 6)
- Phase 1A Task 7: `removeTracing: true` vs CWV — user decision pending
- Phase 1A Task 7: `server-only` guards on lib files — Phase 1D
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup pass
- Phase 1B Task 5 Finding 4: complete/route.ts sequential pre-flight reads → Promise.all
- Phase 1B Task 5 Finding 5: overage guard TOCTOU in accept/route.ts
- Phase 1B Task 5 Finding 3: PPJ protection `provider_not_found` → Sentry alert
- Phase 1B Task 5 Finding 8: accept RPC scan-based FOR UPDATE
- Phase 1B Task 4 Findings 7–9: deprecated edge functions verify undeployed (manual), retry semantics, overage_cleared zombie edge case
- Storage bucket `provider-documents` — 0 RLS policies
- `NEXT_PUBLIC_SITE_URL` missing from Vercel

### New env vars required in Vercel
- `NEXT_PUBLIC_LAUNCH_PROMO = true` (keep promo active)
- `NEXT_PUBLIC_PPJ_FEE_NEAR_AED = 30`
- `NEXT_PUBLIC_PPJ_FEE_FAR_AED = 70`
- `NEXT_PUBLIC_PPJ_DISTANCE_M = 10000`
- `NEXT_PUBLIC_PPJ_PROMO_FEE_AED = 15`

---

## Session: June 5, 2026 — Phase 1A Task 8 complete

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

---

## Session: June 4, 2026 (session 3)

### What was done
1. **CLAUDE.md updated** — Task 6 Finding 1 marked complete, Task 7 audit findings added, "الجاي" pointer advanced to Task 8.
2. **Phase 1A Task 7 — Bundle size audit** (findings only, no code changes).
3. **Phase 1A Task 7 — Full deep audit completed** — see findings below (session 3 continuation).

---

### Phase 1A Task 7: Bundle Size Audit — Findings (full, session 3)

Audit scope: `package.json`, `next.config.ts`, all `src/` imports, all UI components, all lib modules.

#### Finding 1 — 11 completely dead dependencies (HIGH)
All 9 `@radix-ui/*` packages + `react-hook-form` + `@hookform/resolvers` are in `package.json` but have ZERO imports anywhere in `src/`. All UI components (`Button`, `Select`, `Input`, `Accordion`, `Badge`, `Card`) are custom native-HTML + Tailwind — the Radix/RHF stack was installed (likely from shadcn/ui scaffolding) but never wired up.
- Production bundle impact: **zero** (never imported → webpack excludes)
- `node_modules` bloat: ~15+ packages with sub-dependencies, slower installs, `npm audit` noise
- **Proposed fix (terminal):**
  ```
  npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers
  ```

#### Finding 2 — `date-fns` unused (LOW)
`"date-fns": "^4.2.1"` in `package.json`, zero imports anywhere. Production bundle impact: zero.
- **Proposed fix (terminal):** `npm uninstall date-fns`

#### Finding 3 — `removeTracing: true` blocks CWV capture (MEDIUM, carry-over from Task 6)
`next.config.ts:108` — Sentry webpack plugin tree-shakes all tracing code out of the bundle.
`browserTracingIntegration()` (needed for INP/LCP/CLS via Sentry) is a no-op after build.
- Bundle benefit: tracing code removed from client JS
- CWV cost: no INP/LCP/CLS data in Sentry production dashboard
- **Decision required:** keep `removeTracing: true` (errors-only Sentry, smaller bundle) OR remove it + add `browserTracingIntegration` + `tracesSampleRate: 0.05` to `sentry.client.config.ts`
- Deferred — requires user choice.

#### Finding 4 — `zod` and `stripe` Node SDK correctly isolated (CONFIRMED GOOD)
`zod` — API routes only. `stripe` Node SDK (`src/lib/stripe.ts`) — API routes only. No client bundle exposure.

#### Finding 5 — No `server-only` guards on server libs (LOW — future risk)
`src/lib/stripe.ts`, `src/lib/logger.ts`, `src/lib/env.ts`, `src/lib/notifications.ts`, `src/lib/rate-limit.ts`, `src/lib/ops-auth.ts` — none have `import 'server-only'`.
- Current risk: low (all currently imported server-side only).
- Future risk: accidental 'use client' import would silently pull Node.js Stripe SDK into client bundle.
- Deferred to Phase 1C hardening pass.

#### Finding 6 — `SUBSCRIPTION_PLANS` duplicated in 3 places (LOW — maintenance risk)
- `src/types/index.ts` — canonical source with Stripe price IDs
- `src/app/provider/register/page.tsx:15` — local `PLANS` array, hardcoded prices, no Stripe IDs
- `src/app/api/stripe/create-checkout/route.ts:16` — local string array `['starter', 'pro', 'business']`
- No bundle impact. Risk: plan additions/renames won't propagate to all 3 locations. Deferred.

#### Finding 7 — `LAUNCH_PROMO = true` requires redeploy to toggle (LOW — operational)
`src/types/index.ts:55`. Should eventually be a `NEXT_PUBLIC_LAUNCH_PROMO` env var. Deferred.

#### Confirmed good (no action needed)
- `lucide-react` — named imports on all 24 import sites, tree-shaking correct
- `@stripe/react-stripe-js` / `@stripe/stripe-js` — client-only, payment pages only
- `clsx` + `tailwind-merge` — used in `utils.ts`, correctly shared
- `geo.ts`, `utils.ts` — pure functions, safe in client components
- `logger.ts` — server components + API routes only, zero client exposure
- `Navbar.tsx` — 'use client', Supabase client auth only, no heavy leaks
- `@supabase/ssr` — shared client boundary via Navbar, expected

#### Action order
1. `npm uninstall` the 11 dead deps — safe, immediate (Finding 1)
2. `npm uninstall date-fns` — safe, immediate (Finding 2)
3. Decide `removeTracing` / CWV tradeoff (Finding 3) — user decision
4. `server-only` guards — Phase 1C pass (Finding 5)
5. `SUBSCRIPTION_PLANS` deduplication — any future cleanup pass
6. `LAUNCH_PROMO` → env var — before promo ends

---

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification

Goal: identify which DB queries are slow in production using `pg_stat_statements` or Supabase dashboard.
Scope: review current query patterns in API routes + server pages against the indexes applied in migrations 013 + 016.

---

---

## Session: June 4, 2026 (session 4 — end of day wrap-up)

### What was done
1. **SESSION_LOG.md + CLAUDE.md** — end-of-session update: CLAUDE.md المراحل القادمة corrected (tasks 1–7 all done, Task 8 only remaining).
2. No new code changes this session — Tasks 6 and 7 were the work; this entry closes the day.

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify which queries are slow in production using Supabase dashboard or `pg_stat_statements`.
Scope: review all API routes + server pages against indexes from migrations 013 + 016.
No code changes expected — audit + findings only.

Pending user decisions before Task 8:
- `removeTracing: true` vs CWV capture — keep or remove?
- Run `npm uninstall` for 12 dead dependencies? (safe, no code impact)

---

## Session: June 5, 2026 — VERDENT_HANDOFF.md created

### What was done
1. **VERDENT_HANDOFF.md** — created (project root). Complete 15-section handoff document for another AI or engineer. Covers: business model, architecture, all phases, business logic, schema, env vars, API routes, known issues, technical decisions, constraints, deployment, testing, next steps.
2. **README.md** — updated to reflect current project status and link to all documentation files.
3. **`src/proxy.ts`** — inline comments added explaining middleware role, why no DB role check, cookie dance requirement.
4. **`src/app/api/provider/requests/accept/route.ts`** — inline comments added explaining rate limit, parallelized pre-flight checks, overage guard logic, pre-flight lock check advisory nature, atomic RPC purpose.
5. **`src/app/api/stripe/webhook/route.ts`** — inline comments added explaining force-dynamic, idempotency claim pattern, PROCESSING_TIMEOUT_MS, PLAN_BY_PRICE_ID, payment intent handler, subscription sync, raw body requirement.

### Files changed (June 5)
- `VERDENT_HANDOFF.md` — created
- `README.md` — updated
- `src/proxy.ts` — comments added
- `src/app/api/provider/requests/accept/route.ts` — comments added
- `src/app/api/stripe/webhook/route.ts` — comments added
- `SESSION_LOG.md` — this update

---

### Files changed — full session log (June 4, all sessions)

**Session 1 (June 4):**
- `supabase/migrations/016_task4_query_indexes.sql` — created (5 indexes, applied in Supabase)
- `DEPLOYMENT_STATUS.md` — migration 016 added, Phase 1A tasks 1–4 checked off
- `src/app/api/provider/location/route.ts` — Task 4 Finding 5 (2 sequential → Promise.all)
- `src/app/api/provider/requests/accept/route.ts` — Task 4 Finding 6 (4 sequential → Promise.all)
- `src/app/customer/request/page.tsx` — Task 5 (adaptive polling interval)
- `src/app/layout.tsx` — Task 6 Finding 6 (Supabase preconnect)

**Session 2 (June 4):**
- `sentry.client.config.ts` — created (Task 6 Finding 1: client-side Sentry)
- `DEPLOYMENT_STATUS.md` — Task 4 code fixes + Task 5 + Task 6 Finding 1 checked off

**Sessions 3–4 (June 4):**
- `CLAUDE.md` — Tasks 6+7 marked complete, "الجاي" → Task 8, "tasks 2-8" → "Task 8 only remaining"
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
- Phase 1A Task 7: `removeTracing: true` vs CWV — decision required before enabling `browserTracingIntegration`
- Phase 1A Task 7: add `server-only` guards to `stripe.ts`, `logger.ts`, `env.ts`, `notifications.ts`, `rate-limit.ts`, `ops-auth.ts` — Phase 1C hardening pass
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup in cleanup pass
- Phase 1A Task 7: `LAUNCH_PROMO = true` hardcoded — move to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends
- Phase 1A Task 8: ✅ complete — see session June 5, 2026 (Task 8) below
- `npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns` — safe to run any time (12 unused dependencies, zero bundle impact)

---

## Session: June 5, 2026 (session 3 — VERDENT_HANDOFF.md expanded to 25 sections)

### What was done
1. **VERDENT_HANDOFF.md** — expanded with 6 new sections (20–25). Full codebase audit performed: read all 16 migrations, webhook route, accept route, complete route, release route, proxy.ts. Three factual corrections documented. No duplicate content added.
   - **Section 20**: Complete DB column reference — all 12 tables, all columns from all 16 migrations, full index inventory.
   - **Section 21**: Dedicated Authentication Flow — registration, login, session handling, role management, logout, admin creation.
   - **Section 22**: Current Production State — Vercel/Supabase/Stripe/Sentry/Cron/Storage snapshot + launch readiness checklist (~35%).
   - **Section 23**: Corrections and Clarifications — 3 factual errors corrected from source code audit.
   - **Section 24**: Ready-to-use Prompt for Next AI — self-contained copy-paste prompt covering all critical rules.
   - **Section 25**: Final Validation — document stats, files reviewed, files not reviewed, assumptions, missing resources.

### Corrections discovered (from codebase audit)
1. `complete_provider_job_atomic` does NOT delete provider_locations. Only the release route deletes it. Section 16 had a wrong step 4.
2. PPJ recovery credit is ONLY for customer-cancelled requests. NOT restored when another provider accepts the request during payment. Sections 6 and 16 both had wrong descriptions.
3. `checkout.session.completed` is log-only — no DB writes. Provider activation is via `customer.subscription.created`. Section 16 had wrong handler name and wrong action.

### Files changed
- `VERDENT_HANDOFF.md` — sections 20–25 added
- `SESSION_LOG.md` — this update

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify slow queries in production using Supabase `pg_stat_statements` dashboard.
Scope: review all API routes + server pages against indexes from migrations 013 + 016. Audit-only, no code changes expected.

Pending before Task 8:
- `npm run lint && npm run build` — user runs from terminal
- `git add . && git commit -m "Phase 1A complete + VERDENT_HANDOFF.md expanded (sections 20–25)" && git push`
- Decision: `removeTracing: true` vs CWV capture (can defer)
- Optional: `npm uninstall` for 12 dead dependencies (safe, no code impact)

---

## Session: June 5, 2026 — Phase 1A Task 8 complete

### What was done

1. **Issue #1 verified** — `getOpsCronSecret` confirmed exported in `src/lib/env.ts:30`. False alarm from truncated read.

2. **Phase 1A Task 8 — Production slow-query identification (audit + fixes).**
   Full cross-reference of all 20 API routes + 8 server pages against all 25 indexes in migrations 013 + 016. 12 findings produced.

3. **Findings 1, 2, 5 — code fixes (no migration).**
   - `src/app/admin/revenue/page.tsx:70` — `payout_log`: narrowed `select('*')` to 6 used columns + added `.limit(100)`. `idx_payout_log_created` now does useful bounded work.
   - `src/app/admin/revenue/page.tsx:71` — `jobs`: narrowed `select('*')` to 4 used columns + added `.not('completed_at', 'is', null)`. `idx_jobs_completed` partial index now eligible.
   - `src/app/admin/providers/page.tsx:112` — `providers`: narrowed `select('*')` to 8 columns in `AdminProviderRow` + added `.limit(200)`. Removes billing columns from wire transfer, caps unbounded fetch.

4. **Findings 3, 4, 6 — migration 017 applied.**
   - `idx_ppj_payments_status_created` — covers admin-wide `ppj_payments` status filter + sort.
   - `idx_overage_payments_status_created` — covers admin-wide `overage_payments` status filter + sort.
   - `idx_requests_created` — covers admin/requests unfiltered `ORDER BY created_at DESC LIMIT 100`.
   - `supabase/migrations/017_task8_query_indexes.sql` created.

5. **Finding 10 — `get_nearby_open_requests` RPC audited + migration 018 applied.**
   - Function confirmed present in production but absent from all prior migrations.
   - Index coverage confirmed: GIST spatial index + partial index on open/unassigned requests + PK lookups — all correct.
   - No query logic changes. Migration 018 is tracking-only — captures production function body into version control.
   - `supabase/migrations/018_capture_get_nearby_open_requests.sql` created.

### Files changed
- `src/app/admin/revenue/page.tsx` — Findings 1 + 2 (payout_log limit, jobs narrow + null filter)
- `src/app/admin/providers/page.tsx` — Finding 5 (providers narrow + limit)
- `supabase/migrations/017_task8_query_indexes.sql` — created (3 indexes, applied in Supabase)
- `supabase/migrations/018_capture_get_nearby_open_requests.sql` — created (RPC capture, applied in Supabase)
- `DEPLOYMENT_STATUS.md` — migrations 017 + 018 marked ✅, Task 8 marked complete
- `SESSION_LOG.md` — this update

### Task 8 findings not yet actioned (deferred)
- Finding 7 — `monthly-allowance-reset` serial UPDATE loop → `Promise.all` or bulk UPDATE. Deferred to Phase 1B cron reliability pass.
- Finding 8 — `complete/route.ts` 2 sequential reads before RPC → `Promise.all`. Low priority.
- Finding 9 — `release/route.ts` sequential role+counters reads → `Promise.all`. Low priority.
- Finding 10 — `get_nearby_open_requests` CROSS JOIN silent empty result when provider offline. Design decision — deferred.
- Finding 12 — Sequential `users.role` check in admin pages/routes → merge into `Promise.all`. Low priority.

### Phase 1A — now fully complete ✅
All 8 tasks done. Migrations 001–018 applied.

### Next task: Phase 1B remaining
- Cron reliability + monitoring (monthly-allowance-reset serial loop — Finding 7 above)
- `LAUNCH_PROMO` → `NEXT_PUBLIC_LAUNCH_PROMO` env var
- PPJ fees → configurable server-side
- Additional DB indexes as identified

### Deferred issues (ongoing)
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Storage bucket `provider-documents` — 0 RLS policies (review SETUP.md §4)
- CSP violations review — report-only has been running since Phase 1
- Stripe still on test/sandbox keys — live keys before real launch (Phase 10)
- Phase 1A Task 1 deferred: login sequential role fetch, Navbar duplicated auth, router.refresh() + 1200ms fallback, prefetch all 3 dashboards
- Phase 1A Task 2 deferred: getViewerState() sequential queries on home page, logout navigates to `/`
- Phase 1A Task 3 deferred: Finding 5 (provider fallback sequential), Finding 6 (skeleton completeness)
- Phase 1A Task 7: `removeTracing: true` vs CWV — decision required before enabling `browserTracingIntegration`
- Phase 1A Task 7: add `server-only` guards to `stripe.ts`, `logger.ts`, `env.ts`, `notifications.ts`, `rate-limit.ts`, `ops-auth.ts` — Phase 1C
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup in cleanup pass
- Phase 1A Task 7: `LAUNCH_PROMO = true` hardcoded — move to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends
- `npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns` — safe to run any time

---

## Session: June 5, 2026 (session 2 — VERDENT_HANDOFF.md expanded)
   - **Section 16 — PPJ & Subscription Business Logic (Complete Detail):** Full Stripe webhook event table (all 9 events + handler + action), full RPC signatures with transaction step-by-step contracts (`accept_provider_request_atomic`, `complete_provider_job_atomic`, `get_nearby_open_requests`, `restore_ppj_credit`), per-table RLS matrix (all 12 tables), PPJ payment intent creation steps, overage payment intent creation steps, `PLAN_BY_PRICE_ID` mapping pattern.
   - **Section 17 — AI Agent Rules (mandatory):** Session start/end rules, context management at 90%, commands never-run list, bug reporting format, A-vs-B decision rule, golden rule before file changes.
   - **Section 18 — Deferred Items (exact locations):** 3 high-priority pre-launch items, 6 medium-priority (with exact `file:line` references), 10 low-priority items (with exact `file:line` references) organized by phase.
   - **Section 19 — Critical Business Rules (NEVER change):** Commission always 0, PPJ fees server-side only with exact type constants, Google Maps links-only until Phase 6, Stripe TEST mode until Phase 10, webhook URL + current status, atomic RPC inviolable rule, RLS change process, migration process.

### Files changed
- `VERDENT_HANDOFF.md` — 4 sections added (Sections 16–19)
- `SESSION_LOG.md` — this update

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify which queries are slow in production using Supabase `pg_stat_statements` dashboard.
Scope: review all API routes + server pages against indexes from migrations 013 + 016. Audit-only, no code changes expected.

Pending before Task 8:
- `npm run lint && npm run build` — user runs from terminal
- `git add . && git commit -m "Phase 1A complete + VERDENT_HANDOFF.md expanded (sections 16–19)" && git push`
- Decision: `removeTracing: true` vs CWV capture (can defer)
- Optional: `npm uninstall` for 12 dead dependencies (safe, no code impact)
