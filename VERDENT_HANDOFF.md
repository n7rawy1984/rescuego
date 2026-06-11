# RescueGo — Complete Project Handoff

> Historical note: this file is a June 7 handoff snapshot and may contain stale implementation status. For the current source-derived handoff, use `ARCHITECTURE.md` and `PROJECT_HANDOFF.md`.

**Last updated:** June 7, 2026  
**Status:** Phases 0–4B complete. All 6 audit fix phases done. Migrations 001–027 applied. Next: Phase 2B-3 (Arabic strings + RTL activation).  
**Branch:** main  
**Domain:** rescuego.ae

---

## 1. Project Overview & Business Model

RescueGo is a two-sided UAE roadside recovery marketplace connecting stranded drivers (customers) with roadside recovery providers. It is a multi-tenant SaaS product, not a consumer app.

**How it works:**
1. A customer submits a roadside rescue request (location + problem type).
2. Nearby active providers see the request and can accept it.
3. The provider travels to the customer, completes the job, and sets a final price.
4. The customer rates the provider (1–5 stars).
5. Providers pay RescueGo through one of two monetisation models.

**Provider monetisation (two models):**

| Model | Description |
|---|---|
| **Subscription** | Starter / Pro / Business plans, billed monthly via Stripe. Includes a monthly job allowance. Overage jobs cost 12 AED each. |
| **Pay Per Job (PPJ)** | No subscription. Flat acceptance fee charged before the provider can accept: 15 AED promo / 30 AED near (<10 km) / 70 AED far (≥10 km). |

**Revenue:**
- Subscription fees (monthly recurring)
- Overage fees (12 AED per job over monthly allowance)
- PPJ acceptance fees (15–70 AED per job)
- Commission on final job price (0% currently, wired up as Phase 8)

---

## 2. Architecture Overview

### Stack
| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 App Router (file: `next.config.ts`) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4, custom native-HTML components |
| Auth & DB | Supabase (Auth + Postgres + Storage + PostGIS) |
| Payments | Stripe (subscriptions + Payment Intents + webhooks) |
| Monitoring | Sentry `@sentry/nextjs` v10 (errors only; tracing + replay disabled) |
| Deployment | Vercel |
| Rate limiting | Upstash Redis (optional, falls back to in-memory locally) |

### Directory structure
```
src/
  app/                    # Next.js App Router pages + API routes
    api/                  # All server-only API endpoints
      admin/              # Admin operations
      customers/          # Customer-specific reads
      ops/                # Internal cron endpoints (OPS_CRON_SECRET required)
      provider/           # Provider job/location/accept endpoints
      providers/          # Provider self-service (profile, documents, plan)
      ratings/            # Rating submission
      requests/           # Customer request read + cancel
      stripe/             # Stripe checkout + webhook
    admin/                # Admin UI pages (server components)
    auth/                 # Login / register / password reset
    customer/             # Customer pages (request, history, ratings)
    provider/             # Provider pages (dashboard, register, subscribe, pay)
    recovery/             # Static SEO pages (Dubai, Abu Dhabi, Sharjah, etc.)
  components/
    layout/               # Navbar (client), Footer (server)
    ui/                   # Custom Accordion, Badge, Button, Card, Input, Select, Spinner
    stripe/               # StripeElementsProvider (client, payment pages only)
  lib/
    supabase/             # server.ts + admin.ts + client.ts (browser)
    stripe.ts             # Node.js Stripe SDK (server-only)
    logger.ts             # Structured JSON logger
    env.ts                # requireEnv() helper (throws on missing vars)
    rate-limit.ts         # checkRateLimitAsync() (Upstash or in-memory)
    ops-auth.ts           # authorizeOpsRequest() — checks OPS_CRON_SECRET header
    notifications.ts      # notificationEvents constants (used in logger calls)
    provider-allowance.ts # getProviderAllowance() — pure function, allowance logic
    geo.ts                # Pure geodesy helpers
    sentry-redaction.ts   # scrubSentryErrorEvent / scrubSentryTransactionEvent
    utils.ts              # cn(), getProblemLabel(), getStatusBadgeVariant()
  types/
    database.ts           # All TypeScript interfaces for DB rows + enums
    index.ts              # Re-exports database.ts + SUBSCRIPTION_PLANS constant + runtime consts
proxy.ts                  # Next.js middleware (token refresh + unauthenticated redirect)
supabase/migrations/      # 001–026 SQL migrations (all applied in production)
sentry.client.config.ts   # Browser Sentry init
sentry.server.config.ts   # Server Sentry init
sentry.edge.config.ts     # Edge Sentry init
```

### Key design decisions
- **No Radix UI / shadcn.** All UI components are custom native-HTML + Tailwind. Radix packages removed.
- **No Maps SDK.** Google Maps links only. Maps SDK planned for Phase 6.
- **Realtime implemented (Phase 3).** Supabase realtime subscriptions for customer + provider dashboards. Polling reduced to 60s heartbeat fallback.
- **service_role** Supabase client is **server-side only** (`src/lib/supabase/admin.ts`). All API routes that need to bypass RLS use `createAdminClient()`.
- **`proxy.ts`** is Next.js middleware (not `middleware.ts`; Next.js 16 renames the file). It refreshes Supabase tokens and redirects unauthenticated users. It does NOT check roles — roles are enforced at page level and by RLS.
- **i18n** via `next-intl` with Arabic (ar) and English (en) locales. RTL infrastructure in place (Cairo font, logical CSS classes).

---

## 3. Current Project Status

### Completed phases (as of June 7, 2026)
- Phase 0 — QA-FINAL
- Phase 1 — Security hardening + Sentry verified
- Phase 1A — Monitoring, Performance & Stability (all 8 tasks)
- Phase 1B — Critical Architecture Hardening (all lifecycle mutations atomic)
- Phase 1C — Deep RLS Hardening (migrations 021-024)
- Phase 2A — UI Polish (Admin + Customer + Pricing pages)
- Phase 2B.1 — Design System foundation
- Phase 2B-1 — RTL infrastructure (Cairo font, logical classes)
- Phase 2B-2 — Physical → logical directional class migration (18 files)
- Phase 3 — Realtime & Notifications (customer + provider subscriptions)
- Phase 4 — Provider State Machine (en_route/arrived states, advance-state RPC)
- Phase 4B — Admin Operations Center (stuck jobs, performance, filters)

### Phase 1A completion status
| Task | Status | Summary |
|---|---|---|
| Task 1 — Auth/login performance | ✅ Complete | proxy.ts DB call removed, remaining findings deferred |
| Task 2 — Logout lag | ✅ Complete | `signOut({ scope: 'local' })` |
| Task 3 — Dashboard loading | ✅ Complete | Admin+Provider+Customer parallelized |
| Task 4 — Supabase query profiling | ✅ Complete | migration 016, location + accept route parallelized |
| Task 5 — Polling reduction | ✅ Complete | Adaptive 12s/20s interval on customer page |
| Task 6 — CWV baseline | ✅ Complete | sentry.client.config.ts created, preconnect added |
| Task 7 — Bundle size audit | ✅ Complete | 12 unused dependencies removed from package.json |
| Task 8 — Production slow-query identification | ✅ Complete | migration 017 applied |

### Additional completed work (Phases 1B–4B)
- Phase 1B: LAUNCH_PROMO env, PPJ fees env, cron reliability (vercel.json), cancel/release atomicity (migrations 019-020)
- Phase 1C: 6 RLS policies hardened (021), function revoked (022), storage bucket RLS (023), overage TOCTOU (024)
- Phase 3: Customer realtime subscription + provider ProviderRealtimeRefresh component + polling raised to 60s
- Phase 4: Provider state machine (025), advance_provider_job_state RPC (026), JobStateAdvanceButton UI
- Phase 4B: Stuck jobs alert banner, provider performance leaderboard, extended filter tabs, all-state visibility
- Pre-launch hardening: C-1/C-2/C-3, H-1/H-2/H-3/H-4

### Next up (in order)
1. Phase 2B-3 — Arabic strings + RTL activation
2. Phase 2C — Mobile/PWA strategy
3. Phase 5 — Provider KYC & UAE Compliance
4. Phase 6 — Dispatch Logic V2 (Google Maps SDK enters here)
5. Phase 7 — Pricing Engine V2
6. Phase 8 — Quote Approval + Commission activation
7. Phase 9 — Premium Jobs & Commission
8. Phase 10 — Billing Integrity (switch to Stripe live keys here)
9. Phase 11 — Fraud Detection
10. Phase 12 — Legal & UAE Compliance
11. Phase 13 — SEO Domination
12. Phase 14 — Growth & Provider Acquisition
13. Phase 15 — Scale Architecture

---

## 4. Completed Features — File Locations

### Authentication
| Feature | File |
|---|---|
| Login page | `src/app/auth/login/page.tsx` |
| Register page | `src/app/auth/register/page.tsx` |
| Forgot/reset password | `src/app/auth/forgot-password/page.tsx`, `reset-password/page.tsx` |
| Token refresh middleware | `src/proxy.ts` |
| Navbar auth (client) | `src/components/layout/Navbar.tsx` |

### Customer flow
| Feature | File |
|---|---|
| Submit roadside request | `src/app/customer/request/page.tsx` (client, polls every 12–20s) |
| Request history | `src/app/customer/history/page.tsx` |
| Rate a completed job | `src/app/customer/ratings/page.tsx` |
| Cancel request | `src/app/api/requests/cancel/route.ts` |
| Get request state | `src/app/api/requests/route.ts` |
| Unrated jobs count | Merged into `/api/requests` response |

### Provider flow
| Feature | File |
|---|---|
| Provider registration | `src/app/provider/register/page.tsx` |
| Document upload | `src/app/api/providers/documents/route.ts` |
| Dashboard (nearby requests, active job) | `src/app/provider/dashboard/page.tsx` |
| Accept a request | `src/app/api/provider/requests/accept/route.ts` |
| Complete a job | `src/app/api/provider/jobs/complete/route.ts` |
| Release (cancel) a job | `src/app/api/provider/jobs/release/route.ts` |
| Go online / update location | `src/app/api/provider/location/route.ts` |
| Subscribe (Stripe Checkout) | `src/app/provider/subscribe/page.tsx`, `src/app/api/stripe/create-checkout/route.ts` |
| PPJ checkout | `src/app/provider/ppj-pay/page.tsx`, `src/app/api/provider/ppj-checkout/route.ts` |
| Overage checkout | `src/app/provider/overage-pay/page.tsx`, `src/app/api/provider/overage-checkout/route.ts` |
| Provider profile | `src/app/api/providers/profile/route.ts` |
| Provider plan read | `src/app/api/providers/plan/route.ts` |

### Admin flow
| Feature | File |
|---|---|
| Admin dashboard (stats, events, payouts) | `src/app/admin/dashboard/page.tsx` |
| Manage providers (activate/suspend) | `src/app/admin/providers/page.tsx`, `src/app/api/admin/providers/update/route.ts` |
| View all requests | `src/app/admin/requests/page.tsx` |
| Revenue log | `src/app/admin/revenue/page.tsx` |
| Sentry verification | `src/app/api/admin/sentry-verify/route.ts` (SENTRY_VERIFICATION_ENABLED gate) |

### Billing / Stripe
| Feature | File |
|---|---|
| Stripe webhook handler | `src/app/api/stripe/webhook/route.ts` |
| Subscription create/update/delete sync | Inside webhook handler |
| PPJ payment confirmation | Inside webhook handler |
| Overage payment confirmation | Inside webhook handler |
| Payout log sync | Inside webhook handler |
| Monthly allowance reset (cron) | `src/app/api/ops/monthly-allowance-reset/route.ts` |
| Request expiry (cron) | `src/app/api/ops/expire-requests/route.ts` |

### Ratings
| Feature | File |
|---|---|
| Submit rating | `src/app/api/ratings/route.ts` |
| Provider rating auto-update | DB trigger in migration 001 |
| Auto-suspend on low rating | DB trigger in migration 001 |

### SEO pages
| Feature | File |
|---|---|
| Dubai recovery | `src/app/recovery/dubai/page.tsx` |
| Abu Dhabi recovery | `src/app/recovery/abu-dhabi/page.tsx` |
| Sharjah recovery | `src/app/recovery/sharjah/page.tsx` |
| Ajman recovery | `src/app/recovery/ajman/page.tsx` |
| Ras Al Khaimah recovery | `src/app/recovery/ras-al-khaimah/page.tsx` |
| About page | `src/app/about/page.tsx` |
| Pricing page | `src/app/pricing/page.tsx` |

---

## 5. Pending Features — Priority Order

### Immediate (Phase 1A Task 8)
- Production slow-query identification via Supabase `pg_stat_statements` dashboard
- Audit all API routes + server pages against indexes from migrations 013 + 016

### Phase 1B
- Monthly allowance reset cron reliability (idempotency + error alerting)
- Additional DB indexes as identified in Task 8
- `LAUNCH_PROMO` config: move hardcoded `true` in `src/types/index.ts:55` to `NEXT_PUBLIC_LAUNCH_PROMO` env var

### Phase 1C (security hardening)
- Add `import 'server-only'` to: `src/lib/stripe.ts`, `src/lib/logger.ts`, `src/lib/env.ts`, `src/lib/notifications.ts`, `src/lib/rate-limit.ts`, `src/lib/ops-auth.ts`
- Deduplicate `SUBSCRIPTION_PLANS` (defined in 3 places: `types/index.ts`, `provider/register/page.tsx`, `stripe/create-checkout/route.ts`)
- Enable Supabase Storage RLS on `provider-documents` bucket (0 policies currently — see SETUP.md §4)
- Review CSP violations (report-only since Phase 1)

### Phase 2B
- RTL + Arabic language foundation
- Navbar CLS fix (skeleton→content shift on every page; requires architectural change)

### Phase 3
- Realtime request updates (replace polling)
- Push notifications

### Phase 6
- Google Maps SDK integration (currently links only)
- Dynamic dispatch logic

### Phase 8
- Quote approval flow
- Commission calculation activation (`commission_rate` and `commission_amount` are wired in DB/types but always 0 — do not compute until Phase 8)

### Phase 10
- Switch Stripe from test/sandbox to live keys
- Live price IDs in Vercel

---

## 6. Important Business Logic

### Provider Plans

| Plan | Monthly jobs | Overage fee | PPJ support | Priority rank |
|---|---|---|---|---|
| Business | Unlimited | None | N/A | 1 (highest) |
| Pro | 35 | 12 AED/job | N/A | 2 |
| Starter | 15 | 12 AED/job | N/A | 3 |
| Pay Per Job | N/A | N/A | 15/30/70 AED/accept | 4 (lowest) |

Priority rank controls dispatch order in `get_nearby_providers()` RPC — business providers appear first.

### PPJ (Pay Per Job) Flow

1. Provider (on PPJ plan) taps Accept on a request.
2. API checks distance to request: <10 km = 30 AED, ≥10 km = 70 AED. During promo: 15 AED flat.
3. Accept route returns `OVERAGE_REQUIRED` / `PPJ_FEE_REQUIRED` (HTTP 402).
4. Provider is redirected to `/provider/ppj-pay?request_id=...`.
5. StripeElementsProvider loads; Payment Intent created via `/api/provider/ppj-checkout`.
6. Provider pays; Stripe fires `payment_intent.succeeded` to `/api/stripe/webhook`.
7. Webhook calls `accept_provider_request_atomic()` RPC to finalize the accept.
8. If request was taken by another provider while payment was in-flight, `restore_ppj_credit_for_cancelled_paid_request()` RPC credits back the PPJ recovery credit.

PPJ protection edge case: if provider paid but request was already accepted, they receive a `ppj_recovery_credits` credit they can use to accept a future request without paying again.

### Overage Flow

1. Subscribed provider exhausts monthly allowance (jobs_this_month >= plan limit + credit balance).
2. Accept route returns `OVERAGE_REQUIRED` (HTTP 402) with `overage_fee_aed: 12`.
3. Provider is redirected to `/provider/overage-pay?request_id=...`.
4. Provider pays 12 AED overage fee.
5. Stripe fires `payment_intent.succeeded`; webhook sets `requests.overage_cleared = true` and calls `accept_provider_request_atomic()`.

### Subscription Upgrade Credits

When a subscribed provider upgrades plan mid-period:
- Their current `jobs_this_month` count stays (already-used jobs don't disappear).
- Their old plan's full allowance is credited as `job_credit_balance` — they effectively get to "use" both allowances for the remainder of the period.
- Business plan upgrade: job_credit_balance is zeroed (unlimited plan needs no credits).
- Downgrade: job_credit_balance is zeroed.
- Logic lives in the Stripe webhook handler: `src/app/api/stripe/webhook/route.ts` lines 481–500.
- Idempotency: `last_upgrade_bonus_key` (sub_id + period_start + old→new plan) prevents double-crediting.

### Monthly Allowance Reset

- Resets `jobs_this_month = 0` and `job_credit_balance = 0` for Starter and Pro providers only.
- Tied to Stripe billing period: only resets when `stripe_current_period_start > jobs_reset_at`.
- NOT calendar-month based.
- Business and PPJ providers are never reset.
- Triggered by POST to `/api/ops/monthly-allowance-reset` with `Authorization: Bearer <OPS_CRON_SECRET>`.

### Provider Online Status

- "Online" = has a `provider_locations` row with `updated_at` within the last 5 minutes (`PROVIDER_STALE_MINUTES = 5`).
- Provider must update location to be visible to customers or to accept requests.
- When a provider releases a job, their `provider_locations` row is deleted (forces re-check-in).
- Location update is button-triggered on the provider dashboard — NOT automatic polling.

### Request Lifecycle

```
open → accepted → in_progress → completed
     ↘ cancelled (by customer, provider, or admin)
     ↘ expired (by ops cron, stale open requests)
```

- `open → accepted`: atomic RPC `accept_provider_request_atomic()` — locks the row, creates job record, increments jobs_this_month in one transaction.
- `accepted → in_progress`: provider marks "En Route" (not a separate API call — status is updated on the request).
- `in_progress → completed`: `complete_provider_job_atomic()` RPC, provider sets final_price.
- Expiry: `expire_stale_open_requests()` RPC, triggered by `/api/ops/expire-requests` cron. Does not expire locked requests.

### Request Locks

- 60-second optimistic lock (`REQUEST_LOCK_SECONDS = 60`).
- When a provider starts the PPJ/overage payment flow, a lock is placed on the request.
- Lock prevents other providers from accepting the request while payment is processing.
- Lock is checked at both the API route level AND inside the atomic RPC (double-guard).
- Lock is deleted when the RPC successfully accepts the request.

### Commission

- `commission_rate` and `commission_amount` are always 0. This is **intentional**.
- Commission calculation is planned for Phase 8.
- The `jobs` table columns are wired but never computed.
- **Do not add commission logic before Phase 8.**

### Nearby Provider Dispatch Priority

`get_nearby_providers()` RPC (`supabase/migrations/002_rpc_functions.sql`):
1. Filters: `status = 'active'`, location within 5 km radius, `updated_at` within 5 minutes.
2. Orders by: plan tier (business first) → rating DESC → distance ASC.
3. Limit 20 providers.

---

## 7. Database Schema Summary

### Tables (26 migrations applied)

| Table | Purpose |
|---|---|
| `users` | All users (customers, providers, admins). Role column controls access. |
| `providers` | Extended provider profile. 1:1 with users (same UUID). Plan, status, billing fields. |
| `provider_locations` | Live GPS location. 1:1 with providers. PostGIS Point. Staleness = 5 min. |
| `requests` | Customer roadside requests. All lifecycle statuses (open/accepted/en_route/arrived/in_progress/completed/cancelled/expired). |
| `jobs` | Created when request is accepted. Links request-provider. State machine timestamps (en_route_at, arrived_at). Commission fields (always 0 until Phase 8). |
| `ratings` | 1:1 with jobs (UNIQUE on job_id). Stars 1-5 + optional comment. Trigger updates provider rating. |
| `request_locks` | Optimistic locks during PPJ/overage payment flow. TTL = 60s. |
| `stripe_events` | Idempotency log for Stripe webhook processing. |
| `payout_log` | Stripe payouts (upserted from webhook). |
| `price_estimates` | Static price ranges per problem type. Seeded in migration 001. |
| `ppj_payments` | PPJ payment records (pending/paid/failed). |
| `overage_payments` | Overage payment records (pending/paid/failed). |

### Key RLS rules (hardened in Phase 1C)

- Users: can only read/update their own row. Admin bypasses all.
- Providers: can read own row. No broad SELECT policy for customers (removed in migration 021).
- provider_locations: providers can insert/update own. No broad SELECT (removed in 021).
- Requests: customers see own requests. Providers access open requests via RPC only (privacy masking). Provider sees their `accepted_by` requests. Admin sees all.
- Jobs: providers see own. Admin sees all.
- Ratings: authenticated users can insert (verified via job ownership). UNIQUE on job_id.
- stripe_events / payout_log / request_locks: admin-only (all broad policies removed in 021).
- Storage (`provider-documents`): providers can read/write their own folder only (migration 023).

### RLS function
`is_admin()` — `SECURITY DEFINER`, stable, filters `users.id = auth.uid() AND role = 'admin'`.

### Key DB triggers
1. `trigger_update_provider_rating` → `update_provider_rating()` — recalculates rolling avg of last 50 ratings on every INSERT.
2. `trigger_check_suspension` → `check_provider_suspension()` — auto-suspends provider if `rating < 3.0` with ≥5 ratings.

### Key RPCs (SECURITY DEFINER, service_role only)
- `get_nearby_providers(lng, lat, radius, stale_threshold)` — PostGIS-based nearby query with dispatch priority ordering.
- `accept_provider_request_atomic(provider_id, request_id, increment_jobs, consume_ppj_credit)` — atomic accept: locks rows, assigns request, creates job, increments counters, clears lock.
- `complete_provider_job_atomic(provider_id, request_id, final_price)` — atomic completion: validates ownership, marks complete, sets final_price.
- `restore_ppj_credit_for_cancelled_paid_request(provider_id, request_id, payment_intent_id)` — PPJ edge case protection credit.
- `expire_stale_open_requests(cutoff)` — bulk expire stale open requests.
- `reset_monthly_job_counters()` — simple reset (legacy, not used in current reset logic).

### Indexes applied
Migration 013: `idx_jobs_request_id`, `idx_requests_customer_id`, `idx_requests_accepted_by`, `idx_ppj_payments_provider_request`, `idx_overage_payments_stripe_intent`, `idx_stripe_events_status`.

Migration 016: `idx_users_role`, `idx_overage_payments_provider_status_created`, `idx_overage_payments_status`, `idx_payout_log_created`, `idx_ratings_provider_created`.

---

## 8. Environment Variables

All variables required in Vercel dashboard (Production + Preview). Never hardcode secrets.

### Required
| Variable | Visibility | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon key (client-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Supabase service role (bypasses RLS) |
| `STRIPE_SECRET_KEY` | **Server-only** | Stripe API secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | **Server-only** | Stripe webhook signature verification |
| `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` | Public | Stripe price ID for Starter plan |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` | Public | Stripe price ID for Pro plan |
| `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` | Public | Stripe price ID for Business plan |
| `NEXT_PUBLIC_APP_URL` | Public | App base URL (https://rescuego.ae in prod) |
| `OPS_CRON_SECRET` | **Server-only** | Secret for /api/ops/* endpoints |
| `SENTRY_DSN` | **Server-only** | Sentry DSN for server/edge error capture |
| `NEXT_PUBLIC_SENTRY_DSN` | Public | Sentry DSN for browser error capture |

### Optional
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Missing from Vercel — add when used |
| `UPSTASH_REDIS_REST_URL` | Distributed rate limiting (falls back to in-memory) |
| `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting |
| `SENTRY_AUTH_TOKEN` | Sentry source map upload (CI/Vercel only) |
| `SENTRY_ORG` | Sentry source map upload |
| `SENTRY_PROJECT` | Sentry source map upload |
| `SENTRY_VERIFICATION_ENABLED` | Temporary — set `false` after Sentry verification |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Phase 6 only — not needed yet |
| `NEXT_PUBLIC_VERCEL_ENV` | Auto-set by Vercel. Used in Sentry config for environment tagging. |

---

## 9. API Routes Summary

### Public / auth-gated
| Route | Method | Purpose |
|---|---|---|
| `/api/requests` | GET | Customer: get current request state + unrated jobs count |
| `/api/requests/cancel` | POST | Customer: cancel own open request |
| `/api/ratings` | POST | Customer: submit rating for completed job |
| `/api/customers/profile` | GET | Customer: read own profile |
| `/api/customers/unrated-jobs` | GET | Customer: unrated jobs count (legacy; merged into /api/requests) |

### Provider
| Route | Method | Purpose |
|---|---|---|
| `/api/provider/requests/accept` | POST | Accept a request (rate-limited, overage guard, atomic RPC) |
| `/api/provider/jobs/complete` | POST | Complete an accepted/in-progress job with final price |
| `/api/provider/jobs/release` | POST | Release an accepted job back to open |
| `/api/provider/location` | POST | Update provider GPS location (go online) |
| `/api/provider/ppj-checkout` | POST | Create Stripe Payment Intent for PPJ fee |
| `/api/provider/overage-checkout` | POST | Create Stripe Payment Intent for overage fee |
| `/api/providers/profile` | GET | Read own provider profile |
| `/api/providers/plan` | GET | Read own subscription plan |
| `/api/providers/documents` | POST | Upload provider documents to Supabase Storage |

### Admin
| Route | Method | Purpose |
|---|---|---|
| `/api/admin/providers/update` | POST | Activate / suspend a provider |
| `/api/admin/sentry-verify` | POST | Trigger test Sentry event (SENTRY_VERIFICATION_ENABLED guard) |

### Stripe
| Route | Method | Purpose |
|---|---|---|
| `/api/stripe/webhook` | POST | Receive + process all Stripe events (idempotent) |
| `/api/stripe/create-checkout` | POST | Create Stripe Checkout session for subscription |

### Ops (internal cron, OPS_CRON_SECRET required)
| Route | Method | Purpose |
|---|---|---|
| `/api/ops/monthly-allowance-reset` | GET/POST | Reset jobs_this_month for Starter/Pro on new billing period |
| `/api/ops/expire-requests` | GET/POST | Expire stale open requests + clear stuck webhook events |

### Provider State Machine
| Route | Method | Purpose |
|---|---|---|
| `/api/provider/jobs/advance-state` | POST | Advance job state (accepted→en_route→arrived→in_progress) |

---

## 10. Known Issues and Deferred Items

### Active (requires user decision)
- **`removeTracing: true` vs CWV capture** (`next.config.ts:108`): Sentry tracing tree-shaken from bundle. `browserTracingIntegration` needed for INP/LCP/CLS is a no-op. Decision: keep (smaller bundle, errors-only) OR remove + add `browserTracingIntegration + tracesSampleRate: 0.05` to `sentry.client.config.ts`.

### Deployment
- `NEXT_PUBLIC_SITE_URL` missing from Vercel env vars
- Stripe still in Sandbox/Test mode — switch to live keys at Phase 10
- Missing `og-image.jpg` and `logo.png` in `/public` (referenced in metadata)
- Deprecated Supabase Edge Functions still present in `supabase/functions/` — verify none are triggered, then delete

### Performance (deferred from Phase 1A)
- Login: sequential role fetch after login (`auth/login/page.tsx:135`)
- Login: `router.refresh()` + 1200ms fallback timer (`login/page.tsx:57`)
- Navbar: duplicates auth + role check on every page load (extra 200ms latency)
- Navbar: prefetches all 3 dashboards for every visitor
- Home page (`page.tsx`): `getViewerState()` has 3 sequential DB queries for provider users
- Provider dashboard: fallback open requests query fires sequentially after nearby RPC
- All loading.tsx skeletons are incomplete / don't match actual page layouts

### Code quality (partially addressed in Phase 1C)
- [RESOLVED] `server-only` guards added to `stripe.ts`, `admin.ts`, `server.ts`, `ops-auth.ts`, `rate-limit.ts`
- `SUBSCRIPTION_PLANS` defined in 3 places — dedup needed
- [RESOLVED] `LAUNCH_PROMO` now reads from `NEXT_PUBLIC_LAUNCH_PROMO` env var
- `bundlePagesRouterDependencies: true` in `next.config.ts` is redundant for pure App Router (negligible)

### Security (ongoing)
- CSP is in report-only mode since Phase 1 (`Content-Security-Policy-Report-Only` header)
- Review CSP violation reports before enforcing
- Rate limiter fails closed (429 for all) when Redis is not configured — needs graceful degradation or mandatory Redis
- No automated test suite — regressions can ship undetected
- `payout_log` upsert missing `onConflict: 'stripe_payout_id'` — potential duplicate rows

---

## 11. Technical Decisions Made and Why

### `proxy.ts` instead of `middleware.ts`
Next.js 16 renames the middleware entry point. This file is `src/proxy.ts`. The proxy does token refresh only — no role-based redirects. Role enforcement is at page level + RLS. A previous version had a live DB role check in the proxy (on every navigation) which was removed because Next.js auth docs explicitly warn against this pattern.

### `signOut({ scope: 'local' })` in Navbar
Eliminates 200–500ms server round-trip to Supabase. The refresh token is not server-side invalidated, which is an acceptable trade-off at MVP scale. Prevents the Navbar flash caused by SIGNED_OUT → re-render cycle.

### All state checks via `admin` (service_role) client in API routes
API routes use `createAdminClient()` for most data reads after auth verification. This bypasses RLS but is intentional: it allows atomic writes without RLS policy interference. Auth is always verified first via `supabase.auth.getUser()` (anon client).

### `accept_provider_request_atomic()` RPC
The accept flow uses a PostgreSQL transaction (via RPC called with service_role) to atomically: lock the provider row, check for active jobs, check the request lock, update the request status, insert the job record, increment jobs_this_month, and delete the lock. This prevents race conditions when two providers attempt to accept the same request simultaneously.

### Sentry `removeTracing: true`
All Sentry tracing code is tree-shaken from the production bundle to reduce client JS size. Sentry is errors-only. CWV capture via `browserTracingIntegration` is not currently active. Decision to enable/disable is pending.

### No Maps SDK until Phase 6
Google Maps integration is deferred to avoid SDK licensing complexity at MVP stage. Current implementation uses google.com/maps links only (opens native maps app on mobile). Provider locations are stored as PostGIS `geometry(Point, 4326)`.

### Commission = 0 always
`commission_rate` and `commission_amount` are in the schema and types but never computed. The columns are wired for Phase 8 (Quote Approval). **Do not compute commission in any phase before Phase 8.**

### Adaptive polling (12s/20s)
Customer request page polls every 20s when status is `open` (infrequent provider acceptance) and 12s when `accepted` or `in_progress` (provider en route, more time-sensitive). `visibilitychange` + `online` event listeners trigger immediate refresh on tab focus, making the longer background interval safe.

---

## 12. Important Constraints — NEVER Change These

### Stripe
- Webhook signature verification via `stripe.webhooks.constructEvent()` — **must remain**
- Idempotency via `stripe_events` table claim pattern — **must remain**
- No payment logic in client components — **must remain**
- No PPJ/overage fee amounts hardcoded in client components — **must remain**
- `commission_rate` and `commission_amount` must remain 0 until Phase 8

### Supabase
- `service_role` key is used only in `src/lib/supabase/admin.ts` — **server-side only**
- `createAdminClient()` is never imported by client components or page TSX files marked `'use client'`
- RLS policies: change one at a time and smoke-test immediately
- Migrations: always show SQL first, never apply without explicit user approval

### Auth
- `proxy.ts` must always call `supabase.auth.getUser()` (token refresh)
- Role enforcement happens at page level, never only in the proxy
- Admin detection uses `is_admin()` DB function — never trust role from JWT claims directly

### Business logic
- Monthly allowance reset is tied to Stripe billing period, NOT calendar month
- `PROVIDER_STALE_MINUTES = 5` — online threshold; changing this breaks dispatch
- `REQUEST_LOCK_SECONDS = 60` — lock TTL; changing this affects PPJ payment window
- Plan tier ordering: business=1 > pro=2 > starter=3 > pay_per_job=4

---

## 13. Deployment Instructions

### Vercel (hosting)
1. Connect GitHub repo to Vercel.
2. Add all required env vars from section 8 to Vercel dashboard (Production + Preview).
3. Set `NEXT_PUBLIC_APP_URL=https://rescuego.ae`.
4. Deploy. Vercel runs `npm run build` automatically.

### Supabase (database)
1. Create Supabase project.
2. Enable extensions:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
3. Run all 16 migrations in order in Supabase SQL Editor:
   `001_initial_schema.sql` → `016_task4_query_indexes.sql`
4. Create storage bucket `provider-documents` (private).
5. Add RLS policies to the bucket (see SETUP.md §4).
6. Configure Auth: enable email provider, set site URL + redirect URLs.
7. Create first admin user (see SETUP.md §6).

### Stripe
1. Create 3 subscription products (Starter 249 AED, Pro 449 AED, Business 849 AED).
2. Copy price IDs to Vercel env vars.
3. Create webhook endpoint pointing to `https://rescuego.ae/api/stripe/webhook`.
4. Enable events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payout.created`, `payout.paid`, `checkout.session.completed`.
5. Copy `STRIPE_WEBHOOK_SECRET` to Vercel.
6. **Currently on test keys.** Switch to live keys at Phase 10.

### Cron jobs (Vercel Cron)
Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/ops/monthly-allowance-reset",
      "schedule": "0 1 * * *"
    },
    {
      "path": "/api/ops/expire-requests",
      "schedule": "*/15 * * * *"
    }
  ]
}
```
Both endpoints require `Authorization: Bearer <OPS_CRON_SECRET>` header.

---

## 14. Testing Instructions

### Local setup
```bash
npm install
cp .env.example .env.local
# Fill in all variables in .env.local
npm run dev
```

### Golden path test flow
1. Register customer at `/auth/register`.
2. Submit roadside request at `/customer/request`.
3. Register provider at `/provider/register`.
4. Upload documents (emirates_id, license, vehicle).
5. Promote user to admin (see SETUP.md §6).
6. Admin activates provider at `/admin/providers`.
7. Provider goes online (location update) then accepts request at `/provider/dashboard`.
8. Provider completes job with final price.
9. Customer rates job at `/customer/ratings`.

### Subscription test flow
1. Provider registers, admin activates.
2. Provider goes to `/provider/subscribe`, selects a plan.
3. Use Stripe test card `4242 4242 4242 4242`.
4. Confirm provider `status = active` and correct `plan` in Supabase.
5. Forward webhooks locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### PPJ test flow
1. Provider on PPJ plan tries to accept a request.
2. Confirm redirect to `/provider/ppj-pay`.
3. Pay with test card. Confirm request accepted.

### Lint and build (always run before git push)
```bash
npm run lint
npm run build
```

---

## 15. Recommended Next Steps — Priority Order

### Immediate (next session)
1. **Phase 1A Task 8** — Run `EXPLAIN ANALYZE` on the slowest queries in Supabase dashboard (`pg_stat_statements`). Check: admin dashboard count queries, provider dashboard nearby RPC, request accept RPC, monthly reset query. Audit-only, no code changes expected.

2. **npm uninstall** 12 dead dependencies (safe, no code impact, speeds up installs):
   ```
   npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns
   ```

3. **Decide: `removeTracing: true` vs CWV** — Keep it (errors-only Sentry, smaller bundle) or remove it + enable `browserTracingIntegration` with `tracesSampleRate: 0.05` in `sentry.client.config.ts`.

4. **Run from terminal** (after any code changes):
   ```bash
   npm run lint && npm run build
   git add . && git commit -m "Phase 1A complete + VERDENT_HANDOFF.md" && git push
   ```

### Short-term (this week)
5. **Phase 1B** — Cron reliability: add alerting when monthly reset or request expiry fail. Add `vercel.json` cron config.
6. **Phase 1B** — Move `LAUNCH_PROMO = true` to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends.
7. **Phase 1C** — Add `server-only` guards to all server-only lib modules.
8. **Fix `NEXT_PUBLIC_SITE_URL`** — add to Vercel.

### Medium-term
9. **Storage bucket RLS** — Add policies to `provider-documents` bucket.
10. **CSP enforcement** — Review report-only violations, then switch header to `Content-Security-Policy`.
11. **Phase 2B** — RTL + Arabic foundation.
12. **Phase 3** — Replace polling with Supabase realtime.

### Pre-launch (before going live)
13. Switch Stripe to live keys (Phase 10).
14. Enable Supabase email confirmation.
15. Set `NEXT_PUBLIC_APP_URL=https://rescuego.ae`.
16. Configure production Stripe webhook.
17. Verify Sentry in production (SENTRY_VERIFICATION_ENABLED flow).

---

## 16. PPJ & Subscription Business Logic — Complete Detail

### Stripe Webhook Events Handled

| Event | Handler | Action |
|---|---|---|
| `checkout.session.completed` | `processCheckoutSessionCompleted` | Subscription checkout complete: marks provider `active`, sets plan from price ID mapping, syncs `stripe_customer_id` + `stripe_subscription_id` |
| `customer.subscription.created` | `processSubscriptionChange` | Sync all subscription fields: `stripe_customer_id`, `stripe_subscription_id`, `stripe_current_period_start`, plan, status → `active` |
| `customer.subscription.updated` | `processSubscriptionChange` | Same as created; also handles plan upgrades — calculates job credit bonus, writes `last_upgrade_bonus_key` to prevent double-crediting |
| `customer.subscription.deleted` | `processSubscriptionChange` | Sets provider status → `pending`, clears Stripe subscription fields |
| `invoice.payment_failed` | `processSubscriptionChange` | Sets provider status → `suspended` |
| `payment_intent.succeeded` | `processPaymentIntentSucceeded` | Two sub-paths: `fee_type=pay_per_job` → PPJ accept; `fee_type=overage` → sets `overage_cleared=true` then calls `accept_provider_request_atomic()`. If request already taken → `restore_ppj_credit_for_cancelled_paid_request()`. |
| `payment_intent.payment_failed` | `processPaymentIntentFailed` | Deletes request lock, updates payment record status to `failed`, logs failure |
| `payout.created` | `processPayoutEvent` | Upserts row in `payout_log` with `status='created'` |
| `payout.paid` | `processPayoutEvent` | Upserts row in `payout_log` with `status='paid'` |

All events use the idempotency claim pattern: `claimStripeEvent()` inserts `status='processing'` on first delivery; duplicate deliveries return early unless stale (>10 min `PROCESSING_TIMEOUT_MS`). On completion, event is updated to `status='processed'`.

### Supabase RPCs — Full Signatures and Contracts

#### `accept_provider_request_atomic(p_provider_id, p_request_id, p_increment_jobs, p_consume_ppj_credit)`
Returns: `{ success: boolean, reason: string | null, jobs_this_month: number | null, ppj_recovery_credits: number | null }`

Transaction steps (all or nothing, uses `FOR UPDATE` row lock):
1. `SELECT ... FOR UPDATE` on provider row — prevents concurrent accepts by same provider
2. Check provider has no active job (`accepted` or `in_progress`)
3. Check request is still `open` and not locked by another provider
4. `UPDATE requests SET status='accepted', accepted_by=p_provider_id`
5. `INSERT INTO jobs (request_id, provider_id, commission_rate=0, commission_amount=0)`
6. If `p_increment_jobs=true`: `UPDATE providers SET jobs_this_month = jobs_this_month + 1`
7. If `p_consume_ppj_credit=true`: decrements PPJ recovery credit balance (not used in current flow — credits managed via webhook)
8. `DELETE FROM request_locks WHERE request_id=p_request_id`

Failure reasons: `active_job_exists`, `locked_by_another_provider`, `request_not_open`.

`p_consume_ppj_credit` is always `false` in the API route — PPJ credit consumption happens only via the `payment_intent.succeeded` webhook path.

#### `complete_provider_job_atomic(p_provider_id, p_request_id, p_final_price)`
Returns: `{ success: boolean, reason: string | null }`

Transaction steps:
1. Verify job belongs to this provider and status is `accepted` or `in_progress`
2. `UPDATE requests SET status='completed'`
3. `UPDATE jobs SET final_price=p_final_price, completed_at=now()`
4. `DELETE FROM provider_locations WHERE provider_id=p_provider_id` — forces provider offline after job

#### `get_nearby_open_requests(p_provider_lng, p_provider_lat, p_radius_km)`
Returns: open requests within radius, ordered by distance ASC, then `created_at` ASC.

PostGIS query on `requests.location` (geometry Point, SRID 4326). Returns only `status='open'` requests with no active lock or with expired lock. Used by provider dashboard to list available jobs.

#### `restore_ppj_credit_for_cancelled_paid_request(p_provider_id, p_request_id, p_payment_intent_id)`
PPJ edge case protection. Called when a provider paid but the request was accepted by someone else during payment processing. Increments `ppj_recovery_credits` on the provider row — can be used on the next accept attempt.

### PPJ Payment Intent — Creation Steps

Route: `POST /api/provider/ppj-checkout`

1. Verify provider is authenticated + `status='active'` + `plan='pay_per_job'`
2. Verify request is `open` and no active lock exists
3. Calculate fee: `LAUNCH_PROMO ? 15 AED : (distance < 10 km ? 30 AED : 70 AED)` — server-side only
4. Create Stripe Payment Intent with:
   - `amount`: fee × 100 (fils), `currency: 'aed'`
   - `metadata.fee_type: 'pay_per_job'`
   - `metadata.provider_id`, `metadata.request_id`
5. Insert `ppj_payments` row (`status='pending'`)
6. Insert `request_locks` row (`locked_until = now + 60s`)
7. Return `{ client_secret }` to client — client-side Stripe Elements completes payment

### Overage Payment Intent — Creation Steps

Route: `POST /api/provider/overage-checkout`

1. Verify provider is authenticated + on `starter` or `pro` plan
2. Verify request is `open` and no active lock
3. Amount: fixed `OVERAGE_FEE_AED = 12` (1200 fils)
4. Create Stripe Payment Intent with `metadata.fee_type: 'overage'`
5. Insert `overage_payments` row, insert `request_locks` row
6. Return `{ client_secret }`

### Subscription Plan → Stripe Price ID Mapping

Built at module load from env vars in webhook handler (`PLAN_BY_PRICE_ID` map):
```
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID  → 'starter'   (249 AED/month)
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID      → 'pro'        (449 AED/month)
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID → 'business'   (849 AED/month)
```
Plan names are the internal `ProviderPlan` type. Price IDs must come from env vars — never hardcoded.

### RLS Rules — Per Table

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `users` | Own row only | Supabase Auth trigger | Own row only | None |
| `providers` | Own row + active providers (authenticated users) | Own row (registration) | Own row | None |
| `provider_locations` | Active providers' locations (authenticated) | Own row | Own row | Own row |
| `requests` | Customer: own. Provider: `open` + own `accepted_by`. Admin: all | Customer: own | Customer: cancel own. Admin: all | None |
| `jobs` | Provider: own. Admin: all | Service role (via RPC) only | Service role (via RPC) only | None |
| `ratings` | Everyone (public read) | Customer: verified via job ownership | None | None |
| `request_locks` | Service role only | Service role only | Service role only | Service role only |
| `stripe_events` | Admin only | Service role only | Service role only | None |
| `payout_log` | Admin only | Service role only | Service role only | None |
| `ppj_payments` | Own provider row | Service role only | Service role only | None |
| `overage_payments` | Own provider row | Service role only | Service role only | None |
| `price_estimates` | Everyone (public) | None (seeded in migration) | None | None |

Admin bypasses all RLS via `is_admin()` SECURITY DEFINER function. `request_locks`, `stripe_events`, and `payout_log` are accessed exclusively through `createAdminClient()` in API routes.

---

## 17. AI Agent Rules — Mandatory for Any AI Working on This Project

### Session Start (every session, no exceptions)
1. Read `CLAUDE.md` and `SESSION_LOG.md` only.
2. Summarize in one sentence where work last stopped.
3. Wait for user instructions before starting any task.

### Session End (automatic — before any compact or close)
1. Update `SESSION_LOG.md` with:
   - What was done this session
   - Important findings
   - Next task in full detail
   - Any deferred issues
2. Tell user: "Session log updated — ready for git push"

### Context Management
When context reaches 90%: **stop immediately.**
1. Update `SESSION_LOG.md` with full session summary.
2. Tell user: "Context at 90% — please git push and start new session."
3. Do NOT start any new task after this point.

### Commands — Never Run Automatically

| Never run | Instead do |
|---|---|
| `git add / commit / push` | Tell user: `git add . && git commit -m "..." && git push` |
| `npm run lint` | Tell user to run from terminal |
| `npm run build` | Tell user to run from terminal |
| Any SQL migration | Show full SQL first. Say: "Run this manually in Supabase SQL Editor." Wait for user confirmation. |
| Add env vars to code | Tell user to add in Vercel dashboard. Never hardcode. Never add to `.env` files in the repo. |

### Bug Reporting Format (mandatory — never fix silently)
```
Bug found: [description]
Location: [file:line]
Impact: [what breaks / who is affected]
Proposed fix: [the change]
[Wait for user approval before fixing]
```

### A vs B Decisions
When the user asks to choose between options:
- Present both with clear trade-offs.
- Wait for explicit user choice.
- Never pick unilaterally.

### Golden Rule Before Any File Change
1. Read the entire file first.
2. Explain what will change and why.
3. Do not break: Stripe flows / Supabase RLS / auth+session / request lifecycle semantics.
4. After every change: tell user to run `npm run lint && npm run build` from terminal.
5. When in doubt — ask, do not implement.

---

## 18. Deferred Items — Exact Locations

### High Priority (required before launch)
| Item | Location | Action |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` missing from Vercel | Vercel dashboard → Environment Variables | Add `https://rescuego.ae` |
| Storage bucket `provider-documents` has 0 RLS policies | Supabase → Storage → Buckets → provider-documents | Follow SETUP.md §4 to add SELECT/INSERT policies |
| Stripe on Test/Sandbox keys | Vercel env vars: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, all price IDs | Switch to live keys at Phase 10 only |

### Medium Priority (Phase 1B–1C)
| Item | Location | Action |
|---|---|---|
| `LAUNCH_PROMO = true` hardcoded | `src/types/index.ts:55` | Move to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends |
| `SUBSCRIPTION_PLANS` defined in 3 places | `src/types/index.ts`, `src/app/provider/register/page.tsx`, `src/app/api/stripe/create-checkout/route.ts` | Deduplicate — single export from `types/index.ts` |
| No `server-only` guards on server lib modules | `src/lib/stripe.ts`, `src/lib/logger.ts`, `src/lib/env.ts`, `src/lib/notifications.ts`, `src/lib/rate-limit.ts`, `src/lib/ops-auth.ts` | Add `import 'server-only'` at top of each |
| `bundlePagesRouterDependencies: true` redundant | `next.config.ts` | Remove — pure App Router project, flag has no effect |
| CSP in report-only mode | `next.config.ts` — `Content-Security-Policy-Report-Only` header | Review violation reports, switch to enforced `Content-Security-Policy` before launch |
| 12 unused Radix UI + form packages | `package.json` | Safe to remove; zero code uses them. See Section 10 for the exact `npm uninstall` command. |

### Low Priority (deferred to specific phases)
| Item | Location | Phase | Impact |
|---|---|---|---|
| Provider dashboard fallback sequential query | `src/app/provider/dashboard/page.tsx:378` | 1B | Extra DB round-trip when nearby RPC returns 0 results — LOW |
| Loading skeletons incomplete | `src/app/provider/dashboard/loading.tsx`, `src/app/admin/dashboard/loading.tsx` | 2A | Visual flash on load — LOW |
| Navbar CLS skeleton shift | `src/components/layout/Navbar.tsx` | 2B | Skeleton→content layout shift on every page; requires architectural change |
| `removeTracing: true` decision | `next.config.ts:108` | 1A | Blocks CWV capture via Sentry `browserTracingIntegration`; keep or remove |
| Login sequential role fetch | `src/app/auth/login/page.tsx:135` | 1A | 50–100ms extra latency — LOW |
| `router.refresh()` + 1200ms fallback | `src/app/auth/login/page.tsx:57` | 1A | Race condition workaround, not a real fix — LOW |
| Navbar duplicates auth + role check | `src/components/layout/Navbar.tsx` | 1A | Redundant DB call on every page — LOW |
| Navbar prefetches all 3 dashboards | `src/components/layout/Navbar.tsx` | 1A | Wasted bandwidth for single-role users — LOW |
| Logout navigates to `/` not `/auth/login` | `src/components/layout/Navbar.tsx` | 1A | UX annoyance, no functional impact — LOW |

---

## 19. Critical Business Rules — NEVER Change

### Commission — Always Zero Until Phase 8
- `commission_rate = 0` and `commission_amount = 0` in all `jobs` inserts — **intentional**
- Commission calculation is Phase 8 (Quote Approval). Do NOT add any commission logic before Phase 8.
- The columns exist in the schema and `Job` TypeScript type but are never computed.

### PPJ Fees — Server-Side Only
- Fee amounts are defined in `src/types/index.ts` and read only in server-side API routes.
- `PAY_PER_JOB_FEE_NEAR_AED = 30`, `PAY_PER_JOB_FEE_FAR_AED = 70`, `PAY_PER_JOB_PROMO_FEE_AED = 15`, `OVERAGE_FEE_AED = 12`
- Never accept fee amounts from the request body or URL params — always compute server-side.
- `LAUNCH_PROMO = true` currently means flat 15 AED PPJ fee. When turned off, fee becomes distance-based.

### Google Maps — Links Only Until Phase 6
- No Maps SDK anywhere in the codebase. Do NOT add `@googlemaps/js-api-loader` or any Maps library until Phase 6.
- All map links open the native maps app via `https://www.google.com/maps?q=lat,lng` links only.
- Provider locations are stored as PostGIS `geometry(Point, 4326)` — the schema is ready for Phase 6 without changes.

### Stripe — Test Mode Until Phase 10
- All `STRIPE_*` env vars are currently test/sandbox keys.
- Live traffic will be rejected by test keys. Switch at Phase 10 (Billing Integrity) only.
- Webhook: `https://rescuego.ae/api/stripe/webhook` — Active, 0% error rate (as of June 2026).
- Webhook signature verification via `stripe.webhooks.constructEvent()` — **must never be removed**.
- Idempotency via `stripe_events` table claim pattern — **must never be bypassed**.
- Raw body requirement: `req.text()` MUST be called before any JSON parsing. Parsing first invalidates the HMAC signature check and breaks all webhook processing.
- No payment logic in client components. No fee amounts in client props. All payment initiation is server-side.

### Atomic RPCs — Never Bypass
- `accept_provider_request_atomic()` — never replace with direct `UPDATE requests`. The RPC prevents race conditions via row-level locking. Any bypass risks two providers accepting the same request.
- `complete_provider_job_atomic()` — same rule. Validates ownership, updates both `requests` and `jobs`, and clears provider location atomically.
- Both RPCs are `SECURITY DEFINER` and `GRANT`ed to `service_role` only — anon/authenticated roles cannot call them.
- Never rewrite these RPCs without a full Postgres transaction. Any partial-write approach will introduce race conditions.

### RLS — Change Process
- Change **one policy at a time** only.
- Apply the change, then immediately smoke-test: verify the policy works as intended, then verify it does not grant excess access.
- Never use `createAdminClient()` in client components, `'use client'` files, or anywhere accessible from the browser.
- `SUPABASE_SERVICE_ROLE_KEY` must never appear in client-side code or be passed to any client-facing function.

### Migrations — Strict Process
- Migrations 001–016 are applied in production. Next migration number: **017**.
- Always: (1) write the SQL, (2) show it to the user, (3) wait for explicit confirmation, (4) user runs it manually in Supabase SQL Editor.
- Never alter or drop existing columns without a migration and user approval.
- Never apply a migration to production without first testing on a staging project.

---

## 20. Complete Database Column Reference — All 16 Migrations

This section documents every column in every table including additions from later migrations. Section 7 is a summary only. Use this section when writing queries, migrations, or TypeScript types.

### `users`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | `uuid_generate_v4()` |
| `name` | TEXT | 001 | |
| `phone` | TEXT UNIQUE | 001 | |
| `email` | TEXT UNIQUE | 001 | |
| `role` | TEXT CHECK IN ('customer','provider','admin') | 001 | |
| `created_at` | TIMESTAMPTZ | 001 | |
| `cancellation_count` | INTEGER DEFAULT 0 | 009 | Incremented on customer cancel |
| `late_cancellation_count` | INTEGER DEFAULT 0 | 009 | Incremented on late cancel (not yet used) |

### `providers`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK → users(id) CASCADE | 001 | Same UUID as users.id |
| `plan` | TEXT CHECK IN ('starter','pro','business','pay_per_job') | 001 | |
| `status` | TEXT CHECK IN ('pending','active','suspended') DEFAULT 'pending' | 001 | |
| `rating` | NUMERIC(3,2) DEFAULT 5.00 | 001 | Rolling avg of last 50 ratings (trigger) |
| `jobs_this_month` | INTEGER DEFAULT 0 | 001 | Incremented by accept RPC; reset by ops cron |
| `verified_badge` | BOOLEAN DEFAULT false | 001 | Admin-set, no automated logic yet |
| `documents` | JSONB | 001 | Document upload URLs |
| `stripe_customer_id` | TEXT | 001 | Set on checkout.session.completed / subscription.created |
| `stripe_subscription_id` | TEXT | 001 | Active subscription ID |
| `created_at` | TIMESTAMPTZ | 001 | |
| `stripe_current_period_start` | TIMESTAMPTZ | 007 | Used by ops cron to check if reset is due |
| `stripe_current_period_end` | TIMESTAMPTZ | 007 | |
| `jobs_reset_at` | TIMESTAMPTZ | 007 | Timestamp of last jobs_this_month reset |
| `job_credit_balance` | INTEGER DEFAULT 0 CHECK ≥0 | 008 | Extra jobs from subscription upgrade bonus |
| `last_upgrade_bonus_key` | TEXT | 008 | Idempotency key: `sub_id:period_start:old→new` |
| `ppj_recovery_credits` | INTEGER DEFAULT 0 CHECK ≥0 | 009 | Usage-only credits for customer-cancelled paid PPJ jobs |
| `release_count` | INTEGER DEFAULT 0 CHECK ≥0 | 009 | Total jobs voluntarily released |
| `unable_to_complete_count` | INTEGER DEFAULT 0 CHECK ≥0 | 009 | Incremented when provider marks unable to complete |
| `provider_side_cancellation_count` | INTEGER DEFAULT 0 CHECK ≥0 | 009 | Same as release_count (incremented together in release route) |

### `provider_locations`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `provider_id` | UUID PK → providers(id) CASCADE | 001 | Deleted on job release; not deleted on job completion |
| `location` | GEOMETRY(Point,4326) NOT NULL | 001 | PostGIS — `ST_DWithin` queries |
| `updated_at` | TIMESTAMPTZ | 001 | Staleness threshold: 5 minutes (`PROVIDER_STALE_MINUTES`) |

### `requests`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | |
| `customer_id` | UUID → users(id) | 001 | |
| `location` | GEOMETRY(Point,4326) NOT NULL | 001 | Customer GPS at submit time |
| `location_address` | TEXT | 001 | Human-readable address (optional) |
| `problem_type` | TEXT CHECK IN ('flat_tire','battery','tow','other') | 001 | |
| `note` | TEXT | 001 | Optional customer note |
| `status` | TEXT CHECK IN ('open','accepted','in_progress','completed','cancelled','expired') | 001+007 | 'expired' added in migration 007 |
| `accepted_by` | UUID → providers(id) | 001 | NULL until accepted |
| `price_estimate_min` | INTEGER | 001 | AED. Set from price_estimates seed data |
| `price_estimate_max` | INTEGER | 001 | AED |
| `final_price` | INTEGER | 001 | AED. Set by provider on completion |
| `created_at` | TIMESTAMPTZ | 001 | |
| `distance_to_provider_m` | INTEGER | 005 | Metres. Stored at accept time for reference |
| `overage_cleared` | BOOLEAN DEFAULT FALSE | 005 | Set by overage webhook before atomic accept |
| `cancelled_at` | TIMESTAMPTZ | 009 | |
| `cancelled_by` | UUID → users(id) | 009 | User who cancelled |
| `cancellation_actor` | TEXT CHECK IN ('customer','provider','admin') | 009 | Role string of canceller |
| `cancellation_compensated_at` | TIMESTAMPTZ | 009 | When PPJ credit was restored (if applicable) |
| `cancellation_compensation_type` | TEXT CHECK IN ('ppj_recovery_credit','subscription_usage_restore','none') | 009 | Set by restore_ppj_credit RPC |

### `jobs`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | |
| `request_id` | UUID UNIQUE → requests(id) | 001 | UNIQUE — one job per request. ON CONFLICT DO UPDATE used in accept RPC to handle re-accept after release |
| `provider_id` | UUID → providers(id) | 001 | |
| `commission_rate` | NUMERIC(5,2) | 001 | Always NULL/0 until Phase 8 |
| `commission_amount` | INTEGER | 001 | Always NULL/0 until Phase 8 |
| `stripe_payment_intent_id` | TEXT | 001 | Cleared (set NULL) on job release |
| `completed_at` | TIMESTAMPTZ | 001 | Cleared (set NULL) on re-accept after release |

### `ratings`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | |
| `job_id` | UUID UNIQUE → jobs(id) | 001 | One rating per job |
| `provider_id` | UUID → providers(id) | 001 | Denormalised for trigger performance |
| `stars` | INTEGER CHECK BETWEEN 1 AND 5 | 001 | |
| `comment` | TEXT | 001 | Optional |
| `created_at` | TIMESTAMPTZ | 001 | |

### `request_locks`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `request_id` | UUID PK → requests(id) CASCADE | 001 | One lock per request max |
| `provider_id` | UUID → providers(id) | 001 | Who holds the lock |
| `locked_until` | TIMESTAMPTZ NOT NULL | 001 | TTL = now + 60s (`REQUEST_LOCK_SECONDS`) |

### `stripe_events`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | TEXT PK | 001 | Stripe event ID (evt_xxx) |
| `type` | TEXT NOT NULL | 001 | e.g. `payment_intent.succeeded` |
| `processed_at` | TIMESTAMPTZ | 001 | Timestamp of final processing |
| `payload` | JSONB | 001 | Full Stripe event payload |
| `status` | TEXT CHECK IN ('processing','processed','failed') DEFAULT 'processed' | 006 | Idempotency state |
| `processing_started_at` | TIMESTAMPTZ | 006 | For stale-lock detection (10-min timeout) |
| `error_message` | TEXT | 006 | Last error on failure |
| `updated_at` | TIMESTAMPTZ | 006 | |

### `payout_log`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | |
| `stripe_payout_id` | TEXT | 001 | Stripe payout ID (po_xxx) |
| `amount` | INTEGER | 001 | Fils (AED × 100) |
| `currency` | TEXT DEFAULT 'AED' | 001 | |
| `arrival_date` | DATE | 001 | |
| `status` | TEXT | 001 | 'created' or 'paid' (from Stripe payout.status) |
| `created_at` | TIMESTAMPTZ | 001 | |

### `price_estimates`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `problem_type` | TEXT PK | 001 | |
| `min_aed` | INTEGER NOT NULL | 001 | |
| `max_aed` | INTEGER NOT NULL | 001 | |

Seeded values: `flat_tire`(80–200), `battery`(100–250), `tow`(200–800), `other`(150–500)

### `ppj_payments`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 005 | |
| `provider_id` | UUID → providers(id) CASCADE | 005 | |
| `request_id` | UUID → requests(id) CASCADE | 005 | |
| `fee_aed` | INTEGER NOT NULL CHECK > 0 | 005 | 15, 30, or 70 AED |
| `distance_meters` | INTEGER DEFAULT 0 | 005 | Distance at payment creation time |
| `stripe_payment_intent_id` | TEXT | 005 | |
| `status` | TEXT CHECK IN ('pending','paid','failed') DEFAULT 'pending' | 005 | |
| `promo_applied` | BOOLEAN DEFAULT FALSE | 005 | True when LAUNCH_PROMO was active |
| `created_at` | TIMESTAMPTZ | 005 | |
| `recovery_credit_restored_at` | TIMESTAMPTZ | 012 | Set when restore_ppj_credit RPC succeeds |
UNIQUE: `(provider_id, request_id)`

### `overage_payments`
| Column | Type | Migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 006 | |
| `provider_id` | UUID → providers(id) CASCADE | 006 | |
| `request_id` | UUID → requests(id) CASCADE | 006 | |
| `fee_aed` | INTEGER NOT NULL CHECK > 0 | 006 | Always 12 AED (`OVERAGE_FEE_AED`) |
| `stripe_payment_intent_id` | TEXT | 006 | |
| `status` | TEXT CHECK IN ('pending','paid','failed') DEFAULT 'pending' | 006 | |
| `created_at` | TIMESTAMPTZ | 006 | |
| `updated_at` | TIMESTAMPTZ | 006 | |
UNIQUE: `(provider_id, request_id)`

### All Indexes (by migration)
| Index | Table | Columns | Type | Migration |
|---|---|---|---|---|
| `idx_requests_location` | requests | location | GIST | 001 |
| `idx_provider_locations` | provider_locations | location | GIST | 001 |
| `idx_provider_locations_updated` | provider_locations | updated_at | btree | 001 |
| `idx_requests_status` | requests | status | btree | 001 |
| `idx_providers_status` | providers | status | btree | 001 |
| `idx_requests_cancelled_by` | requests | cancelled_by | btree | 009 |
| `idx_jobs_request_id` | jobs | request_id | btree | 013 |
| `idx_requests_customer_id` | requests | customer_id | btree | 013 |
| `idx_requests_accepted_by` | requests | accepted_by | btree | 013 |
| `idx_ppj_payments_provider_request` | ppj_payments | (provider_id, request_id) | btree | 013 |
| `idx_overage_payments_stripe_intent` | overage_payments | stripe_payment_intent_id | btree | 013 |
| `idx_stripe_events_status` | stripe_events | status | btree | 013 |
| `idx_users_role` | users | role | btree | 016 |
| `idx_overage_payments_provider_status_created` | overage_payments | (provider_id, status, created_at DESC) | btree | 016 |
| `idx_overage_payments_status` | overage_payments | status | btree | 016 |
| `idx_payout_log_created` | payout_log | created_at DESC | btree | 016 |
| `idx_ratings_provider_created` | ratings | (provider_id, created_at DESC) | btree | 016 |

---

## 21. Authentication Flow

### Registration

1. User visits `/auth/register`.
2. Form submits to Supabase `auth.signUp()` with email + password.
3. The `public.users` row is created by the registration API route (or directly in the page) with the selected `role` ('customer' or 'provider').
4. For providers: a matching `providers` row is created with `status='pending'`.
5. Email confirmation is currently DISABLED in Supabase Auth settings (dev mode). Must be enabled before launch.
6. After registration: customer → `/customer/request`, provider → `/provider/register` (profile completion).

### Login

1. User visits `/auth/login`.
2. `supabase.auth.signInWithPassword({ email, password })` sets session cookies.
3. Page reads `users.role` via a DB query (sequential after sign-in — deferred optimization, see Finding 2 in Task 1).
4. `router.refresh()` + 1200ms fallback forces Next.js router to re-hydrate with the new session.
5. Redirect: `customer` → `/customer/request`, `provider` → `/provider/dashboard`, `admin` → `/admin/dashboard`.

### Session Handling

- `proxy.ts` runs on every request matching `['/provider/:path*', '/admin/:path*', '/customer/:path*']`.
- It calls `supabase.auth.getUser()` which triggers a token refresh if the access token has expired.
- The refreshed token is written back to the browser cookie via the `setAll` cookie dance (required by `@supabase/ssr`).
- If no valid session exists on a protected route, the user is redirected to `/auth/login?redirect=<current-path>`.
- Role-based access (customer vs. provider vs. admin) is NOT enforced in `proxy.ts`. It is enforced at the page level.

### Role Management

- `role` is stored in `public.users.role` — never derived from JWT claims directly.
- `is_admin()` SECURITY DEFINER function checks `users.id = auth.uid() AND role = 'admin'` — used in all RLS policies.
- Admin bypass: `createAdminClient()` (service_role key) is used in API routes after verifying `users.role = 'provider'` or `'admin'` via the anon client.
- Role cannot be changed by the user — admin updates via `/api/admin/providers/update`.

### Logout

- `supabase.auth.signOut({ scope: 'local' })` in `Navbar.tsx` — local-only, no server round-trip.
- Refresh token is NOT invalidated server-side (acceptable trade-off at MVP scale).
- After logout, user is navigated to `/` (home page). UX improvement deferred: should navigate to `/auth/login`.

### Admin Account Creation

There is no self-service admin registration. To create an admin:
1. Register as a customer via `/auth/register`.
2. In Supabase SQL Editor, run: `UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';`
See `SETUP.md §6` for the full process.

---

## 22. Current Production State

| Item | Status |
|---|---|
| **Production URL** | https://rescuego.ae |
| **Vercel** | Connected to GitHub `main` branch — auto-deploys on push |
| **Domain** | rescuego.ae — active |
| **Supabase** | 16 migrations applied (001–016) |
| **Stripe mode** | **TEST/Sandbox** — NOT live. Switch at Phase 10 only. |
| **Active webhook** | `https://rescuego.ae/api/stripe/webhook` |
| **Sentry** | DSN configured on Vercel, verified in production (June 3, 2026). Errors-only. No replay. No tracing. |
| **Cron jobs** | NOT configured. `vercel.json` crons are absent — must add before launch. |
| **Storage** | Bucket `provider-documents` exists (private). Has **0 RLS policies** — a known pre-launch blocker. |
| **CSP** | `Content-Security-Policy-Report-Only` header only — not enforced. Review violations before enforcing. |
| **NEXT_PUBLIC_SITE_URL** | Missing from Vercel environment variables. Must add. |

### Active Stripe Webhook Events (9)
```
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
payment_intent.succeeded
payment_intent.payment_failed
payout.created
payout.paid
checkout.session.completed
```

### Launch Readiness Checklist

| Blocker | Status | Phase |
|---|---|---|
| Stripe live keys | ❌ Test only | Phase 10 |
| Storage bucket `provider-documents` RLS | ❌ 0 policies | Phase 1C |
| `NEXT_PUBLIC_SITE_URL` env var on Vercel | ❌ Missing | Now |
| `vercel.json` cron configuration | ❌ Missing | Phase 1B |
| CSP enforcement (not report-only) | ❌ Report-only | Phase 1C |
| Supabase email confirmation enabled | ❌ Disabled | Before launch |
| `LAUNCH_PROMO` → env var | ❌ Hardcoded `true` | Phase 1B |
| 12 unused npm packages uninstalled | ⚠️ Deferred | Now (safe) |
| `server-only` guards on lib modules | ⚠️ Missing | Phase 1C |

**Estimated launch readiness: ~35%**

The platform is functional in test mode. The primary blockers before accepting real payments are:
1. Switch Stripe to live keys (Phase 10 deliberate — not before billing is fully audited)
2. Storage RLS on provider-documents
3. Cron jobs configured in vercel.json

---

## 23. Corrections and Clarifications — Codebase Audit

These corrections apply to inaccuracies found in sections 6 and 16 after auditing the actual source code and migrations. The codebase is the authoritative source.

---

### Correction 1 — `complete_provider_job_atomic` Does NOT Delete Provider Location

**Incorrect statement in Section 16:**
> Step 4: `DELETE FROM provider_locations WHERE provider_id=p_provider_id` — forces provider offline after job

**Correct behavior (source: `supabase/migrations/014_complete_job_transaction_hardening.sql` and `015_ppj_credit_accept_complete_job_fix.sql`, `src/app/api/provider/jobs/complete/route.ts`):**

The `complete_provider_job_atomic` RPC does NOT delete `provider_locations`. The complete job API route also does NOT delete it. After a job is completed, the provider remains online and can immediately accept the next request.

Provider location is deleted ONLY in the release route (`src/app/api/provider/jobs/release/route.ts` lines 98–100):
```typescript
admin.from('provider_locations').delete().eq('provider_id', user.id)
```

The existing description in Section 6 is correct: "When a provider releases a job, their `provider_locations` row is deleted." The Section 16 step 4 claim about `complete_provider_job_atomic` is wrong — remove it when revising section 16.

The actual steps of `complete_provider_job_atomic` (from migration 015, the final version):
1. Validate `p_final_price` (1–10000 AED)
2. `SELECT ... FOR UPDATE` on jobs — lock the job row
3. `UPDATE requests SET status='completed', final_price=p_final_price`
4. `UPDATE jobs SET commission_rate=0, commission_amount=0, completed_at=now()`
5. Return `{ success, reason, job_id, completed_at }`

No provider_locations deletion. No lock deletion (lock was already deleted at accept time).

---

### Correction 2 — PPJ Recovery Credit Is Only for Customer-Cancelled Requests

**Incorrect statement in Section 6:**
> PPJ protection edge case: if provider paid but request was already accepted, they receive a `ppj_recovery_credits` credit

**Incorrect statement in Section 16:**
> If request was taken by another provider while payment was in-flight, `restore_ppj_credit_for_cancelled_paid_request()` RPC credits back the PPJ recovery credit.

**Correct behavior (source: `supabase/migrations/012_ppj_cancelled_payment_protection.sql`):**

The `restore_ppj_credit_for_cancelled_paid_request` RPC has two hard guards at the top:
```sql
IF v_request.status <> 'cancelled' OR v_request.cancellation_actor <> 'customer' THEN
  RETURN QUERY SELECT FALSE, 'request_not_customer_cancelled', NULL::INTEGER;
```

The credit is ONLY restored when:
1. The request status is `'cancelled'`
2. The cancellation actor is `'customer'`

**When another provider accepts the request** during payment (status becomes `'accepted'`), the RPC returns `false, 'request_not_customer_cancelled'`. The webhook logs `'ppj_cancelled_payment_protection_not_applied'` with reason `'request_not_customer_cancelled'`, and **no credit is granted**.

**Correct summary:**
- PPJ payment (15/30/70 AED) is at financial risk if another provider accepts the request during the ~60-second payment window.
- Credit IS restored only if the customer explicitly cancels the request before the payment-triggered accept can complete.
- If another provider beats the payment to the accept, the paying provider loses the fee with no recovery.
- The 60-second request lock (`REQUEST_LOCK_SECONDS = 60`) is the primary protection against this race condition — it blocks other providers from accepting while payment is processing.

---

### Correction 3 — `checkout.session.completed` Is Log-Only

**Incorrect statement in Section 16:**
> `checkout.session.completed` | `processCheckoutSessionCompleted` | Subscription checkout complete: marks provider `active`, sets plan from price ID mapping, syncs `stripe_customer_id` + `stripe_subscription_id`

**Correct behavior (source: `src/app/api/stripe/webhook/route.ts` lines 600–609):**

The `checkout.session.completed` handler only logs the event — no DB writes:
```typescript
if (event.type === 'checkout.session.completed') {
  const session = event.data.object as Stripe.Checkout.Session
  logger.info({ event: 'stripe_checkout_session_completed_observed', ... })
}
```

There is no `processCheckoutSessionCompleted` function. Provider activation, plan assignment, and Stripe ID sync all happen via `customer.subscription.created` → `processSubscriptionChange`. Stripe always fires both events on a new subscription checkout; the subscription event carries all the billing data.

---

## 24. Prompt for Next AI

Copy this prompt at the start of a new session to fully brief another AI assistant on this project:

```
You are continuing development on RescueGo — a UAE roadside recovery marketplace (two-sided SaaS).

MANDATORY SESSION START:
1. Read CLAUDE.md completely
2. Read SESSION_LOG.md completely
3. Read VERDENT_HANDOFF.md (this is the master context document — 25 sections)
4. Summarize in one sentence where work last stopped
5. Wait for user instructions before starting any task

PROJECT SUMMARY:
- Domain: rescuego.ae
- Stack: Next.js 16.2.6 App Router / React 19 / TypeScript / Tailwind CSS v4
- Backend: Supabase (Auth + Postgres + PostGIS + Storage + RLS)
- Payments: Stripe (subscriptions + Payment Intents + webhooks) — currently TEST mode
- Deployment: Vercel
- Monitoring: Sentry (errors only, no tracing, no replay)
- Middleware entry: src/proxy.ts (not middleware.ts — Next.js 16 rename)

CURRENT STATUS (as of June 5, 2026):
- Phase 1A Tasks 1–7 complete. Task 8 (production slow-query identification) is next.
- 16 migrations applied in production (001–016). Next migration: 017.
- Stripe is on test/sandbox keys — live keys at Phase 10 only.
- commission_rate = 0, commission_amount = 0 — INTENTIONAL. Do NOT compute commission before Phase 8.

CRITICAL RULES — NEVER VIOLATE:
1. Never run git commands. Always tell user: git add . && git commit -m "..." && git push
2. Never run npm run lint or npm run build. Tell user to run from terminal.
3. Never run SQL migrations. Show SQL first, say "Run in Supabase SQL Editor", wait for confirmation.
4. Never add env vars to code. Tell user to add in Vercel dashboard.
5. Never fix a bug silently — always report first with Bug found / Location / Impact / Proposed fix.
6. Never bypass accept_provider_request_atomic() or complete_provider_job_atomic() — they prevent race conditions.
7. Never add Google Maps SDK (Phase 6 only). Google Maps links only.
8. Never add commission logic before Phase 8.
9. When in doubt — ask, do not implement.
10. Before any file change: read the entire file first, then explain what you will change and why.

ARCHITECTURE NOTES:
- proxy.ts: token refresh + unauthenticated redirect only. No role-based redirects.
- All API routes use createAdminClient() (service_role) AFTER verifying auth via anon client.
- Provider going "online" = inserting/updating a provider_locations row (manual, button-triggered).
- Provider "online" threshold: updated_at within last 5 minutes (PROVIDER_STALE_MINUTES = 5).
- Request lock TTL: 60 seconds (REQUEST_LOCK_SECONDS = 60).
- Adaptive polling on customer request page: 20s (open) / 12s (accepted/in_progress).
- LAUNCH_PROMO = true (src/types/index.ts:55) → flat 15 AED PPJ fee instead of distance-based.

IMPORTANT CORRECTIONS (verified from codebase):
- complete_provider_job_atomic does NOT delete provider_locations. Only the release route does.
- PPJ recovery credit is ONLY restored for customer-cancelled requests, not when another provider accepts.
- checkout.session.completed is log-only — no DB updates. Provider activation is via customer.subscription.created.

MONEY FLOW:
- Provider subscription: Stripe Checkout → subscription.created webhook → mark provider active + set plan
- PPJ fee: Payment Intent created at /api/provider/ppj-checkout → payment_intent.succeeded webhook → accept_provider_request_atomic()
- Overage fee: Payment Intent at /api/provider/overage-checkout → payment_intent.succeeded webhook → set overage_cleared=true → accept_provider_request_atomic()
- All fee amounts are server-side only — never accept from request body

SESSION END REQUIREMENT (mandatory — before any context compact or close):
1. Update SESSION_LOG.md with: what was done, important findings, next task, deferred issues
2. Tell user: "Session log updated — ready for git push"
3. At 90% context: stop immediately, update session log, say "Context at 90% — please git push and start new session"
```

---

## 25. Final Validation

### Document Statistics (after this update)
| Metric | Value |
|---|---|
| Total sections | 25 |
| Estimated line count | ~1,500 |
| Last updated | June 5, 2026 |
| Source of truth | Codebase (migrations, route files, lib modules) |

### Files Reviewed in This Update
| File | Purpose |
|---|---|
| `CLAUDE.md` | Project rules, phase tracking, session rules |
| `SESSION_LOG.md` | All session decisions and findings |
| `README.md` | Project overview |
| `src/proxy.ts` | Middleware (auth/token refresh) |
| `src/app/api/stripe/webhook/route.ts` | All Stripe event handlers |
| `src/app/api/provider/requests/accept/route.ts` | Accept flow + overage guard |
| `src/app/api/provider/jobs/complete/route.ts` | Job completion flow |
| `src/app/api/provider/jobs/release/route.ts` | Job release + location cleanup |
| `supabase/migrations/001` through `016` | All schema, RLS, indexes, RPCs |

### Files NOT Reviewed (should be audited in a future session)
| File | Reason to Review |
|---|---|
| `src/app/auth/login/page.tsx` | Sequential role fetch (deferred Finding 2) + 1200ms timer |
| `src/app/auth/register/page.tsx` | Auth registration flow — exact DB write pattern not confirmed |
| `src/app/api/ops/monthly-allowance-reset/route.ts` | Cron reliability (Phase 1B) |
| `src/app/api/ops/expire-requests/route.ts` | Expiry cron behavior |
| `src/app/page.tsx` | getViewerState() 3 sequential queries (deferred Task 2 finding) |
| `src/app/provider/dashboard/page.tsx` | Fallback sequential query at line 378 (deferred Finding 5) |
| `src/app/components/layout/Navbar.tsx` | Duplicated auth + CLS issue (deferred) |
| `supabase/migrations/003_harden_provider_rls.sql` | RLS hardening details not captured |
| `supabase/migrations/004_nearby_open_requests.sql` | `get_nearby_open_requests` earlier version |

### Missing External Resources
| Resource | Status |
|---|---|
| `ROADMAP.md` | Does not exist in the repository. Phase roadmap is derived from `CLAUDE.md` "المراحل القادمة" section and `SESSION_LOG.md`. |
| `SETUP.md` | Exists (referenced multiple times) but not reviewed in this update. Contains Storage RLS setup (§4) and admin user creation (§6). |
| `DEPLOYMENT_STATUS.md` | Exists (referenced in SESSION_LOG) but not reviewed in this update. Contains per-env checklist. |
| Vercel dashboard | Not accessible to AI. Env var status is based on SESSION_LOG notes. |
| Supabase dashboard | Not accessible to AI. Migration status is based on SESSION_LOG notes. |

### Assumptions Made
1. All 16 migrations are applied in production (stated in SESSION_LOG + DEPLOYMENT_STATUS + CLAUDE.md).
2. Stripe is on test/sandbox keys (stated in CLAUDE.md + SESSION_LOG).
3. Sentry is verified in production (stated in SESSION_LOG June 3 entry).
4. The storage bucket `provider-documents` has 0 RLS policies (referenced in SETUP.md §4 in multiple places but SETUP.md not reviewed).
5. `NEXT_PUBLIC_SITE_URL` is missing from Vercel (stated in deferred items across multiple sessions).
6. `vercel.json` cron config is absent (no cron section found in reviewed files; SESSION_LOG says "pending").
7. Email confirmation is disabled in Supabase Auth (common dev mode; not confirmed from Supabase dashboard).
8. Production URL is `https://rescuego.ae` (stated in CLAUDE.md `Domain: rescuego.ae`).

### Summary of Changes in This Update (Sections 20–25 Added)
- **Section 20**: Complete column-by-column DB reference for all 12 tables, showing which migration added each column, plus full index inventory.
- **Section 21**: Dedicated Authentication Flow section covering registration, login, session handling, role management, logout, and admin creation.
- **Section 22**: Current Production State — snapshot of Vercel/Supabase/Stripe/Sentry/Cron/Storage status with launch readiness checklist.
- **Section 23**: Three factual corrections discovered by auditing source code against existing documentation.
- **Section 24**: Ready-to-use copy-paste prompt for the next AI assistant — self-contained, covers critical rules + corrections.
- **Section 25**: This validation section.
