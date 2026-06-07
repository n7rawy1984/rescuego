# RescueGo — Audit Report 2: Technical & Architecture Overview

**Date:** June 7, 2026  
**Domain:** rescuego.ae  
**Deployment:** Vercel (production)

---

## 1. Project Purpose & Business Model

**RescueGo** is a two-sided UAE roadside recovery marketplace (SaaS). It connects stranded drivers (customers) with roadside recovery providers across all emirates.

### Revenue Streams

| Stream | Amount | Trigger |
|--------|--------|---------|
| Monthly subscription | Starter 249 / Pro 449 / Business 849 AED | Provider subscribes |
| Overage fees | 12 AED per job | Subscribed provider exceeds monthly allowance |
| PPJ acceptance fees | 15 AED (promo) / 30 AED (near) / 70 AED (far) | Non-subscribed provider accepts a job |
| Commission | 0% (intentionally disabled until Phase 8) | — |

### How It Works
1. Customer submits a roadside rescue request (location + problem type)
2. Nearby active providers see the request and can accept it
3. Provider travels to customer, completes the job, sets final price
4. Customer rates the provider (1-5 stars)
5. Providers pay RescueGo through subscription or PPJ model

---

## 2. Complete Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.6 |
| Language | TypeScript | ^5 |
| UI Library | React | 19.2.4 |
| CSS | Tailwind CSS | v4 |
| Auth & DB | Supabase (Auth + Postgres + PostGIS + Storage) | @supabase/supabase-js ^2.106.1 |
| SSR Auth | @supabase/ssr | ^0.10.3 |
| Payments | Stripe | ^22.1.1 (SDK), ^9.6.0 (JS), ^6.4.0 (React) |
| Monitoring | Sentry (@sentry/nextjs) | ^10.55.0 |
| i18n | next-intl | ^4.13.0 |
| Icons | lucide-react | ^1.16.0 |
| Validation | Zod | ^4.4.3 |
| Rate Limiting | Upstash Redis (optional, in-memory fallback) | via REST API |
| Deployment | Vercel | Cron + Edge |
| Font | Cairo (Google Fonts, next/font) | — |

---

## 3. Database Schema

### Tables (26 migrations applied: 001-026)

| Table | Purpose |
|-------|---------|
| `users` | All users (customers/providers/admins). Role column. |
| `providers` | Extended provider profile (plan, status, billing, counters). 1:1 with users. |
| `provider_locations` | Live GPS (PostGIS Point). 1:1 with providers. Stale after 5 min. |
| `requests` | Customer roadside requests. Full lifecycle status tracking. |
| `jobs` | Created on accept. Links request-provider. State machine timestamps (en_route_at, arrived_at). |
| `ratings` | 1:1 with jobs (UNIQUE on job_id). Stars 1-5 + comment. Triggers rating recalculation. |
| `request_locks` | 60-second optimistic locks during payment flows. |
| `stripe_events` | Idempotency log for Stripe webhooks. Processing/processed/failed status. |
| `payout_log` | Stripe payouts (upserted from webhook). |
| `price_estimates` | Static price ranges per problem type. |
| `ppj_payments` | PPJ payment records (pending/paid/failed). |
| `overage_payments` | Overage payment records (pending/paid/failed). |

### Request Status Enum
`open` | `accepted` | `en_route` | `arrived` | `in_progress` | `completed` | `cancelled` | `expired`

### Key RPCs (SECURITY DEFINER, service_role only)

| RPC | Purpose |
|-----|---------|
| `get_nearby_providers()` | PostGIS proximity + plan priority dispatch |
| `accept_provider_request_atomic()` | Atomic accept with overage guard |
| `complete_provider_job_atomic()` | Atomic job completion |
| `release_job_atomic()` | Atomic job release |
| `cancel_request_and_compensate_atomic()` | Atomic cancel with provider compensation |
| `restore_ppj_credit_for_cancelled_paid_request()` | PPJ race protection |
| `expire_stale_open_requests()` | Bulk expire stale requests |
| `advance_provider_job_state()` | Atomic state machine transitions |
| `get_nearby_open_requests()` | Privacy-safe open request query |

---

## 4. Full Request Lifecycle

```
Customer submits request (problem_type + location + optional note)
    → status: open
    → Nearby providers see it (get_nearby_open_requests RPC, 5km radius)

Provider accepts:
    → Subscription: accept_provider_request_atomic (increments jobs_this_month)
    → PPJ: ppj-checkout → Stripe payment → webhook finalizes accept
    → Overage: overage-checkout → Stripe payment → webhook finalizes accept
    → status: accepted

Provider advances state:
    → accepted → en_route (advance_provider_job_state RPC)
    → en_route → arrived
    → arrived → in_progress

Provider completes:
    → complete_provider_job_atomic (sets final_price)
    → status: completed

Customer rates:
    → ratings INSERT → trigger recalculates provider avg rating
    → Auto-suspend if rating < 3.0 with >= 5 ratings

Alternative paths:
    → Customer cancels (open or accepted) → cancel_request_and_compensate_atomic
    → Provider releases → release_job_atomic → request returns to open
    → Request expires (2h stale) → expire_stale_open_requests cron
```

---

## 5. Payment Flows

### 5.1 Subscription (Stripe Checkout)
- Provider selects plan → `/api/stripe/create-checkout` → Stripe Checkout session
- On success: webhook `customer.subscription.created/updated` → provider activated
- On failure: `invoice.payment_failed` → provider suspended
- On deletion: `customer.subscription.deleted` → provider reset to pay_per_job

### 5.2 Pay Per Job (PPJ)
- Provider taps Accept → 402 PPJ_FEE_REQUIRED
- Redirect to `/provider/ppj-pay` → `/api/provider/ppj-checkout` creates PaymentIntent
- Recovery credits checked first (free accept if credits > 0)
- On payment success: webhook `payment_intent.succeeded` → `finalizeAcceptedRequest()`
- Race protection: if request taken while paying, `restore_ppj_credit_for_cancelled_paid_request`

### 5.3 Overage
- Subscribed provider at limit → 402 OVERAGE_REQUIRED (12 AED)
- Same flow as PPJ but with `fee_type: 'overage'` metadata
- Webhook marks `overage_cleared = true` then finalizes accept

### 5.4 Upgrade Credits
- On plan upgrade: `job_credit_balance += old plan allowance`
- On business upgrade or downgrade: credits zeroed
- Idempotency key prevents double-crediting

---

## 6. Auth & Session Architecture

### Authentication
- **Supabase Auth** (email/password, no OAuth configured yet)
- Session stored in HTTP-only cookies managed by `@supabase/ssr`

### Three Client Types

| Client | Location | Purpose |
|--------|----------|---------|
| Browser client | `src/lib/supabase/client.ts` | Navbar, client-side pages |
| Server client | `src/lib/supabase/server.ts` | SSR pages, uses cookies |
| Admin client | `src/lib/supabase/admin.ts` | API routes, bypasses RLS (service_role) |

### Middleware (`proxy.ts`)
- Refreshes Supabase session tokens on every request
- Redirects unauthenticated users from protected routes (`/customer/*`, `/provider/*`, `/admin/*`)
- Does NOT check roles — roles are enforced at page/API level + RLS

### Role Enforcement
- Server-side check at page and API route level
- Backed by RLS policies in Supabase

---

## 7. RLS Strategy

All tables have RLS enabled. Key policies (hardened in Phase 1C, migrations 021-024):

| Table | Policy |
|-------|--------|
| `users` | Read/update own data only. Admin bypasses. |
| `providers` | Read own data only. No broad SELECT for customers. |
| `provider_locations` | Providers insert/update own. No broad SELECT. |
| `requests` | Customers see own. Providers access open requests via RPC only (privacy masking). Assigned provider sees accepted. Admin sees all. |
| `jobs` | Provider sees own. Admin sees all. |
| `ratings` | Authenticated users can insert (verified via job ownership). UNIQUE on job_id. |
| `request_locks` | Admin-only. |
| `stripe_events` | Admin-only. |
| `payout_log` | Admin-only. |
| Storage (`provider-documents`) | Providers read/write their own folder only (migration 023). |

### RLS Helper Function
`is_admin()` — `SECURITY DEFINER`, stable, checks `users.id = auth.uid() AND role = 'admin'`.

---

## 8. Cron Jobs & Scheduled Tasks

| Job | Schedule | Endpoint | Purpose |
|-----|----------|----------|---------|
| Expire stale requests | Every 30 min | `GET /api/ops/expire-requests` | Expires open requests older than 2h. Also clears stuck webhook events older than 1h. |
| Monthly allowance reset | Daily 00:00 UTC | `GET /api/ops/monthly-allowance-reset` | Resets `jobs_this_month` for Starter/Pro when Stripe billing period renews. |

### Security
- Protected by `OPS_CRON_SECRET` (Bearer token) or Vercel `CRON_SECRET` auto-injection
- Both support GET (Vercel cron) and POST (manual trigger)
- `maxDuration: 60` set in vercel.json

---

## 9. API Routes Map

### Customer
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/requests` | GET | Get current request state + unrated jobs |
| `/api/requests` | POST | Create new roadside request |
| `/api/requests/cancel` | POST | Cancel own request |
| `/api/ratings` | POST | Submit rating |
| `/api/customers/profile` | GET | Read own profile |

### Provider
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/provider/requests/accept` | POST | Accept a request |
| `/api/provider/jobs/complete` | POST | Complete job with final price |
| `/api/provider/jobs/release` | POST | Release job back to open |
| `/api/provider/jobs/advance-state` | POST | Advance state machine (en_route/arrived/in_progress) |
| `/api/provider/location` | POST | Update GPS location (go online) |
| `/api/provider/ppj-checkout` | POST | Create PPJ PaymentIntent |
| `/api/provider/overage-checkout` | POST | Create overage PaymentIntent |
| `/api/providers/profile` | GET | Read own profile |
| `/api/providers/plan` | GET | Read own plan |
| `/api/providers/documents` | POST | Upload documents |

### Admin
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/providers/update` | POST | Activate/suspend providers |
| `/api/admin/sentry-verify` | POST | Test Sentry (gated by SENTRY_VERIFICATION_ENABLED) |

### Stripe
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stripe/webhook` | POST | All Stripe event processing (idempotent) |
| `/api/stripe/create-checkout` | POST | Create subscription checkout session |

### Ops (internal)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/ops/expire-requests` | GET/POST | Expire stale open requests + clear stuck events |
| `/api/ops/monthly-allowance-reset` | GET/POST | Reset monthly job counters |

---

## 10. Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Vercel                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │ Next.js App  │  │  API Routes  │  │  Cron    │  │
│  │ (SSR + CSR)  │  │ (Serverless) │  │  Jobs    │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
         │                    │                │
         ▼                    ▼                ▼
┌─────────────────────────────────────────────────────┐
│                   Supabase                          │
│  ┌──────────┐  ┌──────┐  ┌─────────┐  ┌────────┐  │
│  │ Postgres │  │ Auth │  │ Storage │  │PostGIS │  │
│  │ + RLS    │  │      │  │         │  │        │  │
│  └──────────┘  └──────┘  └─────────┘  └────────┘  │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│     Stripe      │  │     Sentry      │
│  (TEST mode)    │  │  (errors only)  │
└─────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Upstash Redis  │
│  (optional)     │
└─────────────────┘
```

### Key Configuration
- `vercel.json`: Cron schedules, maxDuration, headers
- `next.config.ts`: CSP headers (report-only), Sentry config, image domains
- Environment variables: 15+ required (see `.env.example`)

---

## 11. Current Phase & Progress

### Completed Phases

| Phase | Description | Key Deliverables |
|-------|-------------|-----------------|
| Phase 0 | QA-FINAL | Core flows working end-to-end |
| Phase 1 | Security Hardening | Sentry, CSP headers, env validation |
| Phase 1A | Performance & Stability | 8 tasks: auth perf, polling, CWV, bundle, query profiling |
| Phase 1B | Architecture Hardening | All lifecycle mutations atomic (RPCs), cron reliability, env config |
| Phase 1C | RLS Hardening | 6 policies hardened, storage RLS, overage TOCTOU fix (migrations 021-024) |
| Phase 2A | UI Polish | Admin, Customer, Pricing pages polished |
| Phase 2B.1 | Design System | Foundation components and patterns |
| Phase 2B-1 | RTL Infrastructure | Cairo font, logical CSS classes, next-intl config |
| Phase 2B-2 | Directional Migration | 18 files converted from physical to logical classes |
| Phase 3 | Realtime & Notifications | Customer + provider realtime subscriptions, polling to 60s |
| Phase 4 | Provider State Machine | en_route/arrived states, advance-state RPC (migrations 025-026) |
| Phase 4B | Admin Ops Center | Stuck jobs, performance leaderboard, extended filters |

### Pending Phases (in order)

| Phase | Description |
|-------|-------------|
| Phase 2B-3 | Arabic strings + RTL activation ← NEXT |
| Phase 2C | Mobile/PWA strategy |
| Phase 5 | Provider KYC & UAE Compliance |
| Phase 6 | Dispatch Logic V2 (Google Maps SDK) |
| Phase 7 | Pricing Engine V2 |
| Phase 8 | Quote Approval + Commission activation |
| Phase 9 | Premium Jobs & Commission |
| Phase 10 | Billing Integrity (Stripe live keys) |
| Phase 11 | Fraud Detection |
| Phase 12 | Legal & UAE Compliance |
| Phase 13 | SEO Domination |
| Phase 14 | Growth & Provider Acquisition |
| Phase 15 | Scale Architecture |

### Migrations Applied
001 → 026 (all applied in production). Next migration = 027.

---

## 12. File Structure Overview

```
rescuego/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (Cairo font, metadata, Navbar)
│   │   ├── page.tsx            # Landing page (SEO-optimized)
│   │   ├── globals.css         # Tailwind v4 + custom utilities
│   │   ├── robots.ts           # Robots.txt generation
│   │   ├── sitemap.ts          # Sitemap generation
│   │   ├── about/              # About page
│   │   ├── admin/              # Admin dashboard, providers, performance
│   │   ├── api/                # All API routes (see section 9)
│   │   ├── auth/               # Login, register, forgot/reset password
│   │   ├── customer/           # Request, history, ratings pages
│   │   ├── pricing/            # Subscription plans page
│   │   ├── provider/           # Dashboard, PPJ pay, settings, documents
│   │   └── recovery/           # Password recovery
│   ├── components/
│   │   ├── forms/              # RequestForm (customer request submission)
│   │   ├── layout/             # Navbar, Footer
│   │   ├── map/                # MapLink (Google Maps directions)
│   │   ├── provider/           # ProviderRealtimeRefresh, JobStateAdvanceButton
│   │   ├── stripe/             # StripeProvider wrapper
│   │   └── ui/                 # Button, Card, Badge, StatusBadge, Timeline, etc.
│   ├── lib/
│   │   ├── supabase/           # admin.ts, client.ts, server.ts
│   │   ├── env.ts              # Zod-validated environment variables
│   │   ├── geo.ts              # Geodesy helpers (haversine, PPJ fee tier)
│   │   ├── logger.ts           # Structured logging with redaction
│   │   ├── notifications.ts    # Notification stubs (future push)
│   │   ├── ops-auth.ts         # Cron secret validation
│   │   ├── provider-allowance.ts # Pure function: allowance calculation
│   │   ├── rate-limit.ts       # Upstash Redis rate limiter
│   │   ├── sentry-redaction.ts # PII scrubbing for Sentry events
│   │   ├── stripe.ts           # Stripe client initialization
│   │   └── utils.ts            # cn(), getProblemLabel(), getStatusBadgeVariant()
│   ├── types/
│   │   ├── database.ts         # TypeScript interfaces for all DB rows + enums
│   │   └── index.ts            # Re-exports + SUBSCRIPTION_PLANS + runtime consts
│   └── i18n/
│       └── request.ts          # next-intl request configuration
├── messages/
│   ├── ar.json                 # Arabic translations (minimal placeholder)
│   └── en.json                 # English translations (minimal placeholder)
├── supabase/
│   ├── migrations/             # 001-026 SQL migrations
│   └── functions/              # Deprecated edge functions (5 folders)
├── public/                     # Static assets
├── proxy.ts                    # Next.js middleware (token refresh + redirect)
├── next.config.ts              # Next.js config (CSP, Sentry, images)
├── vercel.json                 # Cron schedules, maxDuration, headers
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
└── *.md                        # Documentation files
```
