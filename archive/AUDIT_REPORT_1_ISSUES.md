# RescueGo — Audit Report 1: Issues & Vulnerabilities

> Historical audit note: this report is not the current source-derived architecture. Validate every finding against the current codebase before acting.

**Date:** June 7, 2026  
**Scope:** Full project audit — all source files, migrations, configs, and documentation  
**Total findings:** 20 (0 CRITICAL, 2 HIGH, 7 MEDIUM, 11 LOW)

---

## Findings

| # | Finding | Location | Severity | Impact | Recommended Fix |
|---|---------|----------|----------|--------|-----------------|
| 1 | **No automated test suite** | Project-wide | HIGH | Zero test coverage means regressions can ship undetected. Critical payment/lifecycle logic has no safety net. | Add integration tests for API routes (at minimum: accept, complete, cancel, webhook) and unit tests for pure functions (geo, provider-allowance, utils). |
| 2 | **Stripe in TEST mode — no live keys** | DEPLOYMENT_STATUS.md, `.env.example` | HIGH | Cannot process real money. Launch blocked until Stripe live keys are configured. | Phase 10: switch `STRIPE_SECRET_KEY` + price IDs + webhook secret to live values in Vercel. |
| 3 | **Missing `og-image.jpg` in `/public`** | `src/app/layout.tsx:41` | MEDIUM | OpenGraph/Twitter metadata references `/og-image.jpg` which does not exist — social shares show broken image. | Add a 1200x630 OG image to `public/og-image.jpg`. |
| 4 | **Missing `logo.png` in `/public`** | `src/app/layout.tsx:68` (structuredData) | MEDIUM | Schema.org `logo` field points to `https://rescuego.ae/logo.png` — 404. | Add the logo file to `public/logo.png`. |
| 5 | **`NEXT_PUBLIC_SITE_URL` missing from Vercel** | `DEPLOYMENT_STATUS.md`, `src/lib/env.ts:84` | MEDIUM | Password reset emails fall back to `window.location.origin` which may produce wrong URLs in some Supabase email templates. | Add `NEXT_PUBLIC_SITE_URL=https://rescuego.ae` to Vercel. |
| 6 | **Deprecated Supabase Edge Functions still present** | `supabase/functions/*` (5 functions) | MEDIUM | Old edge functions (`accept-request`, `calculate-priority`, `charge-commission`, `stripe-webhook`, `unlock-job`) may diverge from or conflict with Next.js API route logic if accidentally invoked. | Delete from Supabase dashboard or add a `_deprecated` prefix. Verify none are triggered. |
| 7 | **Rate limiter fail-closed blocks ALL requests in production without Redis** | `src/lib/rate-limit.ts:57-66` | MEDIUM | If `UPSTASH_REDIS_REST_URL`/`TOKEN` are absent in prod (listed as optional), every rate-limited endpoint returns 429 to all users. | Either make Redis mandatory for production (throw at boot) or implement a safe in-memory fallback for single-instance Vercel. |
| 8 | **CSP in Report-Only mode — not enforced** | `next.config.ts:23-79` | MEDIUM | XSS and injection attacks are only reported, not blocked. No enforcement timeline documented. | Plan enforcement after reviewing violation reports. Add nonce/hash support for `script-src`. |
| 9 | **`en_route` and `arrived` statuses not in migration 001 CHECK constraint** | `supabase/migrations/001_initial_schema.sql` | MEDIUM | Migration 025 updates the constraint, but if run out of order or on a fresh DB without 025, inserts will fail. | Ensure migration 025 is always applied. Document it in SETUP.md migration list. |
| 10 | **Navbar client-side role fetch duplicates middleware auth check** | `src/components/layout/Navbar.tsx:52-88` | LOW | Every page load fires an extra `supabase.auth.getUser()` + DB role query from the client, adding ~200ms latency. Role is already known server-side. | Pass `role` from server layout via context or cookie; remove Navbar DB query. |
| 11 | **No CSRF protection on state-mutating POST routes** | All `/api/*` POST routes | LOW | API routes rely solely on Supabase auth token (cookie). Same-origin attackers could theoretically submit cross-site POST requests. Supabase cookies use `SameSite=Lax` which mitigates most vectors. | Consider adding `csrf-token` header validation for non-webhook routes in a future hardening pass. |
| 12 | **`advance_provider_job_state` RPC allows empty string as `p_timestamp_field`** | `src/app/api/provider/jobs/advance-state/route.ts:81`, `026_advance_state_atomic.sql:40` | LOW | When `timestampField` is ``, code sends empty string `''`. The RPC only checks `'en_route_at'` and `'arrived_at'` — empty string harmlessly falls through without writing. Not a bug but could be cleaner. | Pass `null` instead of `''` or add explicit `` branch in RPC. |
| 13 | **No request expiry for `accepted`/`en_route`/`arrived` states** | `src/app/api/ops/expire-requests/route.ts` | LOW | Only `open` requests expire. A provider who accepts and never completes (ghost) holds the request indefinitely until manually released. | Add stuck-job auto-release in Phase 4 (admin dashboard shows alert, but no automated resolution). |
| 14 | **`payout_log` upsert has no unique constraint on `stripe_payout_id`** | `src/app/api/stripe/webhook/route.ts:613` | LOW | `.upsert()` without `onConflict` uses primary key (`id`). Duplicate payout events may create duplicate rows. | Add `onConflict: 'stripe_payout_id'` or add UNIQUE constraint to `stripe_payout_id` column. |
| 15 | **Google Maps API key exposed client-side without documented restrictions** | `src/app/customer/request/page.tsx` | LOW | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is used directly in browser fetch. Safe only if key is restricted by HTTP referrer in Google Cloud Console. No documentation confirms this. | Document API key restriction requirement in SETUP.md. |
| 16 | **PROJECT_HANDOFF.md references outdated dependency state** | `PROJECT_HANDOFF.md` | LOW | States unused Radix/date-fns deps are still in package.json, but they have already been removed. | Update PROJECT_HANDOFF.md to reflect current state. |
| 17 | **`DEPLOYMENT_STATUS.md` previously listed migrations only up to 022** | `DEPLOYMENT_STATUS.md` | LOW | Migrations 023-026 were applied in production but not reflected in the deployment status doc. | Fixed in this audit session. |
| 18 | **`SESSION_LOG.md` not updated with latest sessions** | `SESSION_LOG.md` | LOW | Last entry was June 7, 2026 (RTL). The current audit session was not logged. | Fixed in this audit session. |
| 19 | **`complete/route.ts` allows completion from `accepted` status directly** | `src/app/api/provider/jobs/complete/route.ts:63` | LOW | Line 63 allows completion from `['accepted', 'in_progress']` but Phase 4 added intermediate states (`en_route`, `arrived`). A provider could theoretically skip the state machine. | Add `en_route` and `arrived` to the allowed completion statuses, or restrict to `arrived` and `in_progress` only. |
| 20 | **No email verification enforcement documented for production** | Auth flow | LOW | SETUP.md mentions disabling email confirmation for testing. Production should enforce it but no automated check exists. | Add a pre-launch checklist item confirming Supabase email confirmation is enabled. |

---

## Summary by Severity

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 2 | No tests; Stripe not live |
| MEDIUM | 7 | Missing assets, env gaps, deprecated code, security enforcement gaps |
| LOW | 11 | Code quality, minor logic gaps, documentation drift |

---

## Priority Actions

### Before Launch (Blockers)
1. Switch Stripe to live keys (Phase 10)
2. Add `og-image.jpg` and `logo.png` to `/public`
3. Add `NEXT_PUBLIC_SITE_URL` to Vercel
4. Delete or disable deprecated Supabase Edge Functions
5. Decide on rate limiter behavior without Redis

### Post-Launch (Hardening)
1. Add automated test suite (integration + unit)
2. Enforce CSP (move from report-only)
3. Add stuck-job auto-release logic
4. Add `onConflict` to payout_log upsert
5. Document Google Maps API key restrictions
