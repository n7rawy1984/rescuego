# Supabase Edge Functions Status

Last refreshed: 2026-06-11

These Edge Functions are deprecated for the current RescueGo Next.js MVP.
Active production flows now use the App Router API routes under `src/app/api`.

Do not deploy or wire these functions without a fresh Phase 1.2 security review.
Several functions use the Supabase service role key and/or Stripe secret key and
contain older request, commission, or webhook assumptions that no longer match
the current PPJ, subscription, cancellation, and webhook flows.

Current classification:

| Function | Status | Reason |
| --- | --- | --- |
| `accept-request` | Unused and risky | Mutates requests/providers, uses service role and Stripe, contains stale PPJ percentage logic. |
| `calculate-priority` | Unknown/unused and risky | Uses service role and exposes nearby provider lookup without the current app authorization model. |
| `charge-commission` | Unused and risky | Mutates jobs/requests, charges Stripe off-session, contains stale commission/PPJ assumptions. |
| `stripe-webhook` | Unused and risky | Duplicates the active Next.js webhook with older subscription plan resolution and idempotency behavior. |
| `unlock-job` | Unused and risky | Can reveal customer contact details after direct payment-intent checks outside the active webhook assignment flow. |

Manual deployment checklist:

1. Confirm none of these functions are deployed or publicly callable in the Supabase dashboard.
2. Remove any Stripe webhook endpoints pointing to the Supabase `stripe-webhook` function.
3. Keep the active Stripe webhook pointed at `/api/stripe/webhook`.
4. If any function must be revived, rebuild it against current server-side auth, role, ownership, idempotency, privacy, and billing rules.
