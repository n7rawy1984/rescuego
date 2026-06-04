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
- Phase 1B.4 — Realtime & polling stability
- Phase 1B.5 — Lifecycle recovery hardening (migration 014)
- Phase 2A.1 — Admin UI polish
- Phase 2A.2 — Customer/Provider UI polish
- Phase 2A.4 — Pricing & Subscription UI polish
- Phase 2B.1 — Design System foundation
- Phase 1A Task 1 — Auth/login performance audit + proxy.ts DB call fix
- Phase 1A Task 2 — Logout lag fix (signOut local scope)
- Phase 1A Task 3 — Dashboard loading audit (Findings 1–4 fixed)
- Phase 1A Task 4 — Supabase query profiling + migration 016 + location/accept route parallelization
- Phase 1A Task 5 — Polling audit + adaptive interval fix (customer request page)
- Phase 1A Task 6 — CWV baseline audit + preconnect fix (layout.tsx)
- Migrations: 001 → 016

### الجاي — Phase 1A Task 6 Finding 1
Create `sentry.client.config.ts` — client-side Sentry missing entirely.
Read `sentry.server.config.ts` + `sentry.edge.config.ts` first to match pattern.
Enables browser error tracking + INP/LCP/CLS in production.
Then: Task 7 (bundle size review), Task 8 (production slow-query identification).

### المراحل القادمة بالترتيب
- Phase 1A: tasks 2-8 (logout / dashboard / queries / polling / CWV / bundle / slow-query)
- Phase 1B remaining: cron reliability / DB indexes / LAUNCH_PROMO config
- Phase 1C: Deep RLS hardening
- Phase 2B: RTL & Arabic foundation
- Phase 2C: Mobile/PWA strategy
- Phase 3: Realtime & Notifications
- Phase 4: Operations & Trust V1
- Phase 4B: Admin Operations Center
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
