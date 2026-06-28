# RescueGo — Deployment Status

> Historical note: this file is an older deployment snapshot. It has not been verified against live production environment state on 2026-06-11. For current code architecture and migration position, use `ARCHITECTURE.md`.

آخر تحديث: 5 يونيو 2026 (Phase 1B + 1C complete)

---

## Vercel — Environment Variables
✅ كلهم موجودون على Production and Preview

| Variable | Status | آخر تحديث |
|---|---|---|
| SENTRY_VERIFICATION_ENABLED | ✅ موجود | May 31 |
| NEXT_PUBLIC_SENTRY_DSN | ✅ موجود | May 31 |
| SENTRY_DSN | ✅ موجود | May 31 |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | ✅ موجود | May 29 |
| OPS_CRON_SECRET | ✅ موجود | May 26 |
| NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID | ✅ موجود | May 25 |
| NEXT_PUBLIC_STRIPE_PRO_PRICE_ID | ✅ موجود | May 25 |
| NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID | ✅ موجود | May 25 |
| STRIPE_WEBHOOK_SECRET | ✅ موجود | May 24 |
| STRIPE_SECRET_KEY | ✅ موجود | May 24 |
| NEXT_PUBLIC_SUPABASE_URL | ✅ موجود | May 22 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ✅ موجود | May 22 |
| SUPABASE_SERVICE_ROLE_KEY | ✅ موجود | May 22 |
| NEXT_PUBLIC_APP_URL | ✅ موجود | May 22 |

⚠️ ناقص من Vercel:
- [ ] NEXT_PUBLIC_SITE_URL — مش ظاهر في القائمة
- [ ] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — مش محتاجه دلوقتي (Phase 6)
- [ ] UPSTASH_REDIS_REST_URL — اختياري
- [ ] UPSTASH_REDIS_REST_TOKEN — اختياري
- [ ] SENTRY_AUTH_TOKEN — اختياري (source maps)
- [ ] SENTRY_ORG — اختياري
- [ ] SENTRY_PROJECT — اختياري

---

## Supabase — Database Tables
✅ كل الجداول موجودة على Production

| Table | Status |
|---|---|
| users | ✅ |
| providers | ✅ |
| provider_locations | ✅ |
| requests | ✅ |
| jobs | ✅ |
| ratings | ✅ |
| request_locks | ✅ |
| price_estimates | ✅ |
| ppj_payments | ✅ |
| overage_payments | ✅ |
| payout_log | ✅ |
| geography_columns | ✅ (PostGIS) |
| geometry_columns | ✅ (PostGIS) |
| spatial_ref_sys | ✅ (PostGIS — UNRESTRICTED) |

✅ PostGIS: مفعّل (geometry_columns + geography_columns موجودين)

---

## Supabase — Storage
✅ Bucket: provider-documents — موجود وشغال
✅ فيه ملفات فعلية: emirates_id.pdf / license.pdf / vehicle.jpg

⚠️ ملاحظة: الـ bucket مش فيه Policies (0 policies في القائمة)
- لازم تتأكد إن الـ bucket private وعنده RLS policies صح
- راجع SETUP.md القسم 4

---

## Stripe — Webhooks
✅ Webhook موجود وشغال

| Setting | Value |
|---|---|
| Name | rescuego-production-webhook |
| URL | https://www.rescuego.ae/api/stripe/webhook |
| Status | Active ✅ |
| Events | 10 events |
| Error Rate | 0% ✅ |
| Mode | Sandbox (Test Mode) |

⚠️ مهم: الـ Stripe لسه في Sandbox/Test Mode
- الـ STRIPE_SECRET_KEY على Vercel = test key
- لازم تتحول للـ Live keys قبل اللانش الحقيقي (Phase 10)

---

## Migrations — Supabase
✅ كل الـ migrations اتطبقوا

| Migration | Status |
|---|---|
| 001_initial_schema | ✅ |
| 002_rpc_functions | ✅ |
| 003_harden_provider_rls | ✅ |
| 004_nearby_open_requests | ✅ |
| 005_ppj_payments | ✅ |
| 006_billing_stability | ✅ |
| 007_operational_lifecycle | ✅ |
| 008_upgrade_job_credits | ✅ |
| 009_operational_trust_credits | ✅ |
| 010_harden_open_request_privacy | ✅ |
| 011_accept_flow_transaction_hardening | ✅ |
| 012_ppj_cancelled_payment_protection | ✅ |
| 013_query_performance_indexes | ✅ |
| 014_complete_job_transaction_hardening | ✅ |
| 015_ppj_credit_accept_complete_job_fix | ✅ |
| 016_task4_query_indexes | ✅ |
| 017_task8_query_indexes | ✅ |
| 018_capture_get_nearby_open_requests | ✅ |
| 019_cancel_compensation_atomic | ✅ |
| 020_release_job_atomic | ✅ |
| 021_phase1c_rls_hardening | ✅ |
| 022_phase1c_remaining | ✅ |
| 023_provider_documents_bucket_rls | ✅ |
| 024_accept_rpc_overage_guard | ✅ |
| 025_provider_state_machine | ✅ |
| 026_advance_state_atomic | ✅ |

---

## Sentry — Status
✅ DSN مضاف على Vercel (May 31)
✅ Sentry smoke verification — مكتمل (Jun 3)

---

## الخطوة القادمة مباشرة
**Phase 1A — Monitoring, Performance & Stability**

Tasks:
- [x] auth/login performance audit (proxy.ts DB call removed)
- [x] logout lag investigation (signOut local scope)
- [x] dashboard loading optimization (Findings 1–4 fixed)
- [x] Supabase query profiling (migration 016 applied)
- [x] Phase 1A Task 4 code fixes — location route + accept route Promise.all
- [x] polling reduction (adaptive interval, customer request page)
- [x] Core Web Vitals baseline audit — Finding 6 fix (preconnect) + Finding 1 fix (sentry.client.config.ts)
- [x] bundle size review (Phase 1A Task 7 complete — 12 unused dependencies removed)
- [x] production slow-query identification (Task 8 complete — migration 017 applied, code fixes applied)

**Phase 1B — Critical Architecture Hardening ✅ complete**
- [x] Task 2: LAUNCH_PROMO → NEXT_PUBLIC_LAUNCH_PROMO env var
- [x] Task 3: PPJ fees → NEXT_PUBLIC_PPJ_* env vars with safe fallbacks
- [x] Task 4: Cron reliability — vercel.json created, GET handlers added, Promise.all parallel updates, maxDuration set, REQUEST_EXPIRY_HOURS env var, OPS_CRON_SECRET length validation
- [x] Task 5 Finding 2: cancel double-compensation bug — cancel_request_and_compensate_atomic RPC (migration 019)
- [x] Task 5 Finding 1: release cleanup atomicity — release_job_atomic RPC (migration 020)

**Phase 1C — Deep RLS Hardening ✅ complete**
- [x] Migration 021: 6 over-broad RLS policies dropped/hardened
- [x] Migration 022: reset_monthly_job_counters revoked, ratings UNIQUE(job_id) confirmed
- [x] Migration 023: Storage bucket `provider-documents` RLS policies
- [x] Migration 024: Overage TOCTOU guard inside accept_provider_request_atomic

**Phase 3 — Realtime & Notifications ✅ complete**
- [x] Customer realtime subscription on active request
- [x] Provider ProviderRealtimeRefresh component
- [x] Polling raised to 60s heartbeat fallback

**Phase 4 — Provider State Machine ✅ complete**
- [x] Migration 025: en_route/arrived states, provider_state_machine CHECK constraint
- [x] Migration 026: advance_provider_job_state atomic RPC
- [x] JobStateAdvanceButton component
- [x] Customer 5-step progress timeline UI

**Phase 4B — Admin Operations Center ✅ partial**
- [x] Stuck jobs alert banner (en_route/arrived > 2 hours)
- [x] Provider performance leaderboard page
- [x] Extended filter tabs (all states)
- [ ] Complaint inbox, export tools, manual intervention (future)

**Phase 2B — RTL & Arabic ✅ partial**
- [x] 2B-1: Cairo font + RTL infrastructure
- [x] 2B-2: Physical → logical directional classes (18 files)
- [ ] 2B-3: Arabic strings + full RTL activation ← **NEXT TASK**
