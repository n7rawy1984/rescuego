# RescueGo Setup Guide

> Current-state note: this setup guide may still be useful for local service configuration, but the current architecture and migration position are documented in `ARCHITECTURE.md`. When in doubt, follow the source code and latest migrations.

This guide explains how to connect RescueGo to Supabase and Stripe so login, registration, provider review, requests, documents, and payments work locally.

## 1. Supabase Project Setup

1. Go to https://supabase.com/dashboard.
2. Create a new project.
3. Choose a strong database password and save it securely.
4. Wait until the project is fully provisioned.
5. Open `Project Settings > API`.
6. Copy:
   - Project URL
   - anon public key
   - service_role key

The app uses:
- Supabase Auth for customers, providers, and admins.
- Supabase Postgres for users, providers, requests, jobs, ratings, and Stripe logs.
- Supabase Storage for provider documents.
- PostGIS for future geospatial matching.

## 2. Required Environment Variables

Create a local `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_...

# Google Maps, optional for MVP manual address flow
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Internal operations, server-only
OPS_CRON_SECRET=generate-a-long-random-secret

# Optional distributed rate limiting with Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Optional production monitoring with Sentry
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_VERIFICATION_ENABLED=false
```

Important:
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET` in client code.
- Never expose `OPS_CRON_SECRET` in client code. It is server-only and is used to protect internal operations endpoints.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are optional. If they are missing, rate limiting falls back to process-local memory for local development.
- `SENTRY_DSN` is optional and enables server/edge error capture. `NEXT_PUBLIC_SENTRY_DSN` enables browser error capture; Sentry DSNs are public identifiers, not secret keys.
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are only needed for source-map upload during production builds. Leave them empty locally unless Sentry releases are configured.
- `SENTRY_VERIFICATION_ENABLED` enables the temporary admin-only Sentry verification endpoint. Keep it `false` except while confirming production monitoring.
- For local development, use Stripe test keys.
- For production, change `NEXT_PUBLIC_APP_URL` to `https://rescuego.ae`.

## 3. Database Tables and Migrations

Run all SQL migrations in order from the `supabase/migrations` folder:

1. `001_initial_schema.sql`
2. `002_rpc_functions.sql`
3. `003_harden_provider_rls.sql`
4. `004_nearby_open_requests.sql`
5. `005_ppj_payments.sql`
6. `006_billing_stability.sql`
7. `007_operational_lifecycle.sql`
8. `008_upgrade_job_credits.sql`
9. `009_operational_trust_credits.sql`
10. `010_harden_open_request_privacy.sql`
11. `011_accept_request_atomic.sql`
12. `012_ppj_race_protection.sql`
13. `013_request_lock_ttl_fix.sql`
14. `014_complete_job_atomic.sql`
15. `015_rating_trigger_fix.sql`
16. `016_provider_location_index.sql`
17. `017_slow_query_optimization.sql`
18. `018_launch_promo_ppj_config.sql`
19. `019_cancel_request_atomic.sql`
20. `020_release_job_atomic.sql`
21. `021_phase1c_rls_hardening.sql`
22. `022_phase1c_remaining.sql`
23. `023_provider_documents_bucket_rls.sql`
24. `024_accept_rpc_overage_guard.sql`
25. `025_provider_state_machine.sql` (adds en_route/arrived states — REQUIRED for state machine)
26. `026_advance_state_atomic.sql`
27. `027_payout_log_unique_constraint.sql`

In Supabase:

1. Open `SQL Editor`.
2. Create a new query.
3. Paste the contents of `001_initial_schema.sql`.
4. Run it.
5. Repeat for each migration in order through `027_payout_log_unique_constraint.sql`.

These migrations create:
- `users`
- `providers`
- `provider_locations`
- `requests`
- `jobs`
- `ratings`
- `request_locks`
- `stripe_events`
- `payout_log`
- `price_estimates`
- PostGIS indexes
- RLS policies
- rating update trigger
- provider suspension trigger
- nearby provider RPC
- PPJ and overage payment tracking
- Stripe webhook status tracking
- Stripe billing-cycle period fields for subscription allowance resets
- stale open request expiry RPC

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
```

These are already included in `001_initial_schema.sql`.

## 4. Storage Bucket Setup

Create the provider documents bucket:

1. Go to `Storage`.
2. Click `New bucket`.
3. Bucket name: `provider-documents`
4. Set bucket to `Private`.
5. Save.

The app uploads:
- Emirates ID
- UAE driving license
- Vehicle photo

Validation rules in the app:
- Required files: `emirates_id`, `license`, `vehicle`
- Max size: 5 MB per file
- Allowed MIME types:
  - `image/jpeg`
  - `image/png`
  - `application/pdf`

Admins view documents through temporary signed URLs.

## 5. Auth Settings

In Supabase, open `Authentication > Providers`:

1. Enable Email provider.
2. For easiest local MVP testing, disable email confirmation:
   - `Authentication > Providers > Email`
   - Turn off `Confirm email`
3. For production, enable email confirmation.

In `Authentication > URL Configuration`:

Set Site URL for local development:

```txt
http://localhost:3000
```

Add redirect URLs:

```txt
http://localhost:3000/**
https://rescuego.ae/**
```

If email confirmation is enabled, new users may need to confirm email before the session is active.

## 6. Create the First Admin User

First, create a normal user through the app:

1. Run the app locally.
2. Visit `http://localhost:3000/auth/register`.
3. Register with the email you want as admin.

Then promote that user in Supabase SQL Editor:

```sql
UPDATE users
SET role = 'admin'
WHERE email = 'admin@example.com';
```

If the user does not exist in the `users` table, find the auth user ID:

```sql
SELECT id, email
FROM auth.users
WHERE email = 'admin@example.com';
```

Then insert the admin profile manually:

```sql
INSERT INTO users (id, name, phone, email, role)
VALUES (
  'AUTH_USER_UUID_HERE',
  'Admin',
  '+971500000000',
  'admin@example.com',
  'admin'
)
ON CONFLICT (id)
DO UPDATE SET role = 'admin';
```

After that, log in at:

```txt
http://localhost:3000/auth/login
```

Admin dashboard:

```txt
http://localhost:3000/admin/dashboard
```

## 7. Stripe Test Mode Setup

In Stripe Dashboard:

1. Enable test mode.
2. Go to `Developers > API keys`.
3. Copy:
   - Publishable key: `pk_test_...`
   - Secret key: `sk_test_...`

Create subscription products/prices:

1. Go to `Product catalog`.
2. Create product: `RescueGo Starter`
   - Recurring monthly price: `249 AED`
3. Create product: `RescueGo Pro`
   - Recurring monthly price: `449 AED`
4. Create product: `RescueGo Business`
   - Recurring monthly price: `849 AED`
5. Copy each Stripe price ID into `.env.local`:

```env
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_...
```

Webhook setup for local development:

1. Install Stripe CLI.
2. Log in:

```bash
stripe login
```

3. Forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

4. Copy the webhook secret shown by Stripe CLI:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

Useful test card:

```txt
4242 4242 4242 4242
Any future expiry
Any 3-digit CVC
Any postal code
```

## 8. Local Development Steps

Install dependencies:

```bash
npm install
```

Create `.env.local` using the variables above.

Run the dev server:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

Recommended MVP test flow:

1. Register a customer at `/auth/register`.
2. Create a roadside request at `/customer/request`.
3. Register a provider at `/provider/register`.
4. Upload provider documents.
5. Create/promote an admin user.
6. Admin activates provider at `/admin/providers`.
7. Provider logs in and accepts request at `/provider/dashboard`.
8. Provider completes job with final price.
9. Customer rates job at `/customer/ratings`.

Before deployment or handoff, run:

```bash
npm run lint
npm run build
```

## 9. Operational Lifecycle Automation

The project includes two internal operations endpoints for production lifecycle automation. They are intended for Vercel Cron or trusted internal automation only.

Required migration:

```txt
supabase/migrations/007_operational_lifecycle.sql
```

Required environment variable:

```env
OPS_CRON_SECRET=generate-a-long-random-secret
```

Security:
- `OPS_CRON_SECRET` is server-only.
- Do not prefix it with `NEXT_PUBLIC_`.
- Do not use it in client components.
- If it is missing, ops endpoints fail closed with an error instead of running.
- Requests must include:

```txt
Authorization: Bearer <OPS_CRON_SECRET>
```

Monthly allowance reset:

```bash
curl -X POST http://localhost:3000/api/ops/monthly-allowance-reset \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"
```

Behavior:
- Resets Starter and Pro `jobs_this_month` only when Stripe subscription period has renewed.
- Uses `stripe_current_period_start`, persisted from Stripe subscription webhooks.
- Does not reset Pay Per Job providers.
- Does not reset Business providers.
- Safe to run more than once.

Request expiry:

```bash
curl -X POST http://localhost:3000/api/ops/expire-requests \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"
```

Behavior:
- Expires stale `open` requests older than the configured window.
- Does not touch accepted, in-progress, completed, cancelled, or actively locked requests.
- Logs expired request count only, without customer PII.

For production, call these endpoints from Vercel Cron using the same authorization header.

## 10. Common Errors and Fixes

### Login works but redirects to home

Cause:
- The user exists in Supabase Auth but does not have a matching row in `users`.

Fix:
- Create the profile row manually or register again after migrations are applied.

Check:

```sql
SELECT * FROM users WHERE email = 'user@example.com';
```

### Customer registration succeeds but `/customer/request` redirects away

Cause:
- Missing `users` row or wrong role.

Fix:

```sql
UPDATE users
SET role = 'customer'
WHERE email = 'customer@example.com';
```

### Provider cannot access dashboard

Cause:
- Missing provider profile or user role is not `provider`.

Fix:

```sql
SELECT * FROM users WHERE email = 'provider@example.com';
SELECT * FROM providers WHERE id = 'PROVIDER_USER_UUID';
```

The provider needs:

```txt
users.role = provider
providers.id = users.id
```

### Provider cannot accept requests

Cause:
- Provider status is not `active`.

Fix:
- Log in as admin.
- Go to `/admin/providers`.
- Click `Activate`.

Or run:

```sql
UPDATE providers
SET status = 'active'
WHERE id = 'PROVIDER_USER_UUID';
```

### Provider document upload fails

Possible causes:
- `provider-documents` bucket does not exist.
- Bucket is not private.
- File is larger than 5 MB.
- File type is not JPG, PNG, or PDF.
- `SUPABASE_SERVICE_ROLE_KEY` is missing.

Fix:
- Create the bucket exactly as `provider-documents`.
- Check `.env.local`.
- Restart the dev server after changing env vars.

### Stripe checkout says price is not configured

Cause:
- Missing price ID env variable.

Fix:
- Add all required price IDs:

```env
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_...
```

Restart:

```bash
npm run dev
```

### Stripe webhook returns invalid signature

Cause:
- `STRIPE_WEBHOOK_SECRET` does not match the active Stripe CLI/session webhook secret.

Fix:
- Rerun:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

- Copy the new `whsec_...` value into `.env.local`.
- Restart the dev server.

### Missing environment variable error

Cause:
- Required env var is missing from `.env.local`.

Fix:
- Compare `.env.local` with `.env.example`.
- Restart the dev server.

### Database error: relation does not exist

Cause:
- Migrations were not run.

Fix:
- Run all SQL files in `supabase/migrations` in order.

### Ops endpoint returns unauthorized

Cause:
- Missing or incorrect `Authorization` header.

Fix:

```txt
Authorization: Bearer <OPS_CRON_SECRET>
```

### Ops endpoint says operations secret is not configured

Cause:
- `OPS_CRON_SECRET` is missing from `.env.local` or production environment variables.

Fix:
- Add `OPS_CRON_SECRET`.
- Restart the dev server or redeploy.

### PostGIS function error

Cause:
- PostGIS extension was not enabled.

Fix:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Admin cannot see provider documents

Possible causes:
- Documents were not uploaded.
- Storage bucket name is wrong.
- Service role key is missing.

Fix:
- Confirm bucket name is exactly `provider-documents`.
- Confirm `providers.documents` contains paths.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set.

## Production Monitoring

Sentry monitoring is optional and safe to leave disabled. If `SENTRY_DSN` is empty,
server and edge error capture are not enabled. If `NEXT_PUBLIC_SENTRY_DSN` is empty,
browser error capture is not enabled.

Captured:
- unhandled server/runtime errors
- unhandled browser errors
- Next.js request errors through `instrumentation.ts`
- global app errors from `src/app/error.tsx`

Disabled by default:
- session replay
- profiling
- performance tracing
- manual capture of raw operational payloads

Privacy rules:
- do not send raw Stripe webhook payloads to Sentry
- do not send request bodies, cookies, authorization headers, session tokens, phone numbers, exact addresses, coordinates, or customer operational notes
- use structured logs for operational IDs/statuses only, never customer contact or exact location data

Source maps:
- set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` only in CI/Vercel if source-map upload is desired
- builds continue without source-map upload when these values are missing

Sentry production verification:
1. Set `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_VERIFICATION_ENABLED=true` in Vercel.
2. Redeploy.
3. Sign in as an admin user.
4. Send a POST request to `/api/admin/sentry-verify` from the same authenticated browser session.
5. Confirm the event named `RescueGo Sentry verification event` appears in Sentry.
6. Set `SENTRY_VERIFICATION_ENABLED=false` and redeploy after verification.

## Notes for Production

- Enable Supabase email confirmation.
- Use production Stripe keys and live price IDs.
- Set `NEXT_PUBLIC_APP_URL=https://rescuego.ae`.
- Set `NEXT_PUBLIC_SITE_URL=https://rescuego.ae` (used for password reset redirect URLs).
- Configure optional Sentry monitoring after confirming privacy redaction in a staging deployment.
- Configure Stripe production webhook endpoint:

```txt
https://rescuego.ae/api/stripe/webhook
```

- Keep `provider-documents` private.
- Do not expose service role keys in browser code.
- Apply all migrations (001-027) before deploying.

### Google Maps API Key Restriction

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is exposed client-side (used for geocoding in customer request form). To prevent abuse:

1. Go to Google Cloud Console > APIs & Services > Credentials.
2. Select the API key used for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. Under `Application restrictions`, select `HTTP referrers (websites)`.
4. Add allowed referrers:
   ```
   https://rescuego.ae/*
   http://localhost:3000/*
   ```
5. Under `API restrictions`, restrict to:
   - Maps JavaScript API
   - Geocoding API
   - Places API
6. Save.

This ensures the key cannot be used from unauthorized domains.
