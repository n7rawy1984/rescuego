# RescueGo Roadmap

Last refreshed: 2026-06-11

Full source discovery on 2026-06-11 inspected 187 source/config/migration/i18n files. This roadmap is code-derived, not copied from historical planning docs.

This roadmap reflects the current codebase. For implementation details, read `ARCHITECTURE.md`.

## Current Status

RescueGo has moved past the original early launch foundation. The code now contains:

- Marketplace V2 quote flow.
- Provider KYC with simplified one-document requirement.
- Admin provider review and document signed URL viewing.
- Provider lifecycle states through job completion.
- Stripe subscription, Pay-Per-Job, overage, and webhook paths.
- Operational cron routes.
- RLS hardening through migration `037`.
- Provider KYC schema through migration `038`.
- Realtime publication and client subscriptions for request and quote updates.

Current latest migration:

- `038_provider_kyc.sql`

Next migration:

- `039`

## Completed Foundations

- Next.js App Router structure.
- Supabase Auth integration.
- Supabase Postgres schema and migrations.
- Role model for customer, provider, and admin.
- Customer request creation.
- Provider onboarding.
- Provider profile and plan setup.
- Provider online location.
- UAE location validation helpers.
- Structured logging and redaction.
- Sentry setup.
- CSP and security headers.
- Rate limiting utility.
- Stripe helper utilities.
- Arabic and English message files.

## Completed Marketplace V2 Work

- `request_quotes` table.
- `provider_dispatch_log` table.
- `fair_price_config` table.
- Quote submission route.
- Quote listing route.
- Customer quote selection route.
- Quote expiration in marketplace cron.
- Selected quote assignment.
- Competing quote rejection.
- Provider scoring helper.
- Dispatch helper logic.
- Customer quote list UI.
- Provider quote form UI.
- Final price resolution from selected quote or approved price change.

Important current caveat:

- Database fair price enforcement was relaxed by migration `032`. Route-level broad validation remains, but configured fair price range enforcement is not active in `submit_quote_atomic`.

## Completed Provider Lifecycle Work

- Provider job states: accepted, en_route, arrived, in_progress, completed.
- RPC-backed state advancement.
- Provider SLA timer UI.
- Provider job release.
- Stuck job cleanup.
- Cancellation compensation path.
- Price-change request and customer response.
- Customer rating flow.

## Completed KYC Work

- Provider status enum expanded to `pending`, `under_review`, `active`, `rejected`, and `suspended`.
- Simplified one-document policy implemented.
- Document upload route with MIME, size, and magic-byte validation.
- Provider documents stored under provider-owned paths.
- Admin provider update route.
- Provider KYC log table.
- Admin document viewer with signed URLs.

Business rule:

- One document is enough for the current launch stage. Do not treat that as a bug unless code contradicts the policy.

## Completed Payment Work

- Stripe subscription checkout.
- Stripe billing portal redirection for existing subscriptions.
- Stripe webhook signature verification.
- Stripe event idempotency table usage.
- Subscription status handling.
- PPJ checkout route.
- Overage checkout route.
- Recovery credit support.
- Payout event logging.

## Current Operational Work

Configured Vercel cron routes:

- Expire stale requests.
- Reset monthly provider allowances.
- Run marketplace maintenance.
- Reset weekly SLA counters and visibility reduction.

## Before Production Launch

These items should be validated or completed before real production traffic and payments:

- Run a dedicated database, RLS, storage, and upload security audit.
- Confirm `provider-documents` bucket exists and is private in production.
- Review legacy first-accept routes beside Marketplace V2.
- Decide whether fair price enforcement should be re-enabled before launch.
- Review Stripe subscription status interaction with provider KYC status.
- Confirm all public/protected API routes have appropriate rate limits.
- Confirm admin actions and provider status changes meet audit-log requirements.
- Add automated tests for critical lib utilities, API routes, RPC behavior, and payment webhooks.
- Add CI for lint, typecheck, tests, build, security scan, and secret scanning.
- Verify production env vars against `.env.example`.
- Run Supabase migration smoke tests against a staging project.
- Verify backup and restore process.
- Verify Sentry redaction and operational alerting.

## Future Product Phases

### Phase: Production Hardening

- Security audit remediation.
- Test suite setup.
- CI enforcement.
- Admin audit log completeness.
- Monitoring and uptime checks.
- Production migration rehearsal.

### Phase: Payments at Scale

- Finalize soft launch versus full production payment behavior.
- Validate Stripe webhooks with replayed events.
- Add stronger payment state reconciliation.
- Confirm payout reporting requirements.

### Phase: Dispatch Optimization

- Revisit provider ranking.
- Re-enable or replace fair price validation.
- Improve destination distance handling.
- Add provider availability and SLA analytics.

### Phase: Operations

- Improve admin dashboards.
- Add support workflows.
- Add provider suspension and appeal process documentation.
- Add incident runbooks.

## Documentation Rule

When code changes, update the relevant current-state docs:

- `ARCHITECTURE.md`
- `MARKETPLACE_V2_SPEC.md`
- `PROJECT_HANDOFF.md`
- `SESSION_LOG.md`

Do not let historical audit files become the source of truth.
