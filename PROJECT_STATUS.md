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
| Migration baseline | **VERIFIED — 054 confirmed APPLIED in production (July 12, 2026). Migration 056 confirmed APPLIED & RUNTIME-VERIFIED in production (July 13, 2026, grants-only, independent in scope of 054/055).** Migration 055's cloud-application status is **UNVERIFIED this session** — last recorded status (July 12, 2026) was CODE COMPLETE / NOT YET APPLIED, and no subsequent session recorded runtime verification of 055. Because 056 is grants-only and independent of 055's `submit_quote_atomic` body change, 056 being applied does NOT confirm 055 was applied. **Action required: confirm live via `pg_get_functiondef('public.submit_quote_atomic(...)'::regprocedure)` whether the tier-delay gate (Step 2b) is present in the live function body before treating 055 as applied.** |
| Latest deployed commit | `1556059` ("chore: remove temporary cron auth diagnostics"), pushed to `origin/main` and confirmed via `git push` output July 15, 2026. Preceded by `af23f35` (temporary diagnostics added) and `facc407` (migration 056 hotfix). Vercel auto-deploys from `main`; this session had no Vercel API/dashboard access to confirm the Production deployment picked up `1556059` — confirm in the Vercel dashboard. |
| Migration 051 | **APPLIED & RUNTIME-VERIFIED (July 8, 2026).** `051_dispatch_foundation_schema.sql` — Tiered Dispatch Phase 1 (schema foundation only, no RPC/trigger/lifecycle/realtime/API/pricing changes). Adds `requests.providers_in_range_at_creation` (raw snapshot count, D1/R1), `requests.destination_emirate` (nullable TEXT + CHECK on the 7 UAE emirates, R6), `request_quotes.refunded_at` (D5 refund marker + partial index), and the new `get_provider_limits(plan)` SSOT function (R5, live-behavior-parity values from migrations 039/047, zero callers yet). `npx tsc --noEmit` and `npm run lint` both exit 0. Verified directly in the Supabase SQL Editor: both new `requests` columns exist, `request_quotes.refunded_at` and its partial index exist, `get_provider_limits()` exists and returns the verified live-parity values for all four plans. |
| Migration 052 | **APPLIED & RUNTIME-VERIFIED (July 8, 2026).** `052_subscriber_count_snapshot.sql` — closes a Phase 1 gap left by 051: adds `requests.subscribers_in_range_at_creation` (raw count of online subscribers within 150km at creation; NULL = pre-052 row, 0 = zero-subscriber fallback). Distinguishes "N providers, some subscribers" from "N providers, all PPJ" — same `providers_in_range_at_creation` count, opposite dispatch behavior. Schema only, no other objects touched. `npx tsc --noEmit` and `npm run lint` both exit 0. Verified directly in the Supabase SQL Editor: column exists with type INTEGER, its `COMMENT` is present, no other schema objects changed. |
| Migration 053 | **CODE COMPLETE — NOT YET APPLIED.** `053_tiered_visibility_rpc.sql` — Tiered Dispatch Phase 2: redesigns `get_nearby_open_requests` (D1/D2 tier-delay visibility, R1 frozen `<10`-provider uncapped-radius expansion, R3 elapsed-time-from-`created_at`, Q5 `visibility_reduced` +5min, new `visible_at` return column). Drops and recreates the function (return-type change) with the exact live grants (`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`, verified against 039 before writing — no separate `anon` revoke exists for this function). Radius default changed 5000→150000; the sole caller (`src/app/provider/dashboard/page.tsx:430`) passes `p_radius` explicitly, so this has no live effect until that constant is updated in a later (Phase 6) change. `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Migration 054 | **APPLIED & RUNTIME-VERIFIED IN PRODUCTION (July 12, 2026).** `054_phase3_step1_ssot_and_d5_infra.sql` — Phase 3 Step 1 (silent infrastructure only, per the GPT-reviewed revised sequencing: zero-live-impact first). Adds `idx_request_quotes_provider_refunded_at` (D5 pair-cap query index — opposite predicate of 051's daily-unrefunded index) and `get_customer_abuse_limits()` (new D-SSOT for D-Create/D-Cancel/D-Restore thresholds, mirrors `get_provider_limits`' shape/grants, zero callers yet). No schema change to `request_quotes.selected_at` — verified it already exists since migration 031 and is reused as-is. Verified live: `get_customer_abuse_limits()` returns `5\|15\|5\|15\|2\|5\|15\|3`, the pair-cap index exists with the correct `WHERE refunded_at IS NOT NULL` predicate, grants are `service_role`-only (plus the expected `postgres` owner role). Not called by any existing RPC or route. **Known gap, NOT implemented by this migration:** the approved D-Restore rule's 4th-qualifying-event abuse-review persistence (the 4th restoration for the same (customer, provider) pair within 24h must be logged/flagged for review, not silently denied) has no tracking mechanism yet — no table, no log write. Intentionally deferred to Item E and is a **HARD PREREQUISITE**: D5 restoration enforcement must not go live until this review-flagging mechanism exists and is wired in alongside it. |
| Migration 055 | **CODE COMPLETE — NOT YET APPLIED (July 12, 2026).** `055_phase3_step2_visibility_delay_gate.sql` — Phase 3 Step 2 (Items A+B): live-verified against production (`pg_get_functiondef`/`information_schema.routine_privileges` confirmed the live `submit_quote_atomic` body is identical to migration 039's, grants are `service_role` + owner-only). Adds `compute_request_visibility_delay()` — a shared, additive STABLE helper extracting 053's tier-delay math (D1/D2/Q5), with a corrected legacy short-circuit (`providers_in_range_at_creation IS NULL THEN 0`) that fixes a confirmed live defect in 053 (legacy rows with `visibility_reduced=true` incorrectly got a 5-minute penalty; the helper does not carry this bug into the write path). `submit_quote_atomic` gets one new Step 2b (tier-delay gate, returns `visibility_window_not_open` before the window opens or `visibility_calc_failed` on computation error) inserted between the existing Step 2 and Step 3 — every other step preserved byte-identical to the live body. Grants preserved exactly (`REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT EXECUTE TO service_role`). Scope (binding, Option A): tier-delay authorization only — does NOT enforce GPS-freshness or radius/reachability; "Can Quote" matches "Can See" for tier timing only, not full eligibility parity. `053` is intentionally untouched — its legacy-penalty bug stays flagged for Step 5 (053 helper adoption). Route (`src/app/api/provider/jobs/quote/route.ts`) maps the two new reasons to `403`/`500`. `npx tsc --noEmit` and `npm run lint` both exit 0. **Not yet applied to Supabase — awaiting deploy.** |
| Migration 057 | **CODE COMPLETE — NOT YET APPLIED (July 16, 2026).** `057_phase3_step3_credit_consumption_ssot.sql` — Phase 3 Step 3 (Items C+D). Live-verified first: `select_quote_atomic`'s live body was diffed in full against migration 048 (no drift found) before writing this file; `submit_quote_atomic`'s live body was confirmed (prior session) to match migration 055. `select_quote_atomic` gets `get_provider_limits()` SSOT wiring (replacing the hardcoded 15/35/unlimited CASE) plus the approved 4-case credit-consumption gate: under limit → allow, no credit consumed; at/over limit + `overage_cleared=FALSE` + credit available → consume exactly one credit (column-relative `UPDATE`, under the existing provider-row `FOR UPDATE` lock) then proceed; at/over limit + `overage_cleared=TRUE` → allow, no credit consumed; at/over limit + no credit → unchanged `overage_required` result. `jobs_this_month` increments unconditionally on every successful subscriber selection (unchanged). `submit_quote_atomic` gets SSOT wiring ONLY (Step 4's two hardcoded CASE blocks replaced by one `get_provider_limits()` call) — no new steps, no exhaustion logic, contract fully unchanged. The exhaustion warning is implemented entirely in the application layer (`src/app/api/provider/jobs/quote/route.ts`, additive best-effort `warning_code: 'monthly_allowance_exhausted'`, never turns a successful quote into an error) — submission blocking was explicitly NOT implemented (see `DEFERRED_PRODUCT_BACKLOG.md` P19: the pre-submission overage-payment path is dead code in the live V2 UI, see LB-6). Also fixes `src/lib/provider-allowance.ts`'s `effectiveLimit` double-counting bug (dropped; `remaining = max(0, planLimit - jobsThisMonth) + creditBalance`) and its 3 consumers (`plan/page.tsx`, `overage-checkout/route.ts`; dashboard page needed no change), adds the missing `overage_required` → 409 mapping in `src/app/api/customer/quote/select/route.ts` (previously fell through to a generic 500), and adds client-side `unavailableQuoteIds` filtering in `CustomerQuoteList.tsx` (Option A: pending quote rows are left in the DB, so the quotes API keeps returning them — hidden client-side for the mounted view's lifetime). Grants restated exactly (`REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT EXECUTE TO service_role`) via `CREATE OR REPLACE` (signatures unchanged, no DROP). New i18n keys added to both `messages/ar.json` and `messages/en.json` (`providerRequestList.monthlyAllowanceExhausted`, `customerQuoteList.providerNoLongerAvailable`). **Not yet applied to Supabase — awaiting deploy and Medo's production verification (function-body diff + grants query + behavioral scenarios).** |
| Migration 056 | **APPLIED & RUNTIME-VERIFIED IN PRODUCTION (July 13, 2026).** `056_grants_hotfix.sql` — EMERGENCY grants-only hotfix, unrelated to Phase 3 (Phase 3 Steps 3–5 renumbered to 057+, see next row). Confirmed two live gaps: `select_quote_atomic` (4× DROP+CREATE across migrations 040/045/047/048, none re-issued `REVOKE ALL FROM PUBLIC`) and `get_nearby_providers` (zero grant statements in its entire history). Normalizes grants across all 30 project-owned public-schema functions using live-OID-by-name resolution (no hardcoded argument types). Fail-closed default privileges close THREE combined mechanisms: (i) Postgres's built-in PUBLIC-execute default for functions (proven live via an in-transaction probe — closed by a GLOBAL, no-`IN SCHEMA`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, since schema-specific and global defaults are additive, not overriding, so only the global statement suppresses the built-in default); (ii) explicit default grants to `anon`/`authenticated` recorded in `pg_default_acl` for schema `public` (closed by the schema-scoped statement, kept alongside the global one for a different, additive reason); (iii) DROP+CREATE migrations resetting each function's own ACL to schema defaults on every rebuild (`select_quote_atomic` x4). Fully transactional (pre/postcondition guards + a `__acl_probe_056` fail-closed proof + global/schema default-ACL postcondition asserts via `aclexplode` + a byte-for-byte before/after storage-schema preservation check, abort-and-rollback on any mismatch). `is_admin()` keeps `anon` (live proof: `price_estimates` has an admin RLS policy with `roles={public}`, which Postgres evaluates for anonymous readers too — revoking `anon` would break the public `price_estimates` read). `is_service_role()` locked to owner-only (its only 2 call sites, `039_security_backstop.sql:52,85`, are inside `SECURITY DEFINER` triggers that execute as owner). **Schema drift discovered during this audit:** `expire_stale_open_requests` has no `CREATE FUNCTION` anywhere in `supabase/migrations/` (see `DEFERRED_PRODUCT_BACKLOG.md` P16). Grants-only: no function body/signature/owner/search_path changed. AGENTS.md updated with a standing "Function Grant Discipline" rule. **Production verification (July 13, 2026):** fail-closed probe passed (new functions born owner-only), all postconditions passed (global + schema default-ACL rows confirmed via `aclexplode`, storage-schema default ACL confirmed byte-for-byte unchanged), `anon` EXECUTE confirmed `false` on all 30 targets except `is_admin` (intentional), anonymous `price_estimates` page confirmed still loading correctly post-apply. Committed. |
| Next migration number | 058. Migration 057 (row above) is CODE COMPLETE — NOT YET APPLIED and covers Phase 3 Step 3 (Items C+D: D4 monthly-limit + credit-consumption fix) only. Migration 056 was an emergency grants-only hotfix, not part of Phase 3. Phase 3 Steps 4–5 (Item D5 restoration + abuse controls, 053 helper adoption) remain not yet written and are renumbered to 058+ per `TIERED_DISPATCH_051_ANALYSIS.md`. Named, mandatory follow-up: "Quote Reachability Parity" (GPS-staleness + radius/reachability parity between quote route and dashboard/053) — not yet scheduled to a migration number, must ship before Phase 3 is marked "server-side enforcement complete". A separate reconciliation migration is also needed to capture `expire_stale_open_requests`'s live definition into version control. |
| API phase (tiered dispatch activation) | **CODE COMPLETE — AWAITING DEPLOY (July 8, 2026).** Code-only, no new migration. `src/app/api/requests/route.ts`: GPS coordinates are now mandatory (422 `coordinates_required` on missing/invalid coords), the fixed Dubai-center fallback is removed, and `providers_in_range_at_creation`/`subscribers_in_range_at_creation` are now populated on every request via a single admin-client query against `provider_locations` + in-app distance filtering (falls back to `NULL` on query failure, by design). `src/app/customer/request/page.tsx`: GPS is required to continue, the address field is now an optional note decoupled from GPS, the manual-address-clears-coords behavior is removed. `messages/en.json` and `messages/ar.json` updated. `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Dashboard wiring (tiered visibility enforcement) | **CODE COMPLETE — AWAITING DEPLOY (July 9, 2026).** Code-only, no new migration. Removed the admin-client fallback query in `src/app/provider/dashboard/page.tsx` that bypassed migration 053's tier-delay gate whenever `get_nearby_open_requests` returned zero rows — root cause of a confirmed live bug (a PPJ provider saw a request 3m22s after creation despite a 6-minute tier delay). The RPC is now the dashboard's sole data source. `PROVIDER_RADIUS_METERS` (`src/types/index.ts`) changed from `5000` to `150000` to match the RPC's own default (migration 053's already-approved intent, previously deferred — confirmed as the RPC call's only caller). Added `visible_at` to the dashboard's local `NearbyOpenRequestRow` type (not yet consumed by UI). `npx tsc --noEmit` and `npm run lint` both exit 0. |
| Stripe mode | TEST — live charges are not processed |
| PPJ status | Re-enabled via migration 045; in end-to-end testing |
| Fair price status | Validation active but bounds intentionally widened (migration 044 — LAUNCH BLOCKER) |
| Cloud migration verification | VERIFIED through 050 — 001–045 confirmed July 1, 2026; 046 applied with a defective `update_provider_rating` rewrite (`ratings.score` — real column is `stars`; broke all rating inserts with 42703); 048, 049, and 050 applied and runtime-verified July 5, 2026 (050 restores the original `stars` trigger body) |
| Launch readiness | NOT READY — see §6 for remaining active blockers. The previously open disappearing-quoted-request bug (LB-13) is now CLOSED per a new binding decision — see below and §15. |
| Cron auth incident (401s, missing Vercel `CRON_SECRET`) | **CLOSED July 15, 2026.** See §12 for full symptom/root-cause/fix/verification record. |
| Disappearing quoted-request bug | **CLOSED July 15, 2026 — works as designed, per newly approved binding decision.** The `quoted_at` + 20-minute expiry rule (set once by the first quote, never refreshed by later quotes) is now the official APPROVED launch rule (Medo, July 15, 2026), confirmed by a live production test (request `b61b8e4f-a8ac-409a-bac3-28f9d085a56c`). The previously observed indefinite trapped/zombie symptom was already eliminated by the marketplace-cron auth fix (§12) — the request now reliably transitions to `expired` instead of staying stuck. See LB-13 (§6) and §14/§15. |
| Last documented work session | July 15, 2026 (binding expiry-rule decision recorded; PPJ quote-display investigation closed per live production test; read-only Phase 3 readiness audit performed — see §6 and pending Medo's review) |

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
| Total migrations | 56 files exist in `supabase/migrations/` (001–056). No 057+ files exist yet — Phase 3 Steps 3–5 (credit logic) will start at 057. |
| Latest applied (cloud) | **VERIFIED: 054** (`054_phase3_step1_ssot_and_d5_infra.sql`, applied & runtime-verified July 12, 2026) and **VERIFIED: 056** (`056_grants_hotfix.sql`, applied & runtime-verified July 13, 2026, grants-only, independent of 055). **UNVERIFIED: 053 and 055** — both are documented elsewhere as "code complete, not yet applied," but later session narratives (July 9 dashboard-wiring work assuming `get_nearby_open_requests` — migration 053 — was already callable in production) are inconsistent with "not applied." This inconsistency was NOT resolved this session (no direct Supabase access was used) and must be checked live before either is treated as applied or unapplied. |
| Next migration number | **057** (Phase 3 Steps 3–5 credit logic, per `TIERED_DISPATCH_051_ANALYSIS.md`) |
| Cloud state | Confirmed via explicit session verification: 001–050 (July 1 / July 5, 2026), 051–052 (July 8, 2026, corrected same day), 054 (July 12, 2026), 056 (July 13, 2026). **NOT independently reverified this session: 053, 055** — recommended check before next session relies on either: run `pg_get_functiondef('public.get_nearby_open_requests(...)'::regprocedure)` (053) and `pg_get_functiondef('public.submit_quote_atomic(...)'::regprocedure)` (055, look for the Step 2b tier-delay gate) directly against production. |

**Correction note (July 15, 2026):** Prior versions of this document stated migrations 053/055 were "not yet applied." This session did not gain new evidence either confirming or refuting that — it is carried forward as UNVERIFIED, not as a fact, per the verify-first rule. Do not assume either status without a live check.


**Migrations 039–045 are the security and marketplace remediation batch. Migrations 051–056 are the Tiered Dispatch batch** (051 dispatch-foundation schema, 052 subscriber-count snapshot, 053 tiered visibility RPC, 054 Phase 3 Step 1 SSOT + D5 infra, 055 Phase 3 Step 2 visibility-delay gate in `submit_quote_atomic`, 056 grants hotfix). 001–045 verified July 1, 2026; 046–050 verified July 5, 2026; 051–052 verified July 8, 2026; 054 verified July 12, 2026; 056 verified July 13, 2026. **053 and 055 have no independent post-write verification recorded — see correction note above.**

Complete migration sequence: 001–056. For architectural meaning of each migration see [ARCHITECTURE.md §2] (§2 table currently lists 001–056 — updated July 15, 2026, see that file for the 046–056 additions).

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

**Priority order (set July 15, 2026, per current session):**
1. **LB-12 — Phase 3 credit logic** (Steps 3–5, migrations 057+, per `TIERED_DISPATCH_051_ANALYSIS.md`) — blocks subscriber quote-limit/credit correctness at launch scale.
2. **LB-1 — Fair price formula redesign** (two-leg distance + emirate destination) — fair-price enforcement is currently defeated by migration 044's widened bounds.
3. **LB-4 — Stripe live keys + env vars** — no real payments can be collected until swapped.
4. All remaining open items below (LB-8, LB-9, LB-11), in table order.

**LB-13 is CLOSED** (July 15, 2026, works as designed per the newly approved binding decision — see §6 LB-13 and §15) — removed from the active priority list.

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
| LB-12 | **NEW** — Phase 3 credit logic (Steps 3–5: D4 monthly-limit/credit-consumption fix, D5 restoration + abuse controls, 053-helper adoption), migrations 057+ not yet written | Critical | `TIERED_DISPATCH_051_ANALYSIS.md`, §6 LB-12 |
| LB-13 | Disappearing quoted-request bug — **CLOSED July 15, 2026**, works as designed per the approved `quoted_at` + 20-minute expiry rule (binding decision, §15) | Closed | §6 LB-13 |
| LB-14 | **NEW** — Mandatory-rating lock vs. new-request visibility: code confirms a new active request can be created (POST has no unrated-job check) and, once created, is unconditionally masked by GET while any unrated completed job exists for that customer. Not reachable via the intended single-page UI flow; reachable via a direct API call to `POST /api/requests`. Classification pending Medo. | Pending classification | §6 LB-14 |

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

### LB-12 — Phase 3 Credit Logic (Steps 3–5) — PARTIALLY DONE (Step 3 code complete, July 16, 2026)

**Status:** PARTIALLY DONE. Step 3 (Items C+D) is CODE COMPLETE — NOT YET APPLIED (migration 057, see §1). Steps 4–5 not yet started. Launch blocker until applied and production-verified.

Per `TIERED_DISPATCH_051_ANALYSIS.md`, Tiered Dispatch Phase 3 has three steps done or code-complete (Step 1 = SSOT functions, migration 054, applied July 12, 2026; Step 2 = visibility-delay gate in `submit_quote_atomic`, migration 055, code complete but cloud-application status UNVERIFIED — see §1; Step 3 = credit-consumption fix in `select_quote_atomic` + SSOT wiring in `submit_quote_atomic`, migration 057, code complete, NOT YET APPLIED — see §1). Steps 4–5 (Items D5/F in the analysis doc) remain **not yet written**:
- D4 — monthly-limit / credit-consumption enforcement fix. **DONE (code complete, migration 057):** `select_quote_atomic` now sources `monthly_limit` from `get_provider_limits()` and consumes exactly one `job_credit_balance` credit at selection time, only after the base monthly limit is reached and only when the request's `overage_cleared` is not TRUE.
- D5 — subscriber-limit restoration + abuse controls. Still OUT OF SCOPE — blocked on Item E's abuse-review persistence mechanism (see migration 054's header).
- Adoption of the migration-053 visibility helper across remaining call sites. Not started.
- The pre-existing bug noted in `TIERED_DISPATCH_051_ANALYSIS.md` (`select_quote_atomic` ignores `job_credit_balance`) is now FIXED by migration 057 (pending apply). The mirrored application-layer double-counting bug in `src/lib/provider-allowance.ts` (`effectiveLimit = planLimit + creditBalance`) is also fixed in the same change (see §1, Migration 057 row).
- Submission-time blocking on exhaustion was investigated and explicitly NOT implemented — the pre-submission overage-payment path is dead code in the live V2 marketplace UI (LB-6 removed the only trigger). See `DEFERRED_PRODUCT_BACKLOG.md` P19.

These remaining items (D5, 053 helper adoption) will be written as migrations 058+. No code exists for them yet.

**Impact if launched as-is (before 057 is applied):** Subscriber daily quote limits (5/10/20/3, live since migration 039) are not uniformly enforced against the new SSOT, and job-credit consumption/restoration logic tied to tiered dispatch is incomplete. Once 057 is applied, the credit-consumption gap closes; D5 restoration and abuse controls remain deferred by design (out of scope, per binding decision).

**Required:** Apply migration 057 and complete the production verification checklist in the accompanying implementation notes (function-body diff, grants query, behavioral scenarios) before treating Step 3 as done. Design and implement migrations 058+ for Steps 4–5 per the approved plan in `TIERED_DISPATCH_051_ANALYSIS.md`, following the same verify-first-against-production discipline used for 051–057.

---

### LB-13 — Disappearing Quoted-Request Bug — CLOSED, works as designed (July 15, 2026)

**Status: CLOSED.** The root cause diagnosed across multiple prior read-only sessions is unchanged in the code, but the underlying `quoted_at` + 20-minute expiry rule it depends on is now a formally APPROVED binding decision for launch (Medo, July 15, 2026) — see §15. This is not a code fix; it is a product decision that the previously observed symptom is acceptable/expected behavior once cron execution is healthy.

**Symptom (as originally observed):** A customer's active `quoted` request appeared to disappear from their dashboard after a provider submitted a second/later quote on it.

**Root cause (confirmed in code, unchanged):**
1. `src/app/api/requests/route.ts` (GET handler, ~lines 161–169): masks `activeRequest` from the response when `status === 'quoted'` and `quoted_at` is more than 20 minutes old (or null).
2. `submit_quote_atomic` (migration 039/055): `quoted_at = now()` is written only on the very first quote (`v_is_first_quote`); it is never refreshed by subsequent quotes on the same request.
3. `src/app/api/ops/marketplace-cron/route.ts` `expireUnselectedRequests`: expires `quoted` requests using the same `quoted_at` + 20-minute cutoff, consistent with (1).

**BINDING DECISION (Medo, July 15, 2026):** The current production behavior — `quoted_at` + 20 minutes, set once, never refreshed — is APPROVED for launch. Confirmed by a live production test on request `b61b8e4f-a8ac-409a-bac3-28f9d085a56c`. The previously observed *indefinite trapped/zombie* symptom (request never expiring, staying stuck masked forever) has been eliminated as a side effect of the cron-auth incident closure (§12) — the marketplace-cron `expireUnselectedRequests` job now runs reliably every minute in production, so a masked request reliably transitions to `expired` within the 20-minute window instead of remaining stuck indefinitely. With cron execution healthy, the remaining behavior (a quoted request becomes unavailable/expired 20 minutes after the *first* quote, even if later quotes arrive) is accepted as the launch rule, not treated as a bug.

**Superseded proposal:** The previously discussed "bounded sliding selection window" redesign (`selection_expiry = MIN(latest_valid_quote_time + selection_window, created_at + max_request_lifetime)`) is DEFERRED, not rejected — see `DEFERRED_PRODUCT_BACKLOG.md` and §14. It will only be evaluated post-launch if real usage data shows customers losing valid quotes to expiry or a high re-request rate after expiry.

**Not re-verified this session:** No new code change was made to `requests/route.ts`, `submit_quote_atomic`, or `marketplace-cron/route.ts` — the closure is a product-decision closure, not a code-verification closure. If the underlying code changes in a future session, this closure must be re-evaluated against the new code.

---

### Closed Investigation — PPJ Quote Display (July 15, 2026)

**Status: CLOSED.** Per Medo's live production test: the database contained both submitted quotes, `GET /api/requests/quotes` returned both, and the customer page displayed both. No independent quote-display defect exists. This closes the "PPJ quote missing from customer page" investigation opened in a prior session (previously recorded as UNVERIFIED, pending a runtime test).

**Confirmed expected behavior (not a bug):** The PPJ provider's immediate visibility of the request in that same test is the approved zero-subscriber fallback (`providers_in_range_at_creation = 0`, `subscribers_in_range_at_creation = 0` at request creation) — per the Tiered Dispatch design (`TIERED_DISPATCH_051_ANALYSIS.md`), a zero-subscriber request bypasses tier-delay entirely so a PPJ provider can quote immediately. This is intentional, documented behavior, not a defect.

**Open low-priority UX item (not a launch blocker):** the customer page shows "location not recorded" copy even though exact + fuzzy coordinates exist on the request, because `location_address` is NULL. This is misleading copy, not data loss — tracked as a new item in `DEFERRED_PRODUCT_BACKLOG.md`.

---

### LB-14 — Mandatory-rating lock vs. new-request visibility (read-only, classification pending Medo, July 15, 2026)

**Status: OPEN, classification pending.** Read-only, evidence-based trace. No fix implemented.

**Only one request-creation path exists.** Confirmed via a repo-wide search for `.from('requests')...insert(...)` with a `customer_id` field: exactly one call site, `src/app/api/requests/route.ts` (POST handler). No RPC-based creation function (e.g. `create_request_atomic`) exists in any migration. This is the sole technical surface for this trace.

**POST guard (`src/app/api/requests/route.ts:291-323`) — exact conditions:**
```ts
.from('requests').select('id, status').eq('customer_id', user.id)
.in('status', ['open','quoted','selected_pending_payment','accepted','en_route','arrived','in_progress'])
```
If a row matches, POST returns 409. **This guard has zero reference to `jobs.completed_at`, `ratings`, or any unrated-job condition.** It is identical in scope to the GET handler's active-request status list (by design, per its own comment) — but the rating lock itself is enforced only in GET (`route.ts:185-206`), never in POST.

**GET handler (`route.ts:185-206`) — the lock:** if the customer has any completed job without a matching row in `ratings`, GET returns `completed_unrated_request: {...}, active_request: null` unconditionally — even if a genuinely separate, active request also exists for that customer at that moment.

**Trace result, by path:**
| Path | While an unrated completed job exists |
|---|---|
| `POST /api/requests` (the only creation path) | **Allowed**, unconditionally, as long as no OTHER request is currently in the 7-status active list. The unrated job itself never blocks creation. |
| Any other creation path | **None exists** — no other path to check. |

**Can a request created before completion coexist with a later rating lock?** Traced precisely: **no legitimate ordering exists for this through the intended UI**, because (1) the duplicate-guard's active-status list means a customer can only ever have one request in an active status at a time, and (2) the moment that request transitions to `completed`, the resulting job is *immediately* unrated (there is no grace period) — so by the time a customer could create a second request (i.e., once the first leaves the active-status list), the rating lock has already engaged. The `/customer/request` page (`src/app/customer/request/page.tsx:530`) is the sole UI surface for request creation, and its render logic makes the create-request form (steps 1–3) mutually exclusive with the rating-lock screen — the form is never rendered while `completed_unrated_request` is set, so the customer cannot submit a new request through this page while locked. A live realtime subscription (`page.tsx:207-230`) also proactively refreshes state the instant the tracked request completes, closing this window quickly for an open, connected tab.

**However, coexistence IS reachable via a direct API call**, because the POST guard has no rating-check at all: a raw `POST /api/requests` call (curl/Postman/devtools/any alternate client) issued after the prior request completes — bypassing the page's rating-lock render entirely — succeeds unconditionally. Once that second request exists, every subsequent `GET /api/requests` call (from any tab/session) will mask it: `active_request: null`, `completed_unrated_request: {...}` — the new, genuinely active (and potentially paid/assigned) request becomes invisible on the customer's only dashboard view until the old job is rated, with no time limit and no cron/reminder path.

**Separation of reachability:**
- **Technical reachability:** YES — confirmed by code; the write path (POST) enforces no rating-related check at all.
- **Intended-UI reachability:** NO — the single-page, single-flow, realtime-connected UI cannot produce the coexistence; the create-form and the lock screen are mutually exclusive renders, and the lock engages at the same instant the prior request's active-status window closes.
- **Direct-API reachability:** YES — confirmed; nothing prevents a non-UI client from creating the second request while the lock would otherwise apply on the UI.
- **Business severity:** the gap is real but not exploitable through the official web UI alone under normal single-session use; it is a genuine defense-in-depth gap (the business rule "no new request while a rating is owed" is enforced only in the read/display layer, not the write/creation layer), so any future client, retry, admin action, or bug elsewhere touching this flow could reproduce it and silently strand an active request from its owner indefinitely.

**Which position the code supports:** neither position alone is complete. Position A is correct about intended-UI-flow reachability (blocked). Position B is correct that the guard is architecturally incomplete and reachable via direct API — this is a real, code-confirmed gap, not merely theoretical, even though the standard UI path is closed. Classification (watch item vs. pre-launch requirement to add a matching check in POST) is Medo's decision — no fix implemented.

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
| `OPS_CRON_SECRET` | Required in production — `env.ts` throws at startup if missing or < 32 chars in `production` NODE_ENV. **VERIFIED July 15, 2026 — confirmed present and working** (see §12 cron incident closure). |
| `CRON_SECRET` (Vercel-managed) | **VERIFIED July 15, 2026 — added to Vercel env by owner and confirmed working in production** (`/api/ops/marketplace-cron` returns 200, `event=marketplace_cron_complete`, `critical_failure=false`). Code has honored this variable (subject to a ≥32-char minimum) since commit `0d97b15` (2026-06-05); it was not present as a Vercel env value in production until July 14–15, 2026 — see §12. |

---

## §12 Operations

All operational findings from Phase 2 Security Audit 4 (P4-H4, P4-M1, P4-M2, P4-L4) are resolved in the current codebase.

### Cron Auth Incident (401s, missing Vercel `CRON_SECRET`) — CLOSED July 15, 2026

**Symptoms:** `/api/ops/marketplace-cron` (and other `/api/ops/*` routes) returned 401 Unauthorized. Logs showed `has_bearer=false` and `has_ops_header=false` on the automated Vercel-scheduled invocations, despite `OPS_CRON_SECRET` having been configured in Vercel for months.

**Root cause (confirmed via `git log --follow` / `git show` on `src/lib/ops-auth.ts`):**
- `src/lib/ops-auth.ts` was created 2026-05-25 (`15a9aa0`) supporting **only** `OPS_CRON_SECRET` (via `Authorization: Bearer` or `x-ops-secret` header) — no Vercel-native awareness.
- Support for Vercel's own `process.env.CRON_SECRET` was added 11 days later, 2026-06-05 (`0d97b15`), as an OR'd `isVercelCron` branch.
- `marketplace-cron`'s route and its `vercel.json` schedule were created later still, 2026-06-09 (`22b6bc5`) — after `isVercelCron` support already existed in code.
- `SETUP.md` §9/§11 (lines ~360–453) documents `OPS_CRON_SECRET` as the **manual/dev `curl`-testing credential**, with Vercel's own `CRON_SECRET` as the intended automated-production path — and states (line 379) that Vercel auto-provisions `CRON_SECRET` on Pro/Enterprise plans. That auto-provisioning assumption was never independently verified against this project's actual plan/deployment.
- The owner confirmed `CRON_SECRET` was only added to the Vercel project's environment on 2026-07-14 — meaning `process.env.CRON_SECRET` was very likely `undefined` in production for the ~5-week window between `marketplace-cron`'s creation and that date, so every automated Vercel-scheduled invocation in that window received a 401 (`isVercelCron` always false). No evidence of any external scheduler (cron-job.org, EasyCron, GitHub Actions) sending `OPS_CRON_SECRET`/`x-ops-secret` was found anywhere in git history or docs (repo-wide search returned zero matches beyond `SETUP.md`'s own manual-testing examples).
- Conclusion: the automated cron most likely never authenticated successfully until `CRON_SECRET` was added on 2026-07-14 — there is no evidence of a previously-working external caller that later disappeared.

**Fix:** Owner added `CRON_SECRET` to the Vercel project environment (2026-07-14, outside this repo). To help confirm the fix in production without risking a permanent change, a clearly labeled `TEMP-DIAGNOSTIC` block (additive fields on the existing `logger.warn` unauthorized-request log — no change to the `isVercelCron`/`isOpsSecret` authorization conditions or the 401 response) was added to `src/lib/ops-auth.ts` in commit `af23f35` (2026-07-14/15), verified with `tsc --noEmit` and `eslint` (both exit 0), and pushed to `main`.

**Production verification (owner-confirmed, 2026-07-15):** `/api/ops/marketplace-cron` returns HTTP 200; log event `marketplace_cron_complete`; `critical_failure=false`; `errors=[]`. Authentication confirmed healthy.

**Diagnostics removed:** The `TEMP-DIAGNOSTIC` block was removed in commit `1556059` (2026-07-15). Verified by diffing the resulting file against the last known-good pre-diagnostic commit `facc407` — the diff was empty (byte-identical restoration). `tsc --noEmit` and `eslint` both exit 0 after removal. Pushed to `main` (`af23f35..1556059`).

**Status: CLOSED.** No further action required on this incident. A residual, separate open item: whether this Vercel project actually auto-provisions `CRON_SECRET` per plan tier (the `SETUP.md` line-379 assumption) was never independently confirmed — moot now that it has been added manually and verified working, but the documentation claim itself remains unverified against the Vercel dashboard/plan settings.

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

### P4-M6 — `OPS_CRON_SECRET` Vercel Configuration — CLOSED July 15, 2026

**Status: RESOLVED.** See §12 "Cron Auth Incident — CLOSED July 15, 2026" for the full symptom/root-cause/fix/verification record. Both `OPS_CRON_SECRET` and Vercel's `CRON_SECRET` are now confirmed present and working in production (`/api/ops/marketplace-cron` returns 200, `marketplace_cron_complete`, `critical_failure=false`).

---

### Logging / Observability Gap

**Status: OPEN.**

There is no external uptime monitoring or alerting configured. `src/lib/logger.ts` logs to stdout. Sentry captures errors. No external health-check endpoint at `/api/health`. No alerting configured for 5xx spikes, response time > 2 s, or DB connection failures. Per AGENTS.md B1, these must be implemented before launch.

---

## §14 Superseded Decisions

- **"`OPS_CRON_SECRET` alone authenticates Vercel cron" (original 2026-05-25 design, `15a9aa0`)** — superseded 2026-06-05 (`0d97b15`) by adding native Vercel `CRON_SECRET` support as an OR'd authorization path. `OPS_CRON_SECRET` remains the manual/dev `curl`-testing credential (per `SETUP.md` §11); it was never the mechanism Vercel's own scheduler used.
- **Migration 040/045/047/048's informal, ad-hoc grant statements** — superseded by migration 056's project-wide fail-closed default (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated, service_role`) plus explicit per-function re-grants. Migration 056 is now the canonical grants baseline; any future `DROP FUNCTION`/`CREATE OR REPLACE` must follow the AGENTS.md A2 "Function Grant Discipline" checklist, not the older ad-hoc pattern.
- **Prior assumption "created_at + 30 min consumed identically in all 3 places" for the disappearing-request masking/expiry logic** — this was not confirmed by code inspection. The current, verified mechanism in all three consumers (`requests/route.ts` GET, `marketplace-cron/route.ts`, `submit_quote_atomic`) is `quoted_at` + 20 min, consistently. See LB-13 (§6).
- **Binding decision "fixed selection deadline = created_at + 30 minutes, consumed in 3 places"** — SUPERSEDED July 15, 2026. Replaced by the newly approved binding decision: `quoted_at` + 20 minutes (set once by the first quote, never refreshed), confirmed via live production test on request `b61b8e4f-a8ac-409a-bac3-28f9d085a56c`. See §15 for the current binding rule and LB-13 (§6) for closure detail.

## §15 Binding Decisions Still In Force

These remain authoritative and were not revisited or altered this session. Full text lives in `TIERED_DISPATCH_051_ANALYSIS.md`; only pointers are given here to avoid drift between documents.

- **R1–R6** (Phase 1 resolutions, Tiered Dispatch design) — binding, unchanged.
- **Q-A / Q-B / Q-C** (Phase 2 resolutions, Tiered Dispatch design) — binding, unchanged.
- **Snapshot Consistency Constraint** — dual snapshot counts (`providersInRangeAtCreation`, `subscribersInRangeAtCreation`) must be computed from a single query. Confirmed still implemented as a single query in `src/app/api/requests/route.ts` this session.
- **Option A scope statement** — migration 055's visibility-delay gate covers tier-delay authorization only, not full eligibility parity. The "Quote Reachability Parity" follow-up (GPS-staleness + radius/reachability parity between the quote route and migration-053 dashboard visibility) is still unscheduled and remains a prerequisite before Phase 3 can be marked "server-side enforcement complete."
- **AGENTS.md A2 Function Grant Discipline** (added with migration 056) — every new function and every `DROP FUNCTION` + `CREATE` replacement must revoke `PUBLIC`/`anon`/`authenticated`/`service_role` and re-grant only proven-necessary roles, with the caller/proof recorded in a migration comment. Binding for all future migrations, including 057+.
- **Selection-expiry rule: `quoted_at` + 20 minutes (Medo, July 15, 2026) — NEW BINDING DECISION.** The current production behavior — a request's selection window expires 20 minutes after its `quoted_at` timestamp, which is set once by the first quote and never refreshed by later quotes — is APPROVED for launch. Confirmed by live production test on request `b61b8e4f-a8ac-409a-bac3-28f9d085a56c`: DB contained both quotes, `GET /api/requests/quotes` returned both, customer page displayed both. This supersedes the earlier "created_at + 30 minutes" assumption (§14) and closes LB-13 (§6) as "works as designed." The "bounded sliding selection window" alternative (`selection_expiry = MIN(latest_valid_quote_time + selection_window, created_at + max_request_lifetime)`) is DEFERRED, not rejected — see `DEFERRED_PRODUCT_BACKLOG.md`, to be evaluated only if post-launch usage data shows customers losing valid quotes or high re-request rates.

## §16 Lessons Learned (added July 15, 2026)

- **A root-cause diagnosis is not an implemented fix.** The disappearing-request bug was fully root-caused in prior sessions but no code change was ever made. This session assumed (per the incoming request) that it had been fixed and closed — direct code inspection (not memory) disproved that. Always re-verify the current code state before marking any finding CLOSED, even when a prior session's diagnosis was thorough and confident.
- **Documentation claims about third-party platform behavior (e.g. "Vercel auto-provisions `CRON_SECRET` on Pro/Enterprise plans," `SETUP.md` line 379) are assumptions until checked against the actual deployment/plan.** They should be labeled as such rather than stated as fact in project docs.
- **Temporary diagnostic instrumentation should be added and removed as a verifiable unit**, not just "some extra logging." This session's workflow — label the block clearly (`TEMP-DIAGNOSTIC` comment), keep it additive only (no change to authorization conditions or return values), and verify removal by diffing the file against the exact last-known-good commit (empty diff = exact restoration) plus a type-check/lint pass both before and after — produced a clean, provable before/after state and should be the standard pattern for any future temporary production diagnostics.
