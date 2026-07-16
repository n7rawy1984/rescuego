# RescueGo — Roadmap

This document owns phase definitions, completion status, priorities, and ordering rationale.

For the **current migration baseline, open findings, and launch blockers**, see [PROJECT_STATUS.md].
For **architecture and system design**, see [ARCHITECTURE.md].
For **deferred product and UX items**, see [DEFERRED_PRODUCT_BACKLOG.md].
For **environment setup and migration application**, see [SETUP.md].

When the status of any phase changes, update this document. Do not update [PROJECT_STATUS.md] here — reference it.

---

## Current State Summary

The application is feature-complete through Phase 5 (KYC) and has received four security/infrastructure remediation batches (migrations 039–045). PPJ has been re-enabled via migration 045 and is under end-to-end testing. The fair-price formula has been intentionally relaxed for testing (migration 044) and must be redesigned before launch.

For the current migration baseline, open findings, and launch blockers, see [PROJECT_STATUS.md §1–§6].

---

## Phase Completion Status

### Phase 1 — Core Foundation ✅ COMPLETE

All foundational infrastructure is implemented and operational.

- Next.js 16 App Router structure with `src/proxy.ts` middleware (Next.js 16 convention)
- Supabase Auth: customer, provider, admin role model
- Supabase Postgres schema: users, providers, provider\_locations, requests, jobs, ratings, request\_locks, price\_estimates
- PostGIS for geospatial queries
- Customer request creation wizard (issue → location → confirm)
- Provider registration and onboarding (3-step: profile → documents → plan)
- Provider online/offline toggle with GPS location capture
- UAE location validation and emirate/sub-area detection
- Role-based route protection in middleware
- Structured logging (`src/lib/logger.ts`) with PII redaction
- Sentry setup (server, edge, client; `beforeSend` scrubbing)
- CSP and security headers (enforced, not report-only) in `next.config.ts`
- Rate limiting utility (`src/lib/rate-limit.ts`; soft/hard modes; Upstash Redis + in-memory fallback)
- Stripe helper utilities
- Arabic and English message files (1,600+ lines each; next-intl v4)
- Tailwind CSS v4 with logical CSS properties for RTL

---

### Phase 2 — Provider Lifecycle ✅ COMPLETE

All provider job lifecycle states and RPC-backed transitions are implemented.

- Provider job states: `accepted` → `en_route` → `arrived` → `in_progress` → `completed`
- `advance_provider_job_state` RPC (atomic, whitelisted `to_status`, `SET search_path = public`)
- Provider SLA timer UI (warning at 10 min, breach at 20 min from `accepted_at`)
- Provider job release (`release_job_atomic`; decrements `jobs_this_month` only when V2 slot consumed)
- Stuck-job auto-release (`expire_stuck_active_requests`; uses `requests.created_at`)
- Cancellation compensation path (`cancel_request_and_compensate_atomic`)
- Price-change request and atomic customer response (`request_price_change_atomic`, `respond_price_change_atomic`)
- Customer rating flow (stars + comment; `ratings.customer_id` persisted)
- Operational cron routes (expire requests, monthly allowance reset, weekly SLA reset)
- `payout_log` with UNIQUE constraint on `stripe_payout_id`

---

### Phase 3 — Stripe Subscriptions ✅ COMPLETE

Subscription billing for all three plan tiers is implemented and functional in TEST mode.

- Subscription checkout (`/api/stripe/create-checkout`; KYC guard: `rejected`/`suspended` → 403)
- Stripe billing portal redirect for existing subscriptions
- Stripe webhook signature verification
- Stripe event idempotency (`stripe_events` table; atomic conflict-aware upsert)
- `customer.subscription.created` → plan activation (gated by `KYC_PROTECTED` status list)
- `customer.subscription.updated` → plan change and early-cancellation guard
- `customer.subscription.deleted` → plan reset to `pay_per_job`
- `checkout.session.completed` → log only (activation comes from subscription event)
- Overage checkout and webhook path (`overage_payments` table; `accept_provider_request_atomic` with `plan_limit = -1`)
- PPJ checkout and webhook path (see Phase 6)
- `payout.created` → payout log upsert
- `payment_intent.canceled` → failed status on pending PPJ/overage rows
- Subscription plan tiers: Starter (249 AED/15 jobs), Pro (449 AED/35 jobs), Business (849 AED/unlimited)
- Commission: `commission_rate = 0` intentionally until Phase 8

> Stripe is currently in TEST mode. See [PROJECT_STATUS.md §11] for go-live steps.

---

### Phase 4 — Operational Infrastructure ✅ COMPLETE

All four cron routes are configured and deployed in `vercel.json`.

| Route | Schedule | Purpose |
|---|---|---|
| `/api/ops/expire-requests` | Every 30 minutes | Expire stale open requests; auto-release stuck jobs; clear stuck Stripe events |
| `/api/ops/monthly-allowance-reset` | Daily midnight | Reset `jobs_this_month` for all subscription plans (batches of 50) |
| `/api/ops/marketplace-cron` | Every minute | Expire stale quotes; expire unselected requests; SLA enforcement (LIMIT 50, `created_at ASC`); expire PPJ payment windows |
| `/api/ops/weekly-sla-reset` | Sunday midnight | Apply `visibility_reduced` for 3+ SLA failures; reset `sla_failure_count` |

- Ops auth: `authorizeOpsRequest` using `OPS_CRON_SECRET` (≥32 chars, constant-time comparison) OR Vercel-managed `CRON_SECRET` (≥32 chars) — dual path since 2026-06-05
- `env.ts` hard-fails at startup in production if `OPS_CRON_SECRET` is missing or < 32 chars

> Resolved July 15, 2026: cron auth incident (401s; Vercel `CRON_SECRET` was not present in the Vercel project environment until 2026-07-14) is CLOSED and verified in production. See [PROJECT_STATUS.md §12].
> Open item: weekly SLA reset is non-atomic (two UPDATE statements). See [PROJECT_STATUS.md §13].

---

### Phase 5 — KYC ✅ COMPLETE

Provider KYC flow is fully implemented.

- Provider status machine: `pending` → `under_review` → `active` | `rejected` | `suspended`
- Document upload route (`/api/providers/documents`): MIME type, magic bytes, file size ≤ 5 MB, extension validation
- Supabase Storage bucket `provider-documents` with provider-owned path RLS (migration 023)
- `provider_kyc_log` audit table (migration 038)
- `admin_update_provider_status_atomic` RPC: atomic status update + audit log insert (migration 041)
- Admin provider review UI with document signed URL viewer and `AdminProviderActions` component
- KYC-protected Stripe activation: `KYC_PROTECTED = ['pending', 'under_review', 'rejected', 'suspended']` prevents auto-activation in webhook
- `create-checkout` route: `rejected`/`suspended` providers receive 403 before checkout begins
- `getProviderOnboardingState()` helper for multi-step onboarding UI

> Runtime verification of C2/C3/C4 (immutable-column triggers and KYC webhook guard) is pending cloud confirmation. See [PROJECT_STATUS.md §7].

---

### Phase 6 — Marketplace V2 ✅ COMPLETE (PPJ sub-feature under test)

The full Marketplace V2 quote flow is implemented. PPJ post-selection fee gate re-enabled via migration 045.

**Schema and RPCs:**
- `request_quotes` table, `provider_dispatch_log` table, `fair_price_config` table (migration 031)
- `submit_quote_atomic` RPC: fair-price validation, daily limit check, quote insert (migration 031/039)
- `select_quote_atomic` RPC: plan-branched selection (migration 031/040/045)
- `sla_check_and_release` RPC: SLA enforcement for `accepted`/`en_route`/`arrived` states (migration 031/040)
- `expire_ppj_payment_selection_atomic` RPC: expires timed-out PPJ payment windows (migration 045)
- `finalize_ppj_selection_atomic` RPC: atomic PPJ fee payment → request accepted (migration 045)
- `get_nearby_open_requests` updated to return `open` + `quoted` requests with destination and fuzzy coordinates (migrations 033/035/039)

**Provider scoring:** Four-component formula (rating 40%, proximity 30%, price 20%, acceptance 10%); top 5 of up to 20 pending quotes. See [ARCHITECTURE.md §4].

**Request lifecycle (V2):**
`open` → `quoted` → `selected_pending_payment` (PPJ only) → `accepted` → `en_route` → `arrived` → `in_progress` → `completed`

**PPJ post-selection fee gate (migration 045):**
- `selected_pending_payment` status: customer has selected a PPJ provider; payment window open (10 minutes)
- Contact withheld until `finalize_ppj_selection_atomic` confirms payment
- Two-timer separation: payment window clock (`payment_window_started_at`) separate from SLA clock (`accepted_at`)
- Competitors held as `pending` during payment window; rejected on finalization

**PPJ operational status:** Implemented and in end-to-end testing. See [PROJECT_STATUS.md §9].

**Fair price status:** Validation active; bounds intentionally widened by migration 044 for testing. LAUNCH BLOCKER — formula must be redesigned before go-live. See [PROJECT_STATUS.md §10] and [DEFERRED_PRODUCT_BACKLOG P9].

**Open marketplace security items:** Legacy accept bypass (H2), overage gap in V2 selection (H3), accept RPC active-job check (H6). See [PROJECT_STATUS.md §7].

---

### Security Remediation Batches 1–4 ✅ COMPLETE (cloud verification pending)

Four successive security and integrity remediation batches have been implemented in migrations 039–045.

| Batch | Migration(s) | Key fixes |
|---|---|---|
| Batch 1 | 039 | C2 `enforce_users_immutable_columns` trigger; C3 `enforce_providers_immutable_columns` trigger; C5 re-enable fair-price validation; D8 fuzzy coordinates; CSRF H7 fix (null origin 403, vercel.app wildcard removed); Bearer token D10 removal; KYC_PROTECTED expansion C4 |
| Batch 2 | 040 | CRIT-01 `request_price_change_atomic`; CRIT-02 SLA for en\_route/arrived; HIGH-01 unvalidated request\_id; HIGH-02 GET read-only; HIGH-03 release decrement; HIGH-05 ratings.customer\_id; HIGH-06 respond guard; LOW-01/04 advance\_job whitelist/search\_path; LOW-03 stuck expiry decrement |
| Batch 3 | 041, 042, 043 | H5 `admin_update_provider_status_atomic` (atomic KYC log); phantom `updated_at` → `created_at` fix (migration 042); `idx_jobs_en_route_at` partial index (migration 043) |
| Batch 4 | 044, 045 | Fair-price bounds widened for testing (migration 044); PPJ post-selection fee gate re-enabled (migration 045); P4-H1 GET rate limits; P4-C2 monthly reset pagination; P4-M2 EXPIRE\_BATCH\_LIMIT; P4-H4 cron HTTP 500 on failure |

All fixes are code-complete. Runtime verification of cloud migration state is pending. See [PROJECT_STATUS.md §4] for the full runtime verification table and [PROJECT_STATUS.md §7] for remaining open security findings.

---

### Tiered Dispatch (migrations 051–056) — IN PROGRESS

| Migration | Status |
|---|---|
| 051 — dispatch foundation schema | APPLIED & verified July 8, 2026 |
| 052 — subscriber count snapshot | APPLIED & verified July 8, 2026 |
| 053 — tiered visibility RPC | Code complete; cloud-application status UNVERIFIED this session — see [PROJECT_STATUS.md §3] |
| 054 — Phase 3 Step 1 SSOT + D5 infra | APPLIED & verified July 12, 2026 |
| 055 — Phase 3 Step 2 visibility-delay gate (`submit_quote_atomic`) | Code complete; cloud-application status UNVERIFIED this session — see [PROJECT_STATUS.md §3] |
| 056 — grants hotfix | APPLIED & verified July 13, 2026 |

Phase 3 Steps 3–5 (credit logic: monthly-limit/credit-consumption fix, subscriber-limit restoration + abuse controls) are **not yet written** — next work is migrations 057+. See [TIERED_DISPATCH_051_ANALYSIS.md] and [PROJECT_STATUS.md §6 LB-12].

**Related known issue — CLOSED July 15, 2026:** the disappearing quoted-request bug (customer's active request masked from the dashboard once `quoted_at` is stale) had a confirmed root cause but no code fix. It is now CLOSED as "works as designed" per a binding decision approving the current `quoted_at` + 20-minute expiry rule for launch, confirmed by a live production test. See [PROJECT_STATUS.md §6 LB-13, §15].

---

## Before Launch — Required

The following must be resolved before production traffic and real payments. See [PROJECT_STATUS.md §5–§6] for the detailed current status of each.

| Blocker | Owner reference |
|---|---|
| LB-1 Fair price formula redesign (two-leg distance + destination) | [DEFERRED_PRODUCT_BACKLOG P9, P1, P2] |
| LB-2 Cloud migration verification (039–045 applied?) | [PROJECT_STATUS.md §3–§4] |
| LB-3 C2/C3 runtime verification (immutable-column triggers confirmed?) | [PROJECT_STATUS.md §7] |
| LB-4 Stripe go-live switch | [PROJECT_STATUS.md §11] |
| LB-5 H6 — accept RPC active-job check misses en\_route/arrived | [PROJECT_STATUS.md §7] |
| LB-6 H2 — legacy accept bypasses V2 for subscription providers | [PROJECT_STATUS.md §7] |
| LB-7 H3 — no overage gate in `select_quote_atomic` | [PROJECT_STATUS.md §7] |
| LB-8 P4-C1 — thundering herd realtime broadcast | [PROJECT_STATUS.md §13] |
| LB-9 OG image / logo file extension gaps | [PROJECT_STATUS.md §2] |
| LB-10 P4-H3 — weekly SLA reset non-atomic | [PROJECT_STATUS.md §13] |
| LB-11 `NEXT_PUBLIC_SITE_URL` not set in Vercel | [PROJECT_STATUS.md §11] |
| LB-12 Phase 3 credit logic (Steps 3–5, migrations 057+) — NOT YET WRITTEN | [TIERED_DISPATCH_051_ANALYSIS.md], [PROJECT_STATUS.md §6 LB-12] |
| LB-13 Disappearing quoted-request bug — **CLOSED**, works as designed per approved expiry rule | [PROJECT_STATUS.md §6 LB-13] |

---

## Future Phases

### Phase 7 — Production Hardening

Work required before real-money production traffic.

- Resolve all launch blockers (see table above)
- Cloud migration smoke tests against a staging Supabase project
- Runtime verification of C2/C3 triggers, C4 Stripe KYC path, and all PARTIALLY VERIFIED findings
- Automated test suite: Vitest for `src/lib/` utilities (target 80% coverage), integration tests for API routes and RPCs
- CI pipeline via GitHub Actions: lint → type-check → tests → `npm audit` → `next build`
- `/api/health` endpoint with DB connectivity check
- External uptime monitoring (Better Stack or UptimeRobot)
- Alerting: 5xx spike, response time > 2 s, DB connection failures
- Verify backup and restore process (Supabase Pro daily PITR)
- Resolve P4-H3 weekly SLA reset atomicity (wrap in transaction or convert to RPC)
- Resolve P4-C1 thundering herd (geographic filter on Realtime channel or pull-based polling)
- Confirm `provider-documents` bucket is private and RLS policies are verified in production dashboard

### Phase 8 — Commission and Revenue

Platform revenue infrastructure.

- Set non-zero `commission_rate` in `complete_provider_job_atomic` (currently 0 by design)
- Confirm payout reporting requirements for UAE market
- Validate Stripe webhook replay coverage for all payment events
- Stronger payment state reconciliation and recovery for failed payouts
- Admin revenue reporting improvements

### Phase 9 — Fair Price Redesign

Required before V2 marketplace can enforce economically meaningful quote validation.

- Mandatory emirate destination dropdown on request creation (P1)
- Two-leg distance calculation: provider → breakdown + breakdown → destination (P9)
- Redesigned `fair_price_config` bounds based on UAE two-leg market economics (P2)
- New migration replacing migration 044 widened values with realistic bounds
- Re-enable C5 fair price enforcement in full

See [DEFERRED_PRODUCT_BACKLOG P1, P2, P9] for full scope.

### Phase 10 — Dispatch Optimization

Provider-side marketplace improvements.

- Re-enable or replace `dispatch.ts` dispatch engine (currently has zero callers; see [DEFERRED_PRODUCT_BACKLOG P8])
- Geographic filtering on Realtime channels (addresses P4-C1)
- Provider availability and SLA analytics
- Dispatch ring optimization based on real UAE traffic data

### Phase 11 — Payments at Scale

Production payment operations hardening.

- Switch all Stripe keys to live mode
- Register production webhook endpoint at `https://rescuego.ae/api/stripe/webhook`
- Validate Stripe webhooks with replayed test events
- Commission enforcement (Phase 8 prerequisite)
- Upstash Redis confirmed for cross-instance rate limiting

### Phase 12 — Operations and Support

Operational maturity.

- Improved admin dashboards (KPI trends, SLA heatmaps)
- Support workflow tooling
- Provider suspension and appeal process
- Incident runbooks
- Admin audit log completeness review

---

## Documentation Maintenance Rule

When any phase status changes:

1. Update the phase section above to reflect the new status.
2. Update [PROJECT_STATUS.md] for any new open findings, launch blockers, or runtime verification results.
3. Append to [SESSION_LOG.md] with what was done.
4. Do NOT restate finding detail or migration baselines in this document — reference [PROJECT_STATUS.md].
5. Do NOT reference `MARKETPLACE_V2_SPEC.md`, `PROJECT_HANDOFF.md`, or `RESCUEGO_MASTER_REFERENCE.md` — those are archived historical documents.
