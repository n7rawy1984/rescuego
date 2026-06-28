# Batch 1 Closure Report — Existential Security Fixes

## 1. Batch Overview

**Goal:** Close the existential security findings from SECURITY_AUDIT_1 and SECURITY_AUDIT_3 that posed immediate risk to the platform — role escalation, provider self-activation, KYC bypass via Stripe, unbounded quote prices, and related hardening items.

**Commit hash:** `4e780c5`

**Date completed:** June 24, 2026

**Findings targeted:** C1, C2, C3, C4/F3-C1, C5, D8, H7/D9, D10, F3-H1, F3-M1, F3-M2/M4, F3-M3, F3-L1, L4, M3, M7

---

## 2. Findings Addressed

### C2 — User self-escalation to admin
`BEFORE UPDATE` trigger `enforce_users_immutable_columns` added to the `users` table (migration 039). Blocks any change to the `role` column unless the caller satisfies `is_admin() OR is_service_role()`. The guard uses the JWT `role` claim (`request.jwt.claims`) rather than `auth.uid() IS NULL`, which would have falsely admitted the anon role.

### C3 — Provider self-activation / KYC bypass
`BEFORE UPDATE` trigger `enforce_providers_immutable_columns` added to the `providers` table (migration 039). Locks the following columns against browser-client writes: `status`, `verified_badge`, `rating`, `plan`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_current_period_start`, `stripe_current_period_end`, `jobs_this_month`, `jobs_reset_at`, `visibility_reduced`, `sla_failure_count`, `job_credit_balance`, `ppj_recovery_credits`, `release_count`, `provider_side_cancellation_count`, `unable_to_complete_count`, `last_upgrade_bonus_key`, `documents`. Same `is_admin() OR is_service_role()` guard.

A shared helper `is_service_role()` was added (migration 039) to correctly distinguish genuine service_role connections from the anon role, both of which have a null `auth.uid()`.

### C4 — Stripe subscription activation respecting KYC states
`KYC_PROTECTED` in `src/app/api/stripe/webhook/route.ts` extended from `['under_review', 'rejected']` to `['pending', 'under_review', 'rejected', 'suspended']`. The protected-status check was moved to run before the `active` branch in `resolveStripeStatus()`, so a pending or suspended provider who pays for a subscription has their subscription details recorded (plan, Stripe IDs, billing period) but their `status` is never changed by the webhook. Activation requires an explicit admin action. (Decision D1.)

### C5 — Fair-price validation restored
`submit_quote_atomic` recreated in migration 039 with the price-range validation block restored. Bounds are read exclusively from the `fair_price_config` table — no hard-coded prices. A quote below `base_fee + distance_km × min_price_per_km` is rejected as `price_too_low`; above the equivalent max is rejected as `price_too_high`. If the request's service type has no config row, the function falls back to the `'other'` config row. If no config exists at all, the range check is skipped and only quote validity is applied (fail-open on an operational misconfiguration that an attacker cannot force). (Decision D2.)

### D8 — get_nearby_open_requests returns fuzzy coordinates
`get_nearby_open_requests` recreated in migration 039 with `fuzzy_latitude` and `fuzzy_longitude` added to the `RETURNS TABLE` and `SELECT` clause. All columns from the migration 035 version are preserved, including `destination` and `destination_area`. Fixes the emirate/area badge display on the provider dashboard.

### CSRF hardening (H7 / D9)
In `src/proxy.ts`:
- A state-mutating `/api/` POST with neither `Origin` nor `Referer` header is now rejected with 403. Previously, the absence of both headers caused the check to be silently skipped.
- The `*.vercel.app` wildcard was removed from allowed origins. Only the explicitly enumerated `ALLOWED_ORIGINS` list (production domain, localhost, `NEXT_PUBLIC_SITE_URL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) plus the request's own host are accepted.

### Bearer-token fallback removal (D10 / M7)
`src/lib/supabase/request-user.ts` no longer accepts a `Bearer` token from the `Authorization` header. Authentication is cookie-session only. Cron and ops routes authenticate with `OPS_CRON_SECRET` via `src/lib/ops-auth.ts` and are unaffected. The four callers of `getRequestUser` were updated to call it with no argument.

### Stripe webhook hardening items

| Finding | Fix |
|---|---|
| F3-H1 | On a failed overage accept, `overage_payments.accept_failed` is set to `true` for manual admin review. `overage_cleared` is now set only after a successful accept. No automatic refund. |
| F3-M1 | An active subscription whose plan cannot be resolved now logs the subscription ID and unmatched price IDs as an error, then throws, so the event is recorded as `failed` and Stripe retries. Previously a silent warning with no downstream effect. |
| F3-M2 / M4 | `claimStripeEvent` rewritten as a conflict-aware atomic upsert (`ignoreDuplicates: true`) followed by a status-guarded conditional UPDATE. Removes the TOCTOU window where two concurrent deliveries could both claim the same event. |
| F3-M3 / M3 | `src/app/api/stripe/create-checkout/route.ts` now reads `providers.status` and returns 403 for `rejected` and `suspended` providers before both the billing-portal and checkout branches. `pending` and `under_review` are allowed through (payment permitted; activation waits for admin). |
| F3-L1 | `payment_intent.canceled` handler added. Updates only currently-`pending` rows in `ppj_payments` and `overage_payments` to `failed`. Never touches `paid`, `succeeded`, or `accept_failed` rows. |
| L4 | `PROCESSING_TIMEOUT_MS` reduced from 10 minutes to 3 minutes. |

---

## 3. Runtime Verification Results

Migration 039 was applied to the cloud database. Tests were run under an authenticated (non-admin) JWT context using `SET LOCAL request.jwt.claims`, confirming that `is_service_role()` evaluates false and the triggers enforce independently of the RLS ownership policy.

### Test A — User role escalation (C2)

```sql
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"<non-admin-user-id>"}';
UPDATE public.users SET role = 'admin' WHERE id = '<non-admin-user-id>';
```

**Result:** `ERROR 42501 role_change_not_allowed`

**Status: PASS**

### Test B — Provider self-activation (C3)

```sql
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"<provider-user-id>"}';
UPDATE public.providers SET status = 'active', verified_badge = true WHERE id = '<provider-id>';
```

**Result:** `ERROR 42501 provider_protected_field_change_not_allowed`

**Status: PASS**

### Test C — Service-role / admin update (C3 — admin path preserved)

```sql
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
UPDATE public.providers SET status = 'active' WHERE id = '<provider-id>';
```

**Result:** Update allowed under service_role context (`UPDATE 1`)

**Status: PASS**

### Conclusion

- Self-escalation to admin: **blocked**
- Provider self-activation / KYC bypass: **blocked**
- Admin activation path (service_role): **preserved**

The trigger guard `is_admin() OR is_service_role()` correctly distinguishes trusted server-side contexts from anon/authenticated browser contexts.

---

## 4. C1 Audit Review

Audit finding C1 stated that `src/proxy.ts` was not registered as Next.js middleware because it used a named `proxy` export rather than `export default middleware`, and recommended renaming the file to `src/middleware.ts`.

This was reviewed against the bundled Next.js documentation at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. The docs record:

> `v16.0.0` — Middleware is deprecated and renamed to Proxy

The current supported convention in Next.js 16.2.6 is `proxy.ts` with a named `proxy` export. The `middleware.ts` / `export default middleware` pattern is deprecated. The official codemod migrates `middleware.ts` → `proxy.ts`, not the reverse.

The production build confirms registration:

```
ƒ Proxy (Middleware)
```

**Finding C1 is NOT APPLICABLE on Next.js 16.2.6 and is closed.** No rename was performed. The CSRF hardening (H7/D9) was applied directly in `src/proxy.ts`.

---

## 5. Deployment Status

| Item | Status |
|---|---|
| Migration 039 deployed to cloud database | Done |
| `is_service_role()` function present on cloud DB | Confirmed |
| `overage_payments.accept_failed` column present on cloud DB | Confirmed |
| C2/C3 triggers present and enforcing | Confirmed (Tests A–C) |
| `npm run build` | Exit 0 — `ƒ Proxy (Middleware)` registered |
| `npx tsc --noEmit` | Exit 0 — no type errors |
| `npm run lint` | 0 errors, 0 warnings |
| GitHub push | Completed (commit `4e780c5`) |

---

## 6. Remaining Work

**Batch 1 is CLOSED.**

The next planned phase is **Batch 2**, targeting:
- RPC integrity and state-machine safety
- Job release flows and SLA logic
- Price-change atomicity (CRIT-01)
- SLA auto-release gap (CRIT-02)
- Related audit findings from SECURITY_AUDIT_1, SECURITY_AUDIT_2, and SECURITY_AUDIT_4
