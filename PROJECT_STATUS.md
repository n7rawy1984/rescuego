# RescueGo — Project Status

This document is the single source of truth for the current operational state of RescueGo.
It owns Dynamic and Operational knowledge only.
Architecture design, RPC design, security architecture, and system topology belong to [ARCHITECTURE.md].
Product backlog items belong to [DEFERRED_PRODUCT_BACKLOG.md].
Phase plan and roadmap belong to [ROADMAP.md].
Setup and environment variable definitions belong to [SETUP.md].

**This document must be updated after every deployment session, batch remediation, or runtime verification.**

---

## §1 Current Project Snapshot

| Fact | Current State |
|---|---|
| Migration baseline | 045 applied (`045_ppj_post_selection_fee_gate.sql`) |
| Next migration number | 046 |
| Stripe mode | TEST — live charges are not processed |
| PPJ status | Re-enabled via migration 045; in end-to-end testing |
| Fair price status | Validation active but bounds intentionally widened (migration 044 — LAUNCH BLOCKER) |
| Cloud migration verification | INSUFFICIENT EVIDENCE — cannot confirm from source which migrations are applied to the production Supabase project |
| Launch readiness | NOT READY — multiple blockers active (see §6) |
| Last documented work session | June 28, 2026 (migration 045 deployed, PPJ end-to-end testing begun) |

---

## §2 Deployment Status

### Vercel

The application deploys automatically from the `main` branch via Vercel. Build configuration is in `next.config.ts` and `vercel.json`.

Cron jobs are defined in `vercel.json` and fire on their configured schedules once the application is deployed. See [ARCHITECTURE.md §11] for the cron schedule and purpose of each route.

**Stripe webhook endpoint** must be registered in the Stripe Dashboard to point to the production Vercel deployment URL at `/api/stripe/webhook`. Stripe must be configured to send:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `payout.created`

**OG image and logo file extension gaps (Finding 3, Finding 4 from AUDIT_REPORT_1):**
- `app/layout.tsx` references `/og-image.jpg` but `public/` contains `og-image.svg`.
- JSON-LD schema references `/logo.png` but `public/` contains `logo.svg`.
- These mismatches must be resolved before launch (correct extensions or update references).

### Supabase

Cloud Supabase project must have all 45 migrations applied in order (001–045). Cloud verification status is INSUFFICIENT EVIDENCE — there is no runtime signal in the source proving which migrations the cloud database currently has applied.

> Post-deploy verification SQL:
> ```sql
> SELECT service_type, min_price_per_km, max_price_per_km, base_fee
> FROM public.fair_price_config ORDER BY service_type;
> -- Expected: min=0.01, max=10000, base_fee unchanged (migration 044)
>
> SELECT COUNT(*) FROM public.request_quotes;
> -- Expected: table exists (migration 031)
>
> SELECT COUNT(*) FROM public.provider_kyc_log;
> -- Expected: table exists (migration 038)
>
> SELECT proname FROM pg_proc WHERE proname IN (
>   'enforce_users_immutable_columns',
>   'enforce_providers_immutable_columns',
>   'finalize_ppj_selection_atomic',
>   'expire_ppj_payment_selection_atomic',
>   'admin_update_provider_status_atomic'
> );
> -- Expected: all 5 names returned (migrations 039, 041, 045)
>
> SELECT relname FROM pg_class WHERE relname = 'idx_jobs_en_route_at';
> -- Expected: 1 row (migration 043)
> ```

---

## §3 Migration Baseline

| Fact | Value |
|---|---|
| Total migrations | 45 |
| Latest applied (repo) | `045_ppj_post_selection_fee_gate.sql` |
| Next migration number | 046 |
| Cloud state | INSUFFICIENT EVIDENCE |

**Migrations 039–045 are the security and marketplace remediation batch.** Any Supabase project that does not have these applied is running with unpatched security vulnerabilities (C2/C3 self-escalation bypasses, CRIT-01 price-change TOCTOU, and no PPJ fee gate). Runtime verification of cloud migration state is required before launch.

Complete migration sequence: 001–045. For architectural meaning of each migration see [ARCHITECTURE.md §2].

---

## §4 Runtime Verification

The following table records the verification state of every significant implementation fix. "Code complete" means the fix exists in the repository. "Runtime verified" means it has been confirmed working in the production Supabase environment.

| Finding | Fix location | Code state | Runtime verification |
|---|---|---|---|
| C2 — users.role self-escalation | Migration 039 `enforce_users_immutable_columns` trigger | Code complete | INSUFFICIENT EVIDENCE — cloud migration state unconfirmed |
| C3 — providers sensitive-column self-write | Migration 039 `enforce_providers_immutable_columns` trigger | Code complete | INSUFFICIENT EVIDENCE |
| C4 — Stripe KYC bypass | `webhook/route.ts` `KYC_PROTECTED` expanded | Code complete | INSUFFICIENT EVIDENCE — requires live Stripe test |
| C5 — fair price intentionally relaxed | Migration 044 widened bounds; validation still runs | Intentionally open (LAUNCH BLOCKER — see §6 and §10) | Confirmed in migration SQL |
| CRIT-01 — price-change TOCTOU | Migration 040 `request_price_change_atomic` | Code complete | INSUFFICIENT EVIDENCE |
| CRIT-02 — SLA only on `accepted` | Migration 040 `sla_check_and_release`; cron updated Batch 3 | Code complete; cron fix SESSION_LOG June 26 | PARTIALLY VERIFIED — cron fix confirmed via SESSION_LOG |
| H1 — KYC docs in select response | Migration 040 removes `documents` from `select_quote_atomic` return | Code complete | INSUFFICIENT EVIDENCE |
| H5 — KYC log non-atomic | Migration 041 `admin_update_provider_status_atomic` | Code complete | INSUFFICIENT EVIDENCE |
| HIGH-01 — unvalidated `request_id` | `requests/quotes/route.ts` `z.string().uuid()` | Code complete | Confirmed in source |
| HIGH-02 — GET /api/requests mutates state | `requests/route.ts` GET is now read-only | Code complete | Confirmed in source |
| HIGH-03 — release no decrement | Migration 040 `release_job_atomic` decrements conditionally | Code complete | INSUFFICIENT EVIDENCE |
| HIGH-05 — ratings missing `customer_id` | Migration 040 adds `ratings.customer_id` column | Code complete | INSUFFICIENT EVIDENCE |
| HIGH-06 — price-change respond no guard | Migration 040 `respond_price_change_atomic` status guard | Code complete | INSUFFICIENT EVIDENCE |
| F3-H2 — `overage_cleared` not reset on release | Migration 040 `release_job_atomic`, SLA release, stuck expiry | Code complete | INSUFFICIENT EVIDENCE |
| P4-C2 — monthly reset memory cliff | `monthly-allowance-reset/route.ts` paginated PAGE_SIZE=50 | Code complete | Confirmed in source |
| P4-H1 — no rate limit on GET endpoints | `requests/route.ts` and `requests/quotes/route.ts` rate-limited | Code complete | Confirmed in source |
| P4-H4 — cron returns 200 on failure | `marketplace-cron/route.ts` returns HTTP 500 on critical failure | Code complete | Confirmed in source |
| P4-M1 — missing `en_route_at` index | Migration 043 `idx_jobs_en_route_at WHERE completed_at IS NULL` | Code complete | INSUFFICIENT EVIDENCE |
| P4-M2 — expireStaleQuotes no LIMIT | `marketplace-cron/route.ts` EXPIRE_BATCH_LIMIT=500 | Code complete | Confirmed in source |
| P4-L4 — `OPS_CRON_SECRET` soft-warning only | `env.ts` throws in production if missing or < 32 chars | Code complete | INSUFFICIENT EVIDENCE |
| D10 — Bearer token fallback in request-user | `request-user.ts` cookie-session only | Code complete | Confirmed in source |
| H7 — CSRF null origin bypass + vercel.app wildcard | `proxy.ts` null origin → 403; wildcard removed | Code complete | INSUFFICIENT EVIDENCE |
| M7 — Bearer token auth on API routes | Removed in Batch 1 | Code complete | Confirmed in source |
| PPJ post-selection fee gate | Migration 045 `selected_pending_payment`, two new RPCs | Code complete | Under testing — no production runtime signal |

---

## §5 Launch Readiness

### Blockers (must resolve before go-live)

See §6 for detailed descriptions of each blocker.

| # | Blocker | Severity | Owner reference |
|---|---|---|---|
| LB-1 | Fair price formula redesign (two-leg distance + emirate destination) | Critical | DEFERRED_PRODUCT_BACKLOG P9, P1, P2 |
| LB-2 | Cloud migration verification (migrations 039–045 applied to production?) | Critical | §4 Runtime Verification |
| LB-3 | C2/C3 runtime verification (immutable-column triggers active in cloud?) | Critical | §7 C2, C3 |
| LB-4 | Stripe go-live switch (currently TEST mode) | Critical | §11 |
| LB-6 | H2 — Legacy accept route bypasses V2 marketplace for subscription providers | High | §7 H2 |
| LB-7 | H3 — No overage gate in `select_quote_atomic` | High | §7 H3 |
| LB-8 | P4-C1 — Thundering herd: provider Realtime broadcasts to all online providers | High | §13 |
| LB-9 | OG image / logo file extension gaps | Medium | §2 Deployment |
| LB-10 | P4-H3 — Weekly SLA reset is non-atomic (visibility_reduced and counter_reset in two UPDATE statements) | Medium | §13 |
| LB-11 | `NEXT_PUBLIC_SITE_URL` not set in Vercel (password reset emails degrade) | Medium | §11 |

### Not blockers (deferred by owner decision)

- No test suite — pre-production only (see AGENTS.md B2).
- No CI/CD pipeline beyond Vercel TypeScript build — pre-production only.
- `dispatch.ts` zero callers — deferred until dispatch redesign (DEFERRED_PRODUCT_BACKLOG P8).
- Commission zero — intentional until Phase 8 (DEFERRED_PRODUCT_BACKLOG P5).
- Google Maps SDK — deferred until Phase 6 (AGENTS.md constraint).
- PPJ UI open items P10/P13 — in testing (DEFERRED_PRODUCT_BACKLOG).

---

## §6 Current Launch Blockers

### LB-1 — Fair Price Formula Redesign (CRITICAL)

**Status:** OPEN — Launch blocker.

Migration 039 re-enabled fair-price validation in `submit_quote_atomic`. Migration 044 (`044_temp_widen_fair_price_bounds.sql`) **temporarily widened** the `fair_price_config` bounds to `min_price_per_km = 0.01` and `max_price_per_km = 10000` for all service types. Validation still runs on every quote — it has not been disabled — but the per-km bounds are so wide they permit any reasonable price, defeating the protection.

**Why the current formula must not launch:**
The formula uses a single-leg distance (provider → customer). For tow jobs, the economically significant distance is the two-leg route: provider → breakdown location → destination (where the car is towed). Quotes for tow jobs far from the customer's destination can be priced near-minimum and still be fair by the current single-leg formula, creating provider-unfair or customer-unfair outcomes.

**Required before launch:**
1. Two-leg distance calculation: provider→breakdown + breakdown→destination.
2. Mandatory emirate destination dropdown (customer must select destination at request creation).
3. Redesigned `fair_price_config` bounds based on two-leg economics.
4. New migration replacing the widened 044 values.

See [DEFERRED_PRODUCT_BACKLOG P9, P1, P2] for full backlog items and owner decisions. See [ARCHITECTURE.md §7] for the current formula design.

**Impact if shipped as-is:** Fair price enforcement is effectively inactive. Providers can submit any price and it will be accepted by the RPC.

---

### LB-2 — Cloud Migration Verification (CRITICAL)

**Status:** INSUFFICIENT EVIDENCE.

The repository contains migrations 001–045. Whether all 45 are applied to the production Supabase project cannot be confirmed from source alone. The most recent confirmed session (SESSION_LOG June 24) documented that migration 039 had NOT yet been applied to the cloud database at that time. Migrations 040–045 were written after that session.

**Required before launch:** Run the verification queries in §2 against the production Supabase project and record results here.

---

### LB-3 — C2/C3 Runtime Verification (CRITICAL)

**Status:** PARTIALLY VERIFIED (code complete; cloud runtime unconfirmed).

The `enforce_users_immutable_columns` and `enforce_providers_immutable_columns` triggers (migration 039) are the primary defenses against role self-escalation and provider self-activation. Until the cloud database is confirmed to have migration 039 applied and the triggers firing correctly, these critical paths remain unverified.

**Required before launch:**
```sql
-- Confirm triggers exist:
SELECT tgname, tgrelid::regclass FROM pg_trigger
WHERE tgname IN ('trg_users_immutable_columns', 'trg_providers_immutable_columns');

-- Smoke test C2 (run as authenticated non-admin user):
-- UPDATE users SET role = 'admin' WHERE id = auth.uid();
-- Expected: ERROR 42501 role_change_not_allowed

-- Smoke test C3 (run as authenticated provider):
-- UPDATE providers SET status = 'active' WHERE id = auth.uid();
-- Expected: ERROR 42501 provider_protected_field_change_not_allowed
```

---

### LB-4 — Stripe TEST Mode (CRITICAL)

**Status:** OPEN — TEST mode active.

All Stripe operations use test keys. No real money is processed. The `STRIPE_SECRET_KEY` in Vercel must be swapped to a live key and the webhook endpoint re-registered for the live environment before launch.

**Impact if shipped as-is:** No revenue collected. All "payments" are fictional.

---

### LB-5 — H6: `accept_provider_request_atomic` Active-Job Check — CLOSED

**Status: CLOSED — fixed in migration 029 (supersedes migration 024 line 56). Verified in source.**

Migration `029_rpc_add_en_route_arrived_statuses.sql` line 231 contains `AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')` in the active-job guard — all four active states are covered. No migration in range 030–045 redefines this function. The route-level pre-flight and the RPC are now consistent. Not a launch blocker.

---

### LB-6 — H2: Legacy Accept Bypasses V2 (HIGH)

**Status:** OPEN — Confirmed in `accept/route.ts`.

`POST /api/provider/requests/accept` allows subscription providers to accept `open` status requests directly, bypassing the marketplace V2 quote flow entirely. PPJ providers are correctly blocked (403 `PPJ_PAYMENT_REQUIRED`). Subscription providers are not blocked.

**Impact:** A subscription provider who is fast enough can accept an open request before any quotes are submitted, bypassing the customer's right to compare quotes.

**Required:** Either gate subscription providers behind V2 (accept only `selected_pending_payment` path) or add a flag/feature-gate to phase out the legacy flow. Owner decision required before implementation.

---

### LB-7 — H3: No Overage Gate in `select_quote_atomic` (HIGH)

**Status:** OPEN — No evidence of overage check in `select_quote_atomic`.

When a customer selects a subscription provider's quote via `select_quote_atomic`, the RPC does not check whether the provider has reached their monthly job limit. The overage guard exists in the legacy accept flow only. A customer can select a starter/pro provider who is at their limit; the request becomes `accepted` immediately and `jobs_this_month` is NOT incremented (no corresponding overage payment is collected).

**Impact:** Subscription providers at their monthly limit can receive jobs without paying the overage fee. This is a revenue leak and a fairness issue.

**Required:** Add overage check inside `select_quote_atomic` for the subscriber path, or redirect to overage payment before finalization.

---

## §7 Security — Open Findings

For security architecture and design context, see [ARCHITECTURE.md §8].

Every finding is listed in its current post-Batch-1-through-4 state. A finding is CLOSED only where implementation evidence confirms the fix is code-complete. Runtime-unverified fixes are PARTIALLY VERIFIED.

### C1 — proxy.ts Not Registered as Middleware

**Status: CLOSED — NOT APPLICABLE.**

This finding was based on a misunderstanding of Next.js 16 conventions. Next.js 16 renames `middleware.ts` to `proxy.ts` with a named `proxy` export. The build confirms `ƒ Proxy (Middleware)`. CSRF checks are running. Finding does not apply to this codebase. See [ARCHITECTURE.md §8].

---

### C2 — users.role Self-Escalation via RLS Gap

**Status: PARTIALLY VERIFIED — code complete, cloud runtime unconfirmed.**

Migration 039 adds `enforce_users_immutable_columns` BEFORE UPDATE trigger. Any update to `users.role` by a non-admin, non-service-role caller raises SQLSTATE 42501. The RLS gap (no `WITH CHECK` on the policy) is intentionally patched via trigger rather than policy, because triggers have access to both OLD and NEW values needed for the comparison.

**Runtime verification required before launch.** See LB-3 for verification procedure.

---

### C3 — providers Sensitive-Column Self-Write

**Status: PARTIALLY VERIFIED — code complete, cloud runtime unconfirmed.**

Migration 039 adds `enforce_providers_immutable_columns` BEFORE UPDATE trigger locking 20 columns including status, plan, verified_badge, rating, all Stripe fields, billing/allowance counters, and documents. See [ARCHITECTURE.md §8] for the protected column list.

**Runtime verification required before launch.** See LB-3.

---

### C4 — Stripe Webhook KYC Bypass

**Status: PARTIALLY VERIFIED — code complete, live Stripe test required.**

`KYC_PROTECTED = ['pending', 'under_review', 'rejected', 'suspended']` in `webhook/route.ts`. A provider with any of these statuses will have their subscription recorded but activation withheld. The `create-checkout` route also returns 403 for `rejected` and `suspended` providers before they can even start a checkout.

**Live Stripe test required:** Verify that a pending/under_review provider completing a checkout session does NOT become active.

---

### C5 — Fair Price Enforcement Intentionally Relaxed (LAUNCH BLOCKER)

**Status: INTENTIONALLY OPEN — formula redesign required before launch.**

Migration 039 re-enabled validation inside `submit_quote_atomic`. Migration 044 (`044_temp_widen_fair_price_bounds.sql`) widened `min_price_per_km = 0.01` and `max_price_per_km = 10000` for all service types. Validation still runs — amounts below `base_fee` are still rejected — but the per-km bounds permit essentially any price.

This is NOT the "disabled by migration 032" state. The RPC logic is intact. Only the config table values are temporarily wide.

This is a deliberate testing convenience. The fair-price formula must be redesigned before launch. See LB-1 and [DEFERRED_PRODUCT_BACKLOG P9].

---

### CRIT-01 — Price-Change Request TOCTOU

**Status: PARTIALLY VERIFIED — code complete, cloud runtime unconfirmed.**

Migration 040 adds `request_price_change_atomic` RPC. The entire operation is a single `UPDATE ... WHERE price_change_count = 0 RETURNING id`. No window exists between read and write.

---

### CRIT-02 — SLA Auto-Release Only Fires on `accepted`

**Status: VERIFIED — code complete, cron fix confirmed in SESSION_LOG June 26.**

Migration 040 `sla_check_and_release` handles three states: `accepted` (20 min), `en_route` (2 hours), `arrived` (60 min). The marketplace-cron route queries `.in('status', ['accepted', 'en_route', 'arrived'])` and orders by `created_at ASC` with LIMIT 50. The Batch 3 phantom-column fix (replacing `requests.updated_at` with `requests.created_at`) is applied in migration 042 and confirmed in SESSION_LOG.

---

### H1 — KYC Documents Returned to Customer in Quote Selection

**Status: PARTIALLY VERIFIED — code complete, runtime unconfirmed.**

Migration 040 removes `provider_documents` from the `select_quote_atomic` `RETURNS TABLE` definition. The `customer/quote/select/route.ts` response type has no `documents` field. KYC paths (emirate ID, license, vehicle photo URLs) are not exposed to customers.

---

### H2 — Legacy Accept Bypasses V2 Marketplace (OPEN LAUNCH BLOCKER)

**Status: OPEN.** See LB-6 for full description.

`POST /api/provider/requests/accept` allows subscription providers to accept `open` requests without going through the quote flow. PPJ is blocked. Subscription providers are not blocked.

---

### H3 — V2 Overage Not Collected at Selection (OPEN LAUNCH BLOCKER)

**Status: OPEN.** See LB-7 for full description.

`select_quote_atomic` has no overage check for at-limit subscription providers.

---

### H4 — Rate Limiter In-Memory Fallback

**Status: PARTIALLY VERIFIED.**

`src/lib/rate-limit.ts` now distinguishes `'soft'` mode (in-memory fallback allows traffic) and `'hard'` mode (fails closed). The default is `'soft'`. Cross-instance bypass remains possible when Redis is unavailable, by design in soft mode. Throttled logging is implemented (P4-M4 fix). This is a known architectural trade-off, not a bug.

**Status of Redis in production:** INSUFFICIENT EVIDENCE — whether `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured in Vercel is unknown from source.

---

### H5 — KYC Log Non-Atomic

**Status: PARTIALLY VERIFIED — code complete, cloud runtime unconfirmed.**

Migration 041 `admin_update_provider_status_atomic` wraps provider status update and `provider_kyc_log` insert in a single transaction. Rate limited to 30 requests per 60 seconds per admin user.

---

### H6 — `accept_provider_request_atomic` Misses `en_route`/`arrived` — CLOSED

**Status: CLOSED — fixed in migration 029 (supersedes 024 line 56). Verified in source.**

`029_rpc_add_en_route_arrived_statuses.sql` line 231: `AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')` — all active states included. No migration 030–045 redefines this RPC. LB-5 removed from blockers table.

---

### H7 — CSRF Null Origin Bypass

**Status: PARTIALLY VERIFIED — code complete, runtime unconfirmed.**

`proxy.ts` returns 403 when both `Origin` and `Referer` headers are missing. `*.vercel.app` wildcard removed from `ALLOWED_ORIGINS`. Constants-time comparison not applicable here (origin check is string comparison, not secret comparison).

---

### LOW-02 — `request_quotes` RLS Exposes Rejected/Expired Quotes with Provider UUIDs

**Status: OPEN.**

Migration 031 RLS policy for customers on `request_quotes` uses `customer_id = auth.uid()` with no status filter. Migration 037 (`rls_force_and_explicit_deny.sql`) adds forced RLS but does not add a status filter to this policy. Customers can query their own `request_quotes` rows regardless of status, potentially enumerating provider UUIDs for rejected or expired quotes even after the job is complete.

**Impact:** Low severity. Provider UUIDs are not PII and not linked to contact info without an accepted status. However, it leaks provider participation data.

---

### P4-C1 — Thundering Herd: Provider Realtime (OPEN — See §13)

**Status: OPEN.**

`ProviderRealtimeRefresh.tsx` uses `postgres_changes` with `filter: 'status=eq.open'`. At scale, every INSERT or UPDATE to a `status=open` request broadcasts to every subscribed provider simultaneously, regardless of geographic relevance. See §13 for full description.

---

### F3-L2 — `job_credit_balance` Not Zeroed on Monthly Reset for Business Plan

**Status: VERIFIED RESOLVED.**

`monthly-allowance-reset/route.ts` `resetFieldsFor()` function: business plan only resets `jobs_this_month = 0`. `job_credit_balance` is reset only for `starter` and `pro` (lines 42–44). Business plan never has `job_credit_balance` semantics — this is correct behavior, not a bug.

---

### F3-L3 — Commission Zero

**Status: INTENTIONAL — not a finding.**

`complete_provider_job_atomic` writes `commission_rate = 0` and `commission_amount = 0`. This is the design until Phase 8. See [DEFERRED_PRODUCT_BACKLOG P5].

---

### F3-L4 — Business Plan `jobs_this_month` Never Resets

**Status: VERIFIED RESOLVED.**

`monthly-allowance-reset/route.ts` includes `'business'` in the `.in('plan', ['starter', 'pro', 'business'])` query. The `shouldResetProvider()` function fires for business providers. `resetFieldsFor()` for business plan resets `jobs_this_month = 0` only (no credit semantics). Data integrity maintained.

---

## §8 Marketplace — Operational Status

For marketplace design and flow, see [ARCHITECTURE.md §4].

| Aspect | Status |
|---|---|
| Quote submission (`submit_quote_atomic`) | Operational — fair price validation active but bounds widened (C5/LB-1) |
| Quote selection — subscriber path | Operational — immediate accept, SLA starts, contact revealed |
| Quote selection — PPJ path | Operational via migration 045 — `selected_pending_payment` flow active, under end-to-end testing |
| Legacy accept route (`/api/provider/requests/accept`) | Operational for subscription providers — PPJ correctly blocked — H2 open (LB-6) |
| Overage gate on legacy accept | Operational — route pre-flight + RPC atomic guard both in place |
| Overage gate on V2 selection | MISSING — H3 open (LB-7) |
| Request quotes RLS | Provider UUID exposure on expired/rejected quotes — LOW-02 open |
| Realtime quote updates | Operational — `request_quotes` in Realtime publication |
| Anonymous provider IDs in quote list | Operational — first 4 chars of UUID uppercase |
| Provider scoring | Operational — `computeProviderScore()` four-component formula, top 5 of 20 |

---

## §9 PPJ — Operational Status

For PPJ design, see [ARCHITECTURE.md §6].

| Aspect | Status |
|---|---|
| PPJ re-enabled | Yes — migration 045 applied |
| `selected_pending_payment` status | Active |
| Payment window enforcement | Active — `expire_ppj_payment_selection_atomic` cron runs every minute |
| SLA immunity for `selected_pending_payment` | Confirmed — `sla_check_and_release` only acts on accepted/en_route/arrived |
| Two-timer separation | Confirmed — payment window clock (`payment_window_started_at`) separate from SLA clock (`accepted_at`) |
| PPJ checkout route | Operational — `/api/provider/ppj-checkout` |
| PPJ finalization | Operational — webhook calls `finalize_ppj_selection_atomic` |
| Recovery credits | Implemented server-side — credit path in webhook and ppj-checkout route |
| End-to-end testing | IN PROGRESS — no passing E2E verification recorded |

**Open PPJ product issues (not blockers for deployment, tracked in DEFERRED_PRODUCT_BACKLOG):**

- **P10:** SLA warning message appears prematurely during `selected_pending_payment` phase (before `accepted_at` is set). The SLA timer has not started but the UI shows a warning.
- **P13:** PPJ prompt shows "pay 15 AED" even when provider has a recovery credit. The business logic (webhook/checkout) correctly handles the credit path server-side; the UI does not reflect it.

See [DEFERRED_PRODUCT_BACKLOG P10, P13] for full item descriptions.

---

## §10 Fair Price — Operational Status

For fair price formula design, see [ARCHITECTURE.md §7].

| Aspect | Status |
|---|---|
| Validation active | YES — `submit_quote_atomic` runs full range check on every quote |
| Current bounds | `min_price_per_km = 0.01`, `max_price_per_km = 10000` (migration 044) |
| Base fee | Unchanged from migration 031 seed values |
| Effective protection | MINIMAL — bounds so wide any reasonable price passes per-km check; only sub-base-fee amounts are rejected |
| Formula used | Single-leg (provider → customer Haversine distance) |
| Migration state | 044 widened bounds are applied |
| Launch status | BLOCKED — see LB-1 |

**Current `fair_price_config` state (after migration 044):**

| service_type | min_price_per_km | max_price_per_km | base_fee (unchanged) |
|---|---|---|---|
| tow | 0.01 | 10000 | 100.00 |
| battery | 0.01 | 10000 | 80.00 |
| flat_tire | 0.01 | 10000 | 60.00 |
| fuel | 0.01 | 10000 | 50.00 |
| lockout | 0.01 | 10000 | 70.00 |
| other | 0.01 | 10000 | 80.00 |

**What must change before launch:**

1. Mandatory emirate destination dropdown added to request creation (P1).
2. Fair price formula redesigned to two-leg distance: `(provider→breakdown) + (breakdown→destination)` (P9).
3. New realistic `fair_price_config` bounds based on two-leg UAE market economics (P2).
4. Migration 046 or later replaces the 044 widened values.

The original migration 031 seed values are NOT the restore target — they are single-leg values and will not be correct for the redesigned formula. See [DEFERRED_PRODUCT_BACKLOG P9] for full redesign scope.

---

## §11 Cloud / Environment Status

### Stripe

| Variable | Status |
|---|---|
| `STRIPE_SECRET_KEY` | Must be TEST key currently — INSUFFICIENT EVIDENCE of actual Vercel value |
| `STRIPE_WEBHOOK_SECRET` | Must match registered Stripe webhook endpoint |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Must be TEST publishable key currently |
| `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` | Must reference TEST mode Stripe price |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` | Must reference TEST mode Stripe price |
| `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` | Must reference TEST mode Stripe price |

**Before go-live:** All Stripe keys must be switched to live mode keys. Webhook endpoint must be re-registered in live mode.

### Supabase

| Variable | Status |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required — confirmed in `env.ts` SERVER_REQUIRED_ENVS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required — confirmed in `env.ts` SERVER_REQUIRED_ENVS |
| `SUPABASE_SERVICE_ROLE_KEY` | Required — confirmed in `env.ts` SERVER_REQUIRED_ENVS |

**Provider-documents Storage bucket:** Bucket `provider-documents` must exist with RLS policies from migration 023 applied. Verification: upload a test document as a provider and confirm path-prefix enforcement. Cannot confirm from source.

### Application

| Variable | Status |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | NOT SET in `env.ts` SERVER_REQUIRED_ENVS — logged as `console.warn` only. Password reset emails degrade to `window.location.origin`. Set in Vercel before launch. |
| `NEXT_PUBLIC_APP_URL` | Fallback URL — `getAppUrl()` returns `http://localhost:3000` if missing |

### Rate Limiting (Upstash Redis)

| Variable | Status |
|---|---|
| `UPSTASH_REDIS_REST_URL` | In `RUNTIME_REQUIRED_ENVS` — logs `console.error` if missing but does NOT throw. Rate limiter falls back to in-memory. |
| `UPSTASH_REDIS_REST_TOKEN` | Same as above. |

**Impact of missing Redis in production:** Rate limiting uses in-memory fallback (`'soft'` mode). Limits are per-instance, not cross-instance. At multiple Vercel instances, rate limits are effectively divided by instance count. Upstash Redis should be configured before launch for consistent enforcement.

### Ops/Cron

| Variable | Status |
|---|---|
| `OPS_CRON_SECRET` | Required in production — `env.ts` throws at startup if missing or < 32 chars in `production` NODE_ENV. INSUFFICIENT EVIDENCE of actual Vercel configuration. |

---

## §12 Operations — Currently No Open Findings

All operational findings from Phase 2 Security Audit 4 (P4-H4, P4-M1, P4-M2, P4-L4) are resolved in the current codebase.

No cron/SLA runtime incidents are currently recorded.

**This section is reserved as the designated location for future cron/SLA runtime incidents.** If a cron job fails, returns unexpected results, causes data integrity issues, or an SLA enforcement gap is discovered at runtime, record it here. Do not require a structural change to this document to add such a finding — append to this section directly.

---

## §13 Outstanding Runtime Risks

These are known architectural or scale risks that are open and have no current fix committed. They are distinct from the security findings in §7 because they are primarily scale/reliability concerns rather than security vulnerabilities.

### P4-C1 — Thundering Herd: Provider Realtime Broadcasts

**Status: OPEN.**

`ProviderRealtimeRefresh.tsx` subscribes to `postgres_changes` with `filter: 'status=eq.open'`. At scale, every new open request INSERT broadcasts to every connected provider simultaneously, regardless of whether the provider is geographically relevant to the request. 1500 ms debounce and 3 s throttle reduce the refresh rate but do not reduce the broadcast fan-out.

**Impact at scale:** N providers × M requests per minute = N×M router.refresh() calls. Supabase Realtime is billed by concurrent connections. At 500+ concurrent providers this will degrade client performance and generate significant Supabase costs.

**Required before scaled launch:** Geographic filtering on the realtime channel (filter by bounding box or by proximity at subscribe time) or a pull-based architecture with polling only.

---

### P4-H3 — Weekly SLA Reset Non-Atomic

**Status: OPEN.**

`weekly-sla-reset/route.ts` performs two separate UPDATE statements: first `UPDATE SET visibility_reduced = true WHERE id IN (...)`, then `UPDATE SET sla_failure_count = 0 WHERE sla_failure_count > 0`. These are not wrapped in a transaction. If the route times out or Vercel terminates the invocation between the two UPDATE statements, some providers could have their `sla_failure_count` reset without their `visibility_reduced` flag being set (or vice versa).

**Additionally:** The initial fetch `SELECT id, sla_failure_count FROM providers WHERE sla_failure_count > 0` has no LIMIT. At scale with many failing providers this could load a large dataset into memory.

**Impact:** Inconsistent provider visibility state after partial execution. Low probability per-invocation but grows over time.

**Required:** Wrap both updates in a single transaction, or use a `SECURITY DEFINER` RPC. Add LIMIT + pagination to the fetch.

---

### P4-M4 — Rate Limiter Per-Instance Memory

**Status: OPEN — by design in `'soft'` mode.**

As documented in §11, the in-memory rate limiter is per-Vercel-instance. At multiple concurrent instances, per-user rate limits are not globally enforced. This is the documented behavior of `'soft'` mode. Redis configuration resolves this.

---

### P4-M5 — Realtime Channel Scaling

**Status: OPEN.**

Each provider's `ProviderRealtimeRefresh` creates three Supabase Realtime channels per connected provider. Supabase charges by concurrent channel connections. At 500+ concurrent providers this generates 1500+ channels. No channel pooling or geographic partitioning is implemented.

---

### P4-M6 — `OPS_CRON_SECRET` Vercel Configuration

**Status: INSUFFICIENT EVIDENCE.**

`env.ts` throws at startup in production if `OPS_CRON_SECRET` is missing or < 32 chars. Whether the secret is correctly configured in the Vercel project environment variables cannot be confirmed from source alone. Verify in Vercel dashboard.

---

### Logging / Observability Gap

**Status: OPEN.**

There is no external uptime monitoring or alerting configured. `src/lib/logger.ts` logs to stdout. Sentry captures errors. No external health-check endpoint at `/api/health`. No alerting configured for 5xx spikes, response time > 2 s, or DB connection failures. Per AGENTS.md B1, these must be implemented before launch.
