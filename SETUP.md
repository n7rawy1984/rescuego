# RescueGo — Setup Guide

This document owns local development setup, the complete migration list (001–045) with correct filenames, environment variable definitions, Supabase project setup, storage bucket setup, Stripe webhook registration, build commands, and cron secret generation.

For **current migration baseline and open cloud gaps**, see [PROJECT_STATUS.md §3, §11].
For **architecture and system design**, see [ARCHITECTURE.md].
For **current launch blockers**, see [PROJECT_STATUS.md §5–§6].

---

## 1. Prerequisites

| Tool | Required version | Purpose |
|---|---|---|
| Node.js | 18+ | Runtime |
| npm | bundled with Node | Package management |
| Supabase account | Any | Database, Auth, Storage |
| Stripe account | Any (test mode OK) | Payments |
| Stripe CLI | Latest | Local webhook forwarding |

---

## 2. Supabase Project Setup

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Create a new project. Choose a strong database password and store it securely.
3. Wait until the project is fully provisioned.
4. Open **Project Settings → API**.
5. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service\_role key** → `SUPABASE_SERVICE_ROLE_KEY`

The application uses:
- **Supabase Auth** — customers, providers, and admins
- **Supabase Postgres** — all application tables (16 tables; see [ARCHITECTURE.md §2])
- **Supabase Storage** — provider KYC documents (`provider-documents` bucket)
- **PostGIS** — geospatial queries for provider proximity matching
- **Supabase Realtime** — live quote and job status updates

---

## 3. Required Environment Variables

Create `.env.local` in the project root. Use `.env.example` as the template.

```env
# ─── Supabase ────────────────────────────────────────────────────────────────
# Required. Copy from Supabase Project Settings → API.
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ─── Stripe ──────────────────────────────────────────────────────────────────
# Required. Use test keys locally (sk_test_..., pk_test_...).
# See §8 for how to create subscription products and obtain price IDs.
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_...

# ─── PPJ fees (optional — safe fallback values apply if missing) ──────────────
# Controls pay-per-job acceptance fees shown to providers and charged via Stripe.
# Fallback values: near=30 AED, far=70 AED, threshold=10000m, promo=15 AED.
# Set in Vercel if you want to adjust fees without a code deploy.
NEXT_PUBLIC_PPJ_FEE_NEAR_AED=30
NEXT_PUBLIC_PPJ_FEE_FAR_AED=70
NEXT_PUBLIC_PPJ_DISTANCE_M=10000
NEXT_PUBLIC_PPJ_PROMO_FEE_AED=15

# ─── Feature flags ────────────────────────────────────────────────────────────
# NEXT_PUBLIC_LAUNCH_PROMO: set to 'true' to charge the flat promo PPJ fee
# instead of the distance-based near/far fee.
NEXT_PUBLIC_LAUNCH_PROMO=false

# NEXT_PUBLIC_SOFT_LAUNCH_MODE: set to 'true' to set PPJ fee=0 and skip
# Stripe capture (for internal testing only — never true in production).
NEXT_PUBLIC_SOFT_LAUNCH_MODE=false

# ─── Google Maps ─────────────────────────────────────────────────────────────
# Currently used for map links only (no SDK). Key is optional for local dev
# but must be restricted to allowed referrers before production.
# See §12 for key restriction instructions.
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...

# ─── Application URLs ────────────────────────────────────────────────────────
# NEXT_PUBLIC_APP_URL: base URL for the app. Used in internal links.
# NEXT_PUBLIC_SITE_URL: used for Supabase Auth password reset redirect URLs.
#   WARNING: if missing, password reset emails fall back to window.location.origin.
#   Must be set in Vercel to https://rescuego.ae before launch.
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ─── Support email (optional) ────────────────────────────────────────────────
# Shown in UI error states. Defaults to support@rescuego.ae if not set.
NEXT_PUBLIC_SUPPORT_EMAIL=support@rescuego.ae

# ─── Ops/Cron secret ─────────────────────────────────────────────────────────
# Required in production. Protects internal /api/ops/* endpoints.
# MUST be at least 32 characters. The application throws at startup in
# production (NODE_ENV=production) if this is missing or shorter than 32 chars.
# Generate with: openssl rand -hex 32
OPS_CRON_SECRET=generate-a-long-random-secret-at-least-32-chars

# ─── Upstash Redis (optional — recommended for production) ────────────────────
# Enables cross-instance rate limiting. Without these, rate limiting falls back
# to per-process in-memory storage (limits are not shared across Vercel instances).
# Rate limiter works correctly in dev without Redis.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ─── Sentry (optional) ───────────────────────────────────────────────────────
# SENTRY_DSN: enables server/edge error capture.
# NEXT_PUBLIC_SENTRY_DSN: enables browser error capture. DSNs are public IDs, not secrets.
# SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT: only needed for source-map
# upload in CI/Vercel. Leave empty locally unless Sentry releases are configured.
# SENTRY_VERIFICATION_ENABLED: keep false except while verifying production monitoring.
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_VERIFICATION_ENABLED=false
```

### Security rules for environment variables

- **Never** expose `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `OPS_CRON_SECRET` in any `NEXT_PUBLIC_` variable or client component.
- **Never** commit `.env.local` to version control.
- `NEXT_PUBLIC_` variables are bundled into the client JavaScript — only use them for values that are safe to expose publicly.
- `SENTRY_DSN` values are public identifiers (not secrets); it is safe to use `NEXT_PUBLIC_SENTRY_DSN`.

---

## 4. Database Migrations

Apply all 45 SQL migration files in order. Every migration is idempotent — safe to re-run. Never skip a migration. Never run them out of order.

**In Supabase SQL Editor:**
1. Open **SQL Editor → New query**.
2. Paste the contents of the migration file.
3. Click **Run**.
4. Repeat in order for all 45 files.

**Required Postgres extensions** (included in `001_initial_schema.sql` — no manual step needed):
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Complete migration list (001–045)

| # | Filename | Key changes |
|---|---|---|
| 001 | `001_initial_schema.sql` | Core tables: users, providers, provider\_locations, requests, jobs, ratings, request\_locks, price\_estimates. PostGIS. Core RLS. Auth trigger. |
| 002 | `002_rpc_functions.sql` | Initial RPCs: accept\_request\_atomic, complete\_job\_atomic |
| 003 | `003_harden_provider_rls.sql` | Provider RLS hardening |
| 004 | `004_nearby_open_requests.sql` | get\_nearby\_open\_requests RPC (initial) |
| 005 | `005_ppj_payments.sql` | ppj\_payments, overage\_payments tables; overage\_cleared column |
| 006 | `006_billing_stability.sql` | Billing period stability fixes |
| 007 | `007_operational_lifecycle.sql` | Operational lifecycle RPCs |
| 008 | `008_upgrade_job_credits.sql` | Job credit upgrade logic |
| 009 | `009_operational_trust_credits.sql` | Trust credit operational logic |
| 010 | `010_harden_open_request_privacy.sql` | Open request privacy hardening |
| 011 | `011_accept_flow_transaction_hardening.sql` | Accept flow transaction hardening |
| 012 | `012_ppj_cancelled_payment_protection.sql` | PPJ cancelled payment protection |
| 013 | `013_query_performance_indexes.sql` | Query performance indexes |
| 014 | `014_complete_job_transaction_hardening.sql` | Complete job transaction hardening |
| 015 | `015_ppj_credit_accept_complete_job_fix.sql` | PPJ credit accept/complete job fix |
| 016 | `016_task4_query_indexes.sql` | Task 4 query indexes |
| 017 | `017_task8_query_indexes.sql` | Task 8 query indexes |
| 018 | `018_capture_get_nearby_open_requests.sql` | get\_nearby\_open\_requests capture update |
| 019 | `019_cancel_compensation_atomic.sql` | cancel\_request\_and\_compensate\_atomic RPC |
| 020 | `020_release_job_atomic.sql` | release\_job\_atomic RPC (initial) |
| 021 | `021_phase1c_rls_hardening.sql` | Phase 1C RLS hardening |
| 022 | `022_phase1c_remaining.sql` | Phase 1C remaining fixes |
| 023 | `023_provider_documents_bucket_rls.sql` | provider-documents Storage bucket RLS policies |
| 024 | `024_accept_rpc_overage_guard.sql` | accept\_provider\_request\_atomic with overage guard (p\_plan\_limit param) |
| 025 | `025_provider_state_machine.sql` | en\_route/arrived statuses; jobs.en\_route\_at, jobs.arrived\_at columns |
| 026 | `026_advance_state_atomic.sql` | advance\_provider\_job\_state RPC |
| 027 | `027_payout_log_unique_constraint.sql` | payout\_log UNIQUE constraint on stripe\_payout\_id |
| 028 | `028_stuck_job_auto_release.sql` | expire\_stuck\_active\_requests RPC; stuck job auto-release |
| 029 | `029_rpc_add_en_route_arrived_statuses.sql` | All three main RPCs updated for en\_route/arrived; old 4-param accept overload dropped |
| 030 | `030_requests_realtime_publication.sql` | requests table added to supabase\_realtime publication |
| 031 | `031_marketplace_v2_schema.sql` | **Marketplace V2**: request\_quotes, provider\_dispatch\_log, fair\_price\_config tables; V2 columns on requests/providers; submit\_quote\_atomic, select\_quote\_atomic, sla\_check\_and\_release RPCs; fair\_price\_config seed data |
| 032 | `032_disable_range_estimator.sql` | Disable fair price validation for early testing |
| 033 | `033_nearby_requests_include_quoted.sql` | get\_nearby\_open\_requests returns open + quoted requests |
| 034 | `034_cancel_allow_quoted_status.sql` | cancel\_request\_and\_compensate\_atomic handles quoted status |
| 035 | `035_nearby_requests_add_destination.sql` | get\_nearby\_open\_requests adds destination columns |
| 036 | `036_provider_location_lat_lng_columns.sql` | provider\_locations.lat and .lng as GENERATED ALWAYS AS columns |
| 037 | `037_rls_force_and_explicit_deny.sql` | FORCE ROW LEVEL SECURITY on users and providers; explicit DENY policies |
| 038 | `038_provider_kyc.sql` | **KYC**: provider status enum expanded; provider\_kyc\_log table; KYC columns on providers; provider-documents Storage bucket |
| 039 | `039_security_backstop.sql` | **Security Batch 1**: enforce\_users\_immutable\_columns trigger (C2); enforce\_providers\_immutable\_columns trigger (C3); fair-price validation re-enabled (C5); fuzzy coordinates in get\_nearby\_open\_requests (D8) |
| 040 | `040_rpc_integrity_state_safety.sql` | **Security Batch 2**: request\_price\_change\_atomic (CRIT-01); sla\_check\_and\_release for en\_route/arrived (CRIT-02); release decrement (HIGH-03); ratings.customer\_id (HIGH-05); respond guard (HIGH-06); advance\_job whitelist/search\_path (LOW-01/04); stuck expiry decrement (LOW-03); select\_quote\_atomic removes KYC docs from return (H1) |
| 041 | `041_admin_provider_status_atomic.sql` | **Security Batch 3a**: admin\_update\_provider\_status\_atomic RPC (H5 — atomic status + audit log) |
| 042 | `042_fix_expire_stuck_phantom_column.sql` | **Security Batch 3b**: replace requests.updated\_at phantom column with requests.created\_at in expire\_stuck\_active\_requests |
| 043 | `043_jobs_en_route_at_index.sql` | **Security Batch 3c**: idx\_jobs\_en\_route\_at partial index (WHERE completed\_at IS NULL) |
| 044 | `044_temp_widen_fair_price_bounds.sql` | **Security Batch 4a (TEMPORARY — LAUNCH BLOCKER)**: fair\_price\_config bounds widened to min=0.01, max=10000 for testing. NOT a restore target — fair price formula will be redesigned before launch. See [PROJECT_STATUS.md §10]. |
| 045 | `045_ppj_post_selection_fee_gate.sql` | **Security Batch 4b**: selected\_pending\_payment status; payment\_window\_started\_at column; expire\_ppj\_payment\_selection\_atomic RPC; finalize\_ppj\_selection\_atomic RPC; plan-branched select\_quote\_atomic |

After applying all migrations, run the verification queries in [PROJECT_STATUS.md §2] to confirm the key tables, triggers, and indexes exist.

---

## 5. Storage Bucket Setup

The `provider-documents` bucket stores provider KYC documents (Emirates ID, driving license, vehicle photo). Migration 023 applies RLS policies. The bucket itself must be created manually in the Supabase dashboard.

1. Go to **Storage**.
2. Click **New bucket**.
3. Bucket name: `provider-documents` (exact spelling required).
4. Set visibility to **Private** (never public).
5. Click **Save**.

RLS enforcement (applied by migration 023):
- Providers may read, insert, and update their own files. File paths must start with the provider's `auth.uid()`.
- Providers may NOT delete their own files.
- Admin deletion is performed via the service\_role client only.

Document upload validation (enforced in `POST /api/providers/documents`):
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
- Magic bytes: first 4 bytes validated against MIME type
- Maximum file size: 5 MB
- File extension must match MIME type

Admins view documents through temporary signed URLs generated server-side using the service\_role client.

---

## 6. Auth Settings

In **Supabase → Authentication → Providers → Email**:

1. Enable the Email provider.
2. **Local development**: disable email confirmation (`Confirm email` toggle off) for easier testing.
3. **Production**: enable email confirmation.

In **Authentication → URL Configuration**:

Set **Site URL** for local development:
```
http://localhost:3000
```

Add **Redirect URLs**:
```
http://localhost:3000/**
https://rescuego.ae/**
```

> If `NEXT_PUBLIC_SITE_URL` is not set in Vercel, password reset emails will use `window.location.origin` as the redirect base URL and may break in production. Set this variable before launch. See [PROJECT_STATUS.md §11].

---

## 7. Create the First Admin User

Register a normal user through the app, then promote them in SQL.

**Step 1 — Register:**
```
http://localhost:3000/auth/register
```

**Step 2 — Promote to admin in Supabase SQL Editor:**
```sql
UPDATE users
SET role = 'admin'
WHERE email = 'admin@example.com';
```

If the user does not yet have a row in `users` (possible if registration completed in Auth but the trigger did not fire), insert manually:

```sql
-- Find the auth.users UUID:
SELECT id, email FROM auth.users WHERE email = 'admin@example.com';

-- Insert with admin role (replace UUID_HERE with the result above):
INSERT INTO users (id, name, phone, email, role)
VALUES ('UUID_HERE', 'Admin', '+971500000000', 'admin@example.com', 'admin')
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

**Step 3 — Log in and open admin dashboard:**
```
http://localhost:3000/auth/login
http://localhost:3000/admin/dashboard
```

---

## 8. Stripe Test Mode Setup

### API Keys

1. Open the Stripe Dashboard in test mode.
2. Go to **Developers → API keys**.
3. Copy:
   - **Publishable key** (`pk_test_...`) → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - **Secret key** (`sk_test_...`) → `STRIPE_SECRET_KEY`

### Subscription Products and Price IDs

Create three subscription products in **Stripe → Product catalog**:

| Product name | Recurring price | Env var |
|---|---|---|
| RescueGo Starter | 249 AED / month | `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` |
| RescueGo Pro | 449 AED / month | `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` |
| RescueGo Business | 849 AED / month | `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` |

For each product:
1. Click **Add product**.
2. Set the name.
3. Add a recurring price in AED for the amount above.
4. Copy the **price ID** (`price_...`) into `.env.local`.

> The promo price for Starter (149 AED) is a display-only value in the app UI. Create the standard 249 AED price in Stripe — the promo label is controlled by `NEXT_PUBLIC_LAUNCH_PROMO` in the app, not a separate Stripe price.

### Local Webhook Forwarding

1. Install the Stripe CLI: [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
2. Log in:
```bash
stripe login
```
3. Forward webhook events to your local server:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
4. Copy the webhook secret shown (`whsec_...`) → `STRIPE_WEBHOOK_SECRET` in `.env.local`.
5. Keep the Stripe CLI running in a separate terminal while developing.

### Webhook events to forward

The application handles:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `payout.created`

### Test card

```
Number:  4242 4242 4242 4242
Expiry:  Any future date
CVC:     Any 3 digits
ZIP:     Any value
```

---

## 9. OPS Cron Secret Generation

`OPS_CRON_SECRET` protects all `/api/ops/*` endpoints. It must be at least 32 characters. The application **throws at startup** in `NODE_ENV=production` if this secret is missing or shorter than 32 characters.

Generate a secure value:
```bash
openssl rand -hex 32
```

Add to `.env.local`:
```env
OPS_CRON_SECRET=<paste the 64-character hex string here>
```

Add the same value to Vercel environment variables before deploying.

All ops endpoints require:
```
Authorization: Bearer <OPS_CRON_SECRET>
```

Vercel's own `CRON_SECRET` (set automatically on Pro/Enterprise plans) is also accepted, but only if it meets the ≥32-character minimum. Weak Vercel-managed secrets are logged and ignored by the application.

---

## 10. Local Development

### Install dependencies
```bash
npm install
```

### Start the dev server
```bash
npm run dev
```

Open: `http://localhost:3000`

> Run the Stripe CLI in a separate terminal when testing payment flows (see §8).

### Build and lint check
```bash
npm run build
npm run lint
```

Run both before every commit and before deploying.

### Recommended local test flow

1. Register a customer at `/auth/register`.
2. Create a roadside request at `/customer/request`.
3. Register a provider at `/provider/register`.
4. Upload provider KYC documents (Emirates ID, license, vehicle photo).
5. Create/promote an admin user (see §7).
6. Admin activates the provider at `/admin/providers` → Approve.
7. Provider logs in and submits a quote at `/provider/dashboard`.
8. Customer selects the quote at `/customer/request`.
9. Provider advances job state: accepted → en\_route → arrived → in\_progress → completed.
10. Customer rates the job.

For PPJ flow testing:
1. Register a provider without subscribing (pay\_per\_job plan).
2. Customer creates a request.
3. Provider submits a quote.
4. Customer selects the PPJ provider's quote.
5. Provider is redirected to PPJ payment page (`/provider/ppj-pay`).
6. Use the Stripe test card to complete payment.
7. Confirm provider dashboard shows the request as accepted.

---

## 11. Cron Route Manual Testing

All ops routes are invocable manually with `curl`:

```bash
# Expire stale requests and stuck jobs
curl -X POST http://localhost:3000/api/ops/expire-requests \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"

# Monthly allowance reset
curl -X POST http://localhost:3000/api/ops/monthly-allowance-reset \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"

# Marketplace cron (SLA enforcement, quote expiry, PPJ window expiry)
curl -X POST http://localhost:3000/api/ops/marketplace-cron \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"

# Weekly SLA reset
curl -X POST http://localhost:3000/api/ops/weekly-sla-reset \
  -H "Authorization: Bearer <OPS_CRON_SECRET>"
```

In production, Vercel invokes these automatically on the schedules defined in `vercel.json`. See [ARCHITECTURE.md §11] for schedule details and SLA thresholds.

---

## 12. Google Maps API Key Restriction

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is exposed in client JavaScript. Restrict it before production to prevent abuse.

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Select the API key used for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. Under **Application restrictions**, select **HTTP referrers (websites)**.
4. Add allowed referrers:
   ```
   https://rescuego.ae/*
   http://localhost:3000/*
   ```
5. Under **API restrictions**, restrict to:
   - Maps JavaScript API
   - Geocoding API
   - Places API
6. Click **Save**.

> Google Maps is currently used for map links only (no SDK loaded). The key restriction step still applies to prevent unauthorized use of the key from other domains.

---

## 13. Production Environment Checklist

Before deploying to production, verify every item:

**Vercel environment variables:**
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — production Supabase project URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — production anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — production service role key (server-only)
- [ ] `STRIPE_SECRET_KEY` — **live** secret key (`sk_live_...`) when going live
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — **live** publishable key (`pk_live_...`) when going live
- [ ] `STRIPE_WEBHOOK_SECRET` — webhook secret for the production endpoint (`whsec_...`)
- [ ] `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` — live Stripe price ID for Starter
- [ ] `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — live Stripe price ID for Pro
- [ ] `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` — live Stripe price ID for Business
- [ ] `NEXT_PUBLIC_APP_URL` — `https://rescuego.ae`
- [ ] `NEXT_PUBLIC_SITE_URL` — `https://rescuego.ae` (required for password reset emails)
- [ ] `OPS_CRON_SECRET` — ≥32 chars, generated with `openssl rand -hex 32`
- [ ] `UPSTASH_REDIS_REST_URL` — Upstash Redis REST URL (recommended; fallback to in-memory otherwise)
- [ ] `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis REST token

**Supabase production project:**
- [ ] All 45 migrations applied in order (001–045)
- [ ] `provider-documents` bucket exists and is set to Private
- [ ] Run verification queries from [PROJECT_STATUS.md §2]
- [ ] Email confirmation enabled
- [ ] Site URL set to `https://rescuego.ae`
- [ ] Redirect URLs include `https://rescuego.ae/**`

**Stripe production setup:**
- [ ] Production webhook endpoint registered: `https://rescuego.ae/api/stripe/webhook`
- [ ] Webhook listening for all 8 event types (listed in §8)
- [ ] Test with Stripe CLI replay before switching to live mode

**Security:**
- [ ] C2/C3 triggers verified (see [PROJECT_STATUS.md §7] LB-3 for verification SQL)
- [ ] OG image / logo file extensions corrected (see [PROJECT_STATUS.md §2])
- [ ] `NEXT_PUBLIC_SOFT_LAUNCH_MODE` is NOT set to `true` in production

For the complete list of launch blockers and their current status, see [PROJECT_STATUS.md §5–§6].

---

## 14. Production Monitoring (Sentry)

Sentry is optional. Leave all `SENTRY_*` variables empty to disable it.

When enabling:
1. Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel.
2. Redeploy.
3. To verify:
   - Set `SENTRY_VERIFICATION_ENABLED=true` in Vercel and redeploy.
   - Log in as admin and `POST /api/admin/sentry-verify` from the same browser session.
   - Confirm the event `RescueGo Sentry verification event` appears in Sentry.
   - Set `SENTRY_VERIFICATION_ENABLED=false` and redeploy after verification.

Privacy rules enforced in `src/lib/sentry-redaction.ts` (`beforeSend` hook):
- Raw Stripe webhook payloads are never sent to Sentry.
- Request bodies, cookies, authorization headers, session tokens, phone numbers, exact addresses, coordinates, and customer notes are scrubbed before capture.

Source-map upload (optional):
- Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` only if source-map upload is desired in CI/Vercel.
- Builds succeed without these values.

---

## 15. Common Errors and Fixes

### Login works but redirects to home

**Cause:** User exists in Supabase Auth but has no row in `users`.
**Fix:** Check and insert the profile row manually:
```sql
SELECT * FROM users WHERE email = 'user@example.com';
-- If missing, see §7 for the INSERT pattern.
```

### `/customer/request` redirects away after login

**Cause:** Missing `users` row or incorrect role.
```sql
UPDATE users SET role = 'customer' WHERE email = 'customer@example.com';
```

### Provider cannot access dashboard

**Cause:** Missing provider profile or `users.role` is not `provider`.
```sql
SELECT * FROM users WHERE email = 'provider@example.com';
SELECT * FROM providers WHERE id = 'PROVIDER_USER_UUID';
```
Both rows must exist and `users.role = 'provider'`.

### Provider cannot accept requests

**Cause:** `providers.status` is not `active`.
**Fix:** Log in as admin → `/admin/providers` → Approve. Or:
```sql
-- Only use directly in development. In production, use the admin UI
-- or admin_update_provider_status_atomic RPC to preserve the audit log.
UPDATE providers SET status = 'active' WHERE id = 'PROVIDER_UUID';
```

### Provider document upload fails

Possible causes and fixes:
- `provider-documents` bucket does not exist → create it (§5).
- Bucket is public → set it to Private.
- File larger than 5 MB → reduce file size.
- File type not JPEG/PNG/WebP/PDF → convert the file.
- `SUPABASE_SERVICE_ROLE_KEY` missing or wrong → check `.env.local` and restart dev server.

### Stripe checkout: "price is not configured"

**Cause:** Missing price ID env variable.
```env
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_...
```
Restart the dev server after adding env vars.

### Stripe webhook: "invalid signature"

**Cause:** `STRIPE_WEBHOOK_SECRET` does not match the active Stripe CLI session secret.
**Fix:** Re-run `stripe listen --forward-to localhost:3000/api/stripe/webhook`, copy the new `whsec_...`, update `.env.local`, restart the dev server.

### Ops endpoint: "unauthorized" (401)

**Cause:** Missing or incorrect `Authorization` header.
**Fix:** Add `-H "Authorization: Bearer <OPS_CRON_SECRET>"`.

### Ops endpoint: "operations secret is not configured" (500)

**Cause:** `OPS_CRON_SECRET` missing from `.env.local`.
**Fix:** Add `OPS_CRON_SECRET` (≥32 chars). Restart the dev server.

### "Database error: relation does not exist"

**Cause:** Migrations were not applied.
**Fix:** Apply all 45 migration files in order (§4).

### "PostGIS function error"

**Cause:** PostGIS extension not enabled.
**Fix:**
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```
This is included in `001_initial_schema.sql` — if you see this error, re-run migration 001.

### Admin cannot view provider documents

Possible causes:
- Documents were not uploaded (check `providers.documents` JSONB column).
- Storage bucket name is incorrect (must be exactly `provider-documents`).
- `SUPABASE_SERVICE_ROLE_KEY` missing or wrong.

```sql
SELECT documents FROM providers WHERE id = 'PROVIDER_UUID';
-- Expected: {"emirates_id_url": "...", "license_url": "...", "vehicle_photo_url": "..."}
```
