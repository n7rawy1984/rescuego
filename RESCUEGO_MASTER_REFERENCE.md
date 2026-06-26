# RescueGo — Master Project Reference

This document is a complete, self-contained reference for the RescueGo project. It was generated from a full read of the source code, all four security audit reports, the architecture doc, roadmap, deployment status, and all supporting project documents as of the date below. Anyone reading this cold — including a future AI agent with no prior context — should be able to understand the full project from this file alone.

---

## 1. Project Overview

RescueGo is a UAE-based roadside recovery marketplace. Stranded drivers (customers) submit requests for assistance. Roadside recovery businesses and individual operators (providers) see those requests and submit competitive quotes. Customers select a quote, the selected provider arrives and completes the job, and the customer rates the provider.

**Domain:** rescuego.ae  
**Service area:** UAE only (enforced at the API level via coordinate bounds)  
**Primary language:** Arabic (default locale). English also available.  
**Target market:** B2B2C — providers are businesses paying for platform access; customers are end users in need of emergency roadside assistance.

### User Roles

| Role | Description |
|---|---|
| `customer` | Driver who creates requests and selects quotes |
| `provider` | Roadside operator who submits quotes and completes jobs |
| `admin` | Platform operator who reviews providers, monitors requests, manages KYC |

### Business Model

Providers pay to access the platform through one of two monetisation models:

| Model | How it works |
|---|---|
| **Subscription** | Monthly recurring fee. Includes a fixed monthly job allowance. Overage jobs cost extra. |
| **Pay-Per-Job (PPJ)** | No subscription. Provider pays a flat acceptance fee per job before they can accept. |

**Subscription tiers (from `src/types/index.ts`):**

| Plan | Price (AED/month) | Promo Price | Monthly Jobs | Overage per job |
|---|---|---|---|---|
| Starter | 249 | 149 | 15 | 12 AED |
| Pro | 449 | — | 35 | 12 AED |
| Business | 849 | — | Unlimited | None |

**PPJ fees (from `src/types/index.ts`, controlled by env vars with these defaults):**

| Condition | Fee |
|---|---|
| Launch promo active (`LAUNCH_PROMO=true`) | 15 AED flat |
| Provider within 10 km of request | 30 AED |
| Provider 10 km or more from request | 70 AED |

**Additional revenue streams (defined but not yet active):**
- Platform commission on job completion (currently hardcoded to 0% — intentional soft-launch decision, see Section 6 M5)

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router | 16.2.6 |
| Language | TypeScript (strict mode) | 5.x |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | v4 |
| i18n | next-intl | 4.13.0 |
| Database | Supabase Postgres + PostGIS | Supabase JS 2.106.1 |
| Auth | Supabase Auth (cookie-based via `@supabase/ssr`) | 0.10.3 |
| Realtime | Supabase Realtime (`postgres_changes`) | — |
| Storage | Supabase Storage | — |
| Payments | Stripe (subscriptions + Payment Intents) | stripe 22.1.1 |
| Stripe client | @stripe/react-stripe-js + @stripe/stripe-js | 6.4.0 / 9.6.0 |
| Error monitoring | Sentry (`@sentry/nextjs`) | 10.55.0 |
| Rate limiting | Upstash Redis (optional; falls back to in-memory) | — |
| Hosting | Vercel | — |
| Cron | Vercel cron (via `vercel.json`) | — |

**No UI component library.** All UI components (`Accordion`, `Badge`, `Button`, `Card`, `Input`, `Select`, `Spinner`) are custom native HTML + Tailwind. Radix UI and shadcn were removed.

**No Google Maps SDK.** Maps are Google Maps links/URLs only. Maps SDK is planned but not implemented.

---

## 3. Architecture

### High-Level System Design

```
Browser (Arabic/English)
  │
  ├── Next.js App Router (Vercel)
  │     ├── Pages (Server Components + Client Components)
  │     ├── API Routes (/api/*)  ← all server-side business logic
  │     └── src/proxy.ts  ← middleware (session refresh + auth redirect)
  │
  ├── Supabase
  │     ├── Auth (cookie sessions, JWT)
  │     ├── Postgres + PostGIS (primary DB + location queries)
  │     ├── RLS (row-level security on all tables)
  │     ├── Storage (provider-documents bucket)
  │     └── Realtime (postgres_changes subscriptions)
  │
  ├── Stripe
  │     ├── Checkout (subscription + one-time PPJ/overage)
  │     ├── Webhooks → /api/stripe/webhook
  │     └── Billing Portal (existing subscribers)
  │
  └── Sentry (error capture, no tracing/replay)
```

### Middleware: `src/proxy.ts`

**Critical: this file is NOT correctly registered as Next.js middleware.** See Section 6, C1 for full detail. The file exports `async function proxy(...)` (not `export default async function middleware(...)`) and there is no `middleware.ts` at `src/` or the project root. Next.js does not pick it up. As a result, CSRF origin checks and unauthenticated page redirects defined in this file are not running in production.

If `proxy.ts` were running, it would:
- Refresh the Supabase session cookie on every request
- Redirect unauthenticated users away from `/provider`, `/admin`, `/customer` routes
- Check the `Origin` header on mutating API requests (except `/api/stripe/webhook` and `/api/ops/*`)

### Authentication Flow

- Supabase Auth, cookie-based via `@supabase/ssr`
- `src/lib/supabase/server.ts` — server-side anon client (for user-scoped queries)
- `src/lib/supabase/admin.ts` — service-role client (bypasses RLS; server-only)
- `src/lib/supabase/client.ts` — browser client
- `getRequestUser()` in `src/lib/supabase/request-user.ts` supports both cookie sessions and `Authorization: Bearer` token fallback
- Role (`customer`/`provider`/`admin`) is stored in `users.role` in the database
- Role enforcement happens in individual page and API route handlers, not in middleware

### Directory Structure

```
src/
  app/
    api/                      # All server API endpoints
      admin/                  # Admin operations (providers, sentry-verify)
      customers/              # Customer reads
      customer/               # Customer actions (quote select, price-change respond)
      ops/                    # Internal cron endpoints (require OPS_CRON_SECRET)
      provider/               # Provider job/location/quote/state endpoints
      providers/              # Provider self-service (profile, documents, plan)
      ratings/                # Rating submission
      requests/               # Customer request create/read/cancel/quotes
      stripe/                 # Stripe checkout + webhook
    admin/                    # Admin UI pages
    auth/                     # Login / register / password reset
    customer/                 # Customer pages
    provider/                 # Provider pages
    recovery/                 # Static SEO pages (Dubai, Abu Dhabi, Sharjah, etc.)
  components/
    customer/                 # CustomerQuoteList, etc.
    provider/                 # ProviderRealtimeRefresh, etc.
    layout/                   # Navbar, Footer
    ui/                       # Button, Card, Badge, Input, Select, Spinner, Accordion
    stripe/                   # StripeElementsProvider
  lib/
    supabase/                 # server.ts, admin.ts, client.ts, request-user.ts
    stripe.ts                 # Node.js Stripe SDK (server-only)
    logger.ts                 # Structured JSON logger with redaction
    env.ts                    # requireEnv() — throws on missing required vars
    rate-limit.ts             # checkRateLimitAsync() — Upstash or in-memory fallback
    ops-auth.ts               # authorizeOpsRequest() — checks OPS_CRON_SECRET
    geo.ts                    # Pure geodesy helpers (UAE coordinate validation, distance)
    dispatch.ts               # Ring eligibility and provider filtering logic
    provider-score.ts         # Quote scoring algorithm
    provider-allowance.ts     # Monthly allowance lookup by plan
    provider-onboarding.ts    # KYC onboarding state logic
    location-display.ts       # Provider location display helper
    range-estimator.ts        # Fair price range estimation (UI only; DB enforcement disabled)
    utils.ts                  # cn(), getProblemLabel(), getStatusBadgeVariant()
    notifications.ts          # Notification event constants for logger
    sentry-redaction.ts       # Event scrubbing before Sentry send
  types/
    database.ts               # TypeScript interfaces for all DB rows + enums
    index.ts                  # SUBSCRIPTION_PLANS, PPJ fees, runtime constants
messages/
  ar.json                     # Arabic translations (default)
  en.json                     # English translations
supabase/
  migrations/                 # 001–038 SQL migrations
  functions/                  # Deprecated Supabase Edge Functions (not in use)
proxy.ts                      # Intended middleware (currently broken — see C1)
vercel.json                   # Cron schedule configuration
next.config.ts                # Next-intl, Sentry wrapping, CSP/security headers
```

### Cron Jobs (`vercel.json`)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/ops/expire-requests` | Every 30 min | Expires stale open/quoted requests |
| `/api/ops/monthly-allowance-reset` | Daily 00:00 UTC | Resets `jobs_this_month` for Starter and Pro providers |
| `/api/ops/marketplace-cron` | Every minute | Expires stale quotes, expires overdue quoted requests, enforces SLA on accepted jobs |
| `/api/ops/weekly-sla-reset` | Sundays 00:00 UTC | Releases stuck jobs and resets SLA-related provider flags |

All ops routes require `OPS_CRON_SECRET` header (or Vercel's injected `CRON_SECRET`).

---

## 4. Database Schema

**Migration baseline:** 38 migrations applied (`001_initial_schema.sql` through `038_provider_kyc.sql`). Migrations `039_security_backstop.sql` (Batch 1), `040_rpc_integrity_state_safety.sql` (Batch 2), and `041_admin_provider_status_atomic.sql` (Batch 3) exist in the repo but are **NOT yet applied to the cloud database**. Next migration number: `042`.

### Core Tables

#### `users`
Central profile table linking Supabase Auth UUIDs to roles and contact data.

| Key Columns | Notes |
|---|---|
| `id` UUID (PK, = Supabase auth uid) | |
| `role` TEXT CHECK `('customer','provider','admin')` | Used by RLS `is_admin()` function and all API route role checks |
| `name`, `email`, `phone` | |
| `created_at` | |

**RLS gap:** UPDATE policy has no `WITH CHECK` — any authenticated user can self-escalate to admin role via browser client. See C2.

#### `providers`
Provider business profile, KYC status, subscription state, and performance counters.

| Key Columns | Notes |
|---|---|
| `id` UUID (FK → users.id) | |
| `status` TEXT CHECK `('pending','under_review','active','rejected','suspended')` | Added `under_review` and `rejected` in migration 038 |
| `plan` TEXT | `'starter'`,`'pro'`,`'business'`,`'pay_per_job'` |
| `stripe_customer_id`, `stripe_subscription_id` | |
| `stripe_current_period_start`, `stripe_current_period_end` | |
| `jobs_this_month`, `jobs_reset_at` | Incremented by `select_quote_atomic`; reset by monthly cron |
| ~~`max_active_jobs`~~ | **Does NOT exist** on the `providers` table (verified against full migration history). The plan-based concurrency cap is derived from `plan` at runtime in `submit_quote_atomic`, not stored. |
| `visibility_reduced` | Set `true` after 3+ SLA failures; disables dispatch visibility |
| `sla_failure_count`, `release_count`, `provider_side_cancellation_count` | |
| `rating` NUMERIC | Maintained by `update_provider_rating` trigger |
| ~~`completed_jobs_count`~~ | **Does NOT exist** on the `providers` table (verified against full migration history). |
| `verified_badge` BOOLEAN | Admin-set |
| `documents` JSONB | KYC document storage paths |
| `last_upgrade_bonus_key` | Idempotency key for plan upgrade bonus credits |
| `job_credit_balance` | PPJ recovery credits |
| `overage_cleared` BOOLEAN | Set when provider pays overage for a specific request |

**RLS gap:** UPDATE policy has no `WITH CHECK` — any provider can self-activate, set `verified_badge=true`, or manipulate billing fields via browser client. See C3.

#### `provider_locations`
Current GPS location of online providers. Provider is "online" if `updated_at` is within 5 minutes.

| Key Columns | Notes |
|---|---|
| `id` UUID (FK → providers.id) | |
| `location` GEOMETRY(Point, 4326) | PostGIS point |
| `lat`, `lng` NUMERIC | Generated columns from `location` (added migration 036) |
| `updated_at` | Freshness threshold: 5 minutes (`PROVIDER_STALE_MINUTES=5`) |

#### `requests`
Customer service requests. Central table tracking the full lifecycle.

| Key Columns | Notes |
|---|---|
| `id` UUID PK | |
| `customer_id` UUID (FK → users.id) | |
| `status` TEXT | `open` → `quoted` → `accepted` → `en_route` → `arrived` → `in_progress` → `completed` / `cancelled` / `expired` |
| `problem_type` TEXT | |
| `location` GEOMETRY(Point, 4326) | Exact customer coordinates |
| `location_address` TEXT | |
| `fuzzy_lat`, `fuzzy_lng` NUMERIC | Approx coordinates shown to providers before quote selection |
| `destination_text`, `destination_area` TEXT | Where vehicle needs to go |
| `accepted_by` UUID (FK → providers.id) | Set when a quote is selected |
| `selected_quote_id` UUID (FK → request_quotes.id) | V2 quote path |
| `final_price` NUMERIC | Legacy field; also used as fallback in completion |
| `price_change_requested` NUMERIC | Provider's requested price change |
| `price_change_status` TEXT | `null`, `'pending'`, `'approved'`, `'rejected'` |
| `price_change_count` INT | Should be 0 or 1; race condition allows 2 — see CRIT-01 |
| `is_ppj` BOOLEAN | Whether accepted via Pay-Per-Job path |
| `overage_cleared` BOOLEAN | Whether provider paid overage for this request |
| `cancellation_reason`, `cancelled_by` | |
| `created_at`, `expires_at` | |

#### `request_quotes`
Marketplace V2 provider quotes. One row per provider per request.

| Key Columns | Notes |
|---|---|
| `id` UUID PK | |
| `request_id` UUID (FK → requests.id) | |
| `provider_id` UUID (FK → providers.id) | |
| `amount` NUMERIC | Quoted price |
| `distance_km` NUMERIC | Provider-to-customer distance at quote time |
| `status` TEXT | `'pending'`, `'selected'`, `'rejected'`, `'expired'` |
| `expires_at` TIMESTAMPTZ | |
| `created_at` | |

**RLS gap:** Customer RLS policy allows reading rejected/expired quotes including provider UUIDs. See Audit 2 LOW-02.

#### `jobs`
Created/updated when a request is accepted. Tracks job lifecycle and completion.

| Key Columns | Notes |
|---|---|
| `id` UUID PK | |
| `request_id` UUID (FK → requests.id) | |
| `provider_id` UUID (FK → providers.id) | |
| `customer_id` UUID (FK → users.id) | |
| `status` TEXT | Mirrors request status through job lifecycle |
| `commission_rate`, `commission_amount` | Currently always 0 (hardcoded in completion RPC) |
| `completed_at`, `en_route_at`, `arrived_at` | Timestamps for lifecycle stages |
| `selected_quote_price` | Price from V2 quote selection |
| `final_price` | Resolved at completion |

#### `ratings`
Customer ratings for completed jobs.

| Key Columns | Notes |
|---|---|
| `id` UUID PK | |
| `job_id` UUID (FK → jobs.id, UNIQUE) | One rating per job |
| `provider_id` UUID (FK → providers.id) | |
| `stars` INT (1–5) | |
| `comment` TEXT | |

**`customer_id`:** added in migration 040 (`UUID REFERENCES users(id)`, indexed) and deterministically backfilled via `jobs → requests`. Before 040, attribution required joining through `jobs → requests`. See Audit 2 HIGH-05.

#### `stripe_events`
Webhook idempotency table. One row per Stripe event ID.

| Key Columns | Notes |
|---|---|
| `id` TEXT PK (= Stripe event ID) | |
| `status` TEXT | `'processing'`, `'processed'`, `'failed'` |
| `processed_at` | |

Claim logic is non-atomic (TOCTOU race). See M4/F3-M2.

#### `ppj_payments` / `overage_payments`
Track Pay-Per-Job and overage payment intents.

#### `payout_log`
Stripe payout events recorded from webhook.

#### `provider_kyc_log`
Immutable audit trail of provider status transitions (added migration 038).

| Key Columns | Notes |
|---|---|
| `id` UUID PK | |
| `provider_id` UUID (FK → providers.id) | |
| `admin_id` UUID (FK → users.id) | |
| `action` TEXT CHECK `('submitted','under_review','approved','rejected','suspended','reactivated')` | |
| `previous_status` TEXT | |
| `notes` TEXT | |
| `created_at` | |

**Atomicity gap:** Status update and log insert are two separate DB operations. If the log insert fails, the status change is already committed with no audit trail. See H5.

#### `fair_price_config`
Configuration for fair price ranges by service type. Present in schema. DB enforcement is disabled by migration 032. Used only for UI display and provider scoring.

#### Other Tables
`request_locks` (legacy acceptance lock), `price_estimates` (public estimate config), `provider_dispatch_log` (quote/selection/SLA/completion analytics).

### PostGIS Usage

- `requests.location` stored as `GEOMETRY(Point, 4326)`
- `provider_locations.location` stored as `GEOMETRY(Point, 4326)`
- `lat`/`lng` generated columns in `provider_locations` (migration 036)
- `get_nearby_open_requests` RPC uses GIST spatial index for geographic filtering
- UAE coordinate bounds enforced in `src/lib/geo.ts` on all API inputs

### Key Security-Definer RPCs

All critical state-mutating operations go through RPCs that are `SECURITY DEFINER`, revoked from `anon`/`authenticated`, and granted only to `service_role`. API routes call them via the admin client.

| RPC | Purpose |
|---|---|
| `accept_provider_request_atomic` | Legacy first-accept with overage guard and active-job check |
| `select_quote_atomic` | V2 quote selection — accepts request, rejects competing quotes, reveals provider details |
| `submit_quote_atomic` | V2 quote submission (fair price validation disabled by migration 032) |
| `complete_provider_job_atomic` | Job completion with price derivation logic |
| `cancel_request_and_compensate_atomic` | Customer cancellation with PPJ credit restore |
| `release_job_atomic` | Provider-initiated job release |
| `advance_provider_job_state` | State machine advancement (accepted→en_route→arrived→in_progress) |
| `sla_check_and_release` | SLA breach release for `accepted` status only (gap: doesn't handle `en_route`/`arrived`) |
| `expire_stale_open_requests` | Cron: expires old open requests |
| `expire_stuck_active_requests` | Weekly cron: releases jobs stuck in active states |
| `restore_ppj_credit_for_cancelled_paid_request` | Restores PPJ credit on customer cancellation |

---

## 5. Core Business Logic and Flows

### 5.1 Provider Registration and KYC

**Provider statuses:** `pending` → `under_review` → `active` (or `rejected` / `suspended`)

1. Provider registers at `/provider/register` — creates `users` + `providers` rows with `status = 'pending'`
2. Provider uploads at least one KYC document via `/api/providers/documents`:
   - Accepted document types: Emirates ID, Driving License, Vehicle Registration (Mulkiya)
   - Storage bucket: `provider-documents` (private)
   - Path pattern: `${provider_id}/${field}.${extension}`
   - Validation: MIME type + magic bytes + size (5 MB max) + extension (JPEG/PNG/PDF only)
   - Upload uses `upsert: true` — re-upload replaces previous file; no version history
   - On upload, non-active provider status moves to `under_review`
3. Admin reviews at `/admin/providers`:
   - Views documents via signed URLs (10-minute expiry)
   - Approves (→ `active`) or rejects (→ `rejected`) via `/api/admin/providers/update`
   - Status change + KYC log entry written in two separate DB operations (non-atomic — see H5)
4. Provider can only quote and receive jobs when `status = 'active'`
5. Provider goes "online" by triggering a `provider_locations` upsert (manual button on dashboard)
6. "Online" threshold: `provider_locations.updated_at` within last 5 minutes

**KYC bypass paths (open vulnerabilities — see C3, C4):**
- Browser client can directly `UPDATE providers SET status='active'` (no `WITH CHECK` on RLS)
- Paying for a Stripe subscription unconditionally sets provider to `active` regardless of KYC status

### 5.2 Request / Quote / Dispatch Flow (Marketplace V2)

1. **Customer creates request** via `POST /api/requests`:
   - Rate limited (10/hour per customer)
   - Validates UAE coordinates
   - Blocks duplicate active requests per customer
   - Stores exact GPS in `requests.location` (PostGIS point)
   - Stores fuzzy coordinates when GPS provided
   - Status starts as `open`

2. **Provider discovers request** via provider dashboard:
   - `get_nearby_open_requests` RPC returns `open` and `quoted` nearby requests
   - Provider sees fuzzy customer location, problem type, destination area — no exact address or contact info
   - Ring-based dispatch: 5 km / 10 km / 20 km / unlimited
   - PPJ providers excluded from ring 1 (5 km) in dispatch logic — but this is NOT enforced in the quote submission API (see Audit 2 MED-01)

3. **Provider submits quote** via `POST /api/provider/jobs/quote` → `submit_quote_atomic`:
   - Provider must be `active`, online, location fresh
   - Request must be `open` or `quoted`
   - Rate limited (30/minute per provider)
   - `submit_quote_atomic` inserts/updates `request_quotes` row; moves first-quote requests from `open` to `quoted`
   - Fair price range check is **disabled** (migration 032) — any amount 1–50,000 AED accepted
   - No monthly allowance check in V2 quote path — overage not collected for V2 selections (see H3)

4. **Customer views quotes** via `GET /api/requests/quotes`:
   - Only for customer who owns the request
   - Returns up to 5 quotes, sorted by provider score (rating, distance, price, completion count)
   - Provider shown as anonymous (first 4 chars of UUID — weak anonymisation, see L3)
   - Customer sees provider rating and distance but not name/phone until selection

5. **Customer selects quote** via `POST /api/customer/quote/select` → `select_quote_atomic`:
   - Accepts selected quote, rejects all competing pending quotes
   - Increments `providers.jobs_this_month`
   - Sets `requests.accepted_by` and `requests.selected_quote_id`
   - Sets `requests.status = 'accepted'`
   - Returns provider name, phone, rating, and `documents` JSONB to customer (KYC paths should not be returned — see H1)

6. **Provider advances job lifecycle** via `POST /api/provider/jobs/advance-state`:
   - Valid transitions: `accepted` → `en_route` → `arrived` → `in_progress`
   - Backed by `advance_provider_job_state` RPC
   - Client shows 5-step progress timeline

7. **Provider may request one price change** during `in_progress` via `POST /api/provider/jobs/price-change`:
   - Race condition allows submitting two price changes concurrently (see CRIT-01)

8. **Customer responds to price change** via `POST /api/customer/price-change/respond`:
   - Response UPDATE lacks `status = 'in_progress'` guard (see HIGH-06)

9. **Provider completes job** via `POST /api/provider/jobs/complete` → `complete_provider_job_atomic`:
   - Final price resolved in order: (1) approved price change, (2) selected quote price, (3) legacy `final_price` body parameter
   - Commission always set to 0 (intentional for current phase)
   - Rating prompt shown to customer

10. **Customer rates** via `POST /api/ratings`:
    - Rating stored without `customer_id` column (see HIGH-05)
    - `update_provider_rating` trigger recalculates provider average from last 50 ratings

### 5.3 Legacy Accept Path

`POST /api/provider/requests/accept` remains fully functional alongside V2. It performs first-accept on any `open` request, bypassing the competitive quote model. It is still used by PPJ and overage payment webhook success paths. A provider can first-accept any `open` request before any quotes are submitted. See H2.

### 5.4 Payment and Stripe Webhook Handling

**Subscription flow:**
1. Provider calls `POST /api/stripe/create-checkout` (no KYC status check — see M3)
2. Stripe Checkout session created; provider redirected
3. On payment: `customer.subscription.created` webhook fires
4. `processSubscriptionChange` runs:
   - Resolves provider status via `resolveStripeStatus()`:
     - `sub.status = 'active'` → always returns `'active'` (KYC bypass — see C4)
     - `KYC_PROTECTED = ['under_review', 'rejected']` only protects those two statuses when Stripe is NOT active
     - `'pending'` and `'suspended'` providers can be activated by paying
   - Sets `providers.plan` from Stripe price ID
   - Updates `stripe_customer_id`, `stripe_subscription_id`, billing period

**PPJ flow:**
1. Provider calls `POST /api/provider/ppj-checkout` (provider must be active, online, location fresh)
2. Distance calculated from provider GPS to request GPS (falls back to distance=0 on parse failure — see M6)
3. PaymentIntent created with fee amount
4. `payment_intent.succeeded` webhook calls `accept_provider_request_atomic`

**Overage flow:**
1. Provider calls `POST /api/provider/overage-checkout` (subscription provider at monthly limit)
2. PaymentIntent created for 12 AED overage fee
3. `payment_intent.succeeded` webhook sets `overage_cleared = true` on request, then calls `accept_provider_request_atomic`
4. **Gap:** `overage_cleared` is NOT reset when `release_job_atomic` runs — the next provider to accept a released request gets to skip the overage payment (see F3-H2)
5. **Gap:** If `accept_provider_request_atomic` fails after the overage payment, the provider is charged with no job assigned and no refund/credit mechanism (see F3-H1)

**Webhook idempotency:**
- Events claimed in `stripe_events` table before processing
- Claim is non-atomic (read-then-write TOCTOU) — see M4/F3-M2
- `PROCESSING_TIMEOUT_MS = 10 minutes` — long enough for double-processing under DB slowness
- `checkout.session.completed` is log-only; activation comes from `customer.subscription.created`

### 5.5 SLA and Auto-Release Logic

| Mechanism | Scope | Frequency | Gap |
|---|---|---|---|
| `sla_check_and_release` (marketplace-cron) | `accepted` requests only | Every minute | Does NOT handle `en_route` or `arrived` — provider can advance to `en_route` and abandon indefinitely (up to 1 week) |
| `expire_stuck_active_requests` (weekly-sla-reset) | All stuck active states | Weekly (Sundays) | Does not decrement `jobs_this_month` on release |
| Provider manual release | Any active state | On demand | Requires provider cooperation |
| Customer cancellation | Any state before `in_progress` | On demand | Only self-service option for abandoned `en_route`/`arrived` jobs |

**Admin stuck job alert:** Jobs in `en_route`/`arrived` for more than 2 hours show a banner on `/admin/dashboard`. No automated action from the alert — just visibility.

---

## 6. Current Security Posture

All findings below come from four security audits (Parts 1–4, dates June 2026) verified against source code. Status reflects Batch 1 remediation: code-complete items are marked **RESOLVED** (statically verifiable) or **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (behavior requires a live DB / deployed environment to confirm).

> **Deployment note (Batch 1):** As of the Batch 1 session, `supabase/migrations/039_security_backstop.sql` exists in the repo but is **NOT yet applied to the cloud database** (verified at runtime: `public.is_service_role()` returns PGRST202 "function not found" and `overage_payments.accept_failed` returns 42703 "column does not exist"). The C2/C3 trigger enforcement therefore cannot be runtime-verified until 039 is deployed. Apply 039, then run §6.1.

> **Deployment note (Batch 2):** `supabase/migrations/040_rpc_integrity_state_safety.sql` exists in the repo but is **NOT yet applied to the cloud database**. It must be applied after 039. It modifies `release_job_atomic`, `sla_check_and_release`, `expire_stuck_active_requests`, `advance_provider_job_state`, `select_quote_atomic`; adds helper `release_target_status`, new RPCs `request_price_change_atomic` and `respond_price_change_atomic`; adds `ratings.customer_id` (+ deterministic backfill). All Batch 2 RPCs are **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** until 040 is deployed and tested. **Still pending in Batch 3:** the `enforceSla()` query in `ops/marketplace-cron/route.ts` must be widened to `status IN ('accepted','en_route','arrived')` so the now-extended `sla_check_and_release` actually receives `en_route`/`arrived` breaches (the RPC side is ready). See §6.2 for the post-deploy verification SQL.

> **Deployment note (Batch 3):** `supabase/migrations/041_admin_provider_status_atomic.sql` exists in the repo but is **NOT yet applied to the cloud database**; apply it after 040. It adds one narrow RPC, `admin_update_provider_status_atomic`, that performs the admin status/verified_badge change AND the `provider_kyc_log` insert in a single transaction (H5). Batch 3 also completed the **cron side of CRIT-02** in `ops/marketplace-cron/route.ts` (query widened to `status IN ('accepted','en_route','arrived')`, oldest-first, LIMIT 50; the migration-040 RPC owns the thresholds) — so **CRIT-02 is now fully closed (RPC + cron)**. Other Batch 3 closures (route-only, no migration): P4-C2, P4-H2, P4-H4, P4-M2 (`marketplace-cron` / `monthly-allowance-reset`), F3-L4 (business `jobs_this_month` now reset monthly), and M1 (rate limiting on `admin/providers/update`). The `admin_update_provider_status_atomic` RPC is **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** until 041 is deployed. **Post-deploy QA to re-run:** the CRIT-02 end-to-end scenario (leave a job in `en_route` past 2h or `arrived` past 60m → the minute cron must auto-release it to `quoted`/`open` per D6) — this could not pass before this batch. See §6.3. **M1 follow-up (not in this batch):** `src/app/api/admin/sentry-verify/route.ts` still needs `checkRateLimitAsync`.

### 6.1 C2/C3 Runtime Verification Plan (run AFTER migration 039 is applied)

These tests MUST run under an anon/authenticated JWT (the attacker's context), NOT the `service_role` key — a `service_role` connection bypasses the guard by design and proves nothing.

**Option A — psql / SQL editor, simulating a non-admin authenticated user:**
```sql
-- Replace <USER_UUID> with a real non-admin user id and <PROVIDER_UUID> with a real provider id.

-- Simulate the request a non-admin browser session makes:
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"<USER_UUID>"}';

-- TEST 1 — role escalation must FAIL (expect: ERROR role_change_not_allowed, SQLSTATE 42501)
UPDATE public.users SET role = 'admin' WHERE id = '<USER_UUID>';

-- TEST 2 — provider self-activation must FAIL (expect: ERROR provider_protected_field_change_not_allowed, SQLSTATE 42501)
UPDATE public.providers SET status = 'active', verified_badge = true WHERE id = '<PROVIDER_UUID>';

RESET role;

-- TEST 3 — admin/service-role activation must SUCCEED.
-- The admin API route (POST /api/admin/providers/update with {provider_id, status:'active'})
-- uses the service_role client, for which is_service_role() is true. Equivalent SQL check:
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.providers SET status = 'active' WHERE id = '<PROVIDER_UUID>';  -- expect: UPDATE 1
RESET role;
```

**Option B — Supabase JS client with the anon key + a real signed-in non-admin user:**
```js
const supabase = createClient(SUPABASE_URL, ANON_KEY)
await supabase.auth.signInWithPassword({ email, password }) // a non-admin user/provider
// TEST 1: expect error.code === '42501'
const r1 = await supabase.from('users').update({ role: 'admin' }).eq('id', userId)
// TEST 2: expect error.code === '42501'
const r2 = await supabase.from('providers').update({ status: 'active' }).eq('id', providerId)
```

Pass criteria: Tests 1 and 2 return error `42501` (`role_change_not_allowed` / `provider_protected_field_change_not_allowed`); Test 3 succeeds. Record the exact returned codes/messages here once run.

### 6.2 Batch 2 Runtime Verification Plan (run AFTER migration 040 is applied)

Run these in the Supabase SQL editor (service_role context). Use a disposable test request/provider.

```sql
-- A) release_target_status helper (read-only): 'quoted' when a valid pending quote exists, else 'open'.
SELECT public.release_target_status('<request_with_pending_nonexpired_quote>');  -- expect 'quoted'
SELECT public.release_target_status('<request_with_no_pending_quote>');          -- expect 'open'
-- Confirm it mutated nothing: re-select the request_quotes statuses before/after; they must be identical.

-- B) release_job_atomic — quoted/open target, slot decrement only when consumed, overage cleared.
-- Setup: request status='accepted', accepted_by=<prov>, selected_quote_id set, providers.jobs_this_month=N.
SELECT * FROM public.release_job_atomic('<provider_id>', '<request_id>');  -- expect (true,'released')
SELECT status, accepted_by, selected_quote_id, accepted_at, overage_cleared
FROM requests WHERE id = '<request_id>';
-- expect status 'quoted' (if pending quote remains) else 'open'; accepted_by/selected_quote_id/accepted_at NULL; overage_cleared false
SELECT jobs_this_month FROM providers WHERE id = '<provider_id>';  -- expect N-1 (slot was consumed)
-- Repeat with a request where selected_quote_id IS NULL → jobs_this_month must be UNCHANGED.

-- C) sla_check_and_release — extended states + thresholds.
-- accepted breach (accepted_at older than 20m):
SELECT * FROM public.sla_check_and_release('<accepted_breached_request>');  -- expect (true,'released',<prov>,<bool>)
-- en_route breach requires jobs.en_route_at older than 2h; arrived breach requires jobs.arrived_at older than 60m.
-- Not-yet-breached request:
SELECT * FROM public.sla_check_and_release('<fresh_request>');              -- expect (false,'sla_not_breached',NULL,false)

-- D) advance_provider_job_state — whitelist.
SELECT * FROM public.advance_provider_job_state('<prov>','<req>','arrived','completed',NULL); -- expect (false,'invalid_target_status',NULL)
SELECT * FROM public.advance_provider_job_state('<prov>','<req>','accepted','en_route','en_route_at'); -- expect (true,NULL,'en_route') if owned & matching

-- E) request_price_change_atomic — one change per job, atomic.
SELECT * FROM public.request_price_change_atomic('<prov>','<in_progress_req>', 250); -- expect (true,'requested'); price_change_count→1
SELECT * FROM public.request_price_change_atomic('<prov>','<same_req>', 300);        -- expect (false,'price_change_not_allowed'); count stays 1

-- F) respond_price_change_atomic — guard inside + reject never surfaces price.
SELECT * FROM public.respond_price_change_atomic('<cust>','<in_progress_req>','reject');  -- expect (true,'responded',NULL); count stays 1
SELECT * FROM public.respond_price_change_atomic('<cust>','<same_req>','approve');        -- expect (false,'no_pending_price_change',NULL)

-- G) select_quote_atomic — no documents leaked.
-- Confirm the function's RETURNS TABLE has 5 columns (no provider_documents):
SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'select_quote_atomic';

-- H) ratings.customer_id backfill — must be fully populated for ratings with a resolvable request.
SELECT count(*) FROM ratings r
  JOIN jobs j ON j.id = r.job_id
  JOIN requests req ON req.id = j.request_id
  WHERE r.customer_id IS NULL AND req.customer_id IS NOT NULL;  -- expect 0
```

### 6.3 Batch 3 Runtime Verification Plan (run AFTER migrations 040 + 041 are applied)

Run in the Supabase SQL editor (service_role) plus one cron HTTP call. Use a disposable test request/provider.

```sql
-- A) CRIT-02 end-to-end (the scenario that could NOT pass before Batch 3).
-- A1) accepted breach: set accepted_at older than 20m.
UPDATE requests SET status='accepted', accepted_by='<prov>', accepted_at = now() - interval '25 minutes'
WHERE id='<req>';
-- A2) en_route breach: needs jobs.en_route_at older than 2h.
UPDATE requests SET status='en_route', accepted_by='<prov>' WHERE id='<req2>';
UPDATE jobs SET en_route_at = now() - interval '3 hours' WHERE request_id='<req2>' AND provider_id='<prov>';
-- A3) arrived breach: needs jobs.arrived_at older than 60m.
UPDATE requests SET status='arrived', accepted_by='<prov>' WHERE id='<req3>';
UPDATE jobs SET arrived_at = now() - interval '90 minutes' WHERE request_id='<req3>' AND provider_id='<prov>';
```
Then invoke the cron once (authorized): `GET /api/ops/marketplace-cron`. Expect HTTP 200 and `sla_releases >= 3`. Verify each request:
```sql
SELECT id, status, accepted_by, selected_quote_id, accepted_at, overage_cleared FROM requests WHERE id IN ('<req>','<req2>','<req3>');
-- expect: status 'quoted' (if a valid pending quote remains) else 'open'; accepted_by/selected_quote_id/accepted_at NULL; overage_cleared false
SELECT jobs_this_month FROM providers WHERE id='<prov>';  -- decremented once per released V2 (selected_quote_id) job, GREATEST(0,..)
```
Negative control: a fresh `en_route` job (en_route_at = now()) must NOT be released by the cron (the RPC returns `sla_not_breached`).

```sql
-- B) Atomic admin status + audit log (migration 041).
SELECT * FROM public.admin_update_provider_status_atomic(
  '<admin_uuid>', '<provider_uuid>', 'active', NULL, 'KYC approved', 'under_review', 'approved'
);  -- expect (true,'updated')
SELECT status FROM providers WHERE id='<provider_uuid>';            -- expect 'active'
SELECT action, previous_status, new_status, notes FROM provider_kyc_log
  WHERE provider_id='<provider_uuid>' ORDER BY created_at DESC LIMIT 1;  -- expect ('approved','under_review','active','KYC approved')
-- Atomicity proof: both rows reflect the change, written in one transaction.
-- Guard checks:
SELECT * FROM public.admin_update_provider_status_atomic('<admin>','<prov>','bogus',NULL,NULL,'active','approved'); -- expect (false,'invalid_status')
SELECT * FROM public.admin_update_provider_status_atomic('<admin>','00000000-0000-0000-0000-000000000000','active',NULL,NULL,'pending','approved'); -- expect (false,'provider_not_found')

-- C) Business-plan monthly reset (F3-L4).
-- Setup a business provider whose stripe_current_period_start advanced past jobs_reset_at, jobs_this_month > 0.
-- Invoke GET /api/ops/monthly-allowance-reset, then:
SELECT plan, jobs_this_month, job_credit_balance, jobs_reset_at FROM providers WHERE id='<business_prov>';
-- expect jobs_this_month = 0; job_credit_balance UNCHANGED; jobs_reset_at advanced to the new period.
```



### Critical Findings

| ID | Title | What it enables | Status |
|---|---|---|---|
| **C1** | `proxy.ts` not registered as Next.js middleware — CSRF checks and auth redirects not running | (Audit premise) Any origin can submit POST requests with a victim's session cookie (CSRF). Protected page routes have no server-side redirect guard. | **NOT APPLICABLE on Next.js 16** — In Next.js 16.0.0 the `middleware` convention was deprecated and renamed to `proxy`. `src/proxy.ts` with a named `proxy` export IS the active registered middleware/proxy entrypoint (production build confirms `ƒ Proxy (Middleware)`). No open vulnerability remains. The audit's "rename to middleware.ts" guidance reflects pre-16 conventions and does not apply. CSRF hardening (H7/D9) was applied in place. |
| **C2** | `users` RLS UPDATE has no `WITH CHECK` — any user can self-escalate to admin | `supabase.from('users').update({ role: 'admin' })` from browser succeeds. Admin gains full access to all admin API routes and all admin RLS policies. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 039 NOT yet applied to cloud DB). `BEFORE UPDATE` trigger `enforce_users_immutable_columns` blocks `role` change unless `is_admin() OR is_service_role()`. Must be confirmed under an anon/authenticated JWT after 039 deploys (see §6.1 Verification Plan). |
| **C3** | `providers` RLS UPDATE has no `WITH CHECK` — any provider can self-activate | `supabase.from('providers').update({ status: 'active', verified_badge: true })` from browser succeeds. Bypasses entire KYC process. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 039 NOT yet applied to cloud DB). `BEFORE UPDATE` trigger `enforce_providers_immutable_columns` locks status/verified_badge/rating/plan/stripe/allowance/KYC columns unless `is_admin() OR is_service_role()`. Must be confirmed under an anon/authenticated JWT after 039 deploys (see §6.1 Verification Plan). |
| **C4 / F3-C1** | Stripe subscription webhook unconditionally sets `providers.status = 'active'` | Provider in `pending` or `suspended` status pays for a subscription → webhook activates them. `KYC_PROTECTED` only guards `under_review` and `rejected`. Full exploit chain in FEC-3. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION (production payment path)** — `KYC_PROTECTED` now includes `pending` + `suspended` and is checked before the `active` branch in `resolveStripeStatus()`; payment records the subscription but never auto-activates (D1). Confirm against live Stripe webhook events. |
| **C5** | Fair price validation disabled in `submit_quote_atomic` (migration 032) | Providers can quote any amount from 1 AED to 50,000 AED for any service type with no range check. | **RESOLVED** (migration 039) — `submit_quote_atomic` re-reads bounds from `fair_price_config` and rejects `price_too_low`/`price_too_high` (D2) |
| **CRIT-01** | Price-change count enforced by read-then-write (TOCTOU race) | Provider submits two concurrent price-change requests → both pass the `count >= 1` check → second request resets a customer's rejected decision → customer unknowingly approves a second (higher) price change | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — new `request_price_change_atomic` RPC performs the count-check + update in a single guarded statement (`price_change_count = 0`); route calls the RPC and keeps no separate count/update logic. |
| **CRIT-02** | SLA auto-release only fires on `accepted` status | Provider accepts a job, immediately advances to `en_route`, then abandons. Customer is locked for up to one week with no automated recovery. `jobs_this_month` counter permanently inflated (see HIGH-04). | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — `sla_check_and_release` now releases from `accepted`/`en_route`/`arrived`, computing breach inside the RPC (accepted=20m vs `requests.accepted_at`, en_route=2h vs `jobs.en_route_at`, arrived=60m vs `jobs.arrived_at`). **Batch 3 closed the cron side:** the `enforceSla()` query was widened to `status IN ('accepted','en_route','arrived')` (oldest-first, LIMIT 50); the RPC owns the thresholds. **CRIT-02 is now FULLY closed (RPC + cron)** — NEEDS RUNTIME VERIFICATION until 040+041 deploy (see §6.3 end-to-end QA). |
| **P4-C1** | Realtime broadcasts to ALL online providers on every new request INSERT | At 1,000+ online providers, one new request triggers 1,000 simultaneous `router.refresh()` SSR renders (5–8 DB queries each) → Supabase connection pool exhaustion → platform outage. | **OPEN** — architectural issue in `ProviderRealtimeRefresh.tsx`, no geographic pre-filter |
| **P4-C2** | Monthly allowance reset loads all providers in a single serverless function | `Promise.all()` on all qualifying providers crashes at ~500 providers due to memory/concurrency limits → all providers stay locked at their monthly limit for the full next billing cycle. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** — `ops/monthly-allowance-reset/route.ts` now pages through providers in batches of 50 via `.range()`, processed sequentially per page; memory stays flat regardless of provider count. |

### High Findings

| ID | Title | What it enables | Status |
|---|---|---|---|
| **H1** | `select_quote_atomic` returns KYC document storage paths to customer | Customer receives `provider.documents` containing Supabase storage paths (includes provider UUID). Privacy concern; bucket misconfiguration → direct file access. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — `provider_documents` removed from the `select_quote_atomic` return type and from the route response; customer still receives name/phone/rating only. |
| **H2** | Legacy accept endpoint bypasses V2 quote model | Any provider can first-accept any `open` request, denying customers competitive quotes. Still used by PPJ/overage paths. | **OPEN** (known, deferred decision) |
| **H3** | V2 quote selection doesn't collect overage fee | `select_quote_atomic` increments `jobs_this_month` but doesn't check the monthly limit or trigger overage payment. At-limit providers get free extra jobs in V2 path. | **OPEN** — `031_marketplace_v2_schema.sql:566–568` |
| **H4** | `jobs_this_month` permanently inflated for stuck `en_route`/`arrived` jobs | Consequence of CRIT-02: counter increments on select, never decrements until monthly reset for abandoned jobs. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** — fully addressed now that Batch 3 closed the CRIT-02 cron side: `sla_check_and_release` receives `en_route`/`arrived` breaches and decrements `jobs_this_month` (HIGH-04). |
| **H5** | KYC status update not atomic with audit log insert | Admin status change committed in DB, then KYC log inserted separately. If log insert fails, status is changed with no audit trail. Compliance risk under UAE regulations. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 041) — new `admin_update_provider_status_atomic` RPC writes status/verified_badge AND the `provider_kyc_log` row in one transaction; the route calls it instead of two separate writes. Narrow named params only (no generic provider-update hole; C3 preserved). |
| **H6 (Audit 1)** | `accept_provider_request_atomic` active-job check misses `en_route`/`arrived` states | TOCTOU window: if provider's job transitions `accepted` → `en_route` between route preflight and RPC, RPC allows a second accept. Provider can hold two simultaneous active jobs. | **OPEN** — `migrations/024_accept_rpc_overage_guard.sql:54–59` |
| **H7 (Audit 1)** | CSRF check bypassed on null Origin + `*.vercel.app` wildcard allowed | Requests with no `Origin` or `Referer` header skip CSRF check entirely. Any `*.vercel.app` deployment passes the origin check. Compounded by C1 (CSRF not running at all). | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** — missing Origin+Referer on a state-mutating `/api/` POST is now rejected; `*.vercel.app` wildcard removed (D9). Confirm in a deployed environment that legitimate same-origin POSTs pass and forged/null-origin POSTs get 403. |
| **HIGH-01 (Audit 2)** | `GET /api/requests/quotes` accepts unvalidated `request_id` query string | Non-UUID values sent directly to DB; different error responses for valid-UUID-not-found vs malformed-input leaks information. | **OPEN** |
| **HIGH-02 (Audit 2)** | `GET /api/requests` performs state-mutating expiry write with no error handling | GET endpoint mutates DB state on every poll when a quoted request is >20 min old. No error handling on the write; races with marketplace-cron. | **OPEN** |
| **HIGH-03 (Audit 2)** | `release_job_atomic` doesn't decrement `jobs_this_month` for V2 jobs | Provider who accepts and releases a job loses a monthly slot permanently for that month. Counter drifts upward over time. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — `release_job_atomic` decrements `jobs_this_month` via `GREATEST(0, .. - 1)` only when a slot was consumed (`selected_quote_id IS NOT NULL` captured before clearing); PPJ/legacy jobs untouched. |
| **HIGH-05 (Audit 2)** | Rating row doesn't store `customer_id` | No DB-level attribution of which customer submitted a rating. Dispute resolution lacks DB evidence chain. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — `ratings.customer_id` column + index added and deterministically backfilled via `jobs → requests` (job_id is UNIQUE); `/api/ratings` writes `customer_id` on insert. |
| **HIGH-06 (Audit 2)** | Price-change respond route lacks `status = 'in_progress'` DB guard | Race: provider completes job, then customer's approve call arrives; DB shows `price_change_status = 'approved'` on a completed job but actual charge used original quote price. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — new `respond_price_change_atomic` RPC enforces `status = 'in_progress'` AND `price_change_status = 'pending'` inside the RPC; reject returns `final_price = NULL` and never surfaces the requested price; `price_change_count` stays 1 (no second attempt). |
| **F3-H1 (Audit 3)** | No recovery for failed overage accepts | Provider pays 12 AED overage fee, `accept_provider_request_atomic` fails (request already taken, capacity full, etc.). No refund, no credit. Money taken with no service. | **PARTIAL** — minimal tracking added: `overage_payments.accept_failed` flag set + logged for admin follow-up; `overage_cleared` now set only after a successful accept. Automatic refund/credit deferred. |
| **F3-H2 (Audit 3)** | `overage_cleared` not reset on job release | When a released request's `overage_cleared = true` flag persists, the next provider to accept gets the free overage slot. Platform loses revenue. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** (migration 040) — `overage_cleared` reset to `false` on release in `release_job_atomic`, `sla_check_and_release`, and `expire_stuck_active_requests`. |
| **P4-H1 (Audit 4)** | No rate limiting on polling endpoints | `GET /api/requests` and `GET /api/requests/quotes` have no `checkRateLimitAsync` calls. At 10,000 customers polling every 5 seconds: ~2,000 req/s to unprotected DB read endpoints. | **OPEN** |
| **P4-H2 (Audit 4)** | SLA enforcement loop is sequential over up to 50 requests | 50 serial RPCs per cron invocation; can exceed Vercel `maxDuration` under load. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** — candidates capped at 50, ordered oldest-`updated_at`-first so the closest-to-breach rows are never starved; remainder handled by subsequent minute runs. Sequential calls stay within `maxDuration`. |
| **P4-H3 (Audit 4)** | Weekly SLA reset is non-atomic two-phase update | Two separate DB writes; partial failure corrupts provider SLA flags without rollback. | **OPEN** |
| **P4-H4 (Audit 4)** | Cron partial failures return HTTP 200 | Vercel sees success, no alerting. Silent cron failures go undetected. | **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** — `marketplace-cron` returns 500 when a critical subtask (whole query/RPC-fetch) fails or throws, so Vercel retries and alerting fires; normal per-row `sla_not_breached` outcomes are not treated as failures. Retries are safe (idempotent, no double-decrement). `monthly-allowance-reset` returns 500 on load failure or any per-provider failure. |
| **P4-H5 (Audit 4)** | Admin dashboard runs 19+ parallel DB queries per page load | `stuckJobs` query has no index on `jobs.en_route_at`. | **OPEN** |
| **P4-H6 (Audit 4)** | Customer page dual-loads: polling + realtime both trigger full API fetches | Customer polls every 5 seconds AND realtime events trigger the same full fetch. Double read load under active jobs. | **OPEN** |

### Medium Findings

| ID | Title | Status |
|---|---|---|
| M1 (Audit 1) | Admin API routes have no rate limiting | CODE COMPLETE — NEEDS RUNTIME VERIFICATION — `admin/providers/update` now calls `checkRateLimitAsync` (30 req / 60s per admin, 429 + Retry-After). **Follow-up (not in this batch):** `src/app/api/admin/sentry-verify/route.ts` still needs the same guard. |
| M2 (Audit 1) | Provider-controlled `final_price` accepted for legacy job completion | OPEN |
| M3 (Audit 1) | `create-checkout` doesn't check provider KYC status before creating Stripe session | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — 403 for rejected/suspended before checkout + portal; pending/under_review allowed (D1) |
| M4 (Audit 1) | Stripe event claim is non-atomic (TOCTOU) | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — `claimStripeEvent` rewritten as atomic conflict-aware upsert + status-guarded re-claim |
| M5 (Audit 1) | Commission hardcoded to 0 — platform earns no revenue on completions | OPEN (intentional for now) |
| M6 (Audit 1) | PPJ distance silently falls back to 0 on GPS parse failure — wrong fee charged | OPEN |
| M7 (Audit 1) | Bearer token fallback elevates XSS impact | RESOLVED (D10) — Bearer fallback removed from `getRequestUser`; auth is cookie-session only |
| MED-01 (Audit 2) | Ring eligibility and `visibility_reduced` not enforced in quote API | OPEN |
| MED-02 (Audit 2) | Provider score uses `jobs_this_month` as lifetime completions — new-provider boost fires every month | OPEN |
| MED-03 (Audit 2) | Customer cancel counter updated outside RPC — silently under-counts on DB failure | OPEN |
| MED-04 (Audit 2) | `release_job_atomic` resets to `open` ignoring pending quotes; stale `selected_quote_id` not cleared | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (migration 040) — release uses shared read-only `release_target_status()` helper (→ `quoted` if valid pending non-expired quotes remain, else `open`) and clears `selected_quote_id`/`accepted_at` |
| MED-05 (Audit 2) | Acceptance rate in scoring is tautological | OPEN |
| F3-M1 (Audit 3) | Subscription plan silently unresolved when Stripe price ID env vars absent | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — active sub with unresolved plan now logs (sub id + unmatched price ids) and throws so the event is recorded failed |
| F3-M2 (Audit 3) | Non-atomic Stripe event claim (TOCTOU) — re-verified | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — see M4 |
| F3-M3 (Audit 3) | Billing portal opened for rejected/suspended providers | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — KYC gate runs before both portal and checkout branches |
| P4-M1 (Audit 4) | Missing index on `jobs.en_route_at` — admin stuck-job query is full table scan | OPEN |
| P4-M2 (Audit 4) | `expireStaleQuotes` has no row LIMIT — can hold write locks on large batches | CODE COMPLETE — NEEDS RUNTIME VERIFICATION — `.limit(500)` added to both `expireStaleQuotes` and `expireUnselectedRequests`; remainder handled on the next minute run |
| P4-M3 (Audit 4) | Weekly SLA reset fetches all providers with no LIMIT | OPEN |
| P4-M4 (Audit 4) | Rate-limit Redis fallback flag resets on every cold start | OPEN |
| P4-M5 (Audit 4) | Realtime channel count scales linearly with online providers | OPEN |
| P4-M6 (Audit 4) | `OPS_CRON_SECRET` and Upstash vars in soft-warning env list, not hard-fail | OPEN |

### Low Findings

| ID | Title | Status |
|---|---|---|
| L1 (Audit 1) | CSP uses `unsafe-inline` for `script-src` | OPEN |
| L2 (Audit 1) | All authenticated users can read all ratings rows | OPEN |
| L3 (Audit 1) | Provider anonymous ID is first 4 chars of UUID (weak anonymisation) | OPEN |
| L4 (Audit 1) | Webhook stale-processing timeout is 10 minutes (too long) | RESOLVED — reduced to 3 minutes |
| L5 (Audit 1) | `spatial_ref_sys` RLS disabled (PostGIS system table — cannot be fixed) | Acknowledged |
| LOW-01 (Audit 2) | `advance_provider_job_state` RPC missing `SET search_path = public` | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (migration 040) — `SET search_path = public` added |
| LOW-02 (Audit 2) | Customer RLS on `request_quotes` exposes rejected/expired quotes with provider UUIDs | OPEN |
| LOW-03 (Audit 2) | `expire_stuck_active_requests` weekly cron doesn't decrement `jobs_this_month` | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (migration 040) — decrements `jobs_this_month` (`GREATEST(0, .. - 1)`) per released row only when `selected_quote_id IS NOT NULL` |
| LOW-04 (Audit 2) | `advance_provider_job_state` RPC doesn't whitelist valid `p_to_status` values | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (migration 040) — rejects any `p_to_status` outside `('en_route','arrived','in_progress')` with `invalid_target_status` |
| LOW-05 (Audit 2) | SLA enforcement processes max 50 requests per cron run | OPEN |
| LOW-06 (Audit 2) | Migrations 033 and 034 each contain function body defined twice | OPEN |
| F3-L1 (Audit 3) | `payment_intent.canceled` not handled — canceled PPJ intents stay `pending` forever | CODE COMPLETE — NEEDS RUNTIME VERIFICATION (payment path) — handler moves only currently-`pending` PPJ/overage rows to `failed` |
| F3-L2 (Audit 3) | Monthly reset zeroes `job_credit_balance` — mid-cycle upgrade credits lost | OPEN |
| F3-L3 (Audit 3) | `calculateCommission()` defined but never called | OPEN (intentional for now) |
| F3-L4 (Audit 3) | Business plan `jobs_this_month` never resets — counter drifts upward indefinitely | CODE COMPLETE — NEEDS RUNTIME VERIFICATION — monthly allowance reset now includes the business plan; it zeroes ONLY `jobs_this_month` (+ advances `jobs_reset_at`), never touching billing/allowance fields. Confirmed business `jobs_this_month` is not read as a gate anywhere, so this is data-integrity only. |
| F3-L5 (Audit 3) | Stale payment intent reuse returns old PPJ fee when promo/rate changes | OPEN |
| P4-L1 (Audit 4) | Logger writes to stdout only — no log aggregation, alerting, or persistence | OPEN |
| P4-L2 (Audit 4) | `check_provider_suspension` trigger fires `COUNT(*)` per rating UPDATE | OPEN |
| P4-L3 (Audit 4) | No documented deployment-safety procedure for migration → deploy ordering | OPEN |
| P4-L4 (Audit 4) | `OPS_CRON_SECRET` missing causes silent 503s; not in hard-fail startup validation | OPEN |
| P4-L5 (Audit 4) | `request_quotes` realtime publication not confirmed in source sections read | Needs verification |

### Cascading Failure Chains

| Chain | Severity | Trigger |
|---|---|---|
| **CFC-1** | Critical | New request + 1,000 providers → Supabase pool exhaustion → platform outage |
| **CFC-2** | High | Redis down → rate limits fail → quote spam → DB overload → SLA never enforced → customers stranded |
| **CFC-3** | High | Monthly reset crash → all at-limit providers blocked → marketplace freeze for 24h |

### Audit 4 Launch Readiness Scores

| Dimension | Score | Reason |
|---|---|---|
| Security | 3/10 | Critical RLS, CSRF, KYC bypass unpatched |
| Scalability | 2/10 | Thundering herd dangerous at 1,000+ providers; monthly reset crashes at 500+ |
| Operational readiness | 2/10 | No log aggregation, no alerting, no runbooks, cron failures invisible |
| Overall production readiness | 2/10 | Not safe for production scale without architectural changes |

---

## 7. Current Deployment Status

### What is Live in Production

Based on `DEPLOYMENT_STATUS.md` (last verified June 5, 2026 — may be partially stale):

**Vercel:**
- Application deployed to `rescuego.ae`
- All Supabase env vars present (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- Sentry DSN configured
- Stripe keys present — **still on TEST/sandbox keys** (not live). Real payments cannot be processed.
- `NEXT_PUBLIC_APP_URL` set
- `OPS_CRON_SECRET` set
- Vercel cron routes active (all 4 from `vercel.json`)

**Missing from Vercel (as of June 5, 2026):**
- `NEXT_PUBLIC_SITE_URL` — not set (password reset email fallback may produce wrong URLs)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — deferred to Phase 6
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — not set; rate limiting is running on in-memory fallback only (not shared across Vercel instances)
- Sentry source map vars (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) — optional

**Supabase (production project):**
- All 38 migrations applied (001–038)
- `provider-documents` bucket exists with actual provider files present
- Bucket listed as having 0 RLS policies in dashboard (RLS policies are from migration 023 — may be a display issue; requires verification)
- PostGIS enabled
- Sentry verified and working

**Stripe:**
- Webhook endpoint active: `https://www.rescuego.ae/api/stripe/webhook` (10 events subscribed, 0% error rate)
- **Mode: Sandbox/Test — not live**

**Deprecated Supabase Edge Functions:**
- 5 functions present in `supabase/functions/` directory: `accept-request`, `calculate-priority`, `charge-commission`, `stripe-webhook`, `unlock-job`
- These should not be deployed; if deployed, they can conflict with Next.js API route logic
- Deployment status unverified from source

---

## 8. Known Technical Debt and Fragile Areas

### Architecture / Design Debt

1. **Legacy accept path coexists with Marketplace V2.** `/api/provider/requests/accept` is still fully functional. PPJ and overage webhook paths call it. This means two parallel models for accepting requests exist simultaneously with no clean separation.

2. **Fair price validation disabled.** Migration 032 permanently replaced `submit_quote_atomic` with a version that skips all `fair_price_config` range checks. The comment says "re-enable before soft launch" but soft launch is already running with it disabled. The `fair_price_config` table and `range-estimator.ts` still exist and are used for UI display only.

3. **Commission always zero.** `complete_provider_job_atomic` hardcodes `commission_rate = 0, commission_amount = 0`. `calculateCommission()` exists in `utils.ts` but is never called. Platform earns no commission revenue on completed jobs.

4. **No destination coordinates.** `destination_lat`/`destination_lng` columns exist in schema. Request creation stores `destination_text` and `destination_area` but not destination coordinates. Provider scoring can reference destination distance in theory but has no actual data.

5. **`selected_quote_id` stale after release.** When `release_job_atomic` runs, `requests.accepted_by` is cleared but `requests.selected_quote_id` retains the old quote UUID. Future queries using `selected_quote_id IS NOT NULL` as a V2 detection signal return false positives for released V2 requests.

6. **Realtime model not scalable.** `ProviderRealtimeRefresh` subscribes to all `requests` table changes with `postgres_changes`. At scale, any new request triggers a refresh cascade across all connected provider clients simultaneously. No geographic filtering is possible through Supabase `postgres_changes`.

7. **Business plan providers: `jobs_this_month` never resets.** `monthly-allowance-reset/route.ts` explicitly skips business plan (`if (provider.plan !== 'starter' && provider.plan !== 'pro') return false`). Business plan counter accumulates indefinitely — analytics only, not a billing gate for business plan (unlimited jobs), but creates data integrity drift.

### Code Quality Debt

8. **No test suite.** Zero automated tests in the repository. No test framework in `package.json`. Critical payment flows, RPC logic, state machine transitions, and upload validation have no safety net.

9. **No CI pipeline.** No GitHub Actions or similar. No automated lint, typecheck, build, security scan, or secret scanning on push.

10. **`SUBSCRIPTION_PLANS` defined in multiple places.** Noted in Session Log — deduplication deferred.

11. **Stray non-application file at repo root.** File named `not staged for commit#Uf03a` contains `less` help text. Not application source.

12. **Duplicate function definitions in migrations 033 and 034.** Each file contains the same function body twice. Safe on re-run (`CREATE OR REPLACE`) but creates maintenance confusion.

13. **`request-user.ts` bearer token fallback.** `getRequestUser()` accepts both cookie sessions and `Authorization: Bearer` tokens. If XSS can exfiltrate a JWT, it can call any authenticated API route directly. Evaluate whether bearer fallback is necessary.

### Operational Debt

14. **No log aggregation.** `logger.ts` writes structured JSON to stdout only. No persistence, no search, no alerting. Cron failures, Redis unavailability, and rate limit exhaustion are invisible after function exit.

15. **Cron partial failures return HTTP 200.** Vercel only retries crons on non-2xx responses. Silent cron failures (individual DB errors caught by try/catch that return partial success) are undetectable from the Vercel dashboard.

16. **No incident runbooks.** No documented procedures for DB restore, stuck provider recovery, or Stripe webhook replay.

17. **Stripe still on test keys.** Any switch to live keys requires: new live price IDs in Vercel env vars, new Stripe webhook endpoint registration in Stripe dashboard, and verification that all test-mode references are removed.

---

## 9. Active Open Threads

### Migration 039 — Not Yet Written

Migration 039 is the next migration. Based on the security audits, it needs to cover at minimum:

**Blockers (CRITICAL/HIGH):**
- Fix `users` RLS UPDATE to add `WITH CHECK` preventing `role` column self-modification (C2)
- Fix `providers` RLS UPDATE to add `WITH CHECK` preventing `status`, `verified_badge`, `rating`, `plan`, `stripe_*` modification (C3)
- Fix `resolveStripeStatus` in webhook to extend `KYC_PROTECTED` to include `'pending'` and `'suspended'` (C4)
- Fix `accept_provider_request_atomic` active-job check to include `en_route` and `arrived` states (H6)
- Fix `sla_check_and_release` (or add new RPC) to handle `en_route`/`arrived` SLA breach (CRIT-02)
- Re-enable fair price validation in `submit_quote_atomic` (C5)
- Fix `release_job_atomic` to decrement `jobs_this_month` for V2 jobs (HIGH-03)
- Add atomicity to KYC status update + log insert (H5)
- Strip `documents` from `select_quote_atomic` return value (H1)
- Add `customer_id` column to `ratings` table (HIGH-05)
- Add index on `jobs.en_route_at` for admin stuck-job query (P4-M1)

**Additional high-value items:**
- Add `WITH CHECK (status = 'in_progress')` guard to price-change respond UPDATE (HIGH-06)
- Clear `overage_cleared` in `release_job_atomic` (F3-H2)
- Atomize price-change count enforcement (CRIT-01)
- Add `SET search_path = public` to `advance_provider_job_state` RPC (LOW-01)
- Reset `jobs_this_month` for business plan in monthly allowance cron (F3-L4)

### Middleware Registration (C1)

`src/proxy.ts` must be renamed to `src/middleware.ts` and the export changed from `export async function proxy(...)` to `export default async function middleware(...)`. This is a code change, not a migration, but it is one of the most impactful single fixes — it makes CSRF checking and auth redirects actually run.

### Provider Location Display (Emirate + Area) in ProviderRequestList — OPEN

**Status: Open. Partially working. Gap exists in the primary (RPC) path.**

The `ProviderRequestList` component renders a location badge on each request card showing the emirate and area (e.g. "Dubai — JBR / Marina" in English, "دبي — جي بي آر / المارينا" in Arabic). The badge is derived from `uae_emirate`, `uae_emirate_ar`, `uae_area`, `uae_area_ar` props on each request row — these are not DB columns, they are computed server-side in `provider/dashboard/page.tsx` by calling `getUaeLocation(row.fuzzy_latitude, row.fuzzy_longitude)` against a bounding-box lookup table in `src/lib/geo.ts` covering all UAE emirates and their named areas.

**The gap:** `getUaeLocation()` requires `fuzzy_latitude` and `fuzzy_longitude` to be present on the row. These coordinates are only available in the **fallback path** (direct `requests` table query at line 418 of `provider/dashboard/page.tsx`, which selects `fuzzy_latitude, fuzzy_longitude` explicitly). In the **primary path** — `get_nearby_open_requests` RPC — the return schema (as of migration 035, the latest version) does not include `fuzzy_latitude` or `fuzzy_longitude`. As a result:

- **Fallback path** (provider online but RPC returns 0 results, or provider offline): emirate/area badge shows correctly, because `fuzzy_latitude`/`fuzzy_longitude` are returned by the direct query.
- **Primary RPC path** (provider online, RPC returns nearby requests): `row.fuzzy_latitude` is `undefined` → `getUaeLocation()` returns `null` → `uae_emirate = null` → the badge falls through to the grey fallback showing `t('locationHiddenUntilAccepted')` or `t('fuzzyLocation')`, not the actual emirate name.

**In practice:** Online providers using the RPC path (the normal operating state) do not see the emirate/area badge on request cards. They see the generic location placeholder instead. The feature works correctly only in the fallback/offline path.

**Fix direction:** Add `fuzzy_latitude` and `fuzzy_longitude` to the `RETURNS TABLE` of `get_nearby_open_requests` and to its `SELECT` clause. This requires a new migration (039 candidate) since the RPC is `SECURITY DEFINER` and deployed. Alternatively, compute emirate/area inside the RPC using the PostGIS `ST_X`/`ST_Y` functions on the fuzzy point if fuzzy coords are stored as a geometry column rather than separate numeric columns.

**Files involved:**
- `supabase/migrations/035_nearby_requests_add_destination.sql` — current latest RPC definition (missing `fuzzy_latitude`/`fuzzy_longitude` in RETURNS TABLE)
- `src/app/provider/dashboard/page.tsx:456–476` — emirate computation logic
- `src/lib/geo.ts` — `getUaeLocation()` bounding-box lookup
- `src/components/forms/ProviderRequestList.tsx:323–333` — badge rendering

### Stripe Live Keys Switch

Currently on test keys. Before any real payments:
- Switch `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to live values in Vercel
- Create live Stripe products at 249/449/849 AED monthly
- Update price ID env vars to live price IDs
- Register the production webhook endpoint in the Stripe live dashboard

### Rate Limiting Gaps

- Add `checkRateLimitAsync` to `GET /api/requests` and `GET /api/requests/quotes` (P4-H1)
- Add rate limiting to all `/api/admin/*` routes (M1)
- Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set in Vercel production

### Realtime Architecture Decision

The current `ProviderRealtimeRefresh` broadcasts all `requests` changes to all connected provider clients. This is architecturally unsustainable beyond a small number of concurrent providers (P4-C1). The fix requires a decision:
- Option A: Geographic SSE (server-sent events with geographic pre-filter)
- Option B: Supabase Realtime with provider-scoped channels (requires `request_id` to be known in advance — doesn't work for new requests)
- Option C: Polling-only with reduced interval, remove realtime for provider new-request notifications

This decision is unresolved.

### Monthly Allowance Reset Scalability (P4-C2)

Current `Promise.all()` on all qualifying providers will crash at ~500 providers. Needs pagination (batches of 50–100 with sequential processing or bounded parallelism).

### Provider KYC Subscription Interaction (C4)

Decision needed: should a `pending` provider who pays for a subscription be allowed to activate, or should the KYC gate hold? Currently the code always activates on payment. The fix direction (extend `KYC_PROTECTED`) would block `pending` providers from activating via payment. This is a product decision, not just a bug fix.

### `NEXT_PUBLIC_SOFT_LAUNCH_MODE` Environment Variable

`SOFT_LAUNCH_MODE = process.env.NEXT_PUBLIC_SOFT_LAUNCH_MODE === 'true'` exists in `src/types/index.ts`. The actual production value of this flag in Vercel is unverified. All code paths gated by this flag need an audit before switching to full production payment behavior.

### `NEXT_PUBLIC_LAUNCH_PROMO` Flag

`LAUNCH_PROMO = process.env.NEXT_PUBLIC_LAUNCH_PROMO === 'true'` controls whether PPJ fees are flat 15 AED (promo) or distance-based. Current value in Vercel unverified. A stale payment intent reuse can return the wrong fee if this flag changes between intent creation and reuse (see F3-L5).

### SEO / i18n Deferred Work

From `SEO_AUDIT.md`:
- Phase 3 (content expansion): 4 of 5 city recovery pages are thin content (~150 words). Dubai page is complete.
- Phase 5 (PWA): No `manifest.json`, no favicon variants, no `theme-color` meta.
- Phase 6 (i18n SEO): 14 files have hardcoded English metadata. Locale-aware `generateMetadata()` not implemented. Cookie-based locale is invisible to crawlers.

From `ARABIC_RTL_AUDIT.md`:
- Phase C (deferred): locale-aware metadata (14 files), date formatting locale (6 files), orphaned `ar.json` keys
- B-4: 5 SEO recovery pages have `lang="ar"` but all-English content — decision deferred

### Admin Operations Backlog

From `ROADMAP.md` and `DEPLOYMENT_STATUS.md`:
- Complaint inbox, export tools, and manual intervention for providers — not implemented
- Automated test suite — not started
- CI enforcement — not started

---

## 10. Go-to-Market Status

- **Domain:** `rescuego.ae` — live on Vercel
- **Payment mode:** Stripe test/sandbox. No real money can be collected currently.
- **Soft launch mode:** `SOFT_LAUNCH_MODE` flag exists; production value unverified
- **Launch promo:** `LAUNCH_PROMO` flag exists; controls PPJ flat fee of 15 AED; production value unverified
- **KYC enforcement:** Document review flow implemented but multiple bypass paths exist (C2, C3, C4)
- **Marketplace V2:** Fully implemented (quote submission, selection, scoring, realtime). Legacy first-accept still active alongside it.
- **Arabic:** Default locale, Cairo font, full RTL, 97% of user-facing strings translated. Remaining deferred items are SEO metadata (not visible to users) and recovery page content strategy.
- **SEO:** Completed phases 1, 2, and 4. Social sharing images, schema markup, HSTS, hreflang added. Remaining: content expansion (Phase 3), PWA (Phase 5), i18n metadata (Phase 6).
- **Provider-facing UI:** Registration, document upload, dashboard, plan selection, PPJ/overage payment, state machine controls all implemented.
- **Customer-facing UI:** Request creation, quote listing, provider selection, job progress timeline, price change response, rating — all implemented.
- **Admin UI:** Dashboard, provider review with document signed URLs, requests list, performance leaderboard, revenue summary — all implemented.

**Assessment:** The application is feature-complete for a soft launch. It is NOT safe to process real money or onboard real providers until the Critical and High security findings are remediated — specifically C1 (middleware registration), C2 (user role escalation), C3 (provider self-activation), C4 (KYC bypass via Stripe), C5 (unbounded quote prices), and the Stripe test→live key switch with corresponding webhook update.

---

## Environment Variable Reference

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Production Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only |
| `STRIPE_SECRET_KEY` | Yes | Must be `sk_live_...` for production |
| `STRIPE_WEBHOOK_SECRET` | Yes | From Stripe webhook dashboard |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Must be `pk_live_...` for production |
| `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` | Yes | Live price ID |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` | Yes | Live price ID |
| `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` | Yes | Live price ID |
| `NEXT_PUBLIC_APP_URL` | Yes | `https://rescuego.ae` |
| `NEXT_PUBLIC_SITE_URL` | Yes | Missing from Vercel — needed for auth email URLs |
| `OPS_CRON_SECRET` | Yes | Min 32 chars; missing = silent 503 on all cron routes |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Phase 6 | Not needed until Maps SDK added |
| `UPSTASH_REDIS_REST_URL` | Strongly recommended | Without it: rate limiting is per-instance in-memory only |
| `UPSTASH_REDIS_REST_TOKEN` | Strongly recommended | |
| `NEXT_PUBLIC_LAUNCH_PROMO` | Yes | `true` = flat 15 AED PPJ; `false` = distance-based |
| `NEXT_PUBLIC_SOFT_LAUNCH_MODE` | Verify | Affects payment capture behavior |
| `NEXT_PUBLIC_PPJ_FEE_NEAR_AED` | Optional | Default: 30 |
| `NEXT_PUBLIC_PPJ_FEE_FAR_AED` | Optional | Default: 70 |
| `NEXT_PUBLIC_PPJ_DISTANCE_M` | Optional | Default: 10,000 |
| `NEXT_PUBLIC_PPJ_PROMO_FEE_AED` | Optional | Default: 15 |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | Yes (production) | |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional | Source maps |

---

*Last updated: June 24, 2026*

*Generated from: full source code read (rescuego-main-.zip), SECURITY_AUDIT_1.md through SECURITY_AUDIT_4.md (all four audits, June 2026), ARCHITECTURE.md (refreshed June 11, 2026), ROADMAP.md, DEPLOYMENT_STATUS.md, MARKETPLACE_V2_SPEC.md, PROJECT_HANDOFF.md, VERDENT_HANDOFF.md, SESSION_LOG.md, ARABIC_RTL_AUDIT.md, SEO_AUDIT.md, package.json, vercel.json, and direct source file reads from the extracted zip.*
