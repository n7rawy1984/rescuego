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
| Migration baseline | 050 applied (`050_fix_update_provider_rating_stars_column.sql`) — 048, 049, and 050 all applied and runtime-verified in Supabase July 5, 2026 |
| Migration baseline | 052 applied, 053 code complete — 048 through 052 all applied and runtime-verified in Supabase (048–050: July 5–6, 2026; 051–052: July 8, 2026); 053 written and locally verified (tsc + lint) but not yet applied |
| Migration 051 | **APPLIED & RUNTIME-VERIFIED (July 8, 2026).** `051_dispatch_foundation_schema.sql` — Tiered Dispatch Phase 1 (schema foundation only, no RPC/trigger/lifecycle/realtime/API/pricing changes). Adds `requests.providers_in_range_at_creation` (raw snapshot count, D1/R1), `requests.destination_emirate` (nullable TEXT + CHECK on the 7 UAE emirates, R6), `request_quotes.refunded_at` (D5 refund marker + partial index), and the new `get_provider_limits(plan)` SSOT function (R5, live-behavior-parity values from migrations 039/047, zero callers yet). `npx tsc --noEmit` and `npm run lint` both exit 0. Verified directly in the Supabase SQL Editor: both new `requests` columns exist, `request_quotes.refunded_at` and its partial index exist, `get_provider_limits()` exists and returns the verified live-parity values for all four plans. |
| Migration 052 | **APPLIED & RUNTIME-VERIFIED (July 8, 2026).** `052_subscriber_count_snapshot.sql` — closes a Phase 1 gap left by 051: adds `requests.subscribers_in_range_at_creation` (raw count of online subscribers within 150km at creation; NULL = pre-052 row, 0 = zero-subscriber fallback). Distinguishes "N providers, some subscribers" from "N providers, all PPJ" — same `providers_in_range_at_creation` count, opposite dispatch behavior. Schema only, no other objects touched. `npx tsc --noEmit` and `npm run lint` both exit 0. Verified directly in the Supabase SQL Editor: column exists with type INTEGER, its `COMMENT` is present, no other schema objects changed. |
| Migration 053 | **CODE COMPLETE — NOT YET APPLIED.** `053_tiered_visibility_rpc.sql` — Tiered Dispatch Phase 2: redesigns `get_nearby_open_requests` (D1/D2 tier-delay visibility, R1 frozen `<10`-provider uncapped-radius expansion, R3 elapsed-time-from-`created_at`, Q5 `visibility_reduced` +5min, new `visible_at` return column). Drops and recreates the function (return-type change) with the exact live grants (`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`, verified against 039 before writing — no separate `anon` revoke exists for this function). Radius default changed 5000→150000; the sole caller (`src/app/provider/dashboard/page.tsx:430`) passes `p_radius` explicitly, so this has no live effect until that constant is updated in a later (Phase 6) change. `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Migration 054 | **APPLIED & RUNTIME-VERIFIED IN PRODUCTION (July 12, 2026).** `054_phase3_step1_ssot_and_d5_infra.sql` — Phase 3 Step 1 (silent infrastructure only, per the GPT-reviewed revised sequencing: zero-live-impact first). Adds `idx_request_quotes_provider_refunded_at` (D5 pair-cap query index — opposite predicate of 051's daily-unrefunded index) and `get_customer_abuse_limits()` (new D-SSOT for D-Create/D-Cancel/D-Restore thresholds, mirrors `get_provider_limits`' shape/grants, zero callers yet). No schema change to `request_quotes.selected_at` — verified it already exists since migration 031 and is reused as-is. Verified live: `get_customer_abuse_limits()` returns `5\|15\|5\|15\|2\|5\|15\|3`, the pair-cap index exists with the correct `WHERE refunded_at IS NOT NULL` predicate, grants are `service_role`-only (plus the expected `postgres` owner role). Not called by any existing RPC or route. **Known gap, NOT implemented by this migration:** the approved D-Restore rule's 4th-qualifying-event abuse-review persistence (the 4th restoration for the same (customer, provider) pair within 24h must be logged/flagged for review, not silently denied) has no tracking mechanism yet — no table, no log write. Intentionally deferred to Item E and is a **HARD PREREQUISITE**: D5 restoration enforcement must not go live until this review-flagging mechanism exists and is wired in alongside it. |
| Migration 055 | **CODE COMPLETE — NOT YET APPLIED (July 12, 2026).** `055_phase3_step2_visibility_delay_gate.sql` — Phase 3 Step 2 (Items A+B): live-verified against production (`pg_get_functiondef`/`information_schema.routine_privileges` confirmed the live `submit_quote_atomic` body is identical to migration 039's, grants are `service_role` + owner-only). Adds `compute_request_visibility_delay()` — a shared, additive STABLE helper extracting 053's tier-delay math (D1/D2/Q5), with a corrected legacy short-circuit (`providers_in_range_at_creation IS NULL THEN 0`) that fixes a confirmed live defect in 053 (legacy rows with `visibility_reduced=true` incorrectly got a 5-minute penalty; the helper does not carry this bug into the write path). `submit_quote_atomic` gets one new Step 2b (tier-delay gate, returns `visibility_window_not_open` before the window opens or `visibility_calc_failed` on computation error) inserted between the existing Step 2 and Step 3 — every other step preserved byte-identical to the live body. Grants preserved exactly (`REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT EXECUTE TO service_role`). Scope (binding, Option A): tier-delay authorization only — does NOT enforce GPS-freshness or radius/reachability; "Can Quote" matches "Can See" for tier timing only, not full eligibility parity. `053` is intentionally untouched — its legacy-penalty bug stays flagged for Step 5 (053 helper adoption). Route (`src/app/api/provider/jobs/quote/route.ts`) maps the two new reasons to `403`/`500`. `npx tsc --noEmit` and `npm run lint` both exit 0. **Not yet applied to Supabase — awaiting deploy.** |
| Migration 056 | **APPLIED & RUNTIME-VERIFIED IN PRODUCTION (July 13, 2026).** `056_grants_hotfix.sql` — EMERGENCY grants-only hotfix, unrelated to Phase 3 (Phase 3 Steps 3–5 renumbered to 057+, see next row). Confirmed two live gaps: `select_quote_atomic` (4× DROP+CREATE across migrations 040/045/047/048, none re-issued `REVOKE ALL FROM PUBLIC`) and `get_nearby_providers` (zero grant statements in its entire history). Normalizes grants across all 30 project-owned public-schema functions using live-OID-by-name resolution (no hardcoded argument types). Fail-closed default privileges close THREE combined mechanisms: (i) Postgres's built-in PUBLIC-execute default for functions (proven live via an in-transaction probe — closed by a GLOBAL, no-`IN SCHEMA`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, since schema-specific and global defaults are additive, not overriding, so only the global statement suppresses the built-in default); (ii) explicit default grants to `anon`/`authenticated` recorded in `pg_default_acl` for schema `public` (closed by the schema-scoped statement, kept alongside the global one for a different, additive reason); (iii) DROP+CREATE migrations resetting each function's own ACL to schema defaults on every rebuild (`select_quote_atomic` x4). Fully transactional (pre/postcondition guards + a `__acl_probe_056` fail-closed proof + global/schema default-ACL postcondition asserts via `aclexplode` + a byte-for-byte before/after storage-schema preservation check, abort-and-rollback on any mismatch). `is_admin()` keeps `anon` (live proof: `price_estimates` has an admin RLS policy with `roles={public}`, which Postgres evaluates for anonymous readers too — revoking `anon` would break the public `price_estimates` read). `is_service_role()` locked to owner-only (its only 2 call sites, `039_security_backstop.sql:52,85`, are inside `SECURITY DEFINER` triggers that execute as owner). **Schema drift discovered during this audit:** `expire_stale_open_requests` has no `CREATE FUNCTION` anywhere in `supabase/migrations/` (see `DEFERRED_PRODUCT_BACKLOG.md` P16). Grants-only: no function body/signature/owner/search_path changed. AGENTS.md updated with a standing "Function Grant Discipline" rule. **Production verification (July 13, 2026):** fail-closed probe passed (new functions born owner-only), all postconditions passed (global + schema default-ACL rows confirmed via `aclexplode`, storage-schema default ACL confirmed byte-for-byte unchanged), `anon` EXECUTE confirmed `false` on all 30 targets except `is_admin` (intentional), anonymous `price_estimates` page confirmed still loading correctly post-apply. Committed. |
| Next migration number | 057. Migration 056 is an emergency grants-only hotfix (row above), not part of Phase 3. Phase 3 Steps 3–5 (Items C–F: D4 monthly-limit + credit-consumption fix, D5 restoration + abuse controls, 053 helper adoption) are renumbered to 057+ per `TIERED_DISPATCH_051_ANALYSIS.md` and the approved Phase 3 detailed design. Named, mandatory follow-up: "Quote Reachability Parity" (GPS-staleness + radius/reachability parity between quote route and dashboard/053) — not yet scheduled to a migration number, must ship before Phase 3 is marked "server-side enforcement complete". A separate reconciliation migration is also needed to capture `expire_stale_open_requests`'s live definition into version control. |
| API phase (tiered dispatch activation) | **CODE COMPLETE — AWAITING DEPLOY (July 8, 2026).** Code-only, no new migration. `src/app/api/requests/route.ts`: GPS coordinates are now mandatory (422 `coordinates_required` on missing/invalid coords), the fixed Dubai-center fallback is removed, and `providers_in_range_at_creation`/`subscribers_in_range_at_creation` are now populated on every request via a single admin-client query against `provider_locations` + in-app distance filtering (falls back to `NULL` on query failure, by design). `src/app/customer/request/page.tsx`: GPS is required to continue, the address field is now an optional note decoupled from GPS, the manual-address-clears-coords behavior is removed. `messages/en.json` and `messages/ar.json` updated. `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Dashboard wiring (tiered visibility enforcement) | **CODE COMPLETE — AWAITING DEPLOY (July 9, 2026).** Code-only, no new migration. Removed the admin-client fallback query in `src/app/provider/dashboard/page.tsx` that bypassed migration 053's tier-delay gate whenever `get_nearby_open_requests` returned zero rows — root cause of a confirmed live bug (a PPJ provider saw a request 3m22s after creation despite a 6-minute tier delay). The RPC is now the dashboard's sole data source. `PROVIDER_RADIUS_METERS` (`src/types/index.ts`) changed from `5000` to `150000` to match the RPC's own default (migration 053's already-approved intent, previously deferred — confirmed as the RPC call's only caller). Added `visible_at` to the dashboard's local `NearbyOpenRequestRow` type (not yet consumed by UI). `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Stripe mode | TEST — live charges are not processed |
| PPJ status | Re-enabled via migration 045; in end-to-end testing |
| Fair price status | Validation active but bounds intentionally widened (migration 044 — LAUNCH BLOCKER) |
| Cloud migration verification | VERIFIED through 050 — 001–045 confirmed July 1, 2026; 046 applied with a defective `update_provider_rating` rewrite (`ratings.score` — real column is `stars`; broke all rating inserts with 42703); 048, 049, and 050 applied and runtime-verified July 5, 2026 (050 restores the original `stars` trigger body) |
| Launch readiness | NOT READY — multiple blockers active (see §6) |
| Last documented work session | July 13, 2026 (Migration 056 grants hotfix: APPLIED & runtime-verified in production — see Migration 056 row above) |

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

Cloud Supabase project has all 45 migrations applied in order (001–045). Verified July 1, 2026 — all 5 sentinel functions present, fair_price_config shows migration 044 values, request_quotes and provider_kyc_log tables confirmed, idx_jobs_en_route_at index applied.

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
| Total migrations | 50 — all applied to cloud (046 was applied defective, corrected by 050; 048/049/050 applied and runtime-verified July 5, 2026) |
| Latest applied (cloud) | `050_fix_update_provider_rating_stars_column.sql` |
| Next migration number | 051 (planned dispatch/visibility work numbers from 051+) |
| Cloud state | VERIFIED through 050 (July 5, 2026) — 046 was applied with a defective `update_provider_rating` (ratings 500 production bug); 047 applied manually; 048 (FOR UPDATE correction), 049 (cancel `selected_pending_payment`), and 050 (rating trigger fix, `score`→`stars`) all APPLIED and runtime-verified July 5, 2026 |

**Migrations 039–045 are the security and marketplace remediation batch.** All 50 migrations have been applied to the production Supabase project (001–045 verified July 1, 2026; 046–050 verified July 5, 2026).

Complete migration sequence: 001–050. For architectural meaning of each migration see [ARCHITECTURE.md §2].

---

## §4 Runtime Verification

The following table records the verification state of every significant implementation fix. "Code complete" means the fix exists in the repository. "Runtime verified" means it has been confirmed working in the production Supabase environment.

| Finding | Fix location | Code state | Runtime verification |
|---|---|---|---|
| C2 — users.role self-escalation | Migration 039 `enforce_users_immutable_columns` trigger | Code complete | VERIFIED — trigger confirmed in cloud pg_proc July 1, 2026 |
| C3 — providers sensitive-column self-write | Migration 039 `enforce_providers_immutable_columns` trigger | Code complete | VERIFIED — trigger confirmed in cloud pg_proc July 1, 2026 |
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
| P4-M1 — missing `en_route_at` index | Migration 043 `idx_jobs_en_route_at WHERE completed_at IS NULL` | Code complete | VERIFIED — index applied directly via SQL Editor July 1, 2026 |
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
| LB-2 | Cloud migration verification (migrations 039–045 applied to production?) — CLOSED July 1, 2026 | Critical | §6 LB-2 |
| LB-3 | C2/C3 runtime verification (immutable-column triggers active in cloud?) — CLOSED July 1, 2026 | Critical | §6 LB-3 |
| LB-4 | Stripe go-live switch (currently TEST mode) | Critical | §11 |
| LB-6 | H2 — Legacy accept route bypasses V2 marketplace for subscription providers — CODE COMPLETE July 2, 2026 | High | §7 H2 |
| LB-7 | H3 — No overage gate in `select_quote_atomic` — CLOSED; migration 047 applied, provider-row FOR UPDATE correction in migration 048 applied and runtime-verified July 5, 2026 | High | §7 H3 |
| LB-8 | P4-C1 — Thundering herd: provider Realtime broadcasts to all online providers | High | §13 |
| LB-9 | OG image / logo file extension gaps | Medium | §2 Deployment |
| LB-10 | P4-H3 — Weekly SLA reset is non-atomic — CLOSED, migration 047 applied to cloud | Medium | §13 |
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

### LB-2 — Cloud Migration Verification — CLOSED

**Status: CLOSED — runtime verified July 1, 2026. All 5 sentinel functions present (`enforce_users_immutable_columns`, `enforce_providers_immutable_columns`, `finalize_ppj_selection_atomic`, `expire_ppj_payment_selection_atomic`, `admin_update_provider_status_atomic`). `fair_price_config` shows migration 044 values. `request_quotes` table exists (25 rows). `provider_kyc_log` table exists (3 rows). `idx_jobs_en_route_at` index applied directly via SQL Editor (migration 043 was missing from cloud — index now present).**

---

### LB-3 — C2/C3 Runtime Verification — CLOSED

**Status: CLOSED — C2 and C3 triggers confirmed present in cloud: `enforce_users_immutable_columns` and `enforce_providers_immutable_columns` both returned by `pg_proc` query (July 1, 2026). Full smoke test (attempting role self-escalation) deferred — triggers confirmed present.**

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

**Status: CODE COMPLETE July 2, 2026.** `accept/route.ts` now returns 403 `V2_QUOTE_REQUIRED` for all subscription plans. PPJ guard still first, V2 guard second (unconditional). No DB writes possible via this route for any plan.

`POST /api/provider/requests/accept` allows subscription providers to accept `open` status requests directly, bypassing the marketplace V2 quote flow entirely. PPJ providers are correctly blocked (403 `PPJ_PAYMENT_REQUIRED`). Subscription providers are not blocked.

**Impact:** A subscription provider who is fast enough can accept an open request before any quotes are submitted, bypassing the customer's right to compare quotes.

**Required:** Either gate subscription providers behind V2 (accept only `selected_pending_payment` path) or add a flag/feature-gate to phase out the legacy flow. Owner decision required before implementation.

---

### LB-7 — H3: No Overage Gate in `select_quote_atomic` (HIGH)

**Status: CLOSED. Migration 047 APPLIED to cloud; provider-row FOR UPDATE correction in migration 048 APPLIED and runtime-verified (July 5, 2026).** Overage gate added to subscriber branch of `select_quote_atomic` in migration 047 (applied). Returns `overage_required` when the provider is at the plan limit and `overage_cleared` is false. Migration 047 was applied before the provider-row lock was added, so migration 048 recreates the function with `FOR UPDATE` on the provider row to prevent a TOCTOU race on `jobs_this_month`.

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

**Status: VERIFIED — trigger confirmed in cloud pg_proc July 1, 2026. Function `enforce_users_immutable_columns` present in production Supabase database.**

Migration 039 adds `enforce_users_immutable_columns` BEFORE UPDATE trigger. Any update to `users.role` by a non-admin, non-service-role caller raises SQLSTATE 42501. The RLS gap (no `WITH CHECK` on the policy) is intentionally patched via trigger rather than policy, because triggers have access to both OLD and NEW values needed for the comparison.

---

### C3 — providers Sensitive-Column Self-Write

**Status: VERIFIED — trigger confirmed in cloud pg_proc July 1, 2026. Function `enforce_providers_immutable_columns` present in production Supabase database.**

Migration 039 adds `enforce_providers_immutable_columns` BEFORE UPDATE trigger locking 19 columns including status, plan, verified_badge, rating, all Stripe fields, billing/allowance counters, and documents. See [ARCHITECTURE.md §8] for the protected column list.

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

**Status: CODE COMPLETE July 2, 2026.** See LB-6 for full description. Route now blocks all plans: PPJ via PPJ_PAYMENT_REQUIRED, subscribers via V2_QUOTE_REQUIRED.

`POST /api/provider/requests/accept` now returns 403 for all plans. Subscription providers are blocked by the new V2_QUOTE_REQUIRED guard. PPJ providers blocked by existing PPJ_PAYMENT_REQUIRED guard.

---

### H3 — V2 Overage Not Collected at Selection (OPEN LAUNCH BLOCKER)

**Status: CLOSED. Migration 047 APPLIED; migration 048 (provider-row FOR UPDATE) APPLIED and runtime-verified July 5, 2026.** See LB-7 for full description. Overage gate added to subscriber branch of select_quote_atomic in migration 047; provider-row lock correction in migration 048.

`select_quote_atomic` subscriber branch now checks jobs_this_month >= plan_limit before accepting. Returns overage_required if limit reached and overage_cleared is false. PPJ branch byte-for-byte unchanged from migration 045.

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
| Legacy accept route (`/api/provider/requests/accept`) | BLOCKED — all plans return 403 (PPJ: PPJ_PAYMENT_REQUIRED, subscribers: V2_QUOTE_REQUIRED) — LB-6 CODE COMPLETE July 2, 2026 |
| Overage gate on legacy accept | Operational — route pre-flight + RPC atomic guard both in place |
| Overage gate on V2 selection | CLOSED — migration 047 APPLIED; provider-row FOR UPDATE correction in migration 048 APPLIED and runtime-verified July 5, 2026 — LB-7 |
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
| Customer cancel during payment window | CLOSED — migration 049 (adds `selected_pending_payment` to cancellable statuses in `cancel_request_and_compensate_atomic`) applied and runtime-verified July 5, 2026; provider dashboard now realtime-refreshes on this cancellation and shows translated copy (SESSION_LOG July 5, 2026) |
| Duplicate-request guard during payment window | CODE COMPLETE — POST `/api/requests` now treats `selected_pending_payment` as active (matches GET); deployed with next Vercel build |

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

### Supabase Advisor — anon EXECUTE and function_search_path_mutable (Migration 046)

**Status: APPLIED to cloud (confirmed July 5, 2026) — but introduced a production regression, fixed by migration 050 (applied and runtime-verified July 5, 2026).**

Migration `046_revoke_anon_execute_and_fix_search_path.sql` addresses 44 Supabase Security Advisor warnings:

- **REVOKE EXECUTE FROM anon** (Category B — 2 remaining functions not yet covered by prior migrations): `expire_stale_open_requests(TIMESTAMPTZ)` and `get_nearby_providers(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TIMESTAMPTZ)`. All other Category B functions were already revoked in migrations 040, 041, and 045.
- **SET search_path = public** (Category C — 4 functions): `get_nearby_providers`, `reset_monthly_job_counters`, `update_provider_rating`, `check_provider_suspension`. Despite the migration's claim of "exact original bodies", the `update_provider_rating` rewrite was NOT identical — see regression below.

False positives (not touched): `st_estimatedextent` variants, `extension_in_public`, `enforce_users_immutable_columns`, `enforce_providers_immutable_columns`, `is_admin`, `rls_policy_always_true` on `payout_log`/`stripe_events`.

**Runtime verification:** After applying migration 046 in SQL Editor, rerun Supabase Security Advisor and confirm warning count drops by at least 6 (2 anon-execute + 4 search_path warnings).

---

### Migration 050 — Rating Trigger Regression Fix (046 `score` → `stars`)

**Status: CLOSED — migration 050 APPLIED and runtime-verified in Supabase July 5, 2026.**

Migration 046's rewrite of `update_provider_rating` was defective: its body reads `ratings.score`, a column that does not exist — the real column is `stars` (migration 001). PL/pgSQL does not validate column references at CREATE time, so 046 applied cleanly; the failure only surfaces at runtime. Confirmed live in production July 5, 2026: `pg_proc.prosrc` contains `score`, and every `INSERT INTO ratings` fails inside the AFTER INSERT trigger with Postgres error 42703 (`column "score" does not exist`), returned to the customer as a generic 500 from `POST /api/ratings` (log event `rating_submit_failed`).

Migration `050_fix_update_provider_rating_stars_column.sql` restores the original migration 001 trigger body — `ROUND(AVG(stars)::NUMERIC, 2)` over the last 50 ratings by `created_at DESC` — keeping only the legitimate 046 addition: `SET search_path = public`. The trigger binding is untouched; no other function, table, policy, or grant is modified. Diff-verified: function body between `BEGIN` and `END;` is byte-identical to migration 001.

**Runtime verification: DONE July 5, 2026** — 050 applied in SQL Editor; UI rating submission succeeded (`rating_submitted`), `providers.rating` recomputed from `ratings.stars`.

---

### P4-H3 — Weekly SLA Reset Non-Atomic

**Status: CLOSED, migration 047 applied to cloud.** `weekly-sla-reset/route.ts` now calls `weekly_sla_reset_atomic()` RPC (migration 047). Both UPDATE statements execute atomically inside the RPC. LIMIT 500 prevents unbounded fetch. No direct UPDATE statements remain in the route.
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
