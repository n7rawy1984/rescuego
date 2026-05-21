# RescueGo

RescueGo is a Next.js MVP for a UAE roadside recovery marketplace. Drivers submit roadside requests, providers register and upload documents, admins review providers, and Stripe supports provider subscriptions.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Supabase Auth, Postgres, Storage, RLS
- Stripe subscriptions and webhooks

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` using `.env.example`.

3. Create and configure Supabase using `SETUP.md`.

4. Run migrations in order:

```txt
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rpc_functions.sql
supabase/migrations/003_harden_provider_rls.sql
```

5. Start local development:

```bash
npm run dev
```

6. Open:

```txt
http://localhost:3000
```

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

There is no test script, database migration runner, or seed script configured in
`package.json` yet. Supabase SQL migrations are currently applied manually from
the `supabase/migrations` directory.

## Documentation

- `SETUP.md` contains Supabase, Stripe, auth, storage, and local development setup.
- `PROJECT_HANDOFF.md` contains a full handoff package for another engineer or AI agent.

## Current Verification

- `npm run lint` passes.
- `npm run build` passes with Next.js 16.2.6 and Turbopack.
