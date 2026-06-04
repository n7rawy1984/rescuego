# RescueGo — Complete Project Handoff

**Last updated:** June 5, 2026  
**Status:** Phase 1A tasks 1–7 complete. Task 8 (slow-query identification) is next.  
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
supabase/migrations/      # 001–016 SQL migrations (all applied in production)
sentry.client.config.ts   # Browser Sentry init
sentry.server.config.ts   # Server Sentry init
sentry.edge.config.ts     # Edge Sentry init
```

### Key design decisions
- **No Radix UI / shadcn.** All UI components are custom native-HTML + Tailwind. Radix packages were scaffolded but never wired; `npm uninstall` pending.
- **No Maps SDK.** Google Maps links only. Maps SDK planned for Phase 6.
- **No realtime.** All data is polled (customer request page: 12s/20s adaptive). Realtime planned for Phase 3.
- **service_role** Supabase client is **server-side only** (`src/lib/supabase/admin.ts`). All API routes that need to bypass RLS use `createAdminClient()`.
- **`proxy.ts`** is Next.js middleware (not `middleware.ts`; Next.js 16 renames the file). It refreshes Supabase tokens and redirects unauthenticated users. It does NOT check roles — roles are enforced at page level and by RLS.

---

## 3. Current Project Status

### Completed phases (as of June 5, 2026)
- Phase 0 — QA-FINAL
- Phase 1 — Security hardening + Sentry verified
- Phase 1B.4 — Realtime & polling stability
- Phase 1B.5 — Lifecycle recovery hardening (migration 014)
- Phase 2A.1 — Admin UI polish
- Phase 2A.2 — Customer/Provider UI polish
- Phase 2A.4 — Pricing & Subscription UI polish
- Phase 2B.1 — Design System foundation
- Phase 1A Tasks 1–7 (Auth perf, logout lag, dashboard loading, query profiling, polling, CWV baseline, bundle audit)

### Phase 1A completion status
| Task | Status | Summary |
|---|---|---|
| Task 1 — Auth/login performance | ✅ Complete | proxy.ts DB call removed, remaining findings deferred |
| Task 2 — Logout lag | ✅ Complete | `signOut({ scope: 'local' })` |
| Task 3 — Dashboard loading | ✅ Complete | Admin+Provider+Customer parallelized |
| Task 4 — Supabase query profiling | ✅ Complete | migration 016, location + accept route parallelized |
| Task 5 — Polling reduction | ✅ Complete | Adaptive 12s/20s interval on customer page |
| Task 6 — CWV baseline | ✅ Complete | sentry.client.config.ts created, preconnect added |
| Task 7 — Bundle size audit | ✅ Complete | Findings documented; npm uninstall pending user action |
| Task 8 — Production slow-query identification | ⏳ Next | Audit-only, no code changes expected |

### Next up (in order)
1. Phase 1A Task 8 — Production slow-query identification
2. Phase 1B remaining — cron reliability, DB indexes, LAUNCH_PROMO config
3. Phase 1C — Deep RLS hardening + `server-only` guards
4. Phase 2B — RTL & Arabic foundation
5. Phase 2C — Mobile/PWA strategy
6. Phase 3 — Realtime & Notifications
7. Phase 4 — Operations & Trust V1
8. Phase 4B — Admin Operations Center
9. Phase 5 — Provider KYC & UAE Compliance
10. Phase 6 — Dispatch Logic V2 (Google Maps SDK enters here)
11. Phase 7 — Pricing Engine V2
12. Phase 8 — Quote Approval + Commission activation
13. Phase 9 — Premium Jobs & Commission
14. Phase 10 — Billing Integrity (switch to Stripe live keys here)
15. Phase 11 — Fraud Detection
16. Phase 12 — Legal & UAE Compliance
17. Phase 13 — SEO Domination
18. Phase 14 — Growth & Provider Acquisition
19. Phase 15 — Scale Architecture

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

### Tables (16 migrations applied)

| Table | Purpose |
|---|---|
| `users` | All users (customers, providers, admins). Role column controls access. |
| `providers` | Extended provider profile. 1:1 with users (same UUID). Plan, status, billing fields. |
| `provider_locations` | Live GPS location. 1:1 with providers. PostGIS Point. Staleness = 5 min. |
| `requests` | Customer roadside requests. All lifecycle statuses. |
| `jobs` | Created when request is accepted. Links request ↔ provider. Commission fields (always 0 until Phase 8). |
| `ratings` | 1:1 with jobs. Stars 1–5 + optional comment. Trigger updates provider rating. |
| `request_locks` | Optimistic locks during PPJ/overage payment flow. TTL = 60s. |
| `stripe_events` | Idempotency log for Stripe webhook processing. |
| `payout_log` | Stripe payouts (upserted from webhook). |
| `price_estimates` | Static price ranges per problem type. Seeded in migration 001. |
| `ppj_payments` | PPJ payment records (pending → paid/failed). |
| `overage_payments` | Overage payment records (pending → paid/failed). |

### Key RLS rules

- Users: can only read/update their own row. Admin bypasses all.
- Providers: can read own row + active providers visible to customers. Admin bypasses.
- provider_locations: providers can insert/update own. Active providers' locations visible to all authenticated users.
- Requests: customers see own requests. Active providers see `open` requests. Provider sees their `accepted_by` requests. Admin sees all.
- Jobs: providers see own. Admin sees all.
- Ratings: customers can insert (verified via job ownership). Public read.
- stripe_events / payout_log: admin-only.

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
| `/api/ops/monthly-allowance-reset` | POST | Reset jobs_this_month for Starter/Pro on new billing period |
| `/api/ops/expire-requests` | POST | Expire stale open requests |

---

## 10. Known Issues and Deferred Items

### Active (requires user decision)
- **`removeTracing: true` vs CWV capture** (`next.config.ts:108`): Sentry tracing tree-shaken from bundle. `browserTracingIntegration` needed for INP/LCP/CLS is a no-op. Decision: keep (smaller bundle, errors-only) OR remove + add `browserTracingIntegration + tracesSampleRate: 0.05` to `sentry.client.config.ts`.
- **12 unused npm dependencies** (safe to remove, zero bundle impact):
  ```
  npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns
  ```

### Deployment
- `NEXT_PUBLIC_SITE_URL` missing from Vercel env vars
- Stripe still in Sandbox/Test mode — switch to live keys at Phase 10
- Storage bucket `provider-documents` has 0 RLS policies — see SETUP.md §4

### Performance (deferred from Phase 1A)
- Login: sequential role fetch after login (`auth/login/page.tsx:135`)
- Login: `router.refresh()` + 1200ms fallback timer (`login/page.tsx:57`)
- Navbar: duplicates auth + role check on every page load
- Navbar: prefetches all 3 dashboards for every visitor
- Home page (`page.tsx`): `getViewerState()` has 3 sequential DB queries for provider users, blocks HTML stream
- Provider dashboard: fallback open requests query fires sequentially after nearby RPC
- All loading.tsx skeletons are incomplete / don't match actual page layouts
- Navbar CLS: skeleton→content shift on every page (architectural fix needed, deferred to Phase 2B)

### Code quality (deferred to Phase 1C)
- No `server-only` guards on `stripe.ts`, `logger.ts`, `env.ts`, `notifications.ts`, `rate-limit.ts`, `ops-auth.ts`
- `SUBSCRIPTION_PLANS` defined in 3 places — dedup needed
- `LAUNCH_PROMO = true` hardcoded in `src/types/index.ts:55` — should be `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends
- `bundlePagesRouterDependencies: true` in `next.config.ts` is redundant for a pure App Router project (negligible impact)

### Security (ongoing)
- CSP is in report-only mode since Phase 1 (`Content-Security-Policy-Report-Only` header)
- Review CSP violation reports before enforcing

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
