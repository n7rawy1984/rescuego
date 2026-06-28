# RescueGo Architecture

Last refreshed: 2026-06-11

Source discovery basis: 187 source/config/migration/i18n files were inspected from the working tree, excluding dependency/build output, generated assets, package lock data, and markdown history. The code is the source of truth.

## Project Purpose

RescueGo is a UAE roadside recovery marketplace. Customers request roadside assistance, providers submit quotes, customers select a provider, and admins review providers and operate the marketplace.

## Business Model

- Providers can use Pay-Per-Job or subscriptions.
- Subscription plans are Starter, Pro, and Business.
- PPJ, overage, and subscription flows are implemented with Stripe.
- Soft launch flags exist, but real Stripe checkout/webhook paths are present.
- Commission fields exist, but current completion RPC sets commission to zero.

## Architecture Overview

- Next.js 16 App Router serves pages and API routes.
- Supabase provides Auth, Postgres, Storage, Realtime, RLS, and PostGIS.
- Stripe handles subscriptions, PPJ fees, overage fees, and payout events.
- Sentry is configured for client, server, and edge runtimes with redaction.
- Vercel hosts the app and runs cron routes from `vercel.json`.
- Arabic is the default locale; English is also available through `next-intl`.

## Folder Structure

- `src/app` - routes, pages, layouts, loading states, SEO images, and API handlers.
- `src/app/api` - server API routes for customer, provider, admin, ops, requests, ratings, and Stripe.
- `src/components` - UI, layout, forms, customer, provider, dashboard, and Stripe components.
- `src/lib` - business logic, Supabase clients, Stripe utilities, logging, rate limiting, geo, dispatch, scoring, onboarding.
- `src/types` - database-facing and shared business types/constants.
- `messages` - Arabic and English translation JSON.
- `supabase/migrations` - database schema, RLS, indexes, storage policies, and security-definer RPCs.
- `supabase/functions` - deprecated Supabase Edge Function area. Active flows use Next.js API routes.

## Config and Deployment

- `package.json` uses Next 16.2.6, React 19.2.4, TypeScript 5, Tailwind CSS v4, Supabase JS 2.106.1, Stripe 22.1.1, Sentry 10.55.0, and next-intl 4.13.0.
- `next.config.ts` applies next-intl, Sentry wrapping, CSP/security headers, and image settings.
- `proxy.ts` refreshes Supabase auth cookies, redirects unauthenticated protected pages, and checks origins for mutating API requests except Stripe webhook and ops routes.
- `vercel.json` runs four cron routes: request expiry, monthly allowance reset, marketplace cron, and weekly SLA reset.
- `tsconfig.json` is strict and excludes `supabase/functions`.
- `eslint.config.mjs` uses Next core web vitals and TypeScript config, with `react-hooks/set-state-in-effect` disabled.

## Database Overview

Current migration position:

- Latest migration: `038_provider_kyc.sql`
- Next migration: `039`

Core tables:

- `users` - auth profile, role, contact data, customer counters.
- `providers` - provider plan, status, business fields, documents, Stripe IDs, counters, ratings, SLA flags.
- `provider_locations` - current online location with generated `lat`/`lng` columns.
- `requests` - customer service requests, location, fuzzy coordinates, lifecycle state, selected quote, price changes, cancellation, PPJ/overage flags.
- `jobs` - accepted/completed job record used for lifecycle compatibility and ratings.
- `ratings` - customer ratings for completed jobs.
- `request_locks` - legacy acceptance lock table.
- `stripe_events` - Stripe webhook idempotency and processing state.
- `payout_log` - Stripe payout records.
- `price_estimates` - public estimate config from the initial schema.
- `ppj_payments` - Pay-Per-Job payment tracking.
- `overage_payments` - subscription overage payment tracking.
- `request_quotes` - Marketplace V2 provider quotes.
- `provider_dispatch_log` - quote, selection, SLA, and completion analytics.
- `fair_price_config` - fair price config used for UI/scoring AND DB enforcement. Enforcement was disabled by migration `032`, RE-ENABLED by migration `039` (Batch 1, C5/D2), and TEMPORARILY WIDENED by migration `044` for testing (bounds 0.01/10000; validation still runs). LAUNCH BLOCKER: the formula must be redesigned (two-leg distance: provider→breakdown + breakdown→destination, tied to a mandatory 7-emirate destination dropdown) before go-live — see DEFERRED_PRODUCT_BACKLOG.md P9/P1/P2.
- `provider_kyc_log` - provider status transition history.

Important RPCs:

- `get_nearby_open_requests`
- `accept_provider_request_atomic`
- `complete_provider_job_atomic`
- `cancel_request_and_compensate_atomic`
- `release_job_atomic`
- `expire_stale_open_requests`
- `expire_stuck_active_requests`
- `advance_provider_job_state`
- `submit_quote_atomic`
- `select_quote_atomic`
- `sla_check_and_release`
- `restore_ppj_credit_for_cancelled_paid_request`

## RLS Overview

- Application tables have RLS enabled.
- Migration `037` applies FORCE RLS to the main application tables.
- Sensitive direct writes are explicitly denied for authenticated users on jobs, request locks, Stripe events, and payout logs.
- `provider_kyc_log` has FORCE RLS, admin/provider read policies, and no authenticated direct write policy.
- Storage object policies for `provider-documents` are in migration `023`.
- Security-definer RPCs are revoked from anon/authenticated and granted to `service_role`.
- Service-role access is used server-side through `src/lib/supabase/admin.ts`.

Important note: Supabase `service_role` bypasses RLS by design. Route-level role and ownership checks are therefore critical wherever the admin client is used.

## Authentication Model

- Supabase Auth is cookie-based through `@supabase/ssr`.
- Server/page/API checks call `auth.getUser()`.
- `getRequestUser()` supports cookie sessions and bearer token fallback for request handlers.
- `proxy.ts` does only session refresh and unauthenticated redirects for `/provider`, `/admin`, and `/customer`.
- Role enforcement happens in pages and API route handlers, not in proxy.
- Roles are stored in `users.role`: `customer`, `provider`, `admin`.

## Marketplace Flow

1. Customer creates a request through `POST /api/requests`.
2. Request status starts as `open`.
3. Exact coordinates are stored in `requests.location`.
4. Fuzzy coordinates are generated when GPS is supplied.
5. Active online providers discover open/quoted nearby requests from provider dashboard logic and helper RPCs.
6. Provider submits a quote through `POST /api/provider/jobs/quote`.
7. `submit_quote_atomic` inserts a row in `request_quotes` and moves first-quote requests to `quoted`.
8. Customer loads quotes through `GET /api/requests/quotes`.
9. Quotes are scored by rating, distance, price, and acceptance rate.
10. Customer selects one quote through `POST /api/customer/quote/select`.
11. `select_quote_atomic` accepts the request, selects one quote, rejects other pending quotes, creates or updates the job row, increments provider job count, and reveals provider details.
12. Provider advances through `accepted`, `en_route`, `arrived`, and `in_progress`.
13. Provider may request one price change during `in_progress`.
14. Customer may approve or reject the price change.
15. Provider completes through `POST /api/provider/jobs/complete`.
16. Completion derives final price from approved price change, selected quote, or legacy final price fallback.
17. Customer can rate the completed job.

Legacy first-accept flow remains available through `/api/provider/requests/accept` and is still used by PPJ/overage success paths.

## KYC Flow

Provider statuses:

- `pending`
- `under_review`
- `active`
- `rejected`
- `suspended`

Current policy:

- One verification document is intentionally enough for the current launch stage.
- Accepted fields are Emirates ID, Driving License, and Vehicle Registration / Mulkiya.

Implementation:

- Provider profile setup lives in `/api/providers/profile`.
- Document upload lives in `/api/providers/documents`.
- Uploads are provider-only, rate-limited, 5 MB max per file, JPEG/PNG/PDF only, MIME checked, magic bytes checked, and stored at `${user.id}/${field}.${extension}`.
- Upload uses `upsert: true`, so re-uploading the same field overwrites the previous object.
- Non-active providers move to `under_review` after document upload.
- Active providers remain active when replacing documents.
- Admin updates happen through `/api/admin/providers/update`.
- Admin status changes are logged to `provider_kyc_log` when status changes.
- Admin provider page generates signed document URLs for the `provider-documents` bucket.

## Payment Flow

Subscription checkout:

- `POST /api/stripe/create-checkout`
- Provider-only and owner-checked.
- Creates Stripe customer if needed.
- Existing subscription opens billing portal.
- New subscription opens Stripe Checkout.

Stripe webhook:

- `POST /api/stripe/webhook`
- Reads raw body and verifies `stripe-signature`.
- Claims events in `stripe_events` as `processing`.
- Marks events `processed` or `failed`.
- Handles subscription created/updated/deleted, invoice failure, PaymentIntent succeeded/failed, payout events, and checkout session completed.

PPJ:

- `POST /api/provider/ppj-checkout`
- Active provider only.
- Can use recovery credits or create a PaymentIntent.
- PaymentIntent success in webhook finalizes legacy accept through `accept_provider_request_atomic`.

Overage:

- `POST /api/provider/overage-checkout`
- Subscription provider only when allowance is exhausted.
- PaymentIntent success marks request overage-cleared and finalizes legacy accept.

## Dispatch Flow

- `src/lib/dispatch.ts` computes ring eligibility and filters providers.
- Rings are 5 km, 10 km, 20 km, and unlimited.
- PPJ providers are excluded from ring 1 by helper logic.
- Plan daily visibility limits and max active jobs are in `src/types/index.ts`.
- `get_nearby_open_requests` returns open and quoted requests in later migrations.
- Provider dashboard combines RPC/fallback queries, provider location, fuzzy request location, and recent quote/payment state.
- `provider_dispatch_log` records quote submission, selection, SLA failure, and completion-oriented events.

## Admin Workflow

- Admin pages require authenticated admin role and redirect otherwise.
- `/admin/dashboard` summarizes users, providers, requests, jobs, Stripe events, payout log, and overage payments.
- `/admin/providers` lists providers and generates signed document URLs when needed.
- `/admin/requests` lists request/job/provider/customer state.
- `/admin/performance` summarizes provider ratings/jobs.
- `/admin/revenue` summarizes PPJ, overage, jobs, and payout data.
- `/api/admin/providers/update` changes provider status/verified badge and writes KYC log entries.
- `/api/admin/sentry-verify` is admin-only and used to verify Sentry capture.

## Customer Workflow

- Public/auth pages allow registration and login.
- `/customer/request` is a client page that creates requests, polls active state, subscribes to request/quote realtime changes, shows quotes, handles cancellation, and shows price-change notifications.
- `/customer/history` lists past/completed/cancelled customer requests.
- `/customer/ratings` shows unrated completed jobs.
- Customer APIs cover profile creation, request create/read/cancel, quote listing, quote selection, price-change response, unrated jobs, and ratings.

## Provider Workflow

- `/provider/register` is the main onboarding page for profile, document upload, and plan selection.
- `/provider/pending` shows pending/under-review/rejected/suspended state and KYC log notes.
- `/provider/dashboard` is the operational dashboard for active providers: online status, active job, nearby requests, quote submission, legacy accept/PPJ/overage actions, recent activity, and realtime refresh.
- `/provider/plan`, `/provider/subscribe`, `/provider/ppj-pay`, and `/provider/overage-pay` handle plan/payment UX.
- `/provider/history` and `/provider/ratings` show provider history and rating data.
- Provider APIs cover profile, plan, documents, location, quote, legacy accept, PPJ checkout, overage checkout, job state advancement, price-change request, completion, and release.

## Realtime and Event Flow

- Migration `030` adds `requests` to Supabase realtime publication.
- Migration `031` adds `request_quotes` to realtime publication.
- `CustomerQuoteList` subscribes to quote inserts/updates for the active request.
- `src/app/customer/request/page.tsx` subscribes to request and quote changes and also polls.
- `ProviderRealtimeRefresh` subscribes to request, quote, and provider location events, with debounce/throttle protections.
- Stripe events are asynchronous through `/api/stripe/webhook`.
- Ops events are cron-driven through Vercel.

## Deployment Status

The code is configured for Vercel deployment with scheduled cron routes. The repository itself does not prove which migrations or environment variables are applied in a live production Supabase/Vercel project.

Current code assumptions:

- Supabase URL and anon key are configured.
- Supabase service role key is configured server-side.
- Stripe secret, webhook secret, publishable key, and price IDs are configured.
- `OPS_CRON_SECRET` is configured and at least 32 characters.
- `provider-documents` storage bucket exists and is private.
- Stripe webhook endpoint points to `/api/stripe/webhook`.
- Deprecated Supabase Edge Functions are not deployed or publicly callable.

## Current Production Assumptions

- UAE-only service area is enforced by coordinate bounds in API routes/helpers.
- Google Maps SDK is not used; map links/search URLs are generated.
- Arabic is default; English can be selected through locale cookie.
- `provider-documents` URLs are signed for admin viewing.
- Provider document upload replaces previous file per field.
- Marketplace V2 is implemented, but legacy acceptance remains present.
- No automated test framework is configured in `package.json`.

## Known Technical Debt

- Legacy first-accept flow coexists with Marketplace V2.
- Fair price config exists; DB fair price enforcement was disabled by migration `032`, RE-ENABLED by migration `039` (Batch 1), and TEMPORARILY WIDENED by migration `044` for testing (validation still active, bounds 0.01/10000). The formula will be REDESIGNED (two-leg + emirate destination) before launch, not restored — see DEFERRED_PRODUCT_BACKLOG.md P9.
- Destination latitude/longitude columns exist, but request creation stores only destination text/area.
- There is no test framework or CI pipeline in the repo.
- Some admin/protected routes lack route-level rate limiting.
- Several large client pages/components carry substantial workflow logic.
- Historical markdown files may still be useful context but are not source truth.
- A stray root file named `not staged for commit...` contains `less` help text and is not application source.

## OBSERVATIONS FOR AUDIT

Do not treat this section as fixes. Validate in a dedicated audit before action.

1. `submit_quote_atomic` fair price enforcement was disabled by `032_disable_range_estimator.sql`, RE-ENABLED by `039_security_backstop.sql` (Batch 1), and TEMPORARILY WIDENED by `044_temp_widen_fair_price_bounds.sql` for testing (bounds 0.01/10000, base_fee unchanged; the RPC still runs `v_min_fair = base_fee + distance_km × min_price_per_km` / `v_max_fair = base_fee + distance_km × max_price_per_km`). UI/scoring still computes fair price ranges. Redesign (two-leg + emirate) required before launch — see DEFERRED_PRODUCT_BACKLOG.md P9.

2. `select_quote_atomic` returns `provider_documents` to the customer selection route. Review whether KYC document paths should ever be returned to customers.

3. Stripe subscription webhook status mapping can set providers to `active` when Stripe subscription is active. Review interaction with KYC states, especially `pending`.

4. `provider-documents` storage object policies exist, but bucket creation/private configuration was not found in migrations.

5. Document uploads use `upsert: true`; audit whether replacing documents without retaining old copies satisfies KYC/audit requirements.

6. Admin provider update writes provider status first and logs KYC transition afterward. If log insert fails, the status update still succeeds.

7. Legacy accept, PPJ, and overage paths can still accept requests outside the Marketplace V2 quote-selection path.

8. `complete_provider_job_atomic` keeps a legacy `p_final_price` fallback. Review whether any provider-controlled final price can still affect production pricing.

9. Destination latitude/longitude are available in schema and scoring logic, but not populated by request creation.

10. `marketplace-cron` expires quotes/requests and releases SLA breaches, but warning delivery is not implemented there.

11. Some protected/admin API routes do not use the rate-limit helper despite project rules.

12. `035_nearby_requests_add_destination.sql` appears to include duplicated function body content. Confirm deployment history before changing migrations.

13. Deprecated Supabase Edge Functions are documented as risky/unused; verify they are not deployed in Supabase.

14. No automated tests are configured for route handlers, RPC behavior, payment webhooks, or upload validation.

15. Live production environment state, Supabase bucket privacy, applied migrations, Stripe webhook endpoints, Vercel env vars, and monitoring alerts cannot be verified from local source alone.
