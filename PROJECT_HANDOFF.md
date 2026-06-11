# RescueGo Project Handoff

Last refreshed: 2026-06-11

Full source discovery on 2026-06-11 inspected 187 source/config/migration/i18n files before this handoff was refreshed.

Start with `ARCHITECTURE.md`. It is the canonical map of the current implementation.

## Current State

RescueGo is a UAE roadside recovery marketplace using Next.js 16, Supabase, Stripe, Tailwind CSS v4, next-intl, and Sentry.

The application currently supports:

- Customer request creation.
- Fuzzy provider pre-selection visibility for customer location.
- Marketplace V2 quote submission and quote selection.
- Provider job lifecycle states: accepted, en_route, arrived, in_progress, completed.
- Provider price-change request and customer response.
- Provider KYC with one required document.
- Admin provider review and document viewing through signed URLs.
- Subscription, overage, and Pay-Per-Job payment paths.
- Ops cron routes for request expiry, marketplace maintenance, allowance reset, and SLA reset.

## Current Migration Position

Migrations run through:

- `038_provider_kyc.sql`

Next migration number:

- `039`

Do not modify deployed migrations. Add a new idempotent migration for schema or policy changes.

## Critical Business Rules

- Customers do not see provider contact details until a quote is selected.
- Providers do not see exact customer details before quote selection.
- Providers should only see fuzzy customer location before quoting.
- Marketplace V2 is quote-based.
- Only `active` providers should participate in marketplace requests and quotes.
- Providers in `pending`, `under_review`, `rejected`, or `suspended` should be blocked from marketplace participation.
- Current KYC intentionally requires only one document.
- Accepted KYC documents are Emirates ID, Driving License, or Vehicle Registration / Mulkiya.
- Final job price should come from the selected quote or approved price change, with legacy fallback still present.

## Key Files

- `ARCHITECTURE.md` - current implementation map.
- `MARKETPLACE_V2_SPEC.md` - current quote marketplace behavior.
- `ROADMAP.md` - phase status and pending work.
- `SESSION_LOG.md` - chronological session history.
- `src/types/database.ts` - database-facing TypeScript types.
- `src/types/index.ts` - business constants and shared app types.
- `src/lib/provider-onboarding.ts` - KYC onboarding logic.
- `src/app/api/providers/documents/route.ts` - provider document upload.
- `src/app/api/admin/providers/update/route.ts` - admin provider status updates.
- `supabase/migrations/031_marketplace_v2.sql` - Marketplace V2 tables and RPCs.
- `supabase/migrations/037_force_rls.sql` - FORCE RLS and explicit deny policies.
- `supabase/migrations/038_provider_kyc.sql` - KYC statuses and log table.

## Security Boundaries

- Supabase sessions are cookie-based.
- Protected routes are session-gated in `proxy.ts`.
- API routes perform role checks in route handlers.
- Service-role Supabase access is server-only through `src/lib/supabase/admin.ts`.
- Ops routes require `OPS_CRON_SECRET` or Vercel cron authentication.
- Stripe webhooks require signature verification.
- Provider documents are stored in the `provider-documents` bucket and viewed through signed URLs.

## Current Payment Notes

- Stripe checkout and webhooks are implemented.
- Subscription state can affect provider status.
- PPJ and overage PaymentIntent success paths can call legacy request acceptance RPCs.
- Soft launch and launch promo flags exist in shared constants.
- Full production payment behavior should be reviewed before charging real customers/providers at scale.

## Known Audit Observation Location

Do not scatter new findings across handoff files. Add code-read observations to:

- `ARCHITECTURE.md` under `OBSERVATIONS FOR AUDIT`

Those observations are intentionally not fixes.

## Before Any Future Work

Follow `AGENTS.md`:

1. Read the relevant source files.
2. Check `SESSION_LOG.md`.
3. Check recent commits with `git log --oneline -20`.
4. Do not rely on old docs if they conflict with code.
5. Do not reimplement existing work.

## Documentation Status

This handoff has been refreshed from the codebase. Historical audit documents may still be useful context, but they should not override `ARCHITECTURE.md`, the current migrations, or current source files.
