# RescueGo — Pre-Launch Checklist

> Current-state note: use this as a checklist aid, not as the canonical implementation map. Current code state and audit observations are in `ARCHITECTURE.md`; current roadmap items are in `ROADMAP.md`.

Use this checklist before going live. Each item must be verified by the person deploying.

---

## Supabase Configuration

- [ ] **Email confirmation enabled** — `Authentication > Providers > Email > Confirm email = ON`
- [ ] **Site URL set** — `Authentication > URL Configuration > Site URL = https://rescuego.ae`
- [ ] **Redirect URLs added** — `https://rescuego.ae/**`
- [ ] **All migrations applied** — 001 through 028 in order (migration 025 is REQUIRED for state machine states)
- [ ] **PostGIS extension enabled** — `CREATE EXTENSION IF NOT EXISTS postgis;`
- [ ] **Storage bucket `provider-documents` exists** — Private, no public access
- [ ] **Storage RLS policies applied** — Migration 023 creates them

---

## Vercel Environment Variables

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — Production Supabase project URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Production anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Production service role key
- [ ] `STRIPE_SECRET_KEY` — **LIVE** key (sk_live_...)
- [ ] `STRIPE_WEBHOOK_SECRET` — Production webhook secret (whsec_...)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — **LIVE** key (pk_live_...)
- [ ] `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` — Live Starter price ID
- [ ] `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — Live Pro price ID
- [ ] `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` — Live Business price ID
- [ ] `NEXT_PUBLIC_APP_URL` = `https://rescuego.ae`
- [ ] `NEXT_PUBLIC_SITE_URL` = `https://rescuego.ae`
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Restricted key (see below)
- [ ] `OPS_CRON_SECRET` — At least 32 characters (`openssl rand -hex 32`)
- [ ] `NEXT_PUBLIC_LAUNCH_PROMO` = `true` (or remove when promo ends)
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — Production Sentry DSN
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Recommended for distributed rate limiting

---

## Stripe Configuration

- [ ] **Live mode enabled** — Not test/sandbox
- [ ] **Products created** — Starter (249 AED), Pro (449 AED), Business (849 AED) monthly recurring
- [ ] **Webhook endpoint configured** — `https://rescuego.ae/api/stripe/webhook`
- [ ] **Webhook events subscribed:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `payment_intent.succeeded`
  - `payout.paid`
  - `payout.failed`
- [ ] **Test payment verified** — Complete one full subscription + one PPJ payment in live mode

---

## Google Maps API Key

- [ ] **HTTP referrer restriction** — Only `https://rescuego.ae/*`
- [ ] **API restrictions** — Maps JavaScript API, Geocoding API, Places API only
- [ ] **Billing enabled** — Google Cloud billing account active

---

## Security Verification

- [ ] **CSP enforced** — `Content-Security-Policy` header (not report-only) confirmed in response headers
- [ ] **CSRF active** — POST to `/api/requests` from different origin returns 403
- [ ] **RLS policies tested** — Customer cannot see other customers' requests; provider cannot see billing data of other providers
- [ ] **Admin account created** — At least one admin user with `role = 'admin'` in `users` table
- [ ] **SENTRY_VERIFICATION_ENABLED** = `false` after confirming Sentry works

---

## Cron Jobs

- [ ] **Vercel cron configured** — `vercel.json` has schedules for:
  - `/api/ops/expire-requests` — every 30 min
  - `/api/ops/monthly-allowance-reset` — daily 00:00 UTC
- [ ] **CRON_SECRET auto-injected** — Vercel handles this automatically for cron routes
- [ ] **Manual test** — Call both endpoints with Bearer token and verify 200 response

---

## Assets

- [ ] `public/og-image.svg` exists (1200x630 branded image for social shares)
- [ ] `public/logo.svg` exists (referenced in structured data)
- [ ] Favicon configured

---

## Monitoring

- [ ] **Sentry receiving events** — Trigger test error from admin panel
- [ ] **Vercel logs accessible** — Function logs visible in Vercel dashboard
- [ ] **Stripe webhook dashboard** — No failed deliveries

---

## Operational Readiness

- [ ] **Admin dashboard functional** — `/admin/dashboard` shows live requests
- [ ] **Stuck job alerts visible** — Jobs > 2h in en_route/arrived show alert banner
- [ ] **Auto-release working** — Stuck jobs > 3h auto-released by cron (OPS_STUCK_JOB_HOURS=3)
- [ ] **Provider activation flow** — Admin can activate/suspend providers from `/admin/providers`
- [ ] **Full flow tested** — Customer request → provider accept → en_route → arrived → complete → rate

---

## Post-Launch (within first week)

- [ ] Monitor CSP violation reports (if any break, add exception)
- [ ] Monitor stuck job auto-release count (should be near zero)
- [ ] Review Sentry errors daily
- [ ] Confirm monthly allowance reset fires correctly on billing period
- [ ] Verify provider subscription webhooks process correctly
# RescueGo — Pre-Launch Checklist

Use this checklist before going live. Each item must be verified by the person deploying.

---

## Supabase Configuration

- [ ] **Email confirmation enabled** — `Authentication > Providers > Email > Confirm email = ON`
- [ ] **Site URL set** — `Authentication > URL Configuration > Site URL = https://rescuego.ae`
- [ ] **Redirect URLs added** — `https://rescuego.ae/**`
- [ ] **All migrations applied** — 001 through 028 in order (migration 025 is REQUIRED for state machine states)
- [ ] **PostGIS extension enabled** — `CREATE EXTENSION IF NOT EXISTS postgis;`
- [ ] **Storage bucket `provider-documents` exists** — Private, no public access
- [ ] **Storage RLS policies applied** — Migration 023 creates them

---

## Vercel Environment Variables

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — Production Supabase project URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Production anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Production service role key
- [ ] `STRIPE_SECRET_KEY` — **LIVE** key (sk_live_...)
- [ ] `STRIPE_WEBHOOK_SECRET` — Production webhook secret (whsec_...)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — **LIVE** key (pk_live_...)
- [ ] `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` — Live Starter price ID
- [ ] `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — Live Pro price ID
- [ ] `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` — Live Business price ID
- [ ] `NEXT_PUBLIC_APP_URL` = `https://rescuego.ae`
- [ ] `NEXT_PUBLIC_SITE_URL` = `https://rescuego.ae`
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Restricted key (see below)
- [ ] `OPS_CRON_SECRET` — At least 32 characters (`openssl rand -hex 32`)
- [ ] `NEXT_PUBLIC_LAUNCH_PROMO` = `true` (or remove when promo ends)
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — Production Sentry DSN
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Recommended for distributed rate limiting

---

## Stripe Configuration

- [ ] **Live mode enabled** — Not test/sandbox
- [ ] **Products created** — Starter (249 AED), Pro (449 AED), Business (849 AED) monthly recurring
- [ ] **Webhook endpoint configured** — `https://rescuego.ae/api/stripe/webhook`
- [ ] **Webhook events subscribed:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `payment_intent.succeeded`
  - `payout.paid`
  - `payout.failed`
- [ ] **Test payment verified** — Complete one full subscription + one PPJ payment in live mode

---

## Google Maps API Key

- [ ] **HTTP referrer restriction** — Only `https://rescuego.ae/*`
- [ ] **API restrictions** — Maps JavaScript API, Geocoding API, Places API only
- [ ] **Billing enabled** — Google Cloud billing account active

---

## Security Verification

- [ ] **CSP enforced** — `Content-Security-Policy` header (not report-only) confirmed in response headers
- [ ] **CSRF active** — POST to `/api/requests` from different origin returns 403
- [ ] **RLS policies tested** — Customer cannot see other customers' requests; provider cannot see billing data of other providers
- [ ] **Admin account created** — At least one admin user with `role = 'admin'` in `users` table
- [ ] **SENTRY_VERIFICATION_ENABLED** = `false` after confirming Sentry works

---

## Cron Jobs

- [ ] **Vercel cron configured** — `vercel.json` has schedules for:
  - `/api/ops/expire-requests` — every 30 min
  - `/api/ops/monthly-allowance-reset` — daily 00:00 UTC
- [ ] **CRON_SECRET auto-injected** — Vercel handles this automatically for cron routes
- [ ] **Manual test** — Call both endpoints with Bearer token and verify 200 response

---

## Assets

- [ ] `public/og-image.svg` exists (1200x630 branded image for social shares)
- [ ] `public/logo.svg` exists (referenced in structured data)
- [ ] Favicon configured

---

## Monitoring

- [ ] **Sentry receiving events** — Trigger test error from admin panel
- [ ] **Vercel logs accessible** — Function logs visible in Vercel dashboard
- [ ] **Stripe webhook dashboard** — No failed deliveries

---

## Operational Readiness

- [ ] **Admin dashboard functional** — `/admin/dashboard` shows live requests
- [ ] **Stuck job alerts visible** — Jobs > 2h in en_route/arrived show alert banner
- [ ] **Auto-release working** — Stuck jobs > 3h auto-released by cron (OPS_STUCK_JOB_HOURS=3)
- [ ] **Provider activation flow** — Admin can activate/suspend providers from `/admin/providers`
- [ ] **Full flow tested** — Customer request → provider accept → en_route → arrived → complete → rate

---

## Post-Launch (within first week)

- [ ] Monitor CSP violation reports (if any break, add exception)
- [ ] Monitor stuck job auto-release count (should be near zero)
- [ ] Review Sentry errors daily
- [ ] Confirm monthly allowance reset fires correctly on billing period
- [ ] Verify provider subscription webhooks process correctly
