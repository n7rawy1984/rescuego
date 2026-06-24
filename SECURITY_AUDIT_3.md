# SECURITY AUDIT PART 3 — Stripe, Billing, Webhooks, Financial Integrity

**Date:** 2026-06-23
**Auditor:** Claude Sonnet 4.6 (automated, full source read)
**Scope:** Stripe checkout, PPJ, overage, subscription lifecycle, webhook handling, commission, financial data integrity, production readiness
**Baseline:** Full Production — Stripe LIVE, real money, adversarial providers, replay attacks, race conditions
**Part 1 / Part 2 policy:** Findings from prior audits are not re-reported unless they create a NEW financial exploit chain or extend to a new path verified in this run. When a Part 1/2 prerequisite is needed for a chain, its confirmation status is explicitly stated.

---

## Executive Summary

The financial layer has one high-quality defense — an atomic accept RPC with `FOR UPDATE` locks and an overage guard that prevents the most obvious duplicate-accept race. However, three new financial vulnerabilities were found in this audit. The most severe are: (1) no compensation mechanism for failed overage accepts, leaving providers who pay 12 AED but lose the race with no refund or credit; (2) the `overage_cleared` flag not being cleared by `release_job_atomic`, enabling a subsequent at-limit provider to accept a released request without paying the overage fee; and (3) subscription plan resolution silently failing when Stripe price ID environment variables are absent, activating providers with wrong plan limits. The KYC bypass via Stripe subscription (Part 1 C4) is re-verified from source: `KYC_PROTECTED` covers only `['under_review', 'rejected']`, confirming that `pending` and `suspended` providers can pay their way to `active` status. At production scale with real money, the overage findings (F3-H1 and F3-H2) are the most immediately impactful: they represent revenue loss, incorrect billing state, and a path to free service.

---

## Files Read

**Documentation (8 files):**
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `MARKETPLACE_V2_SPEC.md`
- `PROJECT_HANDOFF.md`
- `SECURITY_AUDIT_1.md`
- `SECURITY_AUDIT_2.md`
- `ROADMAP.md` — **not found**
- `SESSION_LOG.md` — **not found**

**API Routes (9 files):**
- `src/app/api/stripe/create-checkout/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/provider/ppj-checkout/route.ts`
- `src/app/api/provider/overage-checkout/route.ts`
- `src/app/api/provider/requests/accept/route.ts`
- `src/app/api/provider/jobs/complete/route.ts`
- `src/app/api/customer/quote/select/route.ts`
- `src/app/api/ops/monthly-allowance-reset/route.ts`
- `src/app/api/provider/billing-portal/route.ts` — **not found** (billing portal is embedded in create-checkout route)

**Lib files (4 files):**
- `src/lib/stripe.ts`
- `src/lib/provider-allowance.ts`
- `src/lib/utils.ts`
- `src/lib/env.ts`

**Types (2 files):**
- `src/types/database.ts`
- `src/types/index.ts`

**Migrations (7 files):**
- `supabase/migrations/005_ppj_payments.sql`
- `supabase/migrations/006_billing_stability.sql`
- `supabase/migrations/008_upgrade_job_credits.sql`
- `supabase/migrations/012_ppj_cancelled_payment_protection.sql`
- `supabase/migrations/015_ppj_credit_accept_complete_job_fix.sql`
- `supabase/migrations/024_accept_rpc_overage_guard.sql`
- `supabase/migrations/028_stuck_job_auto_release.sql`
- `supabase/migrations/031_marketplace_v2_schema.sql`
- `supabase/migrations/032_disable_range_estimator.sql`

---

## Critical Findings

---

### F3-C1 — Stripe Subscription Activates `pending` and `suspended` Providers (RE-VERIFIED, Part 1 C4 — New Path Confirmed)

- **Severity:** Critical (re-verified)
- **File:** `src/app/api/stripe/webhook/route.ts:472–478`
- **Re-verified from source in this run:** Yes

**Finding:**

```typescript
const KYC_PROTECTED: string[] = ['under_review', 'rejected']
const resolveStripeStatus = (currentDbStatus: string | undefined) => {
  if (sub.status === 'active') return 'active'   // always wins for active subscription
  if (sub.status === 'past_due') return 'suspended'
  if (currentDbStatus && KYC_PROTECTED.includes(currentDbStatus)) return currentDbStatus
  return 'pending'
}
```

`KYC_PROTECTED` covers only `['under_review', 'rejected']`. When `sub.status === 'active'`, the first branch always returns `'active'` without consulting `currentDbStatus`. A provider in `pending` (no documents submitted) or `suspended` (admin-revoked) status can purchase a subscription and the webhook sets their status to `active`.

Additionally, the `create-checkout` route (`route.ts:94–98`) selects only `stripe_customer_id, stripe_subscription_id, users(email, name)` — the `status` field is not in the query and no status check exists. Any provider regardless of KYC state can initiate checkout.

**Attack path (confirmed):**
1. Provider registers → `status = 'pending'`
2. `POST /api/stripe/create-checkout` — no KYC check, checkout session created
3. Provider pays Stripe → `customer.subscription.created` fires
4. Webhook: `resolveStripeStatus('pending')` → `sub.status === 'active'` returns `'active'` immediately, `'pending'` never reaches `KYC_PROTECTED`
5. `providers.status = 'active'` — zero document review

The same path works for `suspended` providers.

**Fix direction:** Add `'pending'` and `'suspended'` to `KYC_PROTECTED`. Also add `provider.status` to the checkout query and return 403 for rejected/suspended providers.

---

## High Findings

---

### F3-H1 — No Recovery Mechanism for Failed Overage Accepts — Provider Charged, No Job Assigned

- **Severity:** High
- **File:** `src/app/api/stripe/webhook/route.ts:351–383`
- **Line reference:** webhook.ts:358–380
- **NEW finding in Part 3**

**Finding:**

When `payment_intent.succeeded` fires for an overage payment, the handler:
1. Marks `overage_payments` row as `paid` (line 353–356)
2. Sets `requests.overage_cleared = true` (line 358–363) — **unconditionally, before the accept**
3. Calls `finalizeAcceptedRequest` (line 365)
4. If the accept fails (request already taken by another provider in a race):

```typescript
} else {
  logger.warn({
    event: 'overage_payment_request_already_taken',
    ...
  })
  // No recovery credit, no refund initiation, no compensation
}
```

Compare with PPJ, which calls `protectCancelledPaidPpjRequest` when the accept fails (webhook.ts:340). No equivalent exists for overage. The provider loses 12 AED with no automated compensation path.

**Scenario:**
1. Provider A (at monthly limit) initiates overage checkout for Request X
2. Provider B accepts Request X via legacy accept (races with A's payment confirmation)
3. Provider A's payment confirms → webhook marks payment `paid`, sets `overage_cleared = true`, accept fails
4. Warning logged, nothing more — Provider A is down 12 AED

**Financial impact:** Platform charges the provider for a service they did not receive. No automated refund, no job credit. Requires manual intervention per incident.

**Additional consequence:** `requests.overage_cleared = true` is set even though the accept failed. This corrupts the flag for subsequent events (see F3-H2).

**Fix direction:** Implement `restore_overage_credit_for_failed_accept` analogous to `restore_ppj_credit_for_cancelled_paid_request`. On accept failure, increment a `overage_recovery_credits` counter (requires schema addition) or log a refund task. Set `overage_cleared = true` only after a successful accept.

---

### F3-H2 — `overage_cleared` Not Cleared on Job Release — Free Overage Accept for Next Provider

- **Severity:** High
- **Files:** `supabase/migrations/028_stuck_job_auto_release.sql:48–54`, `src/app/api/provider/requests/accept/route.ts:116–143`
- **NEW finding in Part 3**

**Finding:**

`release_job_atomic` (migration 028, lines 48–54) resets a released request to `open`:
```sql
UPDATE requests
SET status = 'open',
    accepted_by = NULL
WHERE id = p_request_id
  AND accepted_by = p_provider_id
  AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')
```

`overage_cleared` is **not reset**. Similarly, `expire_stuck_active_requests` (migration 028, lines 110–112) also resets to `open` without clearing `overage_cleared`.

The legacy accept route's overage guard (`accept/route.ts:116–143`) uses `overage_cleared = true` to bypass the overage fee requirement:
```typescript
if (!overageCleared?.overage_cleared) {
  return NextResponse.json({ ..., code: 'OVERAGE_REQUIRED' }, { status: 402 })
}
// if overage_cleared = true: proceeds without payment
```

**Full exploit chain:**
1. Provider A (at monthly limit) pays 12 AED overage for Request X → `overage_cleared = true`, accept succeeds
2. Provider A abandons the job (advances to `en_route`, then disappears)
3. Weekly cron `expire_stuck_active_requests` releases Request X → `status = 'open'`, `accepted_by = NULL`, but `overage_cleared = true` **persists**
4. Provider B (also at monthly limit) calls `POST /api/provider/requests/accept` for Request X
5. Overage guard reads `overage_cleared = true` → bypasses the 12 AED overage fee requirement
6. `accept_provider_request_atomic` called with `p_plan_limit = -1` (bypasses DB-level overage check too)
7. Provider B accepts Request X without paying

**Financial impact:** Platform loses one overage fee (12 AED) per released-and-re-accepted request. At scale with multiple providers and monthly job limits, this is a systematic revenue leak.

**Exploitability:** Medium — an adversarial provider who knows the `overage_cleared` state could deliberately trigger this. More realistically it happens accidentally. The CRIT-02 finding from Part 2 (SLA auto-release missing for en_route/arrived) increases the frequency of the release step in this chain.

**Fix direction:** Add `overage_cleared = FALSE` to the `UPDATE requests SET ...` in both `release_job_atomic` and `expire_stuck_active_requests`. Also add to `sla_check_and_release`.

---

## Medium Findings

---

### F3-M1 — Subscription Plan Silently Unresolved When Stripe Price ID Env Vars Missing

- **Severity:** Medium
- **File:** `src/app/api/stripe/webhook/route.ts:53–58, 501–512`

**Finding:**

`PLAN_BY_PRICE_ID` is built at module load:
```typescript
const PLAN_BY_PRICE_ID = new Map<string, SubscriptionPlan>(
  [
    [process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, 'starter'],
    [process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, 'pro'],
    [process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID, 'business'],
  ].filter((entry): entry is [string, SubscriptionPlan] => Boolean(entry[0]))
)
```

If any price ID env var is unset, the filter removes that entry. If all are unset, `PLAN_BY_PRICE_ID.size = 0`. When a subscription event arrives, `resolveSubscriptionPlan` falls through to metadata:
```typescript
const metadataPlan = subscription.metadata?.plan  // set at checkout time
```

If metadata is also absent (e.g., subscription created outside the app's checkout flow), `resolvedPlan.plan = null`.

The update payload then omits `plan`:
```typescript
if (resolvedPlan.plan) {
  updatePayload.plan = resolvedPlan.plan
} else {
  logger.warn({ event: 'stripe_subscription_plan_unresolved', ... })
  // plan field NOT set in updatePayload
}
```

The provider is still set to `active` (F3-C1) and `stripe_subscription_id` is stored, but `providers.plan` is not updated. A newly subscribing provider with `plan = 'pay_per_job'` would be activated but remain on `pay_per_job`, with no monthly allowance tracking and no overage fee enforcement. A provider with any plan would keep their old plan regardless of what they paid for.

**Financial impact:** Provider may pay for a Pro subscription but have Starter limits (or vice versa), or have no monthly tracking at all. This is a misconfiguration risk that silently corrupts billing state.

**Fix direction:** If `resolvedPlan.plan` is null and the subscription is `active`, treat this as a hard error: mark the Stripe event `failed`, alert on monitoring. Do not silently activate with wrong plan. Add env var presence validation at server startup (already partially done in `validateEnv()` but Stripe price IDs are not in `SERVER_REQUIRED_ENVS`).

---

### F3-M2 — Stripe Event Claim Is Non-Atomic (TOCTOU) — RE-VERIFIED from Part 1 M4

- **Severity:** Medium (re-verified)
- **File:** `src/app/api/stripe/webhook/route.ts:70–143`
- **Re-verified:** Yes — read-then-write pattern confirmed at lines 74–129

**New detail confirmed in this run:** The `PROCESSING_TIMEOUT_MS = 10 * 60 * 1000` (line 49) means a stale handler can be re-claimed after 10 minutes. For subscription events that increment `job_credit_balance` (upgrade credits), if the first handler crashes mid-execution and the event is re-claimed after 10 minutes, it could re-apply upgrade credits if `last_upgrade_bonus_key` was not written before the crash.

The credit application (lines 531–545) is:
1. Read `existingProvider.last_upgrade_bonus_key`
2. Compute new credit balance
3. Write both in `updatePayload` to the DB

If the handler crashes between steps 2 and 3, credits are not applied. A re-claim after 10 minutes re-reads the key (null), re-applies credits, and writes — correctly. This is idempotent recovery, which is good. However, if the crash happens **after** the `providers.update` (step 3) but before `setStripeEventStatus('processed')`, the re-claim after 10 minutes would apply credits again, since it reads `last_upgrade_bonus_key` as set but `existing.status = 'processing'` (stale timeout).

**Fix direction (from Part 1):** Use `INSERT INTO stripe_events ON CONFLICT DO UPDATE SET status = 'processing' WHERE status != 'processed' RETURNING *` as a single atomic claim. The `last_upgrade_bonus_key` idempotency guard provides a secondary defense for credit doubling.

---

### F3-M3 — Billing Portal Opened for Rejected and Suspended Providers

- **Severity:** Medium
- **File:** `src/app/api/stripe/create-checkout/route.ts:140–165`

**Finding:**

When `provider.stripe_subscription_id` is non-null, the route always creates a billing portal session regardless of provider status. No `status` field is fetched from `providers` (the query at line 96 only selects `stripe_customer_id`, `stripe_subscription_id`, `users(email, name)`).

A `rejected` or `suspended` provider with an existing subscription can:
1. Call `POST /api/stripe/create-checkout` with any valid plan
2. Receive a billing portal URL
3. Upgrade their plan in Stripe

The upgrade triggers `customer.subscription.updated`. The KYC_PROTECTED guard (F3-C1) would prevent a `rejected` provider from being re-activated via upgrade, but a `suspended` provider can be re-activated (since `suspended` is not in `KYC_PROTECTED`).

**Financial impact:** Suspended providers can actively manage their subscription and trigger re-activation via plan upgrades.

**Fix direction:** Add `status` to the providers query in `create-checkout`. Return 403 for `rejected` and `suspended` providers. Only `pending` and `under_review` providers should potentially be allowed to subscribe (and the webhook should be fixed to not activate them).

---

## Low Findings

---

### F3-L1 — `payment_intent.canceled` Not Handled — Canceled PPJ Intents Stay `pending` Forever

- **Severity:** Low
- **File:** `src/app/api/stripe/webhook/route.ts:236–247`

**Finding:**

The handled event type list does not include `payment_intent.canceled`. If a PPJ PaymentIntent is canceled (by Stripe after decline timeout, by admin via dashboard, or by card dispute resolution), the corresponding `ppj_payments` row retains `status = 'pending'` indefinitely.

A provider's PPJ payment history would show a ghost pending payment that never resolves. The upsert in `ppj-checkout/route.ts:259–269` has `onConflict: 'provider_id,request_id'` — a new checkout attempt overwrites the record. But if no new checkout is created, the stale pending record persists.

**Financial impact:** Financial records are inaccurate. Billing dashboards show phantom pending payments.

**Fix direction:** Handle `payment_intent.canceled`: update matching `ppj_payments` and `overage_payments` rows to `status = 'failed'`.

---

### F3-L2 — Monthly Allowance Reset Zeroes `job_credit_balance` — Mid-Cycle Upgrade Credits Lost

- **Severity:** Low
- **File:** `src/app/api/ops/monthly-allowance-reset/route.ts:50–53`

**Finding:**

```typescript
let updateQuery = supabase
  .from('providers')
  .update({
    jobs_this_month: 0,
    job_credit_balance: 0,     // zeroes upgrade credits unconditionally
    jobs_reset_at: provider.stripe_current_period_start,
  })
```

`job_credit_balance` is set to 0 on every monthly reset. If a provider upgraded from Starter to Pro mid-cycle, the webhook applies a credit bonus equal to the old plan's monthly allowance (`oldAllowance = 15`). When the billing period rolls over and the reset cron fires, this bonus is zeroed before the provider can use it.

**Example:** Provider upgrades Starter→Pro on day 25 of a 30-day cycle. Credits = 15 applied. Reset cron fires on day 30 (new period). Credits zeroed. Provider expected carry-over credits but receives none.

**Fix direction:** Business decision — document this behavior explicitly. If credits should carry over, exclude `job_credit_balance` from the reset. If credits are period-specific, document they expire at period end.

---

### F3-L3 — Commission Calculation Function Defined But Never Invoked

- **Severity:** Low
- **File:** `src/lib/utils.ts:52–63`, `supabase/migrations/031_marketplace_v2_schema.sql:795–796`

**Finding (re-verified from Part 1 M5):**

`calculateCommission()` in `utils.ts` correctly computes commission rates per plan:
```typescript
export function calculateCommission(jobValueAed: number, plan: ProviderPlan): number {
  if (jobValueAed <= PREMIUM_JOB_THRESHOLD_AED) return 0
  const rates: Partial<Record<ProviderPlan, number>> = {
    starter: 0.15,
    pro: 0.10,
    business: 0,
  }
  ...
}
```

The `complete_provider_job_atomic` RPC (migration 031, lines 795–796) always writes `commission_rate = 0, commission_amount = 0`. The function is never called anywhere in the API routes.

The rates also exist in `SUBSCRIPTION_PLANS` (`premium_commission_pct: 15/10/0`).

**Financial impact:** Platform earns zero commission on all completed jobs. At production scale with real jobs, this is a significant and ongoing revenue loss.

**Fix direction:** Implement commission in `complete_provider_job_atomic`: read provider plan, compute commission from `calculateCommission()` equivalent, record non-zero values. Requires migration 039.

---

### F3-L4 — `business` Plan Provider `jobs_this_month` Never Resets

- **Severity:** Low
- **File:** `src/app/api/ops/monthly-allowance-reset/route.ts:18–25`

**Finding:**

`shouldResetProvider` returns false for business plan:
```typescript
if (provider.plan !== 'starter' && provider.plan !== 'pro') return false
```

Business providers are unlimited — `jobs_this_month` has no impact on their eligibility. However, the counter grows indefinitely. Over years, the counter for a high-volume business provider could become unreliable for analytics.

Additionally, `select_quote_atomic` unconditionally increments `jobs_this_month` for business providers too (migration 031, line 568). Since it never resets, the monthly job scoring (`computeProviderScore` uses `jobs_this_month` as `completedJobs`) always shows business providers with maximum monthly counts after their first month. This compounds MED-02 from Part 2.

**Fix direction:** Include business plan in monthly reset. It's harmless to reset business to 0 since it doesn't affect eligibility.

---

### F3-L5 — Stale Payment Intent Reuse Returns Old Fee on Promo Toggle

- **Severity:** Low
- **File:** `src/app/api/provider/ppj-checkout/route.ts:210–221`

**Finding:**

When a pending PPJ checkout is resumed:
```typescript
if (existing?.stripe_payment_intent_id && existing.status === 'pending') {
  const paymentIntent = await stripe.paymentIntents.retrieve(...)
  if (paymentIntent.status !== 'canceled' && paymentIntent.client_secret) {
    return NextResponse.json({ client_secret: paymentIntent.client_secret, fee_aed: existing.fee_aed })
  }
}
```

`existing.fee_aed` is the fee from when the PaymentIntent was created. If `LAUNCH_PROMO` or `NEXT_PUBLIC_PPJ_FEE_NEAR_AED` changes between the first checkout and the resume, the provider pays the old fee. In most cases this is harmless (old rate ≈ new rate), but if a promo ends, a provider who started checkout during the promo might pay the old lower promo rate.

**Fix direction:** Accept this as a business trade-off (provider started checkout at promo rate, should be honored). Document the behavior. Alternatively, cancel and recreate the PaymentIntent if the fee differs.

---

## Needs Verification

### NV-1 — `NEXT_PUBLIC_SOFT_LAUNCH_MODE` in Production

`SOFT_LAUNCH_MODE` only affects `is_soft_launch` logging in the dispatch log (confirmed: `submit_quote_atomic` uses it only for the log insert). It does NOT bypass PPJ fees, Stripe charges, or any payment. `LAUNCH_PROMO` is separate and does affect PPJ fee amount.

Verify `NEXT_PUBLIC_LAUNCH_PROMO = false` in Vercel production. If true, PPJ fees are reduced to `PAY_PER_JOB_PROMO_FEE_AED` (default 15 AED) instead of 30–70 AED. Source cannot confirm production env var values.

### NV-2 — Stripe Webhook Endpoint Points to Production URL

Cannot verify from source whether the Stripe dashboard webhook endpoint is configured for the production Vercel URL or a staging/preview URL. A misconfigured endpoint means production payments never trigger state changes.

### NV-3 — Stripe Price ID Env Vars Set in Production

`NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID`, `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` are not in `SERVER_REQUIRED_ENVS` in `env.ts`. They fall through to `validateEnv()` only if explicitly added. If unset, plan resolution silently fails (F3-M1). Confirm all three are set in Vercel production.

### NV-4 — Stripe Test Mode vs Live Mode in Production

`event.livemode` is logged at webhook.ts:679 but never checked. In development with a test Stripe account, `livemode = false`. If a test webhook secret is accidentally used in production, `stripe.webhooks.constructEvent` would verify test events as valid, and test subscription events could activate real providers.

Verify: production Vercel uses `STRIPE_SECRET_KEY` starting with `sk_live_` and `STRIPE_WEBHOOK_SECRET` for the live webhook endpoint.

### NV-5 — Billing Portal Configuration

The billing portal (Stripe dashboard setting) must be configured to allow the desired operations (cancellation, plan changes, payment method updates). If the portal allows plan downgrades to `pay_per_job` (not a Stripe subscription plan), the webhook handles this via subscription deletion → `suspended + pay_per_job`. Cannot verify portal configuration from source.

---

## Business Decisions

### BD-1 — Overage Fee Hardcoded at 12 AED

`OVERAGE_FEE_AED = 12` is hardcoded in `src/types/index.ts:63`, not env-controlled. A price change requires a code deploy. Unlike PPJ fees (which have `NEXT_PUBLIC_PPJ_FEE_NEAR_AED` env vars), overage has no runtime configuration.

### BD-2 — No Automated Refund for PPJ "Request Already Taken" Race

When a PPJ payment succeeds but the request is already taken by another provider (not via customer cancellation), `protectCancelledPaidPpjRequest` is called but returns `'request_not_customer_cancelled'` (since the request is `accepted`, not `cancelled`). The provider loses their PPJ fee. This is logged as `ppj_payment_request_already_taken` but no automated recovery occurs. Manual refund required per incident.

### BD-3 — Commission at Zero for Current Phase

`complete_provider_job_atomic` always sets `commission_rate = 0, commission_amount = 0` (migration 031, lines 795–796). This is confirmed intentional for the current launch phase. The `calculateCommission()` function is ready for activation. Must be enabled before full production revenue depends on commission income.

### BD-4 — Subscription `canceled` in Updated Event vs Dedicated Deleted Event

The webhook handles `customer.subscription.updated` with `sub.status = 'canceled'` by setting the provider to `suspended + pay_per_job` (lines 452–469), AND handles `customer.subscription.deleted` separately (lines 578–596) with the same effect. Both paths produce the same result — idempotent on cancellation, correct behavior.

---

## Financial Exploit Chains

---

### FEC-1 — Overage Cleared + Job Released = Free Overage Accept (HIGH)

**Severity:** HIGH  
**Components:** F3-H1, F3-H2, Part 2 CRIT-02  
**Part 1/2 dependency:** CRIT-02 (SLA auto-release missing for `en_route`/`arrived`) increases the occurrence frequency but is not required for the chain.

**Full chain:**
1. Provider A (Starter plan, `jobs_this_month = 15/15`) pays 12 AED overage for Request X
2. Webhook fires: `overage_payments(A, X).status = 'paid'`, `requests.overage_cleared = true`, accept succeeds
3. Provider A advances job to `en_route` (exploiting CRIT-02 from Part 2 to avoid SLA auto-release), then abandons
4. Admin or Provider A manually calls `POST /api/provider/jobs/release` → `release_job_atomic` fires
5. Request X: `status = 'open'`, `accepted_by = NULL`, `overage_cleared = TRUE` (unchanged)
6. Provider B (Pro plan, `jobs_this_month = 35/35`) calls `POST /api/provider/requests/accept` for Request X
7. Legacy accept route reads `overage_cleared = true` → skips 402 overage payment requirement
8. `planLimit = -1` passed to `accept_provider_request_atomic` (line 158–159 of accept/route.ts)
9. Provider B accepts Request X without paying — platform loses 12 AED overage revenue

**Required conditions:** Provider knows or finds a released request. Provider B is at their monthly limit. Both use the legacy accept path (not V2 quote path).

**Revenue impact:** 12 AED per released overage-cleared request. At scale, this is a systematic leak.

---

### FEC-2 — Overage Payment Fails to Accept → Money Taken, No Service, No Recovery (MEDIUM)

**Severity:** MEDIUM  
**Component:** F3-H1

**Chain:**
1. Provider A initiates overage checkout for Request X → PaymentIntent PI_A created
2. Provider B (PPJ) concurrently accepts Request X via legacy accept → Request X becomes `accepted`
3. PI_A payment confirms → Stripe fires `payment_intent.succeeded`
4. Webhook: marks `overage_payments(A, X).status = 'paid'` (12 AED charged)
5. `requests.overage_cleared = true` set (on an already-accepted request — harmless, request won't be accepted again in this state)
6. `finalizeAcceptedRequest(A, X)` → returns false (`status = 'accepted'`, not `open`)
7. Warning logged, no recovery

**Result:** Provider A is charged 12 AED, Provider B got the job for free (PPJ fee). No automated recovery for Provider A.

**Note:** This is not an active exploit by an adversary — it's a platform failure mode. No adversarial actor needed; the race can happen under normal traffic.

---

### FEC-3 — KYC Bypass → Free Platform Activation → Unverified Provider Activity (CRITICAL)

**Severity:** CRITICAL  
**Components:** F3-C1 (re-verified), Part 1 C4, Part 1 M3  
**Dependency:** Part 1 C4 required, re-verified in this run

**Chain:**
1. Provider registers (no documents) → `status = 'pending'`
2. `POST /api/stripe/create-checkout` — no status check, checkout session created (M3/F3-C1)
3. Provider pays Starter subscription (149–249 AED/month)
4. `customer.subscription.created` fires → `resolveStripeStatus('pending')` → `sub.status === 'active'` → returns `'active'`
5. Provider is fully active with no KYC review
6. Provider accepts jobs, earns income
7. Platform earns zero commission (commission hardcoded to 0 — BD-3)
8. No identity verification, no document check

**Financial impact:** Platform revenue depends on providers being legitimate. Unverified providers create customer risk. Zero commission in current phase means no financial gate.

---

## Financial Data Integrity Risks

1. **`overage_cleared` flag persists after job release (F3-H2):** Counter to platform's intended billing model. Each released request can enable a free overage accept for the next provider.

2. **`overage_payments` missing recovery mechanism (F3-H1):** For every race-condition overage failure, a `paid` record exists in the DB with no corresponding accepted job. Records are financially correct (money was taken) but operationally incomplete.

3. **`ppj_payments` ghost pending records (F3-L1):** Canceled payment intents leave `status = 'pending'` rows indefinitely. Dashboard totals for pending PPJ revenue are inflated.

4. **`job_credit_balance` zeroed on monthly reset (F3-L2):** Upgrade credits that were not consumed within the billing period are silently discarded. Providers are billed for an upgrade but the associated credits can be lost.

5. **Plan not updated when price IDs unresolved (F3-M1):** `providers.plan` is not atomically linked to `stripe_subscription_id`. Out-of-sync state is possible if env vars change between the checkout and webhook processing.

6. **Commission always zero (F3-L3 / BD-3):** `jobs.commission_rate = 0` and `jobs.commission_amount = 0` for all completed jobs. Financial reporting based on commission data shows zero revenue from commissions, which is accurate but represents an unfulfilled business model.

---

## Stripe Webhook Event Flow Review

| Event Type | Handler | Key Operations | Gaps |
|---|---|---|---|
| `customer.subscription.created` | Full | Sets status/plan/period, upgrade credits | `KYC_PROTECTED` misses `pending`/`suspended` (F3-C1) |
| `customer.subscription.updated` | Full | Same as created | Same KYC bypass |
| `customer.subscription.deleted` | Full | suspended + pay_per_job | None found |
| `invoice.payment_failed` | Partial | Sets provider suspended | Customer type cast (theoretical) |
| `payment_intent.succeeded` | Full | PPJ accept, overage accept | No overage recovery on accept fail (F3-H1) |
| `payment_intent.payment_failed` | Full | Marks ppj/overage as failed | OK |
| `payment_intent.canceled` | **NOT HANDLED** | None | Ghost pending records (F3-L1) |
| `payout.created` / `payout.paid` | Full | Upserts payout_log | None found |
| `checkout.session.completed` | Log only | Observability only | OK (subscription events handle activation) |
| `invoice.payment_succeeded` | **NOT HANDLED** | None | OK — handled via subscription.updated |
| `customer.subscription.paused` | **NOT HANDLED** | None | Provider not suspended on pause |

**Idempotency:** Read-then-write claim (non-atomic, Part 1 M4 re-verified). 10-minute stale window. For subscription events with upgrade credits, double application is partially mitigated by `last_upgrade_bonus_key` but not for the stale-timeout re-claim path.

**Signature verification:** Raw body read (`req.text()`), `stripe.webhooks.constructEvent` — correctly implemented. `requireEnv('STRIPE_WEBHOOK_SECRET')` throws if missing — availability risk but not a security gap.

**Livemode check:** Event `livemode` field is logged but never enforced. In production, a test-mode webhook secret would fail signature verification (secrets are mode-specific). NV-4 notes this.

---

## Subscription Lifecycle Review

| Status Change | Source | Correct? | Gaps |
|---|---|---|---|
| `pending` → `active` via subscription | webhook.ts:474 | No — KYC bypassed | F3-C1 |
| `active` → `suspended` via past_due | webhook.ts:475 | Yes | — |
| `active` → `suspended` via invoice fail | webhook.ts:604 | Yes | — |
| `active` → `suspended+ppj` via deletion | webhook.ts:583 | Yes | — |
| `suspended` → `active` via new subscription | webhook.ts:474 | No — bypasses admin suspension | F3-C1 |
| `under_review` → preserved via subscription | webhook.ts:476 | Yes | — |
| `rejected` → preserved via subscription | webhook.ts:476 | Yes | — |
| Plan downgrade credit zeroing | webhook.ts:547–549 | Intentional | BD-4 |
| Upgrade credits | webhook.ts:531–545 | Partially atomic | F3-M2 edge case |

**Monthly reset (allowance cron):**
- Only runs for `starter` and `pro` plans with active subscriptions
- Optimistic locking prevents double-reset (per period key)
- `job_credit_balance` zeroed on reset — mid-cycle credits lost (F3-L2)
- `business` providers never reset (F3-L4)

---

## PPJ Flow Review

| Check | Location | Status |
|---|---|---|
| Provider is `pay_per_job` plan | ppj-checkout.ts:83 | Enforced |
| Provider is `active` | ppj-checkout.ts:86 | Enforced |
| Provider is online | ppj-checkout.ts:91–100 | Enforced |
| No active job | ppj-checkout.ts:102–112 | Enforced |
| Request is `open` | ppj-checkout.ts:114–123 | Enforced |
| Ownership / geo eligibility | Not checked | Gap (MED-01 from Part 2) |
| Recovery credit path | ppj-checkout.ts:164–206 | Correct — atomic RPC |
| Existing intent reuse | ppj-checkout.ts:210–231 | Correct — retrieves live status |
| Fee calculation | utils.ts:70–75 | Correct — distance-based, promo-aware |
| Distance fallback to 0 | ppj-checkout.ts:150–158 | Revenue leak (Part 1 M6, re-confirmed) |
| Webhook accept on success | webhook.ts:329–348 | Correct for `open` requests |
| PPJ recovery on cancel | webhook.ts:340 | Correct — RPC guards against double-credit |
| No compensation for "already taken" | webhook.ts:339–347 | BD-2 — intentional |

---

## Overage Flow Review

| Check | Location | Status |
|---|---|---|
| Provider is subscription plan | overage-checkout.ts:73 | Enforced |
| Provider is `active` | overage-checkout.ts:76 | Enforced |
| Provider is online | overage-checkout.ts:80–90 | Enforced |
| Monthly limit reached | overage-checkout.ts:92–103 | Enforced (TOCTOU window for concurrent requests) |
| Request is `open` | overage-checkout.ts:106–113 | Enforced |
| `overage_cleared` checked before checkout | Not checked | **Gap** — another provider may have already cleared |
| Existing intent reuse | overage-checkout.ts:128–152 | Correct |
| Webhook sets `overage_cleared` before accept | webhook.ts:358–363 | **F3-H1** — unconditional |
| Webhook recovery on failed accept | webhook.ts:373–382 | **Missing** — F3-H1 |
| `overage_cleared` cleared on release | migration028:48–54 | **Missing** — F3-H2 |

**Critical gap summary:** The overage flow lacks both an upstream duplicate-clear guard (before checkout) and a downstream compensation mechanism (after failed accept), and the flag is never cleaned up when the request is released.

---

## Commission / Payout Readiness

**Commission calculation:** Correct logic exists in `src/lib/utils.ts:52–63` with rates:
- Starter: 15% on jobs > 400 AED
- Pro: 10% on jobs > 400 AED
- Business: 0%

These rates also appear in `SUBSCRIPTION_PLANS[].premium_commission_pct`.

**Commission recording:** `complete_provider_job_atomic` (migration 031, lines 795–796) always writes `commission_rate = 0, commission_amount = 0`. The calculation function is never called. Platform earns zero commission.

**Payout log:** `payout.created` and `payout.paid` events upsert to `payout_log` (webhook.ts:620–630). Upsert uses `onConflict: 'stripe_payout_id'` — correct idempotency. Payout log records platform payouts to the bank account, not provider payments.

**Final price integrity:**
- V2 jobs: `selected_quote_id IS NOT NULL` → `proposed_price` from `request_quotes` (server-controlled)
- Approved price change: `price_change_requested` from DB (customer-approved)
- Legacy fallback: `p_final_price` from route (provider-supplied, route validates 1–10000)
- DB check for legacy: only `>= 1` (migration 031, line 783) — upper bound only at route level

Final price cannot be manipulated by provider for V2 jobs. Correctly derived from the selected quote.

---

## Production Environment Risks

| Risk | File | Severity | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_STRIPE_*_PRICE_ID` not in startup validation | `src/lib/env.ts:42–52` | HIGH | Not in `SERVER_REQUIRED_ENVS`; plan resolution silently fails (F3-M1) |
| `STRIPE_WEBHOOK_SECRET` not validated at startup | `src/lib/env.ts` | MEDIUM | Called lazily in handler; `requireEnv` throws on first request if missing |
| `NEXT_PUBLIC_LAUNCH_PROMO` affects PPJ fees | `src/types/index.ts:59` | MEDIUM | If `true` in production, PPJ fees reduced to 15 AED. Confirm = false |
| Stripe `livemode` not enforced | `webhook/route.ts:679` | LOW (NV-4) | Logged only; test-mode webhook secret would fail signature anyway |
| `SOFT_LAUNCH_MODE` in production | `src/types/index.ts:73` | LOW | Only affects dispatch log, not fees; confirm = false for clean analytics |
| `business` `jobs_this_month` never resets | `monthly-allowance-reset/route.ts:18` | LOW | Analytics drift; no operational impact |
| `overage_cleared` not in any constraint | schema | LOW | No DB-level enforcement of the flag's lifecycle |

---

## Summary Table

| ID | Severity | Title | File(s) |
|---|---|---|---|
| F3-C1 | **Critical** | Stripe subscription webhook activates `pending`+`suspended` providers (KYC bypass) — re-verified | `webhook/route.ts:472–478`, `create-checkout/route.ts:94–98` |
| F3-H1 | **High** | No compensation for failed overage accepts — provider charged, no job, no credit | `webhook/route.ts:351–383` |
| F3-H2 | **High** | `overage_cleared` not cleared on job release — free overage bypass for next provider | `028_stuck_job_auto_release.sql:48–54`, `accept/route.ts:116–143` |
| F3-M1 | **Medium** | Plan silently unresolved when Stripe price ID env vars absent — provider activated with wrong plan | `webhook/route.ts:53–58, 501–512` |
| F3-M2 | **Medium** | Non-atomic Stripe event claim (TOCTOU) — re-verified; 10-min timeout allows double subscription processing | `webhook/route.ts:70–143` |
| F3-M3 | **Medium** | Billing portal opened for rejected/suspended providers — can trigger subscription changes | `create-checkout/route.ts:140–165` |
| F3-L1 | **Low** | `payment_intent.canceled` not handled — canceled PPJ/overage intents stay pending forever | `webhook/route.ts:236–247` |
| F3-L2 | **Low** | Monthly reset zeroes `job_credit_balance` — mid-cycle upgrade credits silently lost | `monthly-allowance-reset/route.ts:50–53` |
| F3-L3 | **Low** | `calculateCommission()` defined but never called — commission hardcoded to zero | `utils.ts:52–63`, `031_marketplace_v2_schema.sql:795–796` |
| F3-L4 | **Low** | Business plan `jobs_this_month` never resets — analytics drift | `monthly-allowance-reset/route.ts:18–25` |
| F3-L5 | **Low** | Stale payment intent reuse returns old PPJ fee when promo/rate changes | `ppj-checkout/route.ts:210–221` |
| FEC-1 | **High** | Exploit chain: overage cleared + release = free next accept | See Financial Exploit Chains |
| FEC-2 | **Medium** | Exploit chain: overage race → money taken, no job, no recovery | See Financial Exploit Chains |
| FEC-3 | **Critical** | Exploit chain: KYC bypass via subscription → unverified provider activity | See Financial Exploit Chains |

---

## Verification Log

- **Source files opened in this run:** 26
- **Documentation files opened in this run:** 6 (CLAUDE.md, ARCHITECTURE.md, MARKETPLACE_V2_SPEC.md, PROJECT_HANDOFF.md, SECURITY_AUDIT_1.md, SECURITY_AUDIT_2.md)
- **Required files not opened:** `ROADMAP.md` (not found), `SESSION_LOG.md` (not found), `src/app/api/provider/billing-portal/route.ts` (not found — billing portal embedded in `create-checkout/route.ts`)
- **Additional files opened beyond required list:** `src/lib/provider-allowance.ts`, `src/lib/utils.ts`, `src/lib/env.ts`, `supabase/migrations/005_ppj_payments.sql`, `supabase/migrations/006_billing_stability.sql`, `supabase/migrations/008_upgrade_job_credits.sql`, `supabase/migrations/012_ppj_cancelled_payment_protection.sql`, `supabase/migrations/015_ppj_credit_accept_complete_job_fix.sql`, `supabase/migrations/024_accept_rpc_overage_guard.sql`, `supabase/migrations/028_stuck_job_auto_release.sql`, `supabase/migrations/032_disable_range_estimator.sql`
- **Every finding traces to source lines read in this run:** Yes
- **Part 1/Part 2 findings repeated:** F3-C1 re-verifies Part 1 C4 (explicitly labeled); F3-M2 re-verifies Part 1 M4 (explicitly labeled); F3-L3 re-verifies Part 1 M5 commission finding. All other findings are new. No finding was copied without re-verification from source.
- **Source files modified:** No

---

No source files were modified. This report is for review only.
