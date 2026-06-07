@AGENTS.md

# RescueGo — Master Context for Claude Code

## المشروع
RescueGo — UAE roadside recovery marketplace (two-sided SaaS).
- Domain: rescuego.ae
- Stack: Next.js 16 App Router / React 19 / TypeScript / Tailwind CSS v4
- Backend: Supabase Auth + Postgres + Storage + RLS + PostGIS
- Payments: Stripe (subscriptions + Payment Intents + webhooks)
- Deployment: Vercel

---

## قواعد Session — إلزامية

### في بداية كل session
1. اقرأ CLAUDE.md و SESSION_LOG.md بس
2. لخص في جملة واحدة وقفنا فين
3. استنى instructions قبل ما تبدأ

### في نهاية كل session — تلقائي بدون طلب
قبل أي compact أو إغلاق:
1. حدّث SESSION_LOG.md بـ:
   - إيه اللي اتعمل النهارده
   - الـ findings المهمة
   - الـ next task بالتفصيل
   - أي deferred issues
2. قول للـ user: "Session log updated — ready for git push"

### Context Management
When context reaches 90%, stop immediately and:
1. Update SESSION_LOG.md with full session summary
2. Tell user: "Context at 90% — please git push and start new session"
3. Do not start any new task after this point

### لما يسألك A or B
Present options clearly and wait for user choice.
Never pick an option yourself without explicit user instruction.

### Migrations — إلزامي
Never run migrations automatically.
Always show the SQL first and tell user:
"Run this manually in Supabase SQL Editor"
Never apply schema changes without user confirmation.

### ENV Variables — إلزامي
Never add env vars to code.
Always tell user to add them in Vercel dashboard.
Never hardcode secrets anywhere.

### لما تلاقي Bug
Always report first — never fix silently.
Format:
- Bug found: [وصف]
- Location: [الملف والسطر]
- Impact: [التأثير]
- Proposed fix: [الحل]
- Wait for user approval before fixing

### Git — إلزامي
Never run git commands.
Always tell user to run from terminal:
git add . && git commit -m "..." && git push

### Lint & Build — إلزامي
Never run npm run lint or npm run build yourself.
Always tell user to run from terminal.

---

## القاعدة الذهبية قبل أي تغيير
1. اقرأ الملف كامل قبل ما تلمسه
2. اشرح إيه اللي هتغيره وليه
3. لا تكسر: Stripe flows / Supabase RLS / auth/session / request lifecycle semantics
4. بعد كل تغيير: قول للـ user يشغل lint && build من terminal
5. لو في شك — اسأل قبل ما تنفذ

---

## الحالة الحالية للمشروع

### مكتمل بالكامل
- Phase 0 — QA-FINAL
- Phase 1 — Security hardening + Sentry verified
- Phase 1A — Monitoring, Performance & Stability (all 8 tasks)
- Phase 1B — Critical Architecture Hardening (complete)
- Phase 1C — Deep RLS Hardening (migrations 021-024)
- Phase 2A.1 — Admin UI polish
- Phase 2A.2 — Customer/Provider UI polish
- Phase 2A.4 — Pricing & Subscription UI polish
- Phase 2B.1 — Design System foundation
- Phase 2B-1 — RTL infrastructure (Cairo font, logical classes)
- Phase 2B-2 — Physical → logical directional class migration (18 files)
- Phase 3 — Realtime & Notifications (customer + provider subscriptions)
- Phase 4 — Provider State Machine (en_route/arrived/advance-state)
- Phase 4B — Admin Operations Center (stuck jobs, performance, extended filters)
- Pre-launch hardening (C-1 through C-3, H-1 through H-4)
- Migrations: 001 → 027

### مكتمل حديثاً (بعد آخر تحديث)
- Phase 1A Task 8 — Production slow-query identification (migration 017)
- Phase 1B — Complete (LAUNCH_PROMO env, PPJ fees env, cron reliability, cancel/release atomicity)
- Phase 1C — Complete (migrations 021-024: RLS hardening, storage bucket RLS, overage TOCTOU fix)
- Phase 3 — Realtime & Notifications (customer + provider realtime subscriptions)
- Phase 4 — Provider State Machine (en_route/arrived states, advance-state API, migration 025)
- Phase 4B — Admin Operations Center (stuck jobs, performance leaderboard, filters)
- Phase 2B (partial) — RTL infrastructure (Cairo font, logical classes, @custom-variant rtl)
- Pre-launch hardening — C-1/C-2/C-3, H-1/H-2/H-3/H-4 (migration 026)
- Audit Phase 1: og-image.svg + logo.svg, payout_log UNIQUE + onConflict, provider dashboard RLS fix
- Audit Phase 2: Rate limiter fail-open with in-memory fallback (no more 429 for all when Redis missing)
- Audit Phase 3: complete/route.ts state machine alignment + advance-state null fix
- Audit Phase 4: NavbarServer eliminates duplicate client auth (~200ms savings per page)
- Audit Phase 5: Deleted 5 deprecated Supabase edge functions
- Audit Phase 6: CSP enforced + CSRF origin validation on all POST /api/* routes
- Audit Phase 7: getSiteUrl() fallback, Google Maps API key docs, PROJECT_HANDOFF updated, SETUP.md migrations complete
- Migrations: 001 → 027

### الجاي — Next Tasks
- Phase 2B-3: Arabic strings + RTL activation
- Phase 5: Provider KYC & UAE Compliance
- Phase 6: Dispatch Logic V2
- Phase 2B-3: Arabic strings + RTL activation

### المراحل القادمة بالترتيب
- Phase 2B remaining: Arabic strings (2B-3) + RTL activation
- Phase 2C: Mobile/PWA strategy
- Phase 5: Provider KYC & UAE Compliance
- Phase 6: Dispatch Logic V2
- Phase 7: Pricing Engine V2
- Phase 8: Quote Approval
- Phase 9: Premium Jobs & Commission
- Phase 10: Billing Integrity
- Phase 11: Fraud Detection
- Phase 12: Legal & UAE Compliance
- Phase 13: SEO Domination
- Phase 14: Growth & Provider Acquisition
- Phase 15: Scale Architecture

---

## قواعد لا تتكسر أبداً

### Stripe
- لا payment logic في client components
- webhook signature verification لازم تبقى
- idempotency keys لازم تبقى

### Supabase
- service_role key = server-side فقط
- RLS policies: تغيير واحد بالمرة + smoke test فوراً

### Commission
- commission_rate و commission_amount = 0 حالياً — intentional حتى Phase 8
- لا تحسب commission قبل Phase 8

### Google Maps
- حالياً: links فقط — لا Maps SDK
- لا تضيف Maps SDK إلا في Phase 6

---

## UI Prompt Templates

### قالب UI Polish Pass
```
RescueGo UAE — [Phase Name] UI Polish — Safe Pass

Goal: [هدف واضح — visual only]

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

Validation:
- npm run lint (user runs from terminal)
- npm run build (user runs from terminal)

Return:
- files changed
- UI improvements applied
- confirmation no logic/query/API changes
- deferred UI issues
```

### قالب Bug Fix
```
BUG — [وصف المشكلة]

Do NOT change billing, lifecycle, Stripe, auth, or request logic.

Goal: [الهدف المحدد]

Required fix:
- [التغيير المطلوب]

Return:
- files changed
- fix applied
- confirmation no other logic changed
```

### قالب Audit
```
RescueGo UAE — [Phase] Audit

Goal: [هدف الـ audit]

Do NOT change anything yet.
Report findings only.

Scope:
- [الملفات المحددة]

Return:
- findings with severity
- recommended fix order
- wait for user approval before any changes
```

---

## قواعد كتابة الـ Prompt
1. ابدأ بـ context — إيه اللي اتعمل قبل الـ task
2. Goal واحد واضح
3. "Do NOT" list صريحة
4. Scope محدد — الملفات بالاسم
5. Tasks مرقمة
6. Validation — user يشغله من terminal
7. Return محدد
8. لو في شك → defer مش implement
---

