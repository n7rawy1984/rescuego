# RescueGo

RescueGo is a UAE roadside recovery marketplace. Stranded drivers submit rescue requests; registered providers accept and complete jobs; admins review providers. Providers pay via monthly subscriptions or a per-job acceptance fee. Stripe handles all billing.

**Domain:** rescuego.ae  
**Status:** Phase 1A complete (tasks 1–7). Phase 1A Task 8 (slow-query identification) is next.

## Stack

- Next.js 16.2.6 App Router
- React 19 / TypeScript 5
- Tailwind CSS v4
- Supabase — Auth, Postgres, Storage, RLS, PostGIS
- Stripe — subscriptions, Payment Intents, webhooks
- Sentry — error capture (no replay, no tracing)
- Vercel — hosting + cron

## Quick Start

```bash
npm install
cp .env.example .env.local
# Fill in all variables (see SETUP.md §2)
npm run dev
```

Open `http://localhost:3000`.

## Documentation

| File | Purpose |
|---|---|
| `SETUP.md` | Supabase, Stripe, Auth, Storage, local dev setup, common errors |
| `VERDENT_HANDOFF.md` | Full project handoff — architecture, business logic, all phases, constraints |
| `DEPLOYMENT_STATUS.md` | Current production state — env vars, migrations, webhooks |
| `SESSION_LOG.md` | Engineering session log — decisions, findings, deferred items |
| `CLAUDE.md` | AI session rules and project phase tracking |

## Scripts

```bash
npm run dev      # local development (Turbopack)
npm run lint     # ESLint
npm run build    # production build
npm run start    # start production server locally
```

Migrations are applied manually in the Supabase SQL Editor. Run all files in `supabase/migrations/` in order (001 → 016).

## Architecture

Two-sided marketplace with three user roles: `customer`, `provider`, `admin`.

- `src/proxy.ts` — Next.js middleware (token refresh, unauthenticated redirect)
- `src/app/api/` — all server API routes
- `src/app/admin/`, `src/app/provider/`, `src/app/customer/` — role-specific UI
- `src/lib/supabase/admin.ts` — service_role client (server-side only)
- `supabase/migrations/` — all 16 schema migrations

See `VERDENT_HANDOFF.md` for complete architecture, business logic, and phase roadmap.

## Current Verification

- `npm run lint` passes.
- `npm run build` passes with Next.js 16.2.6 and Turbopack.
- 16 migrations applied in production.
- Sentry error capture verified in production (June 3, 2026).
