<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:pre-task-verification-rule -->
# MANDATORY: Pre-Task Verification Rule

Before starting ANY fix, feature, or roadmap task — you MUST first verify whether the work has already been done:

1. **Check the actual code/files** — read the relevant source files to see if the fix/feature already exists.
2. **Check SESSION_LOG.md** — see if it was documented as completed in a previous session.
3. **Check git log** — run `git log --oneline -20` to see recent commits that may have addressed it.

If the task is already done:
- Review the existing implementation for correctness and best practices.
- If it needs improvement (outdated pattern, missing edge case, better approach available) — fix it.
- If it's already correct — skip it silently and move to the next task.
- Do NOT re-implement from scratch or overwrite working code unnecessarily.

If partially done:
- Complete the missing parts.
- Review the existing parts for quality — improve if needed.

This rule applies to ALL work: audit fixes, roadmap phases, SEO tasks, Arabic translation tasks, and any other modifications.

**Reason:** Multiple sessions may work on the same codebase. Work may have been completed but not documented in the audit reports. Always verify before acting.
<!-- END:pre-task-verification-rule -->

<!-- BEGIN:pre-implementation-checklist -->
# MANDATORY: Pre-Implementation Checklist

Before writing ANY code for a new feature, route, or significant change — answer these questions first. If any answer reveals a concern, address it in the implementation plan before coding.

1. **Architecture** — Does this fit the existing modular structure? Will it create coupling?
2. **Security** — What attack vectors does this expose? (injection, auth bypass, data leak)
3. **Database** — Will this query scale at 100K+ rows? Are indexes needed?
4. **Performance** — How many queries? How much bundle size added? Can it be lazy-loaded?
5. **Cost** — How many Supabase/Stripe/Sentry calls per request? Any unbounded loops?
6. **Error handling** — What happens when this fails? Is there a user-facing fallback?
7. **Maintainability** — Can another developer understand this in 6 months without comments?

Do NOT implement shortcuts. Do NOT create technical debt. Prefer scalable, secure, maintainable solutions. If there's a trade-off, document it in a code comment.
<!-- END:pre-implementation-checklist -->

---

<!-- ================================================================== -->
<!-- SECTION A: IMMEDIATE RULES — enforced on EVERY commit/task/feature -->
<!-- ================================================================== -->

<!-- BEGIN:architecture-rules -->
# A1. Architecture & Code Structure

## Principles
- **Modular Architecture** — each feature is self-contained in its own directory.
- **Separation of Concerns** — UI components never contain business logic or direct DB calls.
- **Service Layer** — complex business logic lives in `src/lib/` services, not in components or route handlers.
- **Single Responsibility** — every function/component does ONE thing. Max ~50 lines per function; split if larger.
- **DRY** — reuse `src/lib/` utilities before creating new ones. Check existing helpers first.

## File Structure Convention
```
src/app/[route]/page.tsx       → Page (Server Component by default)
src/app/[route]/layout.tsx     → Layout with metadata
src/components/[domain]/       → Reusable UI components
src/lib/                       → Business logic, services, utilities
src/lib/supabase/              → Database client variants
messages/                      → i18n JSON files (ar.json, en.json)
```

## Import Order
1. React/Next.js
2. External libraries
3. Internal `@/lib/` utilities
4. Internal `@/components/`
5. Types
6. Styles (if any)

## Forbidden Patterns
- God functions (`doEverything()`) — split into focused units.
- Prop drilling beyond 2 levels — use composition or context.
- `any` type — always provide proper types.
- Type assertions (`as`) — only when absolutely unavoidable, with explanation.
- Circular imports — never.
<!-- END:architecture-rules -->

<!-- BEGIN:security-rules -->
# A2. Security

## Authentication (Supabase Auth)
- Sessions are cookie-based via `@supabase/ssr` — never expose tokens client-side.
- Always verify session server-side before any protected operation.
- Use `supabase.auth.getUser()` (server-validated) — never trust `getSession()` alone for authorization.
- Internal/cron routes MUST verify `OPS_CRON_SECRET` bearer token via `src/lib/ops-auth.ts`.

## Authorization (Role-Based)
- Three roles: `customer`, `provider`, `admin`.
- Every protected route/API MUST check user role before executing.
- RLS (Row Level Security) on ALL Supabase tables — never bypass with `service_role` unless in a `SECURITY DEFINER` RPC.
- Principle of least privilege — grant minimum access required.

## Attack Prevention
- **SQL Injection** — always use parameterized queries (Supabase client handles this). Never string-concatenate SQL.
- **XSS** — React escapes by default. Never use `dangerouslySetInnerHTML` without sanitization.
- **CSRF** — cookie-based auth with `SameSite` attribute. API routes validate origin.
- **SSRF** — never fetch user-supplied URLs server-side without allowlist validation.
- **File Upload** — validate file type, size, and content server-side. Never trust client-side validation alone.
- **Open Redirect** — never redirect to user-supplied URLs without validating against allowed domains.

## Data Protection
- Secrets ONLY in environment variables — never in code, never in client bundles.
- Use `requireEnv()` from `src/lib/env.ts` for all env access.
- `NEXT_PUBLIC_` prefix ONLY for truly public values (site URL, Maps API key).
- Stripe secret key, Supabase service_role key — server-only, NEVER in client code.
- PII (phone, email, location) — log only redacted versions via `src/lib/logger.ts`.
- CSP headers enforced in `next.config.ts` — update allowlist when adding new external services.

## Function Grant Discipline (Postgres/Supabase)
- Default privileges are FAIL-CLOSED: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;` is applied project-wide (migration 056). Every newly created function is born callable by its owner only.
- Every new function AND every `DROP FUNCTION` + `CREATE` replacement MUST, in the same migration:
  1. `REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon, authenticated, service_role;`
  2. `GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO <only the roles proven necessary by a verified caller>;`
  3. Record the intended callable role(s) and the proof (file:line of the caller, or the RLS policy/trigger that depends on it) in a migration comment.
- Revoking `anon`/`authenticated` individually is never a substitute for revoking `PUBLIC` — `PUBLIC` membership is implicit for every role and silently reinstates access after a `DROP FUNCTION`.
- `CREATE OR REPLACE FUNCTION` (no preceding `DROP`) preserves the existing ACL — but must still be verified against the live grant, never assumed.
- Never grant `anon` unless a current, legitimate unauthenticated caller and a safe exposed return shape are proven — RLS-policy and trigger-body callers count as callers, not just application `.rpc()` call sites.

## Secrets Checklist (every PR)
- [ ] No API keys, tokens, or passwords in source code
- [ ] No secrets logged (even in error handlers)
- [ ] New env vars added to `.env.example` with placeholder values
- [ ] Client-accessible env vars are genuinely public
<!-- END:security-rules -->

<!-- BEGIN:database-rules -->
# A3. Database Design & Queries

## Schema Design
- **Think at scale** — before creating/modifying any table, consider behavior at 1M+ rows.
- **Indexes** — add on: foreign keys, frequently filtered columns (`user_id`, `email`, `status`, `created_at`), and search columns.
- **Unique constraints** — enforce uniqueness at DB level, not application level (e.g., `users.email`).
- **Soft delete** — use `deleted_at` timestamp instead of hard DELETE for user data and financial records.
- **Timestamps** — every table must have `created_at` (default `now()`) and `updated_at`.
- **UUID** — use as primary key. Never expose sequential IDs.

## Query Performance
- **N+1 Problem** — never query inside a loop. Use joins, `.in()` filters, or batch RPCs.
- **SELECT only needed columns** — never `SELECT *` in production queries.
- **Pagination** — mandatory for any list that can grow. Use cursor-based (`.range()`) for large datasets.
- **Full table scans** — prohibited. Every WHERE clause must hit an index.
- **RPC for complex logic** — use Postgres functions (`SECURITY DEFINER`) for multi-step operations that need atomicity.

## Migrations
- Sequential numbering: sequential, idempotent, never modify deployed ones. For the current migration baseline and next migration number, see `PROJECT_STATUS.md`.
- Each migration is idempotent — safe to re-run.
- Never modify a deployed migration — create a new one.
- Test migration both UP and DOWN before committing.

## Supabase Client Usage
| Context | Client | File |
|---------|--------|------|
| Browser/Client Component | `createBrowserClient` | `src/lib/supabase/client.ts` |
| Server Component / Route | `createServerClient` | `src/lib/supabase/server.ts` |
| Admin/Cron (no user session) | `service_role` client | `src/lib/supabase/admin.ts` |
<!-- END:database-rules -->

<!-- BEGIN:feature-standards -->
# A4. New Feature Engineering Standards

Every new feature, component, page, or route MUST comply with ALL of the following from day one. No exceptions, no "we'll add it later."

## 4.1 Internationalization (i18n)
- ALL user-facing strings MUST use `useTranslations()` (client) or `getTranslations()` (server) — zero hardcoded text.
- Add keys to BOTH `messages/ar.json` AND `messages/en.json` simultaneously.
- Arabic is the default locale — always write Arabic translations first.
- Use ICU message format for plurals, numbers, and interpolation.
- `aria-label`, `placeholder`, `alt`, `title` attributes MUST also be translated.

## 4.2 RTL/LTR Layout
- Use ONLY logical CSS properties: `ms-`/`me-`/`ps-`/`pe-`/`start`/`end` — never `ml-`/`mr-`/`pl-`/`pr-`/`left`/`right` for directional spacing.
- Test visually in both `dir="rtl"` and `dir="ltr"`.
- Icons that imply direction (arrows, chevrons) must flip with `rtl:rotate-180`.

## 4.3 SEO & Metadata
- Every public page MUST export `metadata` or use `generateMetadata()` with locale-aware title + description.
- Follow title template: `"{Page Title}"` — layout appends `| RescueGo UAE` automatically. Do NOT include brand in page title.
- Add `openGraph` (title, description, image, type) for every public page.
- Use exactly ONE `<h1>` per page. Heading hierarchy: h1 > h2 > h3, no level skipping.
- Add JSON-LD schema markup where applicable (Service, FAQ, HowTo, etc.).

## 4.4 Accessibility (a11y)
- Every interactive element MUST have accessible name (aria-label or visible text).
- Every `<img>` / `<Image>` MUST have meaningful `alt` text (translated).
- Form inputs MUST have associated `<label>` elements.
- Color contrast MUST meet WCAG AA (4.5:1 for text, 3:1 for large text).
- Focus management: all interactive elements must be keyboard-navigable.

## 4.5 Performance
- Use `next/image` for ALL images with explicit `width`/`height` or `fill`.
- Lazy-load below-the-fold content with `loading="lazy"` or dynamic imports.
- Avoid importing large libraries in client components — prefer tree-shakeable imports.
- Keep initial bundle per route under 100KB (compressed).
- Server Components by default — only add `'use client'` when truly needed (hooks, browser APIs, interactivity).

## 4.6 Error Handling
- Every async operation MUST have try/catch with meaningful user-facing fallback.
- Use Next.js `error.tsx` boundaries for route-level errors.
- Use `loading.tsx` for route-level loading states.
- API routes return consistent shape: `{ error: string, message?: string }` on failure.
- Never swallow errors silently — at minimum log via `src/lib/logger.ts`.

## 4.7 Code Quality
- Follow existing patterns: file naming, component structure, import order.
- No comments unless logic is genuinely complex.
- Type everything — no `any`, no type assertions unless absolutely necessary.
- Reuse existing utilities (`src/lib/`) before creating new ones.
- Functions: single responsibility, max ~50 lines, descriptive names.

**Enforcement:** If any of the above is missing from a task output, it is considered incomplete. Fix before marking done.
<!-- END:feature-standards -->

<!-- BEGIN:performance-rules -->
# A5. Performance & Cost Awareness

## Per-Request Budget
- Max **5 database queries** per page render (combine with joins/RPCs if more needed).
- Max **100KB** compressed JS per route.
- Target **< 200ms** server response time for dynamic routes.

## Caching Strategy
- Use Next.js built-in caching (`fetch` cache, `unstable_cache`) for rarely-changing data.
- Supabase queries that don't change per-user → cache at edge.
- Static pages (`generateStaticParams`) for public marketing/SEO pages.
- Browser cache via proper `Cache-Control` headers for static assets.

## Cost Control
- Supabase: minimize realtime subscriptions — one per active page max.
- Stripe: batch webhook processing, use idempotency keys.
- Sentry: filter noise (don't report 404s, user disconnects).
- Google Maps: links only (no SDK embed) until Phase 6.
- Never create unbounded loops or recursive calls without limits.

## Bundle Optimization
- Dynamic import (`next/dynamic`) for heavy components (maps, charts, editors).
- Prefer CSS (Tailwind) over JS for animations/transitions.
- Tree-shake: import specific functions, not entire libraries.
- Analyze with `next build` output — flag any route > 100KB.
<!-- END:performance-rules -->

<!-- BEGIN:rate-limiting-rules -->
# A6. Rate Limiting

Already implemented in `src/lib/rate-limit.ts` (Upstash Redis + in-memory fallback).

## Required Limits
| Endpoint | Limit | Window |
|----------|-------|--------|
| Login / Auth | 5 requests | 1 minute |
| Registration | 3 requests | 1 minute |
| Password Reset | 3 requests | 5 minutes |
| API (general) | 100 requests | 1 minute |
| Webhook endpoints | 200 requests | 1 minute |
| File uploads | 10 requests | 5 minutes |

## Rules
- Every public API route MUST apply rate limiting.
- Return `429 Too Many Requests` with `Retry-After` header.
- Rate limit by IP for unauthenticated routes, by user ID for authenticated routes.
- Log rate-limit hits for abuse detection.
<!-- END:rate-limiting-rules -->

<!-- BEGIN:billing-rules -->
# A7. Billing & Payments (Stripe)

## Critical Safeguards
- **Idempotency keys** — every Stripe API call that creates/modifies resources MUST include one.
- **Webhook signature verification** — ALWAYS verify `stripe-signature` header. Never trust unverified webhooks.
- **Duplicate payment prevention** — check existing payment status before creating new PaymentIntent.
- **Retry handling** — webhooks may fire multiple times. All handlers MUST be idempotent.
- **Currency** — AED only. Always work in fils (smallest unit). Use `toFils()` and `formatAED()` from `src/lib/stripe.ts`.

## Subscription Rules
- Plan changes: prorate by default.
- Failed payments: Stripe handles retry schedule. Listen to `invoice.payment_failed` webhook.
- Cancellation: immediate access until period end (don't revoke mid-cycle).
- Commission rates: Starter 15%, Pro 10%, Business 0% — server-side only, never trust client.
- PPJ fee = 15 AED (promo) — controlled by `NEXT_PUBLIC_LAUNCH_PROMO`.

## Forbidden
- Never store full card numbers — Stripe handles PCI compliance.
- Never log Stripe secret key or webhook signing secret.
- Never trust client-submitted prices — always resolve from server-side plan config.
<!-- END:billing-rules -->

---

<!-- ================================================================== -->
<!-- SECTION B: PRE-PRODUCTION RULES — must be in place before launch   -->
<!-- ================================================================== -->

<!-- BEGIN:monitoring-rules -->
# B1. Monitoring & Observability

## Error Tracking (Sentry — already configured)
- Every unhandled exception is captured automatically.
- Add `Sentry.captureException()` for caught errors that need visibility.
- Use `src/lib/sentry-redaction.ts` to strip PII before sending.
- Set meaningful error context: user ID (hashed), route, action.

## Structured Logging (already configured)
- Use `src/lib/logger.ts` for ALL server-side logging.
- JSON format in production, human-readable in dev.
- Automatic redaction of sensitive keys (tokens, passwords, coordinates).
- Include request IDs for tracing.
- Log levels: `error` (failures), `warn` (degraded), `info` (operations), `debug` (dev only).

## Audit Logs (implement before Phase 10)
Track these events in a `audit_logs` table:
- User role changes
- Plan upgrades/downgrades
- Account deletions
- Admin actions (impersonation, manual overrides)
- Payment disputes/refunds
- Provider status changes (approved, suspended)

## Uptime Monitoring (implement before launch)
- External health check endpoint: `/api/health` → returns 200 + DB connectivity status.
- Monitor from external service (Better Stack / UptimeRobot).
- Alert on: 5xx spike, response time > 2s, DB connection failures.
<!-- END:monitoring-rules -->

<!-- BEGIN:testing-rules -->
# B2. Testing Strategy

## Current State
No test framework configured yet. When implementing (Phase target: before production):

## Phase 1: Unit Tests (first priority)
- Framework: **Vitest** (fast, ESM-native, compatible with Next.js).
- Cover: `src/lib/` utilities, business logic, helpers.
- Target: 80% coverage on `src/lib/`.
- Every new utility function ships with its test.

## Phase 2: Integration Tests
- Cover: API routes, database RPCs, webhook handlers.
- Use Supabase local dev for test DB.
- Test happy path + error paths + edge cases.

## Phase 3: E2E Tests
- Framework: **Playwright** (cross-browser, reliable).
- Cover: critical user flows (request service, provider accept, payment).
- Run in CI before deploy.

## Rules (apply immediately even without framework)
- Design components to be testable: props-driven, minimal side effects.
- Export types and constants that tests may need.
- Pure functions over side-effectful ones where possible.
- Never merge code that breaks existing tests (when tests exist).
<!-- END:testing-rules -->

<!-- BEGIN:cicd-rules -->
# B3. CI/CD Pipeline

## Current: Vercel Auto-Deploy
- Every push to `main` triggers Vercel build.
- Build includes: TypeScript check + Next.js compilation.

## Target Pipeline (implement via GitHub Actions before production)
Every push MUST pass:
1. **Lint** — ESLint with project rules
2. **Type Check** — `tsc --noEmit`
3. **Tests** — Vitest unit + integration (when configured)
4. **Security Scan** — `npm audit` + secrets detection
5. **Build** — `next build` succeeds

If ANY step fails → block deploy.

## Branch Strategy
- `main` — production, always deployable.
- Feature branches → PR → review → merge.
- Never push directly to `main` for features (hotfixes acceptable).

## Deploy Rules
- Zero-downtime deploys (Vercel handles this).
- Environment variables: never change production env vars without testing in preview first.
- Database migrations: apply BEFORE deploying code that depends on them.
<!-- END:cicd-rules -->

<!-- BEGIN:backup-rules -->
# B4. Backups & Disaster Recovery

## Database Backups (Supabase manages)
- **Daily** — automatic point-in-time recovery (Supabase Pro plan).
- **Weekly** — manual export verification (test restore works).
- Verify backup integrity quarterly — a backup you can't restore is not a backup.

## Application Recovery
- All code in Git — full history preserved.
- Environment variables documented in `.env.example`.
- Infrastructure-as-code: Vercel project settings + Supabase config reproducible.
- Deployment rollback: Vercel instant rollback to previous deployment.

## Incident Response
- If production breaks: rollback first, investigate second.
- Document root cause in `SESSION_LOG.md` after resolution.
- Add regression prevention (test, guard, or monitoring) for every incident.
<!-- END:backup-rules -->

---

<!-- ================================================================== -->
<!-- SECTION C: STRATEGIC RULES — reference for long-term decisions     -->
<!-- ================================================================== -->

<!-- BEGIN:cost-optimization -->
# C1. Cost Optimization

## Review with Every Feature
- How many additional DB queries per request?
- How much JS bundle size added?
- Any new external API calls? What's the per-call cost?
- Any new realtime subscriptions? (Supabase charges by concurrent connections)
- Any unbounded storage growth? (file uploads, logs)

## Current Cost Centers
| Service | Cost Driver | Control |
|---------|-------------|---------|
| Supabase | Rows read, storage, realtime connections | Efficient queries, pagination, limit subscriptions |
| Vercel | Bandwidth, serverless invocations, build minutes | Static where possible, edge caching |
| Stripe | 2.9% + 30¢ per transaction | No unnecessary test charges in production |
| Sentry | Events/month | Filter noise, sample traces |
| Google Maps | Per-load pricing (future) | Links only until Phase 6 |

## Red Flags
- Infinite loops or recursive calls without exit conditions.
- Polling instead of webhooks/realtime.
- Loading entire datasets when only aggregates needed.
- Multiple Stripe API calls when one batch call suffices.
<!-- END:cost-optimization -->

<!-- BEGIN:api-design -->
# C2. API Design Standards

## Conventions
- Base path: `/api/` (Next.js route handlers).
- Versioning: not needed yet (single client). Add `/api/v1/` when public API is exposed.
- Response format: always JSON.

## Response Shapes
```typescript
// Success
{ data: T }
// or for lists:
{ data: T[], count: number, next_cursor?: string }

// Error
{ error: string, message?: string, code?: string }
```

## Rules
- Every route handler validates input with Zod schema.
- Return appropriate HTTP status codes (200, 201, 400, 401, 403, 404, 429, 500).
- Never return stack traces or internal errors to client.
- Rate limit all public endpoints.
- Log all 5xx errors with full context.
- Idempotent where possible (especially for payment operations).

## Documentation
- When public API is exposed (future): OpenAPI/Swagger spec.
- Internal routes: TypeScript types serve as documentation.
<!-- END:api-design -->

<!-- BEGIN:feature-flags -->
# C3. Feature Flags & Gradual Rollout

## Current Mechanism
- `NEXT_PUBLIC_LAUNCH_PROMO` — controls promotional pricing.
- Environment variables as simple feature flags.

## Rules for New Features
- High-risk features: gate behind env var flag before enabling in production.
- Pattern: `NEXT_PUBLIC_FF_[FEATURE_NAME]` for client-visible, `FF_[FEATURE_NAME]` for server-only.
- Remove flags once feature is stable and fully rolled out (no permanent flags).
- Never ship half-implemented features without a flag — either complete or gated.
<!-- END:feature-flags -->

<!-- BEGIN:documentation-rules -->
# C4. Documentation Standards

## Required for Every Feature (in code)
- TypeScript types/interfaces — self-documenting.
- Complex logic — brief inline comment explaining WHY (not WHAT).
- New env vars — add to `.env.example` with description comment.

## Project-Level Docs (maintain as needed)
- `ROADMAP.md` — phase status, priorities, dependencies.
- `ARABIC_RTL_AUDIT.md` — i18n task tracking.
- `SEO_AUDIT.md` — SEO task tracking.
- `SESSION_LOG.md` — completed work per session.
- `AGENTS.md` — this file (engineering rules).

## Forbidden
- Do NOT create README.md or docs/ unless explicitly requested.
- Do NOT add JSDoc to every function — only where complexity demands it.
- Do NOT write documentation instead of writing clear code.
<!-- END:documentation-rules -->

<!-- BEGIN:multi-role-architecture -->
# C5. Multi-Role Architecture

## Current Roles
| Role | Access | Routes |
|------|--------|--------|
| `customer` | Request service, track, pay | `/customer/*` |
| `provider` | Accept jobs, manage profile, earnings | `/provider/*` |
| `admin` | Full system access, user management | `/admin/*` |

## Rules
- Role is stored in `users.role` — source of truth.
- Every protected page checks role server-side in layout/page.
- API routes verify role before executing — never trust client-side role checks.
- Future roles (e.g., `fleet_manager`, `support_agent`) — add to enum, extend RBAC matrix.
- Role escalation (customer → provider): requires KYC verification flow (Phase 5).

## Permission Boundaries
- Customers NEVER see provider/admin data.
- Providers NEVER see other providers' data or earnings.
- Admin actions are audit-logged (Section B1).
- `service_role` client only used in server-side RPCs, never exposed to any client.
<!-- END:multi-role-architecture -->

---

<!-- ================================================================== -->
<!-- QUICK REFERENCE: Stack & Constraints                                -->
<!-- ================================================================== -->

<!-- BEGIN:stack-reference -->
# Stack Quick Reference

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16 (App Router) | Server Components default |
| Language | TypeScript 5 (strict) | No `any` |
| Styling | Tailwind CSS v4 | Logical properties for RTL |
| i18n | next-intl v4 | Arabic default, English secondary |
| Database | Supabase (Postgres + Auth + Storage + Realtime) | RLS on all tables |
| Payments | Stripe (AED, fils) | Test mode until Phase 10 |
| Monitoring | Sentry | Already configured |
| Rate Limiting | Upstash Redis | With in-memory fallback |
| Deployment | Vercel | Auto-deploy from main |
| Maps | Google Maps (links only) | No SDK until Phase 6 |
| Domain | rescuego.ae | UAE only |

## Critical Constraints
- `commission_rate = 0` — intentional until Phase 8.
- PPJ fee = 15 AED (promo) — server-side only.
- Google Maps — links only, no SDK until Phase 6.
- Stripe — TEST mode until Phase 10.
- Atomic RPCs (`accept_request_atomic`, `complete_provider_job_atomic`, `advance_provider_job_state`) — never bypass.
- RLS changes — one at a time + smoke test.
- Migrations: sequential, idempotent, never modify deployed ones.
<!-- END:stack-reference -->
