# RescueGo — Architecture

§1 Business Model

RescueGo is a UAE-only roadside recovery marketplace on `rescuego.ae`. Customers create roadside assistance requests, nearby providers submit quotes, customers select a quote, providers execute the job, and customers can rate completed work.

Core stack:

| Area | Implementation |
|---|---|
| Framework | Next.js 16 App Router with TypeScript strict |
| Middleware | `src/proxy.ts` with named `proxy` export; Next.js 16 renamed middleware to proxy and the build registers `ƒ Proxy (Middleware)` |
| Styling | Tailwind CSS v4 with logical CSS properties for RTL |
| i18n | `next-intl` v4; Arabic default, English secondary |
| Database | Supabase Postgres, Auth, Storage, Realtime, PostGIS; RLS on all tables |
| Payments | Stripe subscriptions and PaymentIntents; test mode |
| Rate limiting | Upstash Redis with in-memory fallback in `src/lib/rate-limit.ts` |
| Monitoring | Sentry via `instrumentation.ts`, `instrumentation-client.ts`, and `sentry.*.config.ts` |
| Deployment | Vercel; auto-deploy from `main` |
| Maps | Google Maps links only; no SDK |

Roles are stored in `users.role`:

- `customer`
- `provider`
- `admin`

Provider plans are defined in `src/types/index.ts`:

| Plan | Monthly price | Included jobs | Overage | Commission | Dispatch priority |
|---|---:|---:|---:|---:|---:|
| `pay_per_job` | No subscription | Per-job fee | N/A | N/A | 4 |
| `starter` | 249 AED, promo 149 AED | 15/month | 12 AED | 15% | 3 |
| `pro` | 449 AED | 35/month | 12 AED | 10% | 2 |
| `business` | 849 AED | Unlimited | None | 0% | 1 |

PPJ and launch constants from `src/types/index.ts`:

| Constant | Value |
|---|---|
| `PAY_PER_JOB_FEE_NEAR_AED` | `NEXT_PUBLIC_PPJ_FEE_NEAR_AED`, fallback `30` |
| `PAY_PER_JOB_FEE_FAR_AED` | `NEXT_PUBLIC_PPJ_FEE_FAR_AED`, fallback `70` |
| `PAY_PER_JOB_DISTANCE_THRESHOLD_M` | `NEXT_PUBLIC_PPJ_DISTANCE_M`, fallback `10000` meters |
| `LAUNCH_PROMO` | `NEXT_PUBLIC_LAUNCH_PROMO === 'true'` |
| `PAY_PER_JOB_PROMO_FEE_AED` | `NEXT_PUBLIC_PPJ_PROMO_FEE_AED`, fallback `15` |
| `OVERAGE_FEE_AED` | `12` |
| `SOFT_LAUNCH_MODE` | `NEXT_PUBLIC_SOFT_LAUNCH_MODE === 'true'` |

Commission fields exist in the schema. `complete_provider_job_atomic` currently writes `commission_rate = 0` and `commission_amount = 0`; this is intentional until the commission phase.

> Current status: see [PROJECT_STATUS.md].

§2 Database Schema

The database is Supabase Postgres with PostGIS. Migrations are sequential and idempotent. Static schema design is owned here; current migration baseline and next migration number are dynamic operational facts.

> Current status: see [PROJECT_STATUS.md].

Primary enums and union types from `src/types/database.ts`:

| Type | Values |
|---|---|
| `RequestStatus` | `'open' \| 'quoted' \| 'selected_pending_payment' \| 'accepted' \| 'en_route' \| 'arrived' \| 'in_progress' \| 'completed' \| 'cancelled' \| 'expired'` |
| `ProviderStatus` | `'pending' \| 'under_review' \| 'active' \| 'rejected' \| 'suspended'` |
| `ProviderPlan` | `'starter' \| 'pro' \| 'business' \| 'pay_per_job'` |
| `QuoteStatus` | `'pending' \| 'selected' \| 'rejected' \| 'expired'` |
| `PriceChangeStatus` | `'pending' \| 'approved' \| 'rejected'` |
| `DispatchEventType` | `'quote_submitted' \| 'quote_selected' \| 'sla_failure' \| 'completion' \| 'ppj_payment_timeout'` |
| `ProblemType` | `'flat_tire' \| 'battery' \| 'tow' \| 'other'` |
| `ServiceType` | `'tow' \| 'battery' \| 'flat_tire' \| 'fuel' \| 'lockout' \| 'other'` |
| `KycAction` | `'submitted' \| 'under_review' \| 'approved' \| 'rejected' \| 'suspended' \| 'reactivated'` |

Core tables from migrations `001`-`045`:

| Table | Purpose and important columns |
|---|---|
| `users` | User profile and role. Columns: `id` UUID PK, `name`, `phone`, `email`, `role` (`UserRole`), `cancellation_count`, `late_cancellation_count`, `created_at`. |
| `providers` | Provider business, plan, KYC, billing, and performance state. Columns include `id` UUID FK to `users.id`, `plan`, `status`, `rating`, `jobs_this_month`, `job_credit_balance`, `ppj_recovery_credits`, `release_count`, `unable_to_complete_count`, `provider_side_cancellation_count`, `verified_badge`, `documents` JSONB, Stripe customer/subscription/current-period fields, `jobs_reset_at`, `last_upgrade_bonus_key`, `sla_failure_count`, `visibility_reduced`, `created_at`. |
| `provider_locations` | Online provider location. Columns: `provider_id` UUID FK, `location` `GEOMETRY(Point,4326)`, generated `lat` and `lng` float8 columns, `updated_at`. |
| `requests` | Customer request lifecycle. Columns include `id`, `customer_id`, `location`, `location_address`, `problem_type`, `note`, `status`, `accepted_by`, estimate/final price fields, destination fields, fuzzy coordinates, `selected_quote_id`, price-change fields, quote/accept/cancel/payment-window timestamps, release metadata, `created_at`. |
| `jobs` | Provider job record. Columns: `id`, `request_id`, `provider_id`, `commission_rate`, `commission_amount`, `stripe_payment_intent_id`, `completed_at`, `en_route_at`, `arrived_at`. |
| `ratings` | Customer rating for completed jobs. Columns: `id`, unique `job_id`, `provider_id`, `customer_id`, `stars`, `comment`, `created_at`. |
| `request_locks` | Request lock table. Columns: `request_id`, `provider_id`, `locked_until`. |
| `price_estimates` | Estimate configuration by `problem_type`, with `min_aed` and `max_aed`. |
| `request_quotes` | Marketplace V2 quote table. Columns: `id`, `request_id`, `provider_id`, `proposed_price NUMERIC(10,2)`, `status`, `sent_at`, `expires_at`, `selected_at`, `created_at`. |
| `provider_dispatch_log` | Dispatch and marketplace analytics. Columns include `id`, `provider_id`, `request_id`, `distance_km`, `proposed_price`, `service_type`, `price_per_km`, `was_selected`, `sla_met`, `is_soft_launch`, `event_type`, `created_at`. |
| `fair_price_config` | Fair price bounds per service type. Columns: `id`, `service_type`, `min_price_per_km`, `max_price_per_km`, `base_fee`, `quote_validity_minutes`, `created_at`, `updated_at`. |
| `provider_kyc_log` | Provider KYC/admin transition log. Columns: `id`, `provider_id`, `admin_id`, `action`, `previous_status`, `new_status`, `notes`, `created_at`. |
| `stripe_events` | Stripe webhook idempotency. Columns: `id` Stripe event ID, `type`, `status` (`pending`, `processing`, `processed`, `failed`), `payload` JSONB, `error_message`, `created_at`, `updated_at`. |
| `ppj_payments` | Pay-per-job payment tracking. Columns: `id`, `provider_id`, `request_id`, `fee_aed` INTEGER (NOT NULL, migration 005 line 6), `distance_meters` INTEGER (NOT NULL DEFAULT 0), `stripe_payment_intent_id`, `status` (`pending`, `paid`, `failed` — CHECK constraint from migration 005 line 9), `promo_applied` BOOLEAN (NOT NULL DEFAULT FALSE), `created_at`. Unique on `(provider_id, request_id)`. |
| `overage_payments` | Subscription overage payment tracking. Columns: `id`, `provider_id`, `request_id`, `amount_aed`, `stripe_payment_intent_id`, `status`, `accept_failed`, `created_at`, `updated_at`. |
| `payout_log` | Stripe payout records. Columns: `id`, `provider_id`, `request_id`, `commission_rate`, `commission_amount`, unique `stripe_payout_id`, `created_at`. |

Key migration design history:

| Migration | Architectural change |
|---|---|
| `001` | Initial schema: `users`, `providers`, `provider_locations`, `requests`, `jobs`, `ratings`, `request_locks`, `price_estimates`. |
| `005` | Added `ppj_payments`, `overage_payments`, and overage-cleared request state. |
| `011`, `015`, `024` | Evolved `accept_provider_request_atomic`; migration `024` fixed TOCTOU by adding `p_plan_limit`. |
| `019` | Added `cancel_request_and_compensate_atomic`. |
| `020` | Added original `release_job_atomic`. |
| `023` | Added `provider-documents` Storage bucket RLS. |
| `025` | Added `en_route` and `arrived` statuses plus `jobs.en_route_at` and `jobs.arrived_at`. |
| `026` | Added `advance_provider_job_state` atomic RPC. |
| `027` | Added unique constraint on `payout_log.stripe_payout_id`. |
| `028` | Added stuck job auto-release. |
| `029` | Rewrote the three main RPCs for `en_route`/`arrived`; dropped old 4-param accept overload. |
| `030` | Added `requests` to Supabase Realtime publication. |
| `031` | Marketplace V2: quotes, dispatch log, fair price config, V2 request/provider columns, quote/select/SLA RPCs, fair price seeds. |
| `032` | Disabled fair price validation for early testing. |
| `033` | Updated nearby request discovery to include `quoted`. |
| `034` | Updated cancellation RPC for `quoted`. |
| `035` | Added destination columns to nearby request RPC return. |
| `036` | Added generated `provider_locations.lat` and `.lng`. |
| `037` | Forced RLS on `users` and `providers`; added explicit deny policies. |
| `038` | Added provider KYC columns/log/statuses and storage bucket policy changes. |
| `039` | Security backstop: immutable-column triggers, fair price re-enabled in RPC, fuzzy coordinates in nearby RPC, `overage_payments.accept_failed`. |
| `040` | RPC integrity fixes: price-change RPCs, SLA release for en-route/arrived, release decrement, ratings customer ID, state advance hardening, release target helper. |
| `041` | Added `admin_update_provider_status_atomic`. |
| `042` | Fixed phantom `requests.updated_at` reference to `requests.created_at` in stuck expiry. |
| `043` | Added partial index `idx_jobs_en_route_at WHERE completed_at IS NULL`. |
| `044` | Temporarily widened fair-price bounds for testing. |
| `045` | Added PPJ post-selection fee gate: `selected_pending_payment`, `payment_window_started_at`, payment expiry/finalization RPCs. |

Location and geo design:

- Exact coordinates are stored as PostGIS `GEOMETRY(Point,4326)`.
- `provider_locations.lat` and `provider_locations.lng` are generated from the geometry via `ST_Y` and `ST_X`; application code can read plain float8 values.
- `generateFuzzyCoordinates()` stores a random offset up to approximately 1 km in `requests.fuzzy_latitude` and `requests.fuzzy_longitude`.
- Providers see fuzzy coordinates until a request is accepted.
- `roundDispatchCoordinate()` rounds coordinates to five decimal places.
- UAE coordinate validation uses longitude `51`-`57` and latitude `22`-`27`.
- UAE regions and sub-areas are resolved by bounding-box lookup for Dubai, Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah, and Umm Al Quwain.

Application structure relevant to the architecture:

```text
src/
  app/
    layout.tsx                — root layout: Cairo font, ToastProvider, ClientProviders, NavbarServer, next-intl
    page.tsx                  — landing page
    api/                      — API route handlers
    customer/                 — customer pages
    provider/                 — provider pages
    admin/                    — admin pages
    recovery/                 — SEO emirate landing pages
    pricing/                  — public pricing page
    about/                    — about page
    auth/                     — login/register/forgot-password
  components/
    layout/                   — NavbarServer, Navbar, NavbarSkeleton, Footer, ClientProviders
    ui/                       — Button, Card, Badge, Input, Select, Accordion, Toast/ToastProvider/useToast
    provider/                 — provider operational components
    customer/                 — customer quote, price-change, rating components
    forms/                    — ProviderRequestList
    admin/                    — AdminProviderActions
    stripe/                   — StripeElementsProvider, PaymentElementForm
  lib/
    supabase/client.ts        — browser Supabase client
    supabase/server.ts        — server Supabase client with cookies
    supabase/admin.ts         — service_role Supabase client, server-only
    supabase/request-user.ts  — getRequestUser(req), cookie-session only
    dispatch.ts               — dispatch engine; implemented but has zero callers
    geo.ts                    — distance, fuzzy coordinates, UAE location, dispatch ring helpers
    provider-score.ts         — provider quote scoring helpers
    provider-allowance.ts     — allowance and active-job limits
    provider-onboarding.ts    — provider onboarding state
    range-estimator.ts        — UI-only price range estimation
    rate-limit.ts             — Redis/in-memory rate limiting
    ops-auth.ts               — cron authorization
    env.ts                    — env validation and requireEnv
    stripe.ts                 — Stripe SDK instance
    notifications.ts          — notification helpers
    logger.ts                 — structured logger with PII redaction
    sentry-redaction.ts       — Sentry scrubbing
    utils.ts                  — cn()
    location-display.ts       — coordinate and Google Maps link formatting
    i18n/request.ts           — next-intl locale detection
  types/
    database.ts               — DB types and enums
    index.ts                  — plan, fee, dispatch constants
  proxy.ts                    — Next.js 16 proxy
  instrumentation.ts          — Sentry server/edge init
  instrumentation-client.ts   — Sentry client init
messages/
  ar.json                     — Arabic translations; default locale
  en.json                     — English translations
supabase/
  migrations/                 — database migrations
  functions/
    README.md                 — legacy edge functions deleted; only README remains
```

§3 RPC Architecture

RescueGo uses Postgres RPCs for state transitions that must be atomic. The implementation pattern is:

- RPCs use `SECURITY DEFINER` so they execute as the function owner rather than the caller.
- RPCs set `search_path = public` to avoid search-path injection.
- Functions are revoked from `PUBLIC`, `anon`, and `authenticated`, then granted only to `service_role`.
- Next.js API routes call RPCs server-side using `src/lib/supabase/admin.ts` after route-level authentication and authorization.

Complete RPC catalog:

| RPC | Migration | Purpose |
|---|---|---|
| `accept_provider_request_atomic(provider_id, request_id, increment_jobs, consume_ppj_credit, plan_limit)` | `011`/`015`/`024` | Assign an accepted request. Locks provider row with `FOR UPDATE`; checks active job, plan limit, and credit/overage consumption. (Migration 024 lines 18–24: `p_provider_id UUID, p_request_id UUID, p_increment_jobs BOOLEAN DEFAULT TRUE, p_consume_ppj_credit BOOLEAN DEFAULT FALSE, p_plan_limit INTEGER DEFAULT -1`.) |
| `complete_provider_job_atomic(provider_id, request_id, final_price?)` | `014`/`029` | Complete a job. Derives final price from quote or price change; writes commission as zero by design. |
| `cancel_request_and_compensate_atomic(customer_id, request_id, now)` | `019`/`034` | Cancel a request and compensate provider when applicable; handles `quoted`. |
| `restore_ppj_credit_for_cancelled_paid_request(provider_id, request_id, payment_intent_id?)` | `012` | If a PPJ provider has already paid but the customer cancels before job assignment, restores one `ppj_recovery_credits` credit exactly once (idempotent via `recovery_credit_restored_at`). Signature: `p_provider_id UUID, p_request_id UUID, p_payment_intent_id TEXT DEFAULT NULL`. |
| `release_job_atomic(provider_id, request_id)` | `020`/`028`/`040` | Release a job back to the pool. Decrements `jobs_this_month` only if a V2 slot was consumed; clears overage, selected quote, and accepted timestamp; returns request to `quoted` or `open` via `release_target_status()`. |
| `advance_provider_job_state(provider_id, request_id, from_status, to_status, timestamp_field)` | `026`/`040` | Atomic state advance for `accepted → en_route → arrived → in_progress`; whitelist allows `to_status IN ('en_route','arrived','in_progress')`; uses `SET search_path=public`. |
| `get_nearby_open_requests(provider_lat, provider_lng, radius_m)` | `001`/`033`/`035`/`039` | Returns open and quoted requests within radius; includes destination, destination area, fuzzy latitude, and fuzzy longitude. |
| `submit_quote_atomic(provider_id, request_id, proposed_price, distance_km, is_soft_launch)` | `031`/`039` | Submit a quote with fair-price validation from `fair_price_config`; returns `price_too_low` or `price_too_high` on violation. |
| `select_quote_atomic(customer_id, request_id, quote_id)` | `031`/`040`/`045` | Select quote. Subscriber path accepts immediately and reveals contact. PPJ path moves to `selected_pending_payment`, withholds contact, and starts the payment window. |
| `sla_check_and_release(request_id)` | `031`/`040` | Auto-release on SLA breach. Thresholds: accepted 20 minutes, en-route 2 hours, arrived 60 minutes. Decrements `jobs_this_month` only when a consumed slot is released. |
| `expire_stuck_active_requests(stuck_cutoff)` | `028`/`040`/`042` | Bulk auto-release stuck jobs older than cutoff; decrements consumed slots; uses `requests.created_at`, not `requests.updated_at`. |
| `request_price_change_atomic(provider_id, request_id, new_price)` | `040` | Single-statement guarded update for one provider price-change request, eliminating TOCTOU around `price_change_count = 0`. |
| `respond_price_change_atomic(customer_id, request_id, approved)` | `040` | Customer approval/rejection of pending price change; guarded by `status='in_progress'` and `price_change_status='pending'`. |
| `release_target_status(request_id)` | `040` | Stable read-only helper returning `quoted` if valid pending quotes remain, otherwise `open`. |
| `admin_update_provider_status_atomic(admin_id, provider_id, new_status, verified_badge, notes, previous_status, action)` | `041` | Atomic provider status update plus `provider_kyc_log` insert in one transaction; narrow named parameters. |
| `expire_ppj_payment_selection_atomic(request_id, window?)` | `045` | Release a single timed-out PPJ selection. Called per-request by the cron with `p_request_id`; optional `p_window INTERVAL` defaults to `10 minutes` (migration 045 lines 362–365). Sets status to `quoted` or `open`, sets `last_release_reason='ppj_payment_timeout'`, marks PPJ payment failed; no SLA penalty and no job count change. |
| `finalize_ppj_selection_atomic(provider_id, request_id)` | `045` | After PPJ fee payment, moves `selected_pending_payment` to `accepted`, sets `accepted_at=now()`, rejects held competitors, reveals contact, and verifies payer is selected provider. (Migration 045 lines 267–270: 2 parameters — `p_provider_id UUID, p_request_id UUID`.) |
| `enforce_users_immutable_columns()` | `039` | Trigger function blocking `users.role` changes unless `is_admin()` or `is_service_role()`; raises SQLSTATE `42501`. |
| `enforce_providers_immutable_columns()` | `039` | Trigger function blocking updates to 19 sensitive provider columns unless `is_admin()` or `is_service_role()`; raises SQLSTATE `42501`. (Migration 039 lines 86–104: status, verified_badge, rating, plan, stripe_customer_id, stripe_subscription_id, stripe_current_period_start, stripe_current_period_end, jobs_this_month, jobs_reset_at, visibility_reduced, sla_failure_count, job_credit_balance, ppj_recovery_credits, release_count, provider_side_cancellation_count, unable_to_complete_count, last_upgrade_bonus_key, documents.) |
| `is_service_role()` | `039` | Stable helper inspecting `request.jwt.claims.role`; anon/null UID does not satisfy service role. |
| `is_admin()` | `001` | Helper checking `auth.uid()` role against `users`. |

Open route/RPC design caveats are dynamic findings, not static architecture.

> Current status: see [PROJECT_STATUS.md].

§4 Marketplace

Marketplace V2 is quote-selection based rather than simple first-accept. The canonical flow is:

1. Customer creates a request through `POST /api/requests`.
2. The API generates fuzzy coordinates and inserts a request with `status='open'`.
3. Nearby providers see open and quoted requests in `GET /api/provider/dashboard`, backed by `get_nearby_open_requests`.
4. Provider submits a quote through `POST /api/provider/jobs/quote`.
5. `submit_quote_atomic` validates fair price, checks daily visibility limit, inserts a `request_quotes` row, and transitions the first-quote request to `quoted`.
6. Customer fetches quotes through `GET /api/requests/quotes`.
7. The API scores up to 20 pending quotes with `computeProviderScore()` and returns the top 5.
8. Anonymous provider IDs are shown to customers using the first four uppercase characters of the provider UUID.
9. Customer selects a quote through `POST /api/customer/quote/select`.
10. `select_quote_atomic` branches by provider plan:
    - Subscription path: request becomes `accepted`, `accepted_at` is set, SLA starts, non-selected quotes become `rejected`, and contact details are revealed immediately.
    - PPJ path: request becomes `selected_pending_payment`, `payment_window_started_at` is set, competitors remain held as `pending`, contact is withheld, and `payment_required=true` is returned.
11. For PPJ, the provider pays via `POST /api/provider/ppj-checkout` and `/provider/ppj-pay`; Stripe webhook calls `finalize_ppj_selection_atomic`.
12. Provider advances state through `POST /api/provider/jobs/advance-state` using `advance_provider_job_state`.
13. Provider completes through `POST /api/provider/jobs/complete` using `complete_provider_job_atomic`.
14. Customer rates through `POST /api/ratings`; `ratings.customer_id` is written by the HIGH-05 fix.

Request lifecycle statuses:

```text
open → quoted → selected_pending_payment → accepted → en_route → arrived → in_progress → completed
```

Terminal or alternate statuses:

```text
cancelled, expired
```

Provider scoring from `src/lib/provider-score.ts`:

```text
Score = rating_score × 0.40 + proximity_score × 0.30 + price_score × 0.20 + acceptance_score × 0.10
```

Score components:

| Component | Formula |
|---|---|
| `rating_score` | `effectiveRating / 5.0`; providers with fewer than 10 completed jobs receive a `+0.5` boost capped at `5.0`. |
| `proximity_score` | `max(0, 1 - distanceKm / maxRingDistanceKm)` |
| `price_score` | `max(0, min(1, 1 - (proposedPrice - minFairPrice) / (maxFairPrice - minFairPrice)))`; `0.5` if no range is available. |
| `acceptance_score` | `min(1, completedJobs / totalAcceptedJobs)`; `1.0` if no history exists. |

Realtime architecture:

- `requests` is in Supabase Realtime publication from migration `030`.
- `request_quotes` is in Supabase Realtime publication from migration `031`.
- `ProviderRealtimeRefresh` is a null-render client component with three channels:
  - open request insert/update events,
  - provider's own quote updates,
  - active job updates.
- Provider realtime refresh uses a 1500 ms debounce and 3 s throttle, then calls `router.refresh()` and shows toasts for key events.
- `CustomerQuoteList` polls `/api/requests/quotes` every 30 s and subscribes to `request_quotes` insert/update events with a 1 s debounce and in-flight guard.

§5 Dispatch Flow

There are two dispatch-related designs in the codebase:

1. Live dispatch behavior.
2. An implemented but currently unwired dispatch engine in `src/lib/dispatch.ts`.

Live provider discovery is geographic. `get_nearby_open_requests` returns open and quoted requests to online providers within radius, ordered by distance ascending. The dispatch engine in `src/lib/dispatch.ts` has zero callers and is not currently the live routing mechanism.

`src/lib/dispatch.ts` implements:

| Function / concept | Design |
|---|---|
| `getDispatchPriority` | `business=1`, `pro=2`, `starter=3`, `pay_per_job=4`. |
| `computeCurrentRing` | Computes ring by elapsed time since request creation using `Date.now() - requestCreatedAt`. |
| Ring duration | `DISPATCH_RING_DURATION_MS = 5 minutes`. |
| Ring radii | Ring 1: 5000 m, ring 2: 10000 m, ring 3: 20000 m, ring 4: unlimited. |
| PPJ ring rule | PPJ providers are excluded from ring 1. |
| Filtering | Online check, ring eligibility, `MAX_ACTIVE_JOBS`, `DAILY_VISIBILITY_LIMITS`, and `visibility_reduced`. |
| Sorting | Priority first, then distance. |

`provider_dispatch_log` records events such as quote submission, quote selection, SLA failure, completion, and PPJ payment timeout using `DispatchEventType`.

§6 PPJ

Pay-Per-Job providers do not subscribe monthly. They pay a per-job fee after the customer selects their quote and before contact is revealed.

Fee constants:

| Fee | Source |
|---|---|
| Near PPJ fee | `PAY_PER_JOB_FEE_NEAR_AED = 30` fallback, env `NEXT_PUBLIC_PPJ_FEE_NEAR_AED`. |
| Far PPJ fee | `PAY_PER_JOB_FEE_FAR_AED = 70` fallback, env `NEXT_PUBLIC_PPJ_FEE_FAR_AED`. |
| Distance threshold | `PAY_PER_JOB_DISTANCE_THRESHOLD_M = 10000`. |
| Launch promo fee | `PAY_PER_JOB_PROMO_FEE_AED = 15` when `LAUNCH_PROMO` is true. |

PPJ post-selection architecture from migrations `031` and `045`:

1. Customer selects a PPJ quote via `POST /api/customer/quote/select`.
2. `select_quote_atomic` sets request status to `selected_pending_payment`.
3. `payment_window_started_at` is set.
4. Provider contact is withheld.
5. Competitor quotes remain held as `pending`.
6. Provider initiates fee payment through `POST /api/provider/ppj-checkout`.
7. The route verifies the caller is the selected provider and accepts only `selected_pending_payment` status.
8. Stripe PaymentIntent succeeds, or a recovery credit is consumed.
9. Webhook/finalization calls `finalize_ppj_selection_atomic`.
10. Request becomes `accepted`; `accepted_at=now()`; SLA starts; competitor quotes become `rejected`; contact is revealed.

Critical invariant: PPJ has two separate timers.

| Timer | Starts | Managed by | Effect |
|---|---|---|---|
| Payment window | `payment_window_started_at` on `selected_pending_payment` | `expire_ppj_payment_selection_atomic` cron | Releases unpaid selections after 10 minutes, marks PPJ payment failed, no SLA penalty. |
| SLA timer | `accepted_at` from `finalize_ppj_selection_atomic` | `sla_check_and_release` | Applies only after successful payment and acceptance. |

`selected_pending_payment` is structurally immune to `sla_check_and_release`, which only acts on accepted/en-route/arrived requests. An unpaid-but-selected PPJ provider cannot receive an SLA penalty.

Recovery credits:

- If a customer cancels after a PPJ provider has accepted, the provider receives `ppj_recovery_credits`.
- When a provider is later selected and has credits, finalization can consume a credit without a Stripe charge.
- The business logic supports this server-side.

UI and product backlog statuses are dynamic.

> Current status: see [PROJECT_STATUS.md] and [DEFERRED_PRODUCT_BACKLOG.md].

PPJ routes:

| Route | Role |
|---|---|
| `POST /api/provider/ppj-checkout` | Creates Stripe PaymentIntent or finalizes by recovery credit; verifies selected provider. |
| `POST /api/provider/requests/accept` | Blocks PPJ providers with `403 PPJ_PAYMENT_REQUIRED`; subscription providers can still use legacy direct accept. |

§7 Fair Price

Fair price enforcement is implemented in `submit_quote_atomic` and backed by `fair_price_config`.

Formula from migration `039`:

```text
v_min_fair = base_fee + (distance_km × min_price_per_km)
v_max_fair = base_fee + (distance_km × max_price_per_km)
```

Enforcement behavior:

- Rejects with `price_too_low` if `proposed_price < v_min_fair`.
- Rejects with `price_too_high` if `proposed_price > v_max_fair`.
- `distance_km` is the single-leg provider-to-customer Haversine distance computed in the API route and passed as `p_distance_km`.
- Bounds are read from `fair_price_config` by service type.
- If the service type has no row, the RPC falls back to the `other` row.
- If no config exists at all, validation is skipped.
- `src/lib/range-estimator.ts` is UI-facing and does not replace DB enforcement.

Historical fair-price migration sequence:

| Migration | Behavior |
|---|---|
| `031` | Seeded initial service-type bounds. |
| `032` | Disabled validation for early testing. |
| `039` | Re-enabled validation inside `submit_quote_atomic`. |
| `044` | Temporarily widened `min_price_per_km=0.01` and `max_price_per_km=10000` for all service types while keeping base fees unchanged. |

Original migration `031` seed values:

| Service | `min_price_per_km` | `max_price_per_km` | `base_fee` |
|---|---:|---:|---:|
| `tow` | 3 | 8 | 100 |
| `battery` | 2 | 5 | 80 |
| `flat_tire` | 2 | 5 | 60 |
| `fuel` | 2 | 5 | 50 |
| `lockout` | 2 | 6 | 70 |
| `other` | 2 | 6 | 80 |

Current config and launch-blocker state are dynamic. The static architectural point is that DB validation still runs through `submit_quote_atomic`, but the formula and config are subject to product redesign before launch.

> Current status: see [PROJECT_STATUS.md] and [DEFERRED_PRODUCT_BACKLOG.md].

§8 Security Architecture

Security is layered across the Next.js proxy, route handlers, Supabase RLS, service-role-only RPCs, storage policies, CSRF checks, rate limits, and operational authorization.

Next.js proxy (`src/proxy.ts`):

| Concern | Design |
|---|---|
| Convention | Next.js 16 uses `src/proxy.ts` with named `proxy` export; `middleware.ts` is deprecated in v16. |
| Matcher | `/provider/:path*`, `/admin/:path*`, `/customer/:path*`, `/api/:path*`. |
| Session | Refreshes Supabase session cookies on navigation. |
| Protected pages | Redirects unauthenticated users from protected prefixes to `/auth/login`. |
| Public provider overrides | `/provider/register`, `/provider/subscribe`. |
| CSRF scope | Applies to `POST /api/*`; exempts `/api/stripe/webhook` and `/api/ops/`. |
| CSRF origin rule | Missing both `Origin` and `Referer` returns 403; origin must match request host or `ALLOWED_ORIGINS`. |
| Allowed origins | `NEXT_PUBLIC_SITE_URL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `rescuego.ae`, `www.rescuego.ae`, `localhost:3000`. |
| Vercel wildcard | `*.vercel.app` wildcard was removed. |
| Role enforcement | Not done in proxy; handled by pages/routes and backed by RLS. |

Authorization model:

- Supabase auth is cookie-session based via `@supabase/ssr`.
- API routes authenticate using `getRequestUser(req)` from `src/lib/supabase/request-user.ts`.
- `getRequestUser(req)` uses cookie session only; Bearer-token fallback was removed.
- Each route checks role before data operations.
- Admin routes additionally require `role === 'admin'`.
- Server-side admin access uses `service_role` through `src/lib/supabase/admin.ts` only after route-level checks.

RLS model:

- RLS is enabled on all tables.
- `providers` and `users` use `FORCE ROW LEVEL SECURITY` from migration `037`.
- Customers can read/write only their own data.
- Providers can read/write only their own provider rows, quotes, and dispatch logs.
- Admins have full access through server-side service-role routes.
- `request_quotes`: customers read quotes for their own request; providers read their own quotes.
- `fair_price_config`: authenticated users can read.
- `provider_documents` Storage bucket: providers can read/insert/update own files when path prefix equals `auth.uid()`; providers have no delete policy; admin delete is service-role only.

Database security backstop from migration `039`:

| Function / trigger | Behavior |
|---|---|
| `is_service_role()` | Stable function inspecting `request.jwt.claims.role`; anon/null UID does not satisfy this. |
| `enforce_users_immutable_columns` | BEFORE UPDATE trigger on `users`; blocks role change unless `is_admin()` or `is_service_role()`; raises SQLSTATE `42501`. |
| `enforce_providers_immutable_columns` | BEFORE UPDATE trigger on `providers`; blocks 19 sensitive columns unless `is_admin()` or `is_service_role()`; raises SQLSTATE `42501`. |

Sensitive provider columns protected by `enforce_providers_immutable_columns` include status, verified badge, rating, plan, Stripe fields, billing/allowance counters, and documents.

RPC security pattern:

```text
SECURITY DEFINER
SET search_path = public
REVOKE ALL ON FUNCTION ... FROM PUBLIC
REVOKE ... FROM anon, authenticated
GRANT EXECUTE ... TO service_role
```

KYC-protected Stripe activation:

- `KYC_PROTECTED = ['pending','under_review','rejected','suspended']`.
- Stripe webhook records subscription details for these statuses but does not auto-activate providers.
- Activation waits for admin review.

Ops/cron authorization:

- `authorizeOpsRequest(req)` lives in `src/lib/ops-auth.ts`.
- It accepts a Bearer token in the `Authorization` header or `x-ops-secret`.
- `OPS_CRON_SECRET` is required and must be at least 32 characters; production fails hard at startup if missing/weak through `src/lib/env.ts`.
- Vercel `CRON_SECRET` is honored only if at least 32 characters; weak values are logged and ignored.
- Secret comparison uses constant-time `timingSafeEqual` from `node:crypto`.

CSP:

- Content Security Policy is enforced, not report-only, in `next.config.ts`.
- `font-src` includes `fonts.gstatic.com`.

Open security findings and route-specific caveats change over time and are not owned by this document.

> Current status: see [PROJECT_STATUS.md].

§9 Payment Flows

Stripe integration covers subscriptions, PPJ fees, overage fees, webhook idempotency, and payout logging.

Subscription checkout:

| Step | Implementation |
|---|---|
| Route | `POST /api/stripe/create-checkout` |
| Mode | Stripe Checkout Session in subscription mode |
| Guard | Rejected or suspended providers receive 403 |
| Success redirect | `/provider/subscribe?session_id=...` |
| Activation source | Webhook `customer.subscription.created`; `checkout.session.completed` is log-only. |
| Plan resolution | Stripe `price_id` maps to provider plan. |
| KYC behavior | If provider status is KYC-protected, webhook records subscription details but skips activation. |

Overage checkout:

| Step | Implementation |
|---|---|
| Route | `POST /api/provider/overage-checkout` |
| Amount | `OVERAGE_FEE_AED = 12` |
| Stripe object | PaymentIntent |
| Success webhook | Calls `accept_provider_request_atomic` with `overage_cleared=true` and `plan_limit=-1` to bypass monthly limit for that request. |

PPJ checkout:

| Step | Implementation |
|---|---|
| Route | `POST /api/provider/ppj-checkout` |
| Amount | Distance-based PPJ fee, or promo 15 AED when `LAUNCH_PROMO` is true. |
| Stripe object | PaymentIntent unless recovery credit applies. |
| Success webhook | Calls `finalize_ppj_selection_atomic` from migration `045`. |
| Credit path | If `ppj_recovery_credits > 0`, finalizes directly without Stripe charge. |

Webhook idempotency:

- `claimStripeEvent` performs atomic, conflict-aware upsert into `stripe_events`.
- Events are processed through status-guarded conditional re-claim.
- `PROCESSING_TIMEOUT_MS = 3 minutes`.
- `payment_intent.canceled` marks pending PPJ/overage rows as `failed`.
- `customer.subscription.deleted` resets provider to `pay_per_job` and clears Stripe fields.
- `customer.subscription.updated` with `status=canceled` uses the same reset path via early-return guard to avoid races with deleted events.
- `checkout.session.completed` is log-only.
- `payout.created` writes to `payout_log` with upsert on `stripe_payout_id`.

Commission:

- `complete_provider_job_atomic` currently writes `commission_rate = 0` and `commission_amount = 0`.
- This is intentional until the commission phase.

> Current status: see [PROJECT_STATUS.md].

§10 KYC

Provider KYC controls whether a provider can become active and operate in the marketplace.

Provider status model:

```text
pending → under_review → active | rejected | suspended
```

Status meanings:

| Status | Meaning |
|---|---|
| `pending` | Provider has registered but has not completed review. |
| `under_review` | Documents submitted; admin review pending. |
| `active` | KYC approved; provider can accept jobs. |
| `rejected` | Documents rejected; provider cannot access billing portal. |
| `suspended` | Manually suspended; provider cannot access billing portal. |

Migration `038` also includes a `kyc_verified` constraint value, but `kyc_verified` is not part of the TypeScript `ProviderStatus` type.

Document upload route: `POST /api/providers/documents`.

Validation:

| Check | Rule |
|---|---|
| MIME type | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. |
| Magic bytes | First four bytes are inspected. |
| File size | Maximum 5 MB. |
| Extension | File extension validated. |

Storage:

- Files are uploaded to the private Supabase Storage bucket `provider-documents`.
- Upload uses service role in the API route, bypassing RLS only server-side.
- Bucket RLS allows providers to read/insert/update own files only when object path starts with `auth.uid()`.
- Providers do not have a DELETE policy.

KYC document fields stored in `providers.documents` JSONB:

- `emirates_id_url`
- `license_url`
- `vehicle_photo_url`

Admin review route: `POST /api/admin/providers/update`.

- Calls `admin_update_provider_status_atomic`.
- Performs provider status update and `provider_kyc_log` insert in a single transaction.
- Validates status against an allow-list.
- Uses COALESCE-style updates so only provided fields are changed.
- The RPC runs as service role and therefore can pass immutable-column triggers.
- Rate limit is 30 requests per 60 seconds per admin user.

Onboarding:

- `src/lib/provider-onboarding.ts` exposes `getProviderOnboardingState()`.
- It reports remaining provider steps: profile, documents, and plan.

§11 Operations

Operations are implemented through Vercel cron routes, authenticated by `src/lib/ops-auth.ts`, with structured logging through `src/lib/logger.ts`.

Cron routes from `vercel.json`:

| Route | Schedule | Purpose |
|---|---|---|
| `/api/ops/expire-requests` | `*/30 * * * *` | Every 30 minutes. Expires stale open requests, auto-releases stuck jobs through `expire_stuck_active_requests`, and clears stuck Stripe events by moving processing events older than 10 minutes to failed. |
| `/api/ops/monthly-allowance-reset` | `0 0 * * *` | Daily midnight. Resets `jobs_this_month` for `starter`, `pro`, and `business` providers in batches of 50. |
| `/api/ops/marketplace-cron` | `* * * * *` | Every minute. Expires stale quotes, expires unselected requests, enforces SLA through `sla_check_and_release` for up to 50 oldest candidates, and expires PPJ payment windows through `expire_ppj_payment_selection_atomic`. |
| `/api/ops/weekly-sla-reset` | `0 0 * * 0` | Sunday midnight. Applies `visibility_reduced` for providers with 3+ SLA failures and resets `sla_failure_count`. |

SLA thresholds from migration `040`:

| Request state | Threshold | Timestamp |
|---|---:|---|
| `accepted` | 20 minutes | `requests.accepted_at` |
| `en_route` | 2 hours | `jobs.en_route_at` |
| `arrived` | 60 minutes | `jobs.arrived_at` |

SLA breach behavior:

- Request is auto-released via `release_target_status()`.
- Resulting status is `quoted` if valid pending quotes exist, otherwise `open`.
- `accepted_by`, `selected_quote_id`, `accepted_at`, and overage-cleared state are cleared.
- `jobs_this_month` is decremented only if a V2 slot was consumed.

Marketplace cron error handling:

- The route returns HTTP 500 when any critical subtask fails.
- Per-row non-breach outcomes such as `sla_not_breached` are not treated as failures; they are logged and skipped.

Monthly reset design:

- `starter`, `pro`, and `business` reset `jobs_this_month` on monthly Stripe-period cadence where `stripe_current_period_start > jobs_reset_at`.
- Business is unlimited in `src/lib/provider-allowance.ts`; resetting its job count is for data integrity, not gating.

Logging and monitoring:

- Server-side logging uses `src/lib/logger.ts`.
- Production logs are JSON; development logs are human-readable.
- Sensitive fields are redacted.
- Sentry scrubbing is implemented in `src/lib/sentry-redaction.ts`.

Runtime environment state, deployment state, open blockers, and current operational status are dynamic.

> Current status: see [PROJECT_STATUS.md].
