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

## Phase 1A — Monitoring, Performance & Stability ✅
**الهدف:** تقليل اللاج والـ stale state قبل أي realtime complexity.

- [x] Sentry verification + event smoke test
- [x] auth/login performance audit (proxy.ts DB call removed)
- [x] logout lag investigation (signOut local scope)
- [x] dashboard loading optimization (Findings 1–4 fixed)
- [x] Supabase query profiling (migration 016 applied)
- [x] polling reduction (adaptive interval, customer request page)
- [x] Core Web Vitals baseline (preconnect + sentry.client.config.ts)
- [x] bundle size review (12 unused dependencies removed)
- [x] production slow-query identification (migration 017 applied)

**النتيجة:** Stable and observable production runtime.

---

## Phase 1B — Critical Architecture Hardening ✅
**الهدف:** تقوية قلب الـ marketplace قبل scale الحقيقي.

**تم:**
- [x] accept flow → RPC/transaction (migration 011)
- [x] complete flow → RPC/transaction (migration 014)
- [x] lifecycle mutation atomicity
- [x] LAUNCH_PROMO → NEXT_PUBLIC_LAUNCH_PROMO env var
- [x] PPJ fees → NEXT_PUBLIC_PPJ_* env vars
- [x] cron reliability + vercel.json + GET handlers + maxDuration
- [x] cancel double-compensation → cancel_request_and_compensate_atomic (migration 019)
- [x] release atomicity → release_job_atomic (migration 020)

**النتيجة:** All critical lifecycle mutations are atomic.

---

## Phase 1C — Deep RLS Hardening & Least-Privilege Redesign ✅
**الهدف:** تضييق RLS الواسعة بدون كسر lifecycle.

**تم:**
- [x] 6 over-broad RLS policies dropped/hardened (migration 021)
- [x] reset_monthly_job_counters revoked from public (migration 022)
- [x] ratings UNIQUE(job_id) confirmed (migration 022)
- [x] Storage bucket `provider-documents` RLS policies added (migration 023)
- [x] Overage TOCTOU fix: guard inside accept_provider_request_atomic (migration 024)
- [x] server-only guards on admin.ts, server.ts, ops-auth.ts, stripe.ts, rate-limit.ts

**النتيجة:** Least-privilege RLS with no broad SELECT policies remaining.

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

## Phase 2B — RTL & Arabic Foundation ✅
**الهدف:** تأسيس عربي/RTL صحيح قبل التعريب الكامل.

**تم:**
- [x] dir="rtl" strategy (automatic via locale in layout.tsx)
- [x] Arabic font (Cairo via next/font/google)
- [x] RTL spacing/layout (logical classes ms-/me-/ps-/pe- throughout)
- [x] Tailwind RTL strategy (logical utilities, no physical left/right)
- [x] RTL-safe components (verified in audit — zero directional CSS issues)
- [x] Arabic UX copy foundation (ar.json: 1,456 lines, ~98% translated)
- [x] Cookie-based locale switching (NEXT_LOCALE)
- [x] NextIntlClientProvider + server getTranslations setup
- [x] Phase A: provider/register + active job card + error.tsx + provider/plan translations ✅ (2026-06-08)
- [x] Phase B: aria-labels + auth bugs + footer ✅ (2026-06-08)

**متبقي (tracked in ARABIC_RTL_AUDIT.md):**
- [ ] Phase C: locale-aware metadata + date formatting + ar.json cleanup (syncs with SEO Phase 6)
- [ ] B-4: Recovery SEO pages Arabic strategy (syncs with Phase 13)

ملاحظة: التفاصيل الكاملة والتاسكات في `ARABIC_RTL_AUDIT.md`.

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

## Phase 3 — Realtime & Notifications Foundation ✅
**الهدف:** تحويل المنتج من refresh-driven إلى operationally aware.

**تم:**
- [x] Customer request page: Supabase realtime subscription on active request
- [x] Provider dashboard: ProviderRealtimeRefresh component (new open requests + active job changes)
- [x] Poll interval raised to 60s (heartbeat fallback only)
- [x] Privacy-safe payloads (no PII in realtime channels)
- [x] Customer/provider scoped realtime channels
- [x] Reconnect handling via Supabase client

**النتيجة:** Real-time updates for both customer and provider without polling dependency.

---

## Phase 4 — Operations & Trust V1 ✅
**الهدف:** العميل يشعر أن الخدمة تتحرك فعليًا.

**تم:**
- [x] Provider state transitions: accepted → en_route → arrived → in_progress (migration 025)
- [x] advance_provider_job_state atomic RPC (migration 026)
- [x] JobStateAdvanceButton component ("On My Way" / "I've Arrived" / "Start Job")
- [x] Customer-facing 5-step progress timeline UI
- [x] Provider dashboard integration with state machine
- [x] Admin visibility for delayed/stuck jobs (stuck jobs alert on dashboard)

**متبقي (future phases):**
- [ ] delayed provider escalation + automatic release rules
- [ ] customer report issue
- [ ] no-show tracking + provider reliability scoring

لا live GPS streaming في V1.

---

## Phase 4B — Admin Operations Center ✅ (جزئي)
**الهدف:** الأدمن يقدر يشغّل المنصة من أول يوم production فعلي.

**تم:**
- [x] live requests dashboard with extended status filter tabs (en_route, arrived)
- [x] stuck jobs alert banner (en_route/arrived > 2 hours)
- [x] provider performance leaderboard page (/admin/performance)
- [x] request filters/search (All/Open/Accepted/En Route/Arrived/In Progress/Completed/Cancelled/Expired)
- [x] Request Status card with all 7 live states
- [x] revenue overview

**متبقي:**
- [ ] complaint inbox
- [ ] admin export tools
- [ ] manual intervention tools
- [ ] incident recovery procedures
- [ ] operational alerts (automated)
- [ ] audit logs

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

**Tracked in `SEO_AUDIT.md`:**
- [x] Phase 1: Title duplication + OG image (PNG) + HSTS + hreflang ✅ (2026-06-08)
- [x] Phase 2: Schema types (Service/EmergencyService) + LocalBusiness fields ✅ (2026-06-08)
- [ ] Phase 3: Recovery pages expansion + internal links + per-city OG + FAQ schema
- [x] Phase 4: Page metadata + noindex auth + H1 hierarchy + sitemap fix ✅ (2026-06-08)
- [ ] Phase 5: PWA manifest + favicons + theme-color (syncs with Phase 2C)
- [ ] Phase 6: i18n SEO (locale-aware generateMetadata, og:locale:alternate) — depends on Arabic Phase C
- [ ] Arabic pages + missing emirates (Fujairah, UAQ)
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
| Phase 1A | ✅ مكتمل (all 8 tasks) |
| Phase 1B | ✅ مكتمل |
| Phase 1C | ✅ مكتمل |
| Phase 2A | ✅ جزئي (Admin + Customer + Pricing UI) |
| Phase 2B.1 | ✅ Design System foundation |
| Phase 2B | ✅ Phase A+B مكتمل — Phase C متبقي (يعتمد على SEO Phase 6) |
| Phase 3 | ✅ مكتمل (realtime subscriptions) |
| Phase 4 | ✅ مكتمل (state machine + advance-state) |
| Phase 4B | ✅ جزئي (stuck jobs, performance, filters done) |
| Phase 13 | ⚡ جزئي — Phases 1+2+4 ✅ مكتمل، Phases 3+5+6 ⏳ متبقي |
| Phase 5–12, 14–16 | ⏳ قادم |

**Next Priority:**
1. Phase 2C — PWA/Mobile strategy قرار (يحدد Phase 5 SEO: manifest + icons)
2. Arabic Phase C + SEO Phase 6 — locale-aware metadata + hreflang (مترابطين)
3. SEO Phase 5 — manifest.json + favicon variants + theme-color (يعتمد على 2C)
4. SEO Phase 3 — Recovery pages content expansion + FAQ schema (مع Phase 13 content)
5. Phase 2A remaining — loading skeletons, modals, accessibility
6. Phase 5+ — KYC, Dispatch, Pricing Engine...

---

## Migrations Applied
001 → 030 ✅ (Next = 031)

- 027: payout_log UNIQUE constraint (idempotent)
- 028: release_job_atomic + expire_stuck_active_requests
- 029: All RPCs updated with en_route/arrived + DROP old accept overload
- 030: requests table added to supabase_realtime publication (idempotent)

## Critical Rules
- commission_rate = 0, commission_amount = 0 — intentional حتى Phase 8
- PPJ fee = 15 AED (promo) — server-side only, controlled by NEXT_PUBLIC_LAUNCH_PROMO
- Google Maps — links only, no SDK حتى Phase 6
- Stripe — TEST mode حتى Phase 10
- accept_request_atomic + complete_provider_job_atomic + advance_provider_job_state — never bypass
- RLS changes — one at a time + smoke test
- New features MUST follow AGENTS.md standards (i18n, RTL, SEO, a11y, performance, security)
