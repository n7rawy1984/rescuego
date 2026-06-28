# SECURITY AUDIT PART 1 — Authentication, Authorization, RLS, and Payments

**Date:** 2026-06-11  
**Auditor:** Claude Sonnet 4.6 (automated, full source read)  
**Scope:** Auth/session, RLS policies, Stripe payment flows, atomic RPCs, sensitive data exposure  
**Baseline:** Full production conditions — Stripe LIVE, real money, real PII, public traffic, commission active  
**Files read:** proxy.ts, all 3 Supabase clients, all 28 API routes, migrations 001–038, types/index.ts, rate-limit.ts, ops-auth.ts, next.config.ts

---

## CRITICAL FINDINGS

---

### C1 — proxy.ts Middleware Not Registered in Next.js Framework

**File:** `src/proxy.ts`  
**Severity:** CRITICAL  

**Finding:**  
`src/proxy.ts` exports a named function `proxy` (not `export default function middleware`) and there is no `src/middleware.ts` or root-level `middleware.ts` file anywhere in the repository.

Next.js requires the middleware entry point to be at `middleware.ts` (project root or `src/`) with a **default export** named `middleware`. The framework does not pick up an arbitrarily-named file called `proxy.ts`.

The file comment states: *"In Next.js 16 the middleware entry point is proxy.ts, not middleware.ts."* This is incorrect — no such rename occurred in Next.js. The `config` export with the `matcher` array is present, but Next.js only reads this from a file at the correct path with the correct export name.

**Consequences if proxy is not running:**
1. **CSRF origin checks are not executing** — every mutating POST API route is unprotected by the origin check in `proxy.ts:47–73`.
2. **Supabase session cookie refresh is not happening in middleware** — for page-level navigation with expired tokens, users may appear logged out or get stale sessions (individual API routes still call `getUser()` which does its own JWT validation).
3. **Unauthenticated redirects for `/provider`, `/admin`, `/customer` page routes are not running** — protected page routes rely on this redirect. Pages themselves may still perform their own auth checks, but this is not guaranteed for every page.

**Attack scenario:** An attacker on any origin submits a `POST` to `/api/provider/requests/accept` or `/api/requests` with a victim's valid session cookie. Without the CSRF origin check, the request proceeds. The JSON body requirement provides some mitigation (see H7) but is not a complete defense.

**Fix direction:** Rename `src/proxy.ts` to `src/middleware.ts` and change `export async function proxy(...)` to `export default async function middleware(...)`.

---

### C2 — RLS Allows Any Authenticated User to Self-Escalate to Admin Role

**File:** `supabase/migrations/001_initial_schema.sql:135`  
**Severity:** CRITICAL  

**Finding:**  
```sql
CREATE POLICY "Users update own data" ON users FOR UPDATE USING (auth.uid() = id);
```

This policy has no `WITH CHECK` constraint. It permits any authenticated user to update **any column** on their own `users` row using the browser Supabase client (anon key + valid session). The `role` column has no separate write protection.

**Attack scenario:**
```javascript
// From browser, using anon key + authenticated session
const { data } = await supabase
  .from('users')
  .update({ role: 'admin' })
  .eq('id', supabase.auth.getUser().data.user.id)
// Returns success — user is now admin
```

Because `is_admin()` (used in ALL admin RLS policies) reads from `users.role`, the escalated user would pass every admin RLS check, gain full access to `providers`, `jobs`, `stripe_events`, `payout_log`, `provider_kyc_log`, and all admin API routes.

The API routes check `profile?.role !== 'admin'` using a server client call to `users`. Once the DB row is changed, the server-side check also passes.

**Fix direction:** Add `WITH CHECK (role = OLD.role OR is_admin())` to the UPDATE policy, or deny direct `role` column updates entirely and route role changes through admin-only service-role operations.

---

### C3 — RLS Allows Providers to Self-Activate and Self-Verify Without KYC

**File:** `supabase/migrations/001_initial_schema.sql:138`  
**Severity:** CRITICAL  

**Finding:**  
```sql
CREATE POLICY "Providers update own data" ON providers FOR UPDATE USING (auth.uid() = id);
```

No `WITH CHECK` constraint. Any provider using the browser Supabase client can update their own `providers` row to:
- Set `status = 'active'` — bypass the entire KYC review process
- Set `verified_badge = true` — fraudulently claim verification
- Set `rating = 5.0` — fake their rating
- Modify `plan`, `stripe_customer_id`, `jobs_this_month`, etc.

**Attack scenario:**
```javascript
await supabase.from('providers').update({ status: 'active', verified_badge: true }).eq('id', userId)
// Provider now appears as active and verified; can accept jobs, quote, and bypass all dispatch guards
```

All API routes check `provider.status !== 'active'` by reading from the DB. Once the row is mutated, these checks pass.

**Fix direction:** Remove write access to sensitive columns from the authenticated policy. Use `WITH CHECK` that prevents changes to `status`, `verified_badge`, `rating`, `plan`, and billing fields. Require all such changes to go through service-role API routes.

---

### C4 — Stripe Subscription Webhook Unconditionally Activates Providers, Bypassing KYC

**File:** `src/app/api/stripe/webhook/route.ts:472–476`  
**Severity:** CRITICAL  

**Finding:**
```typescript
const KYC_PROTECTED: string[] = ['under_review', 'rejected']
const resolveStripeStatus = (currentDbStatus: string | undefined) => {
  if (sub.status === 'active') return 'active'   // ← always wins
  if (sub.status === 'past_due') return 'suspended'
  if (currentDbStatus && KYC_PROTECTED.includes(currentDbStatus)) return currentDbStatus
  return 'pending'
}
```

When a Stripe subscription becomes `active`, the webhook unconditionally sets `providers.status = 'active'` regardless of the current KYC status. The `KYC_PROTECTED` guard only runs when `sub.status` is NOT `active` or `past_due`.

Additionally, `/api/stripe/create-checkout` (`route.ts:94–98`) does NOT check provider KYC status before creating a Stripe Checkout session. Any provider in `pending`, `under_review`, `rejected`, or `suspended` can reach Stripe and subscribe.

**Full attack path:**
1. Provider registers → status = `pending`
2. Provider calls `/api/stripe/create-checkout` with any plan → no status check, session created
3. Provider completes Stripe payment → `customer.subscription.created` fires with `status = active`
4. Webhook sets `providers.status = 'active'`
5. Provider is now fully active with zero document review

This completely defeats the KYC gate.

**Fix direction:** In `resolveStripeStatus`, add `KYC_PROTECTED` to the `active` branch check — if the current status is `under_review` or `rejected`, return the current status even when Stripe is active. Also add a status check in `create-checkout` route to block subscriptions from non-eligible providers.

---

### C5 — Fair Price Validation Disabled — Any Quote Amount Accepted at Production

**File:** `supabase/migrations/032_disable_range_estimator.sql`  
**Severity:** CRITICAL  

**Finding:**  
Migration 032 replaces the `submit_quote_atomic` RPC with a version that skips the entire `fair_price_config` price range check (steps 7–9 in the original). The comment reads: *"RANGE_ESTIMATOR_DISABLED — re-enable before soft launch."* Soft launch is already active and this is still disabled.

At production with real payments:
- A provider can quote **1 AED** for a tow job (fair price: ~150–450 AED) — selected by a customer thinking it's legitimate, then customer is bound to the job
- A provider can quote **50,000 AED** (the route-level maximum) for a flat tire change
- No database enforcement prevents predatory or extortionate pricing
- The route-level schema only validates `z.number().min(1).max(50000)` — no per-service-type constraints

**Fix direction:** Create migration 039 that reinstates the fair price range validation in `submit_quote_atomic` using the `fair_price_config` table. Decide whether to restore the original `price_too_low`/`price_too_high` rejection logic or replace with a configurable soft enforcement.

---

## HIGH FINDINGS

---

### H1 — Provider KYC Document Paths Returned to Customer After Quote Selection (Observation 2)

**Files:** `supabase/migrations/031_marketplace_v2_schema.sql:587–593`, `src/app/api/customer/quote/select/route.ts:96–104`  
**Severity:** HIGH  

**Finding:**  
`select_quote_atomic` returns `v_provider.documents` (the full JSONB blob), and the API route passes it to the customer response as `provider.documents`:

```typescript
return NextResponse.json({
  success: true,
  provider: {
    name: result.provider_name,
    phone: result.provider_phone,
    documents: result.provider_documents,  // KYC storage paths
    rating: result.provider_rating,
  },
})
```

The `documents` column contains paths like `{ "emirates_id_url": "<uuid>/emirates_id.jpg", "license_url": "<uuid>/license.pdf" }`. These paths:
1. Expose the provider's Supabase user UUID to the customer
2. Are never needed by the customer (they need name and phone only)
3. If bucket permissions are ever misconfigured, become direct download paths
4. Create a privacy concern under UAE data protection norms

**Fix direction:** Strip `documents` from the RPC return type or from the route response. Return only `name`, `phone`, and `rating` to the customer.

---

### H2 — Legacy Accept Endpoint Bypasses V2 Quote Flow for Open Requests (Observation 7)

**File:** `src/app/api/provider/requests/accept/route.ts`  
**Severity:** HIGH  

**Finding:**  
`POST /api/provider/requests/accept` remains fully functional and calls `accept_provider_request_atomic` which only accepts requests with `status = 'open'`. Any provider (with `status = active`, online, no active job) can first-accept any open request before any quotes are submitted, entirely bypassing the V2 competitive quote model.

The customer's stated expectation is to receive multiple quotes and choose. The legacy path denies them this choice on any request that is accepted before the first quote arrives. Since new requests start `open` (not `quoted`), there is always a window where legacy accept wins.

KYC, online status, and capacity checks are all still enforced by this route — the bypass is specifically of the V2 marketplace model, not the safety guards.

**Fix direction:** Restrict or remove the legacy accept endpoint. For production V2, block direct acceptance of `open` requests unless the flow comes from a PPJ/overage payment webhook. Alternatively, gate the route behind a feature flag.

---

### H3 — V2 Quote Selection Does Not Enforce Subscription Overage Limits

**Files:** `supabase/migrations/031_marketplace_v2_schema.sql:566–568`, `src/app/api/provider/jobs/quote/route.ts`  
**Severity:** HIGH  

**Finding:**  
`submit_quote_atomic` checks active job capacity (`capacity_full`) and daily quote count (`daily_limit_reached`) but does NOT check the provider's monthly job allowance against their plan limit.

`select_quote_atomic` increments `jobs_this_month` unconditionally:
```sql
UPDATE providers SET jobs_this_month = COALESCE(jobs_this_month, 0) + 1 WHERE id = v_provider_id;
```

There is no overage fee gate in the V2 path. A Starter plan provider (15 jobs/month) at 15/15 can submit quotes for additional jobs, have one selected, increment to 16 jobs, and never pay the 12 AED overage fee. This fee is only enforced in the legacy accept route (`/api/provider/requests/accept`), which most V2 providers never use.

**At production scale:** Platform loses all overage revenue for V2-selected jobs.

**Fix direction:** Add a monthly allowance check in `submit_quote_atomic` (or a pre-flight in the quote route) that blocks quote submission when `jobs_this_month >= plan_limit` (except business plan). Alternatively, gate `select_quote_atomic` on an overage payment for at-limit providers.

---

### H4 — Rate Limiting Falls Back to Process-Local In-Memory Map (Not Shared Across Instances)

**File:** `src/lib/rate-limit.ts:14`  
**Severity:** HIGH  

**Finding:**
```typescript
const buckets = new Map<string, RateLimitEntry>()
```

When Upstash Redis is unavailable (network error, missing env vars, cold start), rate limiting falls back to a `Map` in the current serverless function instance's memory. Vercel deploys each function invocation potentially in a separate process/container.

An attacker can bypass all rate limits by distributing requests across multiple Vercel edge nodes. The fallback is also silently triggered on any Redis failure — the `redisFallbackLogged` flag only logs the first fallback per instance, making incidents hard to detect.

Affected limits: quote submission (30/min), accept (60/60s), PPJ/overage checkout (10/hr), customer request creation (10/hr), document upload (5/hr), admin checkout (10/hr).

**Fix direction:** Ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured and monitored. Add alerting when Redis is unavailable. Consider making Redis a hard dependency for critical payment routes rather than silently falling back.

---

### H5 — KYC Status Update Not Rolled Back If Audit Log Insert Fails (Observation 6)

**File:** `src/app/api/admin/providers/update/route.ts:87–121`  
**Severity:** HIGH  

**Finding:**  
```typescript
const { error } = await admin.from('providers').update(updates).eq('id', ...)
// status is now changed in DB

if (parsed.data.status && parsed.data.status !== targetProvider.status) {
  const { error: logError } = await admin.from('provider_kyc_log').insert({...})
  if (logError) {
    logger.warn({...})  // logs warning, but status change is already committed
  }
}
```

The status update and the KYC log insert are two independent DB operations. If the log insert fails (DB contention, constraint violation, network timeout), the status change is permanently committed with no audit trail. Under UAE data-protection and financial-services compliance requirements, an audit gap on a KYC decision is a regulatory risk.

**Fix direction:** Wrap both operations in a Postgres transaction using an RPC, or perform the log insert FIRST and roll back if it fails, then update status.

---

### H6 — accept_provider_request_atomic Active Job Check Missing en_route and arrived States

**File:** `supabase/migrations/024_accept_rpc_overage_guard.sql:54–59`  
**Severity:** HIGH  

**Finding:**
```sql
SELECT id INTO v_active_request_id
FROM requests
WHERE accepted_by = p_provider_id
  AND status IN ('accepted', 'in_progress')   -- missing en_route, arrived
  AND id <> p_request_id
```

Migrations 029 added `en_route` and `arrived` as valid active job statuses. The RPC's active-job guard still only checks `accepted` and `in_progress`. The route-level preflight (`accept/route.ts:77`) correctly checks all 4 states. However, there is a TOCTOU window: if a provider's job transitions from `accepted` → `en_route` between the route preflight and the RPC execution, the RPC's active-job check would find no `accepted` job and allow a second accept.

This race is exploitable by a provider timing their state advance and a concurrent accept call. Result: provider has two simultaneously active jobs (violating plan limits and dispatch model).

**Fix direction:** Update `accept_provider_request_atomic` to check `status IN ('accepted', 'en_route', 'arrived', 'in_progress')`.

---

### H7 — CSRF Check Bypassed When Origin and Referer Headers Are Absent

**File:** `src/proxy.ts:50–54`  
**Severity:** HIGH (compounded by C1 if middleware isn't running)  

**Finding:**
```typescript
const origin = request.headers.get('origin')
const referer = request.headers.get('referer')
const requestOrigin = origin || (referer ? new URL(referer).origin : null)

if (requestOrigin && !ALLOWED_ORIGINS.some(...)) {  // null origin → entire check skipped
```

When both `origin` and `referer` are absent, `requestOrigin` is `null` and the CSRF block is never reached. Certain browser configurations, direct `curl` calls, server-to-server calls, and form-to-JSON attacks (where the browser doesn't send `origin`) can bypass this check entirely.

Additionally, `*.vercel.app` is in the implicit allow list:
```typescript
const isVercelPreview = requestOrigin.endsWith('.vercel.app')
if (requestOrigin !== requestHost && !isVercelPreview) { // .vercel.app always passes
```

Any attacker who deploys their own project to Vercel gets a `*.vercel.app` domain that passes the CSRF check.

**Fix direction:** If origin is null, apply stricter logic (e.g., require referer to match allowed domains, or reject if no origin for state-mutating requests). Remove the `.vercel.app` wildcard and enumerate specific preview domains instead.

---

## MEDIUM FINDINGS

---

### M1 — Admin API Routes Have No Rate Limiting

**Files:** `src/app/api/admin/providers/update/route.ts`, `src/app/api/admin/sentry-verify/route.ts`  
**Severity:** MEDIUM  

**Finding:**  
Neither admin route calls `checkRateLimitAsync`. A compromised admin account can make unlimited status changes to providers (mass activation, mass suspension), spam Sentry events, or exhaust DB connections without any throttle.

**Fix direction:** Add `checkRateLimitAsync` to all admin routes with a conservative limit (e.g., 30–60 requests/minute per admin).

---

### M2 — Provider-Controlled final_price Accepted for Legacy Job Completion (Observation 8)

**Files:** `src/app/api/provider/jobs/complete/route.ts:8–10`, `supabase/migrations/031_marketplace_v2_schema.sql:769–782`  
**Severity:** MEDIUM  

**Finding:**  
The completion API accepts `final_price: z.number().int().min(1).max(10000)` from the provider body. The RPC uses this as the third-priority fallback when `selected_quote_id IS NULL`. For any request processed through the legacy accept path (PPJ/overage webhooks, direct accept), there is no `selected_quote_id`, so the provider reports their own final price.

A provider completing a legacy job can report any price 1–10,000 AED as the `final_price` regardless of any verbal agreement with the customer. At production, this determines revenue accounting and customer receipts.

**Fix direction:** For legacy requests, store the price agreed-upon at acceptance time (in `request_locks` or a dedicated field) and use that as the authoritative completion price, not provider-supplied input.

---

### M3 — create-checkout Does Not Verify Provider KYC Status

**File:** `src/app/api/stripe/create-checkout/route.ts:84–98`  
**Severity:** MEDIUM (attack chain with C4)  

**Finding:**  
The checkout route checks `userRole.role === 'provider'` and finds the provider row, but does not check `provider.status`. This is the entry point for the C4 attack chain: any provider in any KYC status can purchase a subscription and get set to `active` via the webhook.

**Fix direction:** Add a status gate before creating the Stripe session: `if (provider.status === 'rejected' || provider.status === 'suspended') return 403`.

---

### M4 — Stripe Event Idempotency Claim Is Not Atomically Guaranteed

**File:** `src/app/api/stripe/webhook/route.ts:70–143`  
**Severity:** MEDIUM  

**Finding:**  
`claimStripeEvent` reads the existing row, checks its status, then writes. This read-modify-write is not wrapped in a database transaction or `FOR UPDATE` lock. Two concurrent Stripe retry deliveries for the same event could:
1. Both read `existing === null`
2. Both proceed to attempt INSERT
3. One INSERT fails with PK conflict → returns 500 → Stripe marks the delivery as failed and retries
4. The other handler continues processing

In practice, Stripe sends retries with a delay, reducing the concurrency window. But under slow DB response or stale-processing timeout (10 minutes), a second handler can re-claim and double-process subscription events, PPJ acceptance, or overage clearing.

**Fix direction:** Use `INSERT INTO stripe_events ... ON CONFLICT (id) DO UPDATE SET status = 'processing' WHERE stripe_events.status != 'processed' RETURNING *` as a single atomic claim operation. Check the returned row to determine if the claim succeeded.

---

### M5 — Commission Hardcoded to Zero — Revenue Model Broken at Production Flip

**File:** `supabase/migrations/031_marketplace_v2_schema.sql:795–796`  
**Severity:** MEDIUM  

**Finding:**
```sql
UPDATE jobs SET commission_rate = 0, commission_amount = 0 WHERE id = v_job_id;
```

`complete_provider_job_atomic` always zeros commission. There is no mechanism to enable platform commission without a new migration and changes to the completion RPC. At production, this means the platform collects zero commission revenue on every completed job.

**Fix direction:** Add commission calculation logic to the RPC using a configurable rate (from `providers.plan` or a `platform_config` table). This is a required migration 039 item before production.

---

### M6 — PPJ Distance Calculation Falls Back to 0 on Parse Failure

**File:** `src/app/api/provider/ppj-checkout/route.ts:145–158`  
**Severity:** MEDIUM  

**Finding:**
```typescript
} else {
  calculatedDistance = 0
  logger.warn({...})  // silently continues
}
```

If either the provider's GPS or the request's GPS coordinates fail to parse, `calculatedDistance = 0` and `feeAed = getPayPerJobFee(0)` (minimum fee). A provider at 50 km from the customer would pay the near-distance fee (30 AED) instead of the far-distance fee (70 AED) if location data is malformed. This is a silent revenue leak.

**Fix direction:** Return an error when GPS data cannot be parsed rather than silently using distance=0.

---

### M7 — Bearer Token Fallback Elevates XSS Impact

**File:** `src/lib/supabase/request-user.ts:27–36`  
**Severity:** MEDIUM  

**Finding:**  
`getRequestUser` accepts `Authorization: Bearer <token>` in addition to cookie sessions. If an XSS attack can exfiltrate a Supabase JWT from `localStorage` or JavaScript-accessible storage, that token can be used to call any API route directly without needing the `HttpOnly` session cookie.

This is standard Supabase behavior but increases the blast radius of any XSS from "read data" to "execute any authenticated API action."

**Fix direction:** Evaluate whether bearer token fallback is needed for current use cases. If only browser-based sessions are expected, consider disabling the bearer fallback and serving only cookie-authenticated sessions.

---

## LOW FINDINGS

---

### L1 — CSP Uses `unsafe-inline` for script-src

**File:** `next.config.ts:30–37`  
**Severity:** LOW  

**Finding:**  
`script-src 'unsafe-inline'` is present in the CSP, allowing all inline `<script>` blocks. This weakens XSS protection — any injected inline script would execute. The comment notes this is pending nonce/hash rollout.

**Fix direction:** Implement nonce-based CSP for production. Next.js supports nonces via `headers()` middleware integration.

---

### L2 — All Authenticated Users Can Read All Ratings Rows

**File:** `supabase/migrations/021_phase1c_rls_hardening.sql:36–38`  
**Severity:** LOW  

**Finding:**  
```sql
CREATE POLICY "Authenticated read ratings" ON ratings FOR SELECT TO authenticated USING (true);
```

Any authenticated user (customer or provider) can enumerate all rating rows including `comment` fields. If customers write comments containing personal details, these are readable by any provider on the platform.

**Fix direction:** Scope the read policy to own jobs (`customer_id = auth.uid()` or `provider_id = auth.uid()`) for detailed rows, and serve aggregate ratings via API routes only.

---

### L3 — Provider Anonymous ID Is First 4 Characters of UUID

**File:** `src/app/api/requests/quotes/route.ts:183`  
**Severity:** LOW  

**Finding:**
```typescript
const anonymousId = quote.provider_id.slice(0, 4).toUpperCase()
```

UUID v4 has a predictable character distribution. With multiple quotes visible to the same customer, a persistent attacker could partially fingerprint providers across requests.

**Fix direction:** Use `HMAC-SHA256(provider_id + request_id, server_secret).slice(0, 8)` as an opaque, per-request identifier.

---

### L4 — Webhook Stale-Processing Timeout Allows Double Execution

**File:** `src/app/api/stripe/webhook/route.ts:49`  
**Severity:** LOW  

**Finding:**  
`PROCESSING_TIMEOUT_MS = 10 * 60 * 1000` (10 minutes). A handler that takes longer than 10 minutes (DB congestion, Stripe API latency) would be re-claimed and reprocessed. For subscription events that set `providers.status`, double processing is idempotent. For PPJ acceptance, the RPC's `status = 'open'` guard provides protection against double-accept. Still, a shorter timeout (2–3 minutes) reduces the window.

**Fix direction:** Reduce to 2–3 minutes. Ensure all webhook handlers are idempotent and complete within Vercel's serverless function timeout.

---

### L5 — spatial_ref_sys RLS Disabled (Known, Cannot Be Fixed)

**File:** `supabase/migrations/037_rls_force_and_explicit_deny.sql:6–9`  
**Severity:** LOW (acknowledged)  

**Finding:**  
The `spatial_ref_sys` PostGIS system table has `rowsecurity=false` and cannot be altered. Migration 037 documents this. This is the root cause of Supabase's `rls_disabled_in_public` alert. It is not an application vulnerability — the table contains only PostGIS reference data.

**Fix direction:** Follow Supabase's recommended pattern of moving the PostGIS extension to the `extensions` schema to suppress the alert. No data risk.

---

## SOFT-LAUNCH → PRODUCTION SWITCH RISKS

These must be resolved or explicitly decided before switching to live Stripe payments and real traffic.

| # | Risk | Must-Do Before Go-Live |
|---|------|------------------------|
| SW1 | **Fair price validation disabled (C5)** | Migration 039 must re-enable `submit_quote_atomic` price range checks |
| SW2 | **Stripe webhook KYC bypass (C4)** | Fix `resolveStripeStatus` to protect all KYC states, not just `under_review`/`rejected` |
| SW3 | **Users/providers RLS UPDATE (C2, C3)** | Add `WITH CHECK` constraints; test that browser-client role/status updates are blocked |
| SW4 | **proxy.ts middleware registration (C1)** | Verify Next.js is actually calling the middleware; rename to `middleware.ts` with default export |
| SW5 | **Commission hardcoded to 0 (M5)** | Implement commission calculation in `complete_provider_job_atomic` before real revenue |
| SW6 | **V2 overage not collected (H3)** | Add monthly limit check to quote submission or `select_quote_atomic` |
| SW7 | **Legacy accept bypasses V2 (H2)** | Decide: remove endpoint, restrict to payment-webhook-only, or add V2 guard |
| SW8 | **Upstash Redis in production (H4)** | Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set; test fallback alerting |
| SW9 | **KYC document paths in customer response (H1)** | Strip `documents` from `select_quote_atomic` return / API route response |
| SW10 | **KYC log atomicity (H5)** | Wrap status update + log insert in one transaction |
| SW11 | **`NEXT_PUBLIC_SOFT_LAUNCH_MODE`** | Confirm this env var is `false` in production; audit all code paths gated by `SOFT_LAUNCH_MODE` |
| SW12 | **`NEXT_PUBLIC_LAUNCH_PROMO`** | Confirm promo flag state for production; verify it affects only descriptions, not amounts |
| SW13 | **`provider-documents` bucket privacy** | Confirm bucket is private in production Supabase project (cannot verify from source alone) |
| SW14 | **Stripe webhook endpoint** | Confirm Stripe dashboard webhook points to production URL, not staging |
| SW15 | **`*.vercel.app` CSRF allowlist (H7)** | Remove wildcard; enumerate only known production/preview domains |
| SW16 | **Admin rate limiting (M1)** | Add rate limits to all `/api/admin/*` routes before public launch |
| SW17 | **PPJ fee env vars** | Verify `NEXT_PUBLIC_PPJ_FEE_NEAR_AED`, `NEXT_PUBLIC_PPJ_FEE_FAR_AED`, `NEXT_PUBLIC_PPJ_DISTANCE_M` are set (default fallbacks are the old hardcoded values — acceptable only if intended) |
| SW18 | **No automated tests or CI** | Critical payment webhooks, RPC logic, and upload validation have no test coverage; regression risk at every future change |

---

## SUMMARY TABLE

| ID | Title | Severity | File(s) |
|----|-------|----------|---------|
| C1 | proxy.ts middleware not registered — CSRF/redirects not running | **CRITICAL** | `src/proxy.ts` |
| C2 | users RLS UPDATE allows self role escalation to admin | **CRITICAL** | `migrations/001_initial_schema.sql:135` |
| C3 | providers RLS UPDATE allows self KYC bypass | **CRITICAL** | `migrations/001_initial_schema.sql:138` |
| C4 | Stripe subscription webhook always activates provider, bypasses KYC | **CRITICAL** | `src/app/api/stripe/webhook/route.ts:472` |
| C5 | Fair price validation disabled — any quote 1–50000 AED accepted | **CRITICAL** | `migrations/032_disable_range_estimator.sql` |
| H1 | KYC document paths returned to customer in quote selection | **HIGH** | `migrations/031:587`, `customer/quote/select/route.ts:96` |
| H2 | Legacy accept endpoint bypasses V2 quote model | **HIGH** | `src/app/api/provider/requests/accept/route.ts` |
| H3 | V2 quote selection doesn't enforce subscription overage limits | **HIGH** | `migrations/031:566`, `provider/jobs/quote/route.ts` |
| H4 | Rate limiting in-memory fallback not shared across instances | **HIGH** | `src/lib/rate-limit.ts:14` |
| H5 | KYC status update not rolled back if audit log insert fails | **HIGH** | `src/app/api/admin/providers/update/route.ts:87–121` |
| H6 | accept RPC active job check misses en_route/arrived states | **HIGH** | `migrations/024_accept_rpc_overage_guard.sql:54` |
| H7 | CSRF check bypassed on null origin; *.vercel.app wildcard allowed | **HIGH** | `src/proxy.ts:50–73` |
| M1 | Admin API routes have no rate limiting | **MEDIUM** | `api/admin/providers/update`, `api/admin/sentry-verify` |
| M2 | Provider-controlled final_price accepted for legacy completions | **MEDIUM** | `api/provider/jobs/complete/route.ts`, `migrations/031:769` |
| M3 | create-checkout does not check provider KYC status | **MEDIUM** | `api/stripe/create-checkout/route.ts:94` |
| M4 | Stripe event claim is not database-atomic (TOCTOU) | **MEDIUM** | `api/stripe/webhook/route.ts:70–143` |
| M5 | Commission hardcoded to zero — platform earns no revenue at completion | **MEDIUM** | `migrations/031_marketplace_v2_schema.sql:795` |
| M6 | PPJ distance silently falls back to 0 on GPS parse failure | **MEDIUM** | `api/provider/ppj-checkout/route.ts:145` |
| M7 | Bearer token fallback elevates XSS impact | **MEDIUM** | `src/lib/supabase/request-user.ts:27` |
| L1 | CSP uses unsafe-inline for script-src | **LOW** | `next.config.ts:30` |
| L2 | All authenticated users can read all ratings rows | **LOW** | `migrations/021:36` |
| L3 | Provider anonymous ID is weak (first 4 chars of UUID) | **LOW** | `api/requests/quotes/route.ts:183` |
| L4 | Webhook stale-processing timeout too long (10 min) | **LOW** | `api/stripe/webhook/route.ts:49` |
| L5 | spatial_ref_sys RLS disabled (PostGIS, acknowledged) | **LOW** | `migrations/037` |

---

*End of Security Audit Part 1. No source files were modified. All findings are for review only.*
