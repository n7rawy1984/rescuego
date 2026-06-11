# RescueGo

RescueGo is a UAE roadside recovery marketplace. Customers request roadside assistance, providers submit quotes, customers select a provider, and admins operate provider review and marketplace oversight.

Current status: Marketplace V2, provider KYC, admin document review, Stripe billing paths, operational crons, realtime request/quote updates, and RLS hardening are implemented in the codebase. Read `ARCHITECTURE.md` first for the current source-derived map.

Last full source discovery: 2026-06-11, covering 187 source/config/migration/i18n files.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript 5 strict mode
- Tailwind CSS v4
- next-intl with Arabic as default locale
- Supabase Auth, Postgres, Storage, Realtime, RLS, PostGIS
- Stripe subscriptions, PaymentIntents, and webhooks
- Sentry
- Upstash Redis rate limiting with in-memory fallback
- Vercel hosting and cron

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev      # local development
npm run lint     # ESLint
npm run build    # production build
npm run start    # start production server locally
```

## Documentation

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | Canonical current-state architecture and audit observations |
| `PROJECT_HANDOFF.md` | Practical handoff for a fresh AI agent |
| `ROADMAP.md` | Current phase status and remaining production work |
| `MARKETPLACE_V2_SPEC.md` | Implemented quote-marketplace behavior |
| `SESSION_LOG.md` | Chronological engineering session log |
| `CLAUDE.md` | AI agent project notes |
| `AGENTS.md` | Required engineering rules |
| `SETUP.md` | Local setup and service configuration notes |

Historical audit reports and older handoff files may contain stale context. Prefer `ARCHITECTURE.md` and current source code when resolving conflicts.

## Current Architecture

Roles:

- `customer`
- `provider`
- `admin`

Core marketplace flow:

1. Customer creates a request.
2. Providers see fuzzy request location before quote selection.
3. Active online providers submit quotes.
4. Customer selects one quote.
5. Exact details are revealed to the selected provider.
6. Provider advances the job lifecycle.
7. Customer rates the completed job.

Provider KYC currently requires one accepted document:

- Emirates ID
- Driving License
- Vehicle Registration / Mulkiya

## Migrations

Migrations live in `supabase/migrations/`.

Current latest migration:

- `038_provider_kyc.sql`

Next migration number:

- `039`

Run migrations in order. Do not edit deployed migrations.

## Important Runtime Files

- `proxy.ts` - session refresh, protected route redirects, API origin checks.
- `next.config.ts` - Next config, CSP/security headers, Sentry wrapping.
- `vercel.json` - operational cron schedule.
- `src/lib/supabase/admin.ts` - server-only service-role client.
- `src/lib/rate-limit.ts` - rate limiting.
- `src/lib/logger.ts` - structured logging and redaction.
- `src/types/database.ts` - database-facing TypeScript types.
- `src/types/index.ts` - application constants and shared types.
