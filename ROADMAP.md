# RescueGo UAE — Final Master Roadmap v2.4

---

## Phase 0 — QA-FINAL Closure ✅
**الهدف:** تثبيت المنتج كـ stable pre-production build.

**تم:**
- request lifecycle stabilization
- PPJ payment flow
- subscription flow
- overage flow
- rating recovery
- release/reaccept flow
- customer cancellation
- PPJ recovery credits
- location privacy
- customer phone/address/notes input
- assigned-provider-only contact reveal
- admin providers visibility
- admin requests visibility
- login reliability
- logout/session recovery improvements
- mobile production smoke test
- dashboard UX polish
- customer history
- Stripe Link disabled
- Apple Pay / Google Pay enabled
- PPJ Stripe return race hardening
- complete job stale-state hardening
- cancellation/release lifecycle hardening

**النتيجة:** Stable pre-production operational marketplace.

---

## Phase 1 — Security & Infrastructure Hardening ✅
**الهدف:** hard-safe production foundation.

**تم:**
- API rate limiting
- Upstash-ready distributed limiter
- request spam protection
- auth protection
- input validation
- secure headers
- CSP Report-Only rollout
- Stripe webhook replay/idempotency protection
- Stripe webhook observability
- Supabase Edge Functions audit
- deprecated functions documented
- RLS/privacy audit
- Sentry baseline integration ✅
- structured logging
- safe redaction rules
- admin/provider/customer route guards
- service-role audit
- admin route audit
- distributed-ready rate limiter rollout
- SENTRY_DSN على Vercel ✅
- Sentry smoke verification ✅
- webhook production verification ✅

**النتيجة:** Production-safe security and monitoring foundation.

---

## Phase 1A — Monitoring, Performance & Stability ✅ (Tasks 1–7)
**الهدف:** تقليل اللاج والـ stale state قبل أي realtime complexity.

- [x] Sentry verification + event smoke test
- [x] auth/login performance audit (proxy.ts DB call removed)
- [x] logout lag investigation (signOut local scope)
- [x] dashboard loading optimization (Findings 1–4 fixed)
- [x] Supabase query profiling (migration 016 applied)
- [x] polling reduction (adaptive interval, customer request page)
- [x] Core Web Vitals baseline (preconnect + sentry.client.config.ts)
- [x] bundle size review (12 unused dependencies removed)
- [ ] production slow-query identification ← **NEXT TASK**

**النتيجة:** Stable and observable production runtime.

---

## Phase 1B — Critical Architecture Hardening ✅ (جزئي)
**الهدف:** تقوية قلب الـ marketplace قبل scale الحقيقي.

**تم:**
- [x] accept flow → RPC/transaction (migration 011)
- [x] complete flow → RPC/transaction (migration 014)
- [x] lifecycle mutation atomicity

**متبقي:**
- [ ] cron reliability + monitoring
- [ ] LAUNCH_PROMO → config خارج الكود
- [ ] PPJ fees → configurable server-side
- [ ] ops cron monitoring
- [ ] lifecycle rollback safety

---

## Phase 1C — Deep RLS Hardening & Least-Privilege Redesign
**الهدف:** تضييق RLS الواسعة بدون كسر lifecycle.

**الجداول المستهدفة:** requests / providers / provider_locations / request_locks / ratings

- [ ] policy واحدة كل مرة + smoke test بعدها مباشرة
- [ ] scoped views أو RPCs بدل broad SELECT
- [ ] منع direct browser access للحقول الحساسة
- [ ] realtime-safe RLS review
- [ ] admin-only access isolation
- [ ] provider/customer least-privilege separation

⚠️ أي policy change لا يجب أن يكسر: dashboards / realtime / assignment / PPJ / provider visibility / customer recovery / admin views.

---

## Phase 2A — UI System Pass ✅ (جزئي)
**الهدف:** Professional SaaS UI foundation.

**تم:**
- [x] Phase 2A.1 — Admin UI polish
- [x] Phase 2A.2 — Customer/Provider UI polish
- [x] Phase 2A.4 — Pricing & Subscription UI polish
- [x] Phase 2B.1 — Design System foundation (tokens, components)

**متبقي:**
- [ ] loading skeletons (provider + admin dashboards)
- [ ] unified modals
- [ ] accessibility pass
- [ ] design documentation

---

## Phase 2B — RTL & Arabic Foundation
**الهدف:** تأسيس عربي/RTL صحيح قبل التعريب الكامل.

- [ ] إصلاح أي mojibake
- [ ] dir="rtl" strategy
- [ ] Arabic font fallback
- [ ] RTL spacing/layout
- [ ] Arabic date + number formatting
- [ ] Tailwind RTL strategy
- [ ] RTL-safe components
- [ ] Arabic UX copy foundation
- [ ] Arabic dashboard layout testing
- [ ] Arabic mobile layout testing

ملاحظة: التعريب الكامل والـ SEO العربي في Phase 13.

---

## Phase 2C — Customer & Provider Mobile/PWA Strategy
**الهدف:** تجربة موبايل حقيقية للطوارئ والميدان.

⚠️ قرار استراتيجي: Web PWA أم Native app؟ لازم يتحسم قبل Phase 3.

- [ ] تحديد: Web PWA أم native
- [ ] provider field workflow audit
- [ ] customer emergency UX audit
- [ ] installable PWA evaluation
- [ ] offline behavior
- [ ] push readiness assessment
- [ ] touch optimization
- [ ] mobile navigation polish
- [ ] provider dashboard mobile-first
- [ ] payment flow mobile audit

---

## Phase 3 — Realtime & Notifications Foundation
**الهدف:** تحويل المنتج من refresh-driven إلى operationally aware.

**Customer realtime:** request accepted / released / completed / cancelled / provider reassigned

**Provider realtime:** new request / reopened / customer cancelled / assignment changed / active job changed

**القواعد:**
- lightweight toast/banner فقط
- لا duplicate subscriptions
- لا GPS streaming
- لا live map tracking بعد
- Push notifications مؤجّلة حتى يتحسم قرار Phase 2C

**المطلوب:**
- [ ] Supabase realtime cleanup
- [ ] reconnect handling
- [ ] stale-state reduction
- [ ] lightweight notification layer
- [ ] polling reduction where realtime is safe
- [ ] privacy-safe payloads
- [ ] customer/provider scoped realtime channels

---

## Phase 4 — Operations & Trust V1
**الهدف:** العميل يشعر أن الخدمة تتحرك فعليًا.

**Provider states:** accepted → en_route → arrived → completed / released / no_show

**Customer timeline:** Request received → Provider assigned → On the way → Arrived → Completed

- [ ] provider state transitions + UX
- [ ] customer-facing progress timeline UI
- [ ] delayed provider escalation
- [ ] customer report issue
- [ ] automatic release rules
- [ ] no-show tracking
- [ ] provider reliability foundation
- [ ] admin visibility for delayed/stuck jobs

لا live GPS streaming في V1.

---

## Phase 4B — Admin Operations Center
**الهدف:** الأدمن يقدر يشغّل المنصة من أول يوم production فعلي.

⚠️ يتوازى مع Phase 4 — مش بعدها.

- [ ] live requests dashboard
- [ ] stuck jobs view
- [ ] no-show alerts
- [ ] complaint inbox
- [ ] provider performance overview
- [ ] request filters/search
- [ ] payment exceptions
- [ ] revenue overview
- [ ] audit logs
- [ ] operational alerts
- [ ] admin export tools
- [ ] manual intervention tools
- [ ] incident recovery procedures

---

## Phase 5 — Provider KYC & UAE Compliance Operations
**الهدف:** شبكة مقدمين موثوقة وقانونية.

- [ ] admin document viewer
- [ ] Emirates ID review
- [ ] trade license review
- [ ] vehicle document review
- [ ] verification workflow
- [ ] suspension reasons
- [ ] provider agreement checkbox
- [ ] approval audit log
- [ ] UAE compliance operations

---

## Phase 6 — Dispatch Logic V2
**الهدف:** مين يشوف الطلب ومتى.

⚠️ Prerequisite: Google Maps Distance Matrix API + domain restrictions + quota monitoring + billing alerts.

- [ ] Business / Pro / Starter / PPJ priority tiers
- [ ] timed dispatch windows (30-second response windows)
- [ ] request locks + response timeout
- [ ] no-response escalation + auto-release
- [ ] distance/rating/plan scoring
- [ ] PostGIS dashboard integration
- [ ] fallback dispatch logic
- [ ] provider availability freshness
- [ ] no-show penalty influence on dispatch
- [ ] dispatch audit logs

---

## Phase 7 — Pricing Engine V2
**الهدف:** السعر والمسافة server-side وموثوقين.

- [ ] PPJ launch fee = 15 AED (server-side)
- [ ] بعد اللانش: near = 30 AED / far = 70 AED
- [ ] server-side distance calculation
- [ ] emirate-crossing logic
- [ ] price preview + fee lock
- [ ] fallback pricing لو PostGIS fails
- [ ] no client-trusted pricing
- [ ] promo config خارج الكود

---

## Phase 8 — Quote Approval & Commission Integrity
**الهدف:** منع التلاعب بالسعر.

- [ ] provider sends quote → customer approves
- [ ] job يبدأ بعد approval فقط
- [ ] revised quote + quote expiry
- [ ] customer rejects quote → dispute path
- [ ] final_price = approved quote (source of truth)
- [ ] no self-reported commission basis
- [ ] quote history + admin dispute visibility

---

## Phase 9 — Premium Jobs & Subscription Commission
**الهدف:** تفعيل revenue model صح.

**Premium job:** approved quote فوق 400 AED أو long-distance premium rule.
**Commission:** Starter 15% / Pro 10% / Business 0%

- [ ] server-side commission calculation
- [ ] لا commission قبل Quote Approval (Phase 8)
- [ ] commission audit trail
- [ ] provider-facing commission clarity
- [ ] admin revenue reporting

---

## Phase 10 — Billing Integrity, Credits, Refunds & Payout
**الهدف:** فلوس المنصة تبقى دقيقة وقابلة للتوسع.

- [ ] jobs_this_month integrity
- [ ] monthly reset cron reliability
- [ ] request expiry cron reliability
- [ ] overage enforcement
- [ ] refund workflows + Stripe refund API integration
- [ ] payout log/admin review
- [ ] billing portal UX
- [ ] **Stripe LIVE keys** — needed before real launch
- [ ] billing reconciliation

---

## Phase 11 — Fraud & Abuse Detection
**الهدف:** حماية الـ marketplace.

- [ ] repeated release/cancellation detection
- [ ] provider no-show patterns
- [ ] fake completion signals
- [ ] suspicious pricing + unusual location patterns
- [ ] customer spam detection
- [ ] provider abuse flags
- [ ] reliability scoring
- [ ] WhatsApp OTP verification (Twilio — ~$0.005/msg UAE)
- [ ] admin fraud review tools + fraud flags dashboard

---

## Phase 12 — Legal & UAE Compliance
**الهدف:** جاهزية قانونية قبل growth الحقيقي.

⚠️ لا SEO / Growth / Marketing كبير قبل هذه المرحلة.

- [ ] Terms of Service
- [ ] Privacy Policy — UAE PDPL-aware
- [ ] cancellation + refund policy
- [ ] provider terms + customer terms
- [ ] payment disclosure + location data disclosure
- [ ] dispute policy + limitation of liability
- [ ] data retention policy
- [ ] legal review before public scale

---

## Phase 13 — SEO Domination
**الهدف:** Organic growth after stability and legal readiness.

- [ ] Arabic/English SEO cleanup
- [ ] Arabic pages + UAE city pages
- [ ] missing emirates pages (Fujairah, UAQ)
- [ ] service pages + schema markup + LocalBusiness schema
- [ ] Core Web Vitals optimization
- [ ] Google Search Console setup
- [ ] content strategy + Arabic trust content
- [ ] bilingual landing pages + emergency intent pages

---

## Phase 14 — Growth & Provider Acquisition
**الهدف:** تشغيل السوق وزيادة العرض والطلب.

- [ ] provider onboarding campaigns
- [ ] WhatsApp sales scripts
- [ ] provider education + referral system
- [ ] customer trust content + conversion tracking
- [ ] growth analytics + acquisition funnels
- [ ] pricing experiments + retention tracking
- [ ] bilingual marketing assets
- [ ] provider acquisition playbook

---

## Phase 15 — Scale Architecture & Reliability
**الهدف:** تحمل النمو الحقيقي.

- [ ] background queues + reliable cron system
- [ ] cache strategy + realtime scaling
- [ ] DB indexes + partition review
- [ ] query optimization + media optimization
- [ ] incident monitoring + operational alerting
- [ ] backup/recovery plan + disaster recovery
- [ ] Supabase + Vercel cost monitoring
- [ ] production runbooks

---

## Phase 16 — Long-Term Expansion Readiness
**الهدف:** التحضير للتوسع بعد استقرار UAE core platform.

لا تبدأ قبل اكتمال: security + operations + dispatch + billing + legal + fraud + scale architecture.

- multi-emirate operational maturity
- multi-country readiness + multi-currency
- enterprise fleet accounts + corporate roadside contracts
- B2B dashboards + advanced reporting
- region-aware pricing
- white-label readiness (optional)

---

## الوضع الحالي للمشروع

| Phase | Status |
|---|---|
| Phase 0 | ✅ مكتمل |
| Phase 1 | ✅ مكتمل |
| Phase 1A | ✅ Tasks 1–7 مكتملة / Task 8 ناقص |
| Phase 1B | ✅ جزئي (RPC transactions done) |
| Phase 2A | ✅ جزئي (Admin + Customer + Pricing UI) |
| Phase 2B.1 | ✅ Design System foundation |
| Phase 1C | ⏳ قادم |
| Phase 2B (RTL) | ⏳ قادم |
| Phase 3–16 | ⏳ قادم |

**Next Task:** Phase 1A Task 8 — Production slow-query identification

---

## Migrations Applied
001 → 016 ✅ (Next = 017)

## Critical Rules
- commission_rate = 0, commission_amount = 0 — intentional حتى Phase 8
- PPJ fee = 15 AED — server-side only
- Google Maps — links only, no SDK حتى Phase 6
- Stripe — TEST mode حتى Phase 10
- accept_request_atomic + complete_provider_job_atomic — never bypass
- RLS changes — one at a time + smoke test
