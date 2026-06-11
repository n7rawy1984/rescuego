# CLAUDE.md

Last refreshed: 2026-06-11

Full source discovery on 2026-06-11 inspected 187 source/config/migration/i18n files before documentation refresh.

This file is for AI agents working in the RescueGo repository. The codebase is the source of truth. Start by reading `AGENTS.md`, then `ARCHITECTURE.md`.

## Project

RescueGo is a UAE roadside recovery marketplace.

Roles:

- `customer`
- `provider`
- `admin`

Core flow:

1. A customer creates a roadside assistance request.
2. Active online providers submit quotes.
3. The customer selects one quote.
4. The selected provider receives exact customer details.
5. The provider advances the job through the lifecycle.
6. The customer rates the completed job.

## Current Technical Stack

- Next.js 16 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS v4
- next-intl, Arabic default
- Supabase Auth, Postgres, Storage, Realtime
- Stripe
- Sentry
- Upstash Redis rate limiting with in-memory fallback
- Vercel deployment and cron routes

## Current Canonical Docs

- `ARCHITECTURE.md` - current code-derived architecture.
- `PROJECT_HANDOFF.md` - concise onboarding handoff.
- `MARKETPLACE_V2_SPEC.md` - current marketplace behavior.
- `ROADMAP.md` - current phase status.
- `SESSION_LOG.md` - chronological work history.
- `AGENTS.md` - required engineering rules.

Historical audit documents may be stale. Treat them as history unless they were explicitly refreshed.

## Critical Business Rules

- Marketplace V2 is quote-based.
- Providers see fuzzy customer location before quote submission.
- Exact customer details are revealed only after quote selection.
- Only `active` providers should receive marketplace requests or submit quotes.
- Providers in `pending`, `under_review`, `rejected`, or `suspended` should be blocked from marketplace participation.
- Current KYC intentionally requires only one document.
- Accepted KYC documents are Emirates ID, Driving License, and Vehicle Registration / Mulkiya.
- Final price should come from the selected quote or an approved price change. Legacy fallback still exists in code.

## Current Migration Position

Migrations run through `038_provider_kyc.sql`.

The next migration should be `039`.

Never edit deployed migrations. Create a new idempotent migration.

## Important Implementation Files

- `src/app/api/requests/route.ts`
- `src/app/api/requests/quotes/route.ts`
- `src/app/api/customer/quote/select/route.ts`
- `src/app/api/provider/jobs/quote/route.ts`
- `src/app/api/provider/jobs/advance-state/route.ts`
- `src/app/api/provider/jobs/complete/route.ts`
- `src/app/api/providers/documents/route.ts`
- `src/app/api/admin/providers/update/route.ts`
- `src/lib/provider-onboarding.ts`
- `src/lib/dispatch.ts`
- `src/lib/geo.ts`
- `src/lib/rate-limit.ts`
- `src/lib/logger.ts`
- `src/lib/supabase/admin.ts`
- `src/types/database.ts`
- `src/types/index.ts`

## Current Storage Model

Provider documents use the Supabase Storage bucket `provider-documents`.

Uploads:

- authenticated provider only
- fixed document fields only
- 5 MB per file
- JPEG, PNG, PDF only
- MIME and magic-byte validation
- storage path `${user.id}/${field}.${extension}`
- `upsert: true`

Admin viewing uses signed URLs with a 10 minute expiry.

## Current KYC Model

Provider statuses:

- `pending`
- `under_review`
- `active`
- `rejected`
- `suspended`

Uploading at least one valid document moves non-active providers to `under_review`.

Admin status changes are logged to `provider_kyc_log` when the status changes.

## Current Operational Routes

Configured in `vercel.json`:

- `/api/ops/expire-requests`
- `/api/ops/monthly-allowance-reset`
- `/api/ops/marketplace-cron`
- `/api/ops/weekly-sla-reset`

These routes require ops authentication.

## Working Rules For Agents

- Follow `AGENTS.md` strictly.
- Do not touch source code when the user requests documentation-only work.
- Use `rg` / `rg --files` for exploration.
- Before implementation work, check source, `SESSION_LOG.md`, and recent git commits.
- Keep docs aligned to code, not hopes or old plans.
- Put unresolved observations in `ARCHITECTURE.md` under `OBSERVATIONS FOR AUDIT`.
