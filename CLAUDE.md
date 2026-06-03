@AGENTS.md

# RescueGo — Master Context for Claude Code

## المشروع
RescueGo — UAE roadside recovery marketplace (two-sided SaaS).
- Domain: rescuego.ae
- Stack: Next.js 16 App Router / React 19 / TypeScript / Tailwind CSS v4
- Backend: Supabase Auth + Postgres + Storage + RLS + PostGIS
- Payments: Stripe (subscriptions + Payment Intents + webhooks)
- Deployment: Vercel

## القاعدة الذهبية قبل أي تغيير
1. اقرأ الملف كامل قبل ما تلمسه
2. اشرح إيه اللي هتغيره وليه
3. لا تكسر: Stripe flows / Supabase RLS / auth/session / request lifecycle semantics
4. بعد كل تغيير: npm run lint && npm run build لازم يعديوا
5. لو في شك — اسأل قبل ما تنفذ

---

## الحالة الحالية للمشروع (آخر تحديث)

### ✅ مكتمل بالكامل
- **Phase 0** — QA-FINAL: request lifecycle / PPJ / subscription / overage / rating / release / cancellation / mobile smoke test
- **Phase 1** — Security hardening: rate limiting / input validation / secure headers / CSP Report-Only / Stripe webhook idempotency / Sentry baseline / RLS audit / route guards + Sentry smoke verification ✅ + all env vars on Vercel ✅
- **Phase 1B.4** — Realtime & polling stability audit (ProviderRequestList + customer request page)
- **Phase 1B.5** — Lifecycle recovery hardening (migration 014: complete_provider_job_atomic RPC)
- **Phase 2A.1** — Customer request UX upgrade (mobile-first redesign)
- **Migrations** — وصلت لـ 015_ppj_credit_accept_complete_job_fix.sql

### 📋 المراحل القادمة بالترتيب

**Phase 1A — Monitoring, Performance & Stability**
- auth/login performance audit
- logout lag investigation
- dashboard loading optimization
- Supabase query profiling
- polling reduction
- Core Web Vitals baseline
- bundle size review
- production slow-query identification

**Phase 1B (المتبقي) — Critical Architecture**
- ⚠️ accept flow atomicity — migration 011 اتعمل بالفعل (accept_request_atomic RPC) — تأكد إنه مطبق على production
- cron monitoring + retry/failure handling
- DB indexes audit (migration 013 موجود)
- LAUNCH_PROMO → env/DB config (مش hardcoded)
- PPJ fee config → server-side configurable
- ops routes reliability review

**Phase 1C — Deep RLS Hardening**
- ⚠️ policy واحدة كل مرة + smoke test بعدها فوراً
- الجداول: requests / providers / provider_locations / request_locks / ratings
- لا تكسر: dashboards / realtime / assignment / PPJ / provider visibility

**Phase 2A (المتبقي) — UI System Pass**
- design tokens file
- loading skeletons
- empty states
- error states
- button/card/badge consistency
- provider dashboard visual upgrade

**Phase 2B — RTL & Arabic Foundation**
- إصلاح mojibake في layout.tsx keywords
- dir="rtl" strategy
- Arabic font fallback
- RTL spacing/layout
- Tailwind RTL utilities

**Phase 2C — Mobile/PWA Strategy**
- ⚠️ قرار استراتيجي: Web PWA أم native app؟ لازم يتحسم أول
- provider field workflow audit
- push readiness assessment

**Phase 3 — Realtime & Notifications**
- Supabase realtime cleanup
- lightweight notification layer
- customer/provider scoped channels
- polling reduction where realtime is safe

**Phase 4 — Operations & Trust V1**
- provider states: accepted → en_route → arrived → completed
- customer progress timeline UI
- no-show tracking
- auto-release rules

**Phase 4B — Admin Operations Center**
- live requests dashboard
- stuck jobs view
- no-show alerts
- revenue overview

**Phase 5 — Provider KYC & UAE Compliance**
- admin document viewer
- Emirates ID / trade license review
- provider agreement checkbox

**Phase 6 — Dispatch Logic V2**
- ⚠️ Prerequisite: Google Maps API key + HTTP referrer restrictions + billing alerts
- Business/Pro/Starter/PPJ priority tiers
- PostGIS dashboard integration

**Phase 7 — Pricing Engine V2**
- PPJ launch fee = 15 AED (server-side)
- distance-based pricing بعد اللانش
- server-side distance calculation

**Phase 8 — Quote Approval & Commission Integrity**
- provider sends quote → customer approves
- final_price = approved quote (source of truth)
- commission بعد quote approval فقط

**Phase 9 — Premium Jobs & Commission**
- server-side commission calculation
- Premium: approved quote > 400 AED
- Starter 15% / Pro 10% / Business 0%

**Phase 10 — Billing Integrity**
- jobs_this_month integrity
- cron reliability
- Stripe refund API integration
- billing reconciliation

**Phase 11 — Fraud Detection**
**Phase 12 — Legal & UAE Compliance**
**Phase 13 — SEO Domination**
**Phase 14 — Growth & Provider Acquisition**
**Phase 15 — Scale Architecture**

---

## بنية المشروع المهمة

```
src/
  app/
    api/
      provider/
        requests/accept/route.ts     ← يستخدم accept_request_atomic RPC
        jobs/complete/route.ts       ← يستخدم complete_provider_job_atomic RPC
        jobs/release/route.ts        ← release flow
        location/route.ts            ← GPS location updates
        ppj-checkout/route.ts        ← PPJ Stripe payment
        overage-checkout/route.ts    ← overage Stripe payment
      requests/route.ts              ← customer creates request
      requests/cancel/route.ts       ← customer cancellation
      stripe/webhook/route.ts        ← all Stripe events
      ops/
        expire-requests/route.ts     ← cron: expire stale requests
        monthly-allowance-reset/route.ts ← cron: reset jobs_this_month
    admin/                           ← admin dashboard pages
    customer/                        ← customer pages
    provider/                        ← provider pages
    recovery/                        ← UAE emirate SEO pages
  components/
    forms/
      ProviderRequestList.tsx        ← realtime request list (updated in 1B.4)
    provider/
      ProviderAvailabilityToggle.tsx
      dashboard/                     ← provider dashboard components
    ui/                              ← Button, Card, Badge, Input, etc.
  lib/
    supabase/
      server.ts                      ← server client
      admin.ts                       ← service role client
    rate-limit.ts                    ← Upstash-ready rate limiter
    logger.ts                        ← structured logger with redaction

supabase/
  migrations/
    001 → 015                        ← كل الـ migrations بالترتيب
    014: complete_provider_job_atomic RPC
    015: ppj_credit_accept_complete_job_fix
```

---

## قواعد لا تتكسر أبداً

### Stripe
- لا تعمل payment logic في client components
- webhook signature verification لازم يبقى
- idempotency keys لازم تبقى
- لا تحذف Stripe event logging

### Supabase
- service_role key = server-side فقط
- لا تعمل direct DB calls بدون RLS من browser
- RLS policies: تغيير واحد بالمرة + smoke test فوراً

### Auth
- middleware.ts / proxy.ts يحمي الـ routes — لا تغيرهم إلا بحذر شديد
- JWT role checks لازم تبقى

### Commission
- commission_rate و commission_amount حالياً = 0 في complete route
- ده intentional حتى يتنفذ Phase 8 (Quote Approval)
- لا تحسب commission قبل Phase 8

### Environment Variables الحساسة
```
SUPABASE_SERVICE_ROLE_KEY     ← server only
STRIPE_SECRET_KEY              ← server only
STRIPE_WEBHOOK_SECRET          ← server only
OPS_CRON_SECRET                ← server only
```

---

## أول حاجة تعملها في كل session جديد
```
1. اقرأ هذا الملف (CLAUDE.md)
2. اقرأ PROJECT_HANDOFF.md
3. افهم الـ task المطلوب
4. اشرح خطتك قبل ما تبدأ
5. نفذ خطوة بخطوة
6. npm run lint && npm run build بعد كل تغيير
```

---

## Google Maps — تحذير مهم
- حالياً: links فقط — لا Maps SDK
- لا تضيف Maps SDK أو Geocoding أو Distance Matrix إلا في Phase 6
- لما تضيفهم: API key + HTTP referrer restrictions + quota monitoring + billing alerts أولاً

---

## Sentry — الخطوة الأولى المطلوبة
```
1. أضف SENTRY_DSN على Vercel
2. أضف NEXT_PUBLIC_SENTRY_DSN على Vercel
3. Vercel redeploy
4. POST /api/admin/sentry-verify (كـ admin)
5. تأكد الـ event ظهر في Sentry
6. SENTRY_VERIFICATION_ENABLED=false
```

---

## UI Prompt Templates — جاهزة للنسخ

### قالب UI Polish Pass
```
RescueGo UAE — [Phase Name] UI Polish — Safe Pass

[اذكر الـ phases المكتملة قبلها]

Goal:
[هدف واضح — visual only]

Do NOT change billing logic.
Do NOT change Stripe flows.
Do NOT change request lifecycle.
Do NOT change auth/session behavior.
Do NOT change database schema.
Do NOT introduce realtime.
Do NOT touch Sentry/CSP/security logic.
Do NOT change API routes or Supabase queries.
UI polish only.

Scope:
- [الملفات المحددة فقط]

Tasks:
1. [task محدد]
2. [task محدد]

Shared components rule:
- If shared component NOT used by admin → apply change directly
- If shared by admin too → extract variant, don't touch original
- Document any shared component touched

Validation:
Run:
- npm run lint
- npm run build

Return:
- files changed
- UI improvements applied
- mobile improvements
- shared components touched
- confirmation no logic/query/API changes
- deferred UI issues
- lint/build status

Final rule:
If any change risks operational stability → defer and document, don't implement.
```

---

### قالب Bug Fix
```
BUG — [وصف المشكلة]

[سياق المشكلة]

Do NOT change [حاجة 1].
Do NOT change [حاجة 2].
Do NOT change billing, lifecycle, Stripe, auth, dashboards, or request logic.

Goal: [الهدف المحدد]

Required fix:
- [التغيير المطلوب بالظبط]

Validation:
- npm run lint
- npm run build

Return:
- files changed
- fix applied
- confirmation no other logic changed
- lint/build status
```

---

### قالب Audit + Safe Fixes
```
RescueGo UAE — [Phase] Audit & Safe Fixes

[الـ phases المكتملة]

Goal: [هدف الـ audit]

Do NOT change:
- billing logic
- Stripe flows
- request lifecycle
- auth/session
- Supabase RLS
- UI redesign
- admin behavior

Scope:
- [الملفات المحددة]

Tasks:
1. Audit [موضوع]
   Review: [النقاط]
2. Apply only low-risk fixes if clearly safe
   Prefer: [نوع الإصلاحات المقبولة]
   Avoid: [نوع التغييرات الممنوعة]

Validation:
- npm run lint
- npm run build

Return:
- files reviewed
- risks identified
- fixes applied
- deferred risks
- lint/build status
```

---

## قواعد كتابة الـ Prompt

1. **ابدأ بـ context** — إيه اللي اتعمل قبل الـ task دي
2. **Goal واحد واضح** — مش أهداف متعددة
3. **"Do NOT" list صريحة** — الحاجات اللي ميتلمسوش
4. **Scope محدد** — الملفات بالاسم مش "كل الكود"
5. **Tasks مرقمة** — كل task في سطر
6. **Validation دايماً** — lint + build
7. **Return محدد** — إيه اللي تريده يرجعه
8. **Final rule** — لو في شك → defer مش implement

