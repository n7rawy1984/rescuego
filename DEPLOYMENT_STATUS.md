# RescueGo — Deployment Status
آخر تحديث: 4 يونيو 2026

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
- [ ] Phase 1A Task 4 code fixes — location route + accept route Promise.all
- [ ] polling reduction
- [ ] Core Web Vitals baseline
- [ ] bundle size review
- [ ] production slow-query identification

