# RescueGo — Session Log

---

## Session: July 2, 2026 — Migration 048: provider-row FOR UPDATE correction (047 immutable)

**Context:** Migration 047 was applied manually to Supabase BEFORE the provider-row `FOR UPDATE` fix was committed locally (in a prior local-only edit). Migration 047 is therefore immutable and must match the applied version exactly. The lock correction moves to a new corrective migration 048.

### What was verified

- Read migration 047 in full. It contained a local-only `FOR UPDATE` edit (comment block + `FOR UPDATE`) on the provider row SELECT — the edit that must NOT be in 047 because 047 was already applied without it.
- Confirmed the applied version of 047 = git commit `062e233` (the original commit); the local `FOR UPDATE` edit was commit `c959312`.
- Reverted only that edit in 047. `git diff 062e233 -- 047...sql` returns empty (exit 0) — 047 now matches the applied version byte-for-byte.
- Diffed 047 vs 048 `select_quote_atomic`: the only differences are removal of `WHERE id = v_provider_id;` and addition of `WHERE id = v_provider_id` + `FOR UPDATE;` (plus one explanatory comment line). PPJ branch, subscriber branch (except the lock), signature, RETURNS TABLE, and grants are identical.

### Why 048 was needed

Migration 047 (applied) has no provider-row lock in the subscriber overage path. Without it, two concurrent `select_quote_atomic` calls selecting the same at-limit provider (via two different requests) could both read `jobs_this_month` below the limit, both pass the overage gate, and both increment — bypassing the monthly limit (TOCTOU). The `requests FOR UPDATE` does not protect the provider row across different requests. Since 047 is immutable, the fix is delivered as migration 048.

### What changed

- `supabase/migrations/047_...sql`: reverted the local FOR UPDATE edit; now identical to the applied version.
- `supabase/migrations/048_fix_provider_lock_select_quote_atomic.sql`: new. `DROP FUNCTION IF EXISTS public.select_quote_atomic(UUID, UUID, UUID)` + full recreate of the function with the single functional change (provider row `FOR UPDATE`) + re-applied `REVOKE ALL FROM anon, authenticated` and `GRANT EXECUTE TO service_role`.
- `PROJECT_STATUS.md`: §1 snapshot, §3 migration baseline, §5 LB-7, §7 H3, §8 updated — 047 applied, 048 required and NOT YET APPLIED, LB-7 CODE COMPLETE pending 048 cloud application.

### Verification

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0.

**Migration 048 is FILE ONLY and must still be applied to Supabase SQL Editor.** LB-7 is not fully closed in cloud until 048 is applied.

---

## Session: July 2, 2026 — FOR UPDATE provider lock in select_quote_atomic (migration 047 correction)

**Goal:** Verify whether the provider row is locked (`FOR UPDATE`) in the subscriber overage path of `select_quote_atomic`, and correct migration 047 if the lock is missing.

### What was verified

- **Repo file `supabase/migrations/047_overage_gate_v2_and_sla_reset_atomic.sql`:** the providers SELECT after `v_provider_id` is set (originally lines 74–75) read `SELECT * INTO v_provider FROM providers WHERE id = v_provider_id;` — **NO `FOR UPDATE`**. The `requests` SELECT (line 42) already had `FOR UPDATE`; the providers SELECT did not.
- **Live database `pg_proc` query — COULD NOT BE RUN.** No `psql` binary, no `supabase` CLI, no local `supabase/config.toml`, and no direct Postgres connection string (`DATABASE_URL` / `SUPABASE_DB_URL` / `POSTGRES_URL` all unset; `.env.local` contains only `NEXT_PUBLIC_SUPABASE_URL`, which is the REST endpoint and cannot execute `SELECT prosrc FROM pg_proc`). The user constraint "do not apply anything to Supabase SQL Editor" also rules out the SQL Editor. Live function body could not be inspected from this environment.
- **Migration 047 is NOT YET APPLIED to cloud** (per prior July 2 entry). The live `select_quote_atomic` is therefore still the migration 045 body, which has no LB-7 subscriber overage branch at all — so the live function cannot yet contain this lock regardless.

### What was found

The repo migration 047 lacked `FOR UPDATE` on the provider row read in the subscriber path. This is a TOCTOU risk: without locking the provider row, two concurrent `select_quote_atomic` calls selecting the same at-limit provider (via two different requests) could both read `jobs_this_month` below the limit, both pass the overage gate, and both increment `jobs_this_month` — bypassing the monthly limit. The `requests FOR UPDATE` does not protect the provider row across different requests.

### What was changed

- `supabase/migrations/047_overage_gate_v2_and_sla_reset_atomic.sql`: added `FOR UPDATE` to the providers SELECT (now lines 80–82) plus an explanatory comment describing the TOCTOU race the lock prevents. PPJ branch and all other logic unchanged.

### Verification

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0.
- (SQL migration content is not exercised by tsc/lint; these confirm no TypeScript/lint regression from the repo state.)

**Migration 047 still NOT YET APPLIED to cloud Supabase.** Apply migrations 046 + 047 in order via SQL Editor before the next production deploy. The `FOR UPDATE` correction is now part of the migration that will be applied.

---

## Session: July 2, 2026 — LB-6 + LB-7 + LB-10

**Goal:** Close three launch blockers: LB-6 (legacy accept route bypasses V2 for subscribers), LB-7 (no overage gate in select_quote_atomic), LB-10 (weekly SLA reset non-atomic).

### Change 1 — LB-6: accept/route.ts V2 guard

**Pre-change verification:**
- PPJ guard block ends at line 110 (`}`), blank line 111, `if (!providerLocation)` at line 112.
- PPJ guard returns 403 `PPJ_PAYMENT_REQUIRED` for `plan === 'pay_per_job'`.
- No prior V2 guard existed.

**Applied:** Inserted unconditional V2 guard block after PPJ guard. Subscription providers (starter/pro/business) now receive 403 `V2_QUOTE_REQUIRED`. Legacy accept path (providerLocation check, activeJob check, overage guard, `accept_provider_request_atomic` RPC) removed since it is now unreachable for all plans.

**TypeScript fix:** `provider.plan !== 'pay_per_job'` at line 112 caused TS2367 (types have no overlap after PPJ guard narrowing). Guard made unconditional; unused imports and variables cleaned up. Final: tsc exit 0, lint exit 0 (no warnings).

**Final file:** `accept/route.ts` — 115 lines. PPJ guard lines 76–90, V2 guard lines 92–108. All pre-flight checks preserved (role, 404, status). Legacy code removed, preserved in git history.

### Change 2 — LB-7 + LB-10: migration 047

**Pre-change verification:**
- Migration 045 subscriber branch: `UPDATE requests SET status = 'accepted'` starts at line 209. No overage/plan_limit check precedes `jobs_this_month` UPDATE at line 232. Confirmed.
- `weekly-sla-reset/route.ts`: first UPDATE (`visibility_reduced = true`) at line 44, second UPDATE (`sla_failure_count = 0`) at line 57. Not in a transaction. Confirmed.
- Grep `weekly_sla_reset_atomic` across migrations 001–046: zero results. Confirmed new function.

**Applied:** Created `supabase/migrations/047_overage_gate_v2_and_sla_reset_atomic.sql`.

- **LB-7 (select_quote_atomic):** DROP + CREATE OR REPLACE with overage gate in subscriber branch. `v_plan_limit`: starter=15, pro=35, business=-1 (unlimited). Gate fires when `jobs_this_month >= v_plan_limit AND NOT overage_cleared`. Returns `overage_required`. PPJ branch byte-for-byte identical to migration 045 (lines 80–103 of migration 047).
- **LB-10 (weekly_sla_reset_atomic):** New `SECURITY DEFINER` RPC. LIMIT 500 prevents unbounded fetch. `visibility_reduced = TRUE` and `sla_failure_count = 0` execute atomically in one transaction. Returns `(providers_reset INT, visibility_reduced_count INT)`.
- Both functions: `REVOKE ALL FROM anon, authenticated` + `GRANT TO service_role`.

**Migration 047 NOT YET APPLIED to cloud Supabase SQL Editor.** Apply after code review.

### Change 3 — LB-10: weekly-sla-reset/route.ts

**Pre-change verification:**
- Line 44: `update({ visibility_reduced: true })` — first non-atomic UPDATE. Confirmed.
- Line 57: `update({ sla_failure_count: 0 })` — second non-atomic UPDATE. Confirmed.
- No RPC call existed in file. Confirmed.

**Applied:** Replaced entire try block content with single `supabase.rpc('weekly_sla_reset_atomic')` call. Route structure, auth (`authorizeOpsRequest`), exports (`GET`, `POST`), and response shape (`{ success: true, providers_reset, visibility_reduced_count, errors }`) unchanged. `results` object still declared with `errors` array (preserved for shape compatibility). No direct UPDATE statements remain.

**Post-change verification:** File is 62 lines. No UPDATE statements. Auth and exports byte-for-byte unchanged.

### Change 4 — tsc + lint

- `npx tsc --noEmit`: exit 0, no errors.
- `npm run lint`: exit 0, no warnings.

### Files changed

| File | Change |
|---|---|
| `src/app/api/provider/requests/accept/route.ts` | LB-6: V2 guard added, legacy accept path removed, unused imports cleaned |
| `supabase/migrations/047_overage_gate_v2_and_sla_reset_atomic.sql` | New — LB-7 overage gate + LB-10 atomic SLA reset RPC |
| `src/app/api/ops/weekly-sla-reset/route.ts` | LB-10: replaced two non-atomic UPDATEs with weekly_sla_reset_atomic() RPC call |
| `PROJECT_STATUS.md` | §1, §3, §5, §6 LB-6/LB-7, §7 H2/H3, §8, §13 P4-H3 updated |

### Note on migration 047

Migration 047 is **code complete and committed** but has **not been applied to cloud Supabase**. Until applied:
- LB-7 overage gate is inactive in production (select_quote_atomic still uses migration 045 body).
- LB-10 atomic SLA reset is inactive (route falls back to error until RPC exists in Supabase).
- Apply via Supabase SQL Editor before next production deploy.

---

## Session: July 2, 2026 — Supabase Security Advisor: anon EXECUTE + search_path (migration 046)

**Goal:** Address 44 Supabase Security Advisor warnings. Grepped all 001–045 migrations to determine which functions already had REVOKE FROM anon or SET search_path in prior migrations, then wrote migration 046 for the remaining gaps only.

### Task 1 — Per-function verification findings

**Category B — anon EXECUTE:**

| Function | Already revoked? | Where |
|---|---|---|
| `admin_update_provider_status_atomic` | YES | migration 041 — REVOKE ALL FROM anon, authenticated |
| `select_quote_atomic` | YES | migrations 040 + 045 |
| `finalize_ppj_selection_atomic` | YES | migration 045 |
| `request_price_change_atomic` | YES | migration 040 |
| `respond_price_change_atomic` | YES | migration 040 |
| `expire_stale_open_requests` | NO | needs REVOKE — included in 046 |
| `expire_ppj_payment_selection_atomic` | YES | migration 045 |
| `get_nearby_open_requests` | YES | migration 039 — REVOKE ALL FROM PUBLIC |
| `get_nearby_providers` | NO | needs REVOKE — included in 046 |
| `release_target_status` | YES | migration 040 |
| `reset_monthly_job_counters` | YES | migration 022 — REVOKE ALL FROM PUBLIC/anon/authenticated |

**Category C — SET search_path:**

| Function | Already fixed? | Where |
|---|---|---|
| `get_nearby_providers` | NO | needs fix — included in 046 |
| `update_provider_rating` | NO | needs fix — included in 046 |
| `reset_monthly_job_counters` | NO | needs fix — included in 046 |
| `check_provider_suspension` | NO | needs fix — included in 046 |
| `expire_stale_open_requests` | YES | migration 007 line 18 |
| `get_nearby_open_requests` | YES | migration 039 line 360 |

### What migration 046 contains

**File:** `supabase/migrations/046_revoke_anon_execute_and_fix_search_path.sql` (191 lines)

- **Section 1 (lines 56–63):** REVOKE EXECUTE FROM anon for 2 functions:
  - `expire_stale_open_requests(TIMESTAMPTZ)` — signature from migration 007 line 14
  - `get_nearby_providers(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TIMESTAMPTZ)` — signature from migration 002 lines 1–5

- **Section 2 (lines 66–188):** CREATE OR REPLACE for 4 functions with SET search_path = public added:
  - `get_nearby_providers` (lines 76–120) — body identical to migration 002 lines 16–45
  - `reset_monthly_job_counters` (lines 127–139) — body identical to migration 002 lines 51–53; re-applies REVOKE ALL / GRANT to service_role to preserve migration 022 privileges after CREATE OR REPLACE
  - `update_provider_rating` (lines 150–172) — body identical to migration 001 lines 155–182
  - `check_provider_suspension` (lines 177–188) — body identical to migration 001 lines 189–197

**Not touched (confirmed absent from migration 046):** `enforce_users_immutable_columns`, `enforce_providers_immutable_columns`, `is_admin`, `st_estimatedextent`, `payout_log` policies, `stripe_events` policies.

### Verification
- REVOKE count: 2 — matches the 2 functions confirmed needing it.
- `SET search_path = public` confirmed in all 4 recreated function bodies (lines 92, 135, 172, 188).
- False-positive functions confirmed absent via grep (zero results).
- `npx tsc --noEmit` exit 0.
- `npm run lint` exit 0.

### Files changed
- `supabase/migrations/046_revoke_anon_execute_and_fix_search_path.sql` — new migration (191 lines)
- `PROJECT_STATUS.md` §13 — new finding entry added: "Supabase Advisor — anon EXECUTE and function_search_path_mutable (Migration 046)"

**NOTE: Migration 046 has NOT YET been applied to the cloud Supabase project.** Must be applied via SQL Editor. After applying, rerun Supabase Security Advisor and confirm warning count drops by at least 6.

---

## Session: July 1, 2026 — Cloud migration verification (LB-2 + LB-3 closed)

**Goal:** Verify all 45 migrations are applied to the production Supabase project and confirm the C2/C3 security triggers are present in cloud, closing LB-2 and LB-3.

**What was verified:**
- Ran the §2 sentinel query against the production Supabase SQL Editor: all 5 sentinel functions returned (`enforce_users_immutable_columns`, `enforce_providers_immutable_columns`, `finalize_ppj_selection_atomic`, `expire_ppj_payment_selection_atomic`, `admin_update_provider_status_atomic`).
- `fair_price_config` confirmed showing migration 044 values (`min_price_per_km = 0.01`, `max_price_per_km = 10000`) for all service types.
- `SELECT COUNT(*) FROM public.request_quotes` → 25 rows (table present — migration 031 applied).
- `SELECT COUNT(*) FROM public.provider_kyc_log` → 3 rows (table present — migration 038 applied).
- `SELECT relname FROM pg_class WHERE relname = 'idx_jobs_en_route_at'` → 0 rows (migration 043 index was missing from cloud).
- Applied `idx_jobs_en_route_at` index directly via SQL Editor using the statement from migration 043.
- C2/C3 trigger functions confirmed present in `pg_proc`.

**What was found:**
- All migrations 001–045 effectively applied, with one gap: migration 043's index (`idx_jobs_en_route_at`) had not been applied — remedied immediately via SQL Editor.
- Both security trigger functions (C2 and C3) confirmed present in cloud.

**What was updated in PROJECT_STATUS.md:**
- §1 snapshot: cloud migration verification updated from "INSUFFICIENT EVIDENCE" to "VERIFIED — all migrations 001–045 confirmed applied (July 1, 2026)".
- §2 Supabase paragraph: updated to confirm all 45 migrations applied, with verification details.
- §3 table: `Cloud state` row changed to "VERIFIED — all migrations 001–045 confirmed applied (July 1, 2026)".
- §3 prose: removed "required before launch" sentence; replaced with confirmation.
- §4 Runtime Verification table: C2 row → "VERIFIED — trigger confirmed in cloud pg_proc July 1, 2026"; C3 row → same; P4-M1 row → "VERIFIED — index applied directly via SQL Editor July 1, 2026".
- §5 blockers table: LB-2 and LB-3 rows marked "CLOSED July 1, 2026".
- §6 LB-2 section: replaced INSUFFICIENT EVIDENCE description with CLOSED status and full verification evidence.
- §6 LB-3 section: replaced PARTIALLY VERIFIED description with CLOSED status.
- §7 C2 section: updated from PARTIALLY VERIFIED to VERIFIED; removed "Runtime verification required" note.
- §7 C3 section: updated from PARTIALLY VERIFIED to VERIFIED; corrected column count from 20 to 19 (matching Phase 4A-5 fix); removed "Runtime verification required" note.

**Committed:** `4b7faf8` docs: close LB-2 and LB-3 -- cloud migration verification complete (July 1, 2026)

---

## Session: July 1, 2026 — Housekeeping: package-lock, .env.example, docs corrections, rate limits, i18n

**Goal:** Apply 8 targeted housekeeping tasks covering dependency hygiene, environment documentation, security findings closure, JSON-LD correctness, i18n completeness, rate limiting, and documentation accuracy. Verify-first policy applied to every task.

**Task 1 — package-lock desync (SKIPPED — already correct):**
Ran `npm ci`. Completed cleanly: "added 504 packages, audited 505 packages." No missing dependency errors. No change made.

**Task 2 — .env.example (CREATED):**
Verified `.env.example` existed on disk but was blocked by `.gitignore` line 34 (`.env*` rule) — `git check-ignore -v .env.example` confirmed it was untrackable. Added `!.env.example` exception at `.gitignore` line 35. Created `.env.example` (78 lines, 9 variable groups, placeholder values only) sourced from `SETUP.md §3`. Groups: Supabase, Stripe, PPJ fees, Feature flags, Google Maps, Application URLs, Support email, Ops/Cron secret, Upstash Redis, Sentry. Confirmed trackable post-fix via `git status`. Committed `a0e8524`.
- `.gitignore` line 35: added `!.env.example`
- `.env.example`: new file, 78 lines

**Task 3 — Close LB-5 (CLOSED in docs):**
Verified `029_rpc_add_en_route_arrived_statuses.sql` line 231: `AND status IN ('accepted', 'en_route', 'arrived', 'in_progress')` — the active-job guard covers all four active states. Grepped migrations 030–045 for any redefinition of `accept_provider_request_atomic`: zero results. Fix is confirmed present in code since migration 029. LB-5 was incorrectly left open in docs.
Updated `PROJECT_STATUS.md`:
- §5 blockers table: removed LB-5 row (was between LB-4 and LB-6).
- §6 LB-5 section: replaced OPEN description with CLOSED — fixed in migration 029 (supersedes 024 line 56); verified in source.
- §7 H6 section: updated from OPEN to CLOSED with same evidence.
Committed `b3293e0`.

**Task 4 — Fix logo reference in JSON-LD (FIXED):**
Verified `public/logo.png` absent; `public/logo.svg` present. Grepped all `*.tsx`/`*.ts` files in `src/` for `logo.png`: two hits.
- `src/app/layout.tsx` line 74: changed `/logo.png` → `/logo.svg` (JSON-LD Organization schema)
- `src/app/about/page.tsx` line 19: changed `/logo.png` → `/logo.svg` (JSON-LD Organization schema)
No other references to `logo.png` found anywhere in `src/` or `public/`. Committed `70efc50`. Partial closure of LB-9.

**Task 5 — Add missing PPJ keys to en.json (FIXED):**
Compared `messages/ar.json` and `messages/en.json` under `admin.requests.lifecycle` using Python JSON parse. Found 4 keys present in `ar.json` missing from `en.json`:
- `awaitingPaymentTitle` — Arabic: "بانتظار تأكيد الدفع" → English added: "Awaiting Payment Confirmation"
- `awaitingPaymentDesc` — Arabic: multi-sentence provider-selection awaiting-payment description → English: "A provider has been selected. Their details will be shown after they confirm payment. If they do not confirm within 10 minutes, you can select another provider."
- `awaitingPaymentBadge` — Arabic: "بانتظار دفع مقدم الخدمة" → English added: "Awaiting Provider Payment"
- `ppjPaymentTimeoutNotice` — Arabic: "لم يؤكد مقدم الخدمة الدفع، يرجى اختيار مقدم خدمة آخر." → English added: "The provider did not confirm payment. Please select another provider."
Inserted after `messages/en.json` line 1601 (`"unassigned": "Unassigned"`). JSON validated with Python `json.load` — no syntax errors. Committed `5945fb4`.
- `messages/en.json` lines 1602–1605: 4 new keys added

**Task 6 — Add rate limiting to two routes (FIXED):**
Verified neither route called `checkRateLimitAsync` before change.
- `src/app/api/provider/jobs/release/route.ts`:
  - Line 6: added `import { checkRateLimitAsync } from '@/lib/rate-limit'`
  - Lines 42–48: rate limit call after role check (line 38–40), before `createAdminClient()` (line 50). Key `provider-release-job:${user.id}`, 10 req / 60 s, mode `'soft'`. Returns 429 + `Retry-After` on breach.
- `src/app/api/customers/unrated-jobs/route.ts`:
  - Line 4: added `import { checkRateLimitAsync } from '@/lib/rate-limit'`
  - Lines 28–34: rate limit call after role check (line 24–26), before `createAdminClient()` (line 36). Key `customer-unrated-jobs:${user.id}`, 30 req / 60 s, mode `'soft'`. Returns 429 + `Retry-After` on breach.
`npx tsc --noEmit` exit 0. `npm run lint` exit 0. Committed `3ba702a`.

**Task 7 — ARCHITECTURE.md ppj_payments columns + missing RPC (FIXED):**
(a) Read `supabase/migrations/005_ppj_payments.sql`. Actual columns: `id`, `provider_id`, `request_id`, `fee_aed` INTEGER NOT NULL, `distance_meters` INTEGER NOT NULL DEFAULT 0, `stripe_payment_intent_id`, `status` CHECK ('pending','paid','failed') DEFAULT 'pending', `promo_applied` BOOLEAN NOT NULL DEFAULT FALSE, `created_at`. Docs had `amount_aed` (wrong name), `accept_failed` (non-existent column), and omitted `fee_aed`, `distance_meters`, `promo_applied`. Updated `ARCHITECTURE.md` §2 `ppj_payments` row to match actual schema (migration 005 lines 3–12).
(b) Grepped all migrations for `restore_ppj_credit_for_cancelled_paid_request`: found in `012_ppj_cancelled_payment_protection.sql`. Signature: `(p_provider_id UUID, p_request_id UUID, p_payment_intent_id TEXT DEFAULT NULL)`. Purpose: restores one `ppj_recovery_credits` credit idempotently when a customer cancels after a PPJ provider has paid. Absent from the RPC catalog. Added to `ARCHITECTURE.md` §3 after the `cancel_request_and_compensate_atomic` row.
Committed `ea68e67`.

**Task 8 — Stray file (SKIPPED — not found):**
Searched entire repo outside `node_modules` for any filename containing `#U`. `Get-ChildItem -Recurse` with `Where-Object { $_.Name -match "#U" }` returned zero results. `git status --short | Select-String "#U"` also returned nothing. No file to delete.

**Final build:** `npm run build` — zero errors, zero warnings. All routes compiled. Committed documentation changes (archive + Phase 4B) separately in prior session; these 7 commits are all housekeeping.

**Verification results:**
- `npx tsc --noEmit` exit 0 (no type errors)
- `npm run lint` exit 0 (no lint errors)
- `npm run build` succeeded — all routes compile (exit 0)
- logo.png: zero remaining references in `src/` or `public/`
- Atomic RPC files (`040`, `045`, `webhook/route.ts`, `accept/route.ts`): untouched — `git diff HEAD` returns 0 bytes
- Rate limit pattern: both routes confirmed — call after `getUser()`/role check, before DB; 429 + Retry-After on breach; correct key format; mode `'soft'`

**Commits this session:**
- `a0e8524` docs: add .env.example with all required environment variables
- `b3293e0` docs: close LB-5 — accept RPC en_route/arrived already fixed in migration 029
- `70efc50` fix: correct JSON-LD logo reference from .png to .svg (LB-9 partial)
- `5945fb4` fix: add missing PPJ lifecycle i18n keys to en.json
- `3ba702a` fix: add rate limiting to release and unrated-jobs routes
- `ea68e67` docs: fix ppj_payments column list and add restore_ppj_credit RPC to ARCHITECTURE catalog

---

## Session: June 28, 2026 — PPJ re-enabled (NEW MODEL): post-selection fee gate (migration 045 + code)

**Goal (P7):** Re-enable Pay Per Job under a new model — PPJ providers quote like everyone; the per-job fee is charged AFTER the customer selects their quote, before contact details are revealed and the job is assigned. Subscribers are unaffected (immediate reveal + assign).

**Migration `045_ppj_post_selection_fee_gate.sql` (NOT yet applied — paste into Supabase SQL editor):**
- Adds request status `selected_pending_payment`; columns `requests.payment_window_started_at` and `requests.last_release_reason`; widens `provider_dispatch_log.event_type` to allow `ppj_payment_timeout`; partial index `idx_requests_payment_window_pending`.
- `select_quote_atomic` plan-branched (return shape gains `payment_required`): subscriber path byte-for-byte unchanged; PPJ path → `selected_pending_payment`, holds competitors as `pending`, withholds contact, `accepted_at` stays NULL.
- New `finalize_ppj_selection_atomic` — webhook on fee payment: `selected_pending_payment → accepted`, sets `accepted_at = now()` (SLA starts ONLY here), rejects held competitors, reveals contact, verifies payer is the selected provider.
- New `expire_ppj_payment_selection_atomic` — cron, 10-min: releases to `quoted`/`open`, sets `last_release_reason = 'ppj_payment_timeout'`, marks unpaid `ppj_payments` row `failed`, no SLA penalty, no jobs change.

**Two timers — proven separate:** the 10-min payment window keys off `payment_window_started_at`; the SLA clock keys off `accepted_at` (set only at payment). `sla_check_and_release` only acts on `accepted/en_route/arrived`, so `selected_pending_payment` is structurally immune → an unpaid-but-selected PPJ provider can never get an SLA penalty.

**Code:**
- `customer/quote/select/route.ts` — returns `payment_required` (no contact for PPJ).
- `provider/ppj-checkout/route.ts` — accepts `selected_pending_payment`; verifies the caller is the selected provider; recovery-credit path now finalizes via the new RPC.
- `api/requests/route.ts` GET — withholds provider contact while `selected_pending_payment` (no pre-payment leak); returns `last_release_reason`.
- `stripe/webhook/route.ts` — PPJ branch calls `finalize_ppj_selection_atomic` (overage branch untouched).
- `ops/marketplace-cron/route.ts` — separate `expirePpjPaymentWindows()` pass.
- New `components/provider/PpjPaymentPrompt.tsx` — "pay 15 AED to reveal details" + 10-min countdown + 5-min warning (UI-only).
- `provider/dashboard/page.tsx` — query + render the pending-payment prompt.
- `customer/request/page.tsx` — "awaiting payment" state + Arabic timeout notice.
- `types/database.ts` — `RequestStatus` + `DispatchEventType` extended.
- `messages/ar.json` + `messages/en.json` — new keys (Arabic-first).

**Safety:** subscriber selection path unchanged; H1 (no KYC docs returned) preserved; C5 fair-price validation untouched; CRIT-02 SLA untouched; 403 PPJ guard kept.

**Verified:** `npx tsc --noEmit` = 0, `npm run lint` = 0, `npm run build` = 0. JSON files parse.

---

## Session: June 27, 2026 — Migration 044: temporarily WIDEN fair-price bounds for testing

**Task:** Allow any reasonable test quote to pass during testing WITHOUT disabling the fair-price validation, then correct stale docs and enrich the deferred backlog.

**Confirmed formula (read from `submit_quote_atomic`, migration `039_security_backstop.sql:262-274`):**
- `v_min_fair = base_fee + (distance_km × min_price_per_km)`
- `v_max_fair = base_fee + (distance_km × max_price_per_km)`
- reject `price_too_low` if `proposed_price < v_min_fair`; reject `price_too_high` if `proposed_price > v_max_fair`.
- `distance_km` is the single leg provider→customer (route-side haversine). The route (`provider/jobs/quote/route.ts`) has no independent price check — the RPC is the sole enforcement point; `range-estimator.ts` is UI-only.

**Change — migration `044_temp_widen_fair_price_bounds.sql` (created, NOT applied by me):**
- `UPDATE public.fair_price_config SET min_price_per_km = 0.01, max_price_per_km = 10000, updated_at = now();` for ALL service types. `base_fee` left unchanged. Idempotent (absolute values). Includes before/after snapshot SELECT comments and a `DO $$` block that raises if any row was not widened.
- WIDENS, does NOT disable: the RPC logic is untouched and still runs the range check on every quote. Amounts below the base_fee floor are still correctly rejected `price_too_low` (expected).
- Header documents this as TEMPORARY test scaffolding and a LAUNCH BLOCKER to REDESIGN (two-leg distance: provider→breakdown + breakdown→destination, mandatory 7-emirate dropdown) — NOT a restore target. References backlog P9/P1/P2. Previous seeded values listed for the record only: tow 3–8/100, battery 2–5/80, flat_tire 2–5/60, fuel 2–5/50, lockout 2–6/70, other 2–6/80.

**Stale-doc corrections (fair-price enforcement was: disabled by 032 → RE-ENABLED by 039 (Batch 1) → TEMPORARILY WIDENED by 044; redesign before launch, not restore):**
- `ARCHITECTURE.md` (3 lines: config note, deployment-state note, known-gap note)
- `MARKETPLACE_V2_SPEC.md` (1 line: the 032-disables claim)
- `RESCUEGO_MASTER_REFERENCE.md` (5 lines: file-tree note, `fair_price_config` table doc, RPC table row, quote-flow note, "known issue" item — plus the C5 findings-table row annotated with the 044 widen + launch-blocker note)
- Deliberately LEFT UNCHANGED: `SECURITY_AUDIT_1/2/3.md` — these are point-in-time audit records that correctly describe the 032 state at the time of each audit; they are historical, not stale.

**Backlog:** Saved the owner's authoritative `DEFERRED_PRODUCT_BACKLOG.md` (items P1–P10) into the repo root, keeping P1–P8 and P10 verbatim; only P9 was enriched (confirmed formula, migration 044 reference, widened values 0.01/10000, base_fee unchanged, two-leg+emirate redesign launch-blocker, QA scenarios) and its status set to "DONE (widen migration created) — redesign still OPEN".

**Verification:** `npx tsc --noEmit`, `npm run lint`, `npm run build` (SQL + markdown changes only; no TS touched).

**Deploy:** apply `044` by pasting it into the Supabase SQL editor and running it (production DB). No code deploy required for the widening itself.

---

## Session: June 27, 2026 — PPJ free-accept bypass fix (server-side payment guard)

**Finding:** A Pay Per Job (PPJ) provider could be assigned a job WITHOUT paying the per-job acceptance fee. The free accept route `src/app/api/provider/requests/accept/route.ts` had no PPJ-plan guard: its checks were role/active/online/no-active-job, and the overage guard deliberately skips PPJ (`hasMonthlyAllowance=false`). It then called `accept_provider_request_atomic` directly and assigned the job. The atomic RPC itself does not gate PPJ payment (migrations 011/015/024 — PPJ logic there is only `p_consume_ppj_credit` and `p_plan_limit`), so PPJ payment enforcement is entirely the caller's responsibility. The UI (`ProviderRequestList.tsx:117`) correctly routes PPJ to `/api/provider/ppj-checkout`, but the server had no defense-in-depth, so any stale/alternate client or direct call to the accept route bypassed payment. The PPJ payment chain (ppj-checkout → PaymentIntent → webhook `finalizeAcceptedRequest`) was intact and NOT disabled; Stripe (test keys) and subscription checkout were working.

**Fix (code-only, minimal, one file):** Added a server-side guard in `accept/route.ts` immediately after the active-status check — when `provider.plan === 'pay_per_job'`, log `accept_request_blocked_ppj_payment_required` and return `403 { error, code: 'PPJ_PAYMENT_REQUIRED', request_id }`. PPJ never legitimately uses this route, so the subscription/overage path is untouched. No changes to subscription checkout, Stripe webhook, ppj-checkout route, database, migrations, or launch behavior.

**Fee amount (env-only, NOT changed in code — to be set by operator):** PPJ test fee is currently 30/70 AED by distance because `NEXT_PUBLIC_LAUNCH_PROMO` is unset. To use the 15 AED promo fee in test, set in Vercel + `.env.local`: `NEXT_PUBLIC_LAUNCH_PROMO=true` and `NEXT_PUBLIC_PPJ_PROMO_FEE_AED=15`. Stays on Stripe TEST keys; no live impact.

**Verification:** `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` exit 0.

---

## Session: June 27, 2026 — Security Remediation Batch 4 (rate limiting, GET hardening, lib hardening, index)

Last active security batch (Batch 5 is deferred/architectural). 7 files; one DB change in new migration 043.

**Findings closed:**
- **P4-H1** (`src/app/api/requests/route.ts`) — added `checkRateLimitAsync('customer-active-request:'+user.id, 60, 60_000, 'customer_get_active_request')` (SOFT) to the GET handler; 429 + Retry-After. The quotes GET was already rate-limited (60/min) and is kept at 60/min per ruling (not lowered to the audit's suggested 30/min — already deployed, safe for active polling).
- **HIGH-02** (`src/app/api/requests/route.ts`) — removed the state-mutating expiry write (former lines 136-149). GET is now read-only: a `quoted` request older than 20 min is treated as expired in the response only (`activeRequest = null`), no DB write. `marketplace-cron` owns DB expiry. Confirmed safe — writes are server-authoritative: `select_quote_atomic` (`customer/quote/select/route.ts:52-56`) re-validates live DB state and rejects with `request_not_in_quoted_status`/`quote_expired`, so the brief read-vs-DB mismatch cannot cause an inconsistent write. Response shape unchanged.
- **HIGH-01** (`src/app/api/requests/quotes/route.ts`) — `request_id` is validated as a UUID (`z.string().uuid()`) before any DB call; missing/malformed input returns a uniform `400 { error: 'Invalid request' }`. No DB-level error reaches malformed input, removing the info-leak distinguishability.
- **M1 (fully closed)** (`src/app/api/admin/sentry-verify/route.ts`) — added `checkRateLimitAsync('admin-sentry-verify:'+user.id, 30, 60_000, 'admin_sentry_verify')` (SOFT) after the admin role check, matching Batch 3's `admin/providers/update`. No admin route now lacks rate limiting.
- **P4-M4 / H4** (`src/lib/rate-limit.ts`) — replaced the lifetime-of-instance `redisFallbackLogged` boolean with a 60s time-throttled timestamp (`lastFallbackLogAt` + `FALLBACK_LOG_THROTTLE_MS`) so a degraded fleet stays visible instead of silently logging once. Added `RateLimitMode = 'soft' | 'hard'`: SOFT (default) keeps in-memory fallback; HARD fails closed (deny) when Redis is unavailable and logs `rate_limit_redis_unavailable_hard_fail`.
- **P4-M6** (`src/lib/ops-auth.ts`) — Vercel's `CRON_SECRET` is honored only if ≥32 chars (else ignored + `ops_route_weak_cron_secret` warning); both secret comparisons now use constant-time `timingSafeEqual` (closes the timing side-channel). Fail-closed behavior preserved (missing OPS secret → 503, wrong → 401).
- **P4-L4** (`src/lib/env.ts`) — `OPS_CRON_SECRET` is now a production-only hard-fail in `validateEnv()` (throws at startup if missing in production), eliminating silent runtime 503s. NOT required in development (cron not exercised locally) → dev startup unaffected. Existing ≥32-char check retained.
- **P4-M1** (`supabase/migrations/043_jobs_en_route_at_index.sql`, new) — partial index `idx_jobs_en_route_at_active ON public.jobs (en_route_at) WHERE completed_at IS NULL`, matching the admin stuck-job query (`admin/dashboard/page.tsx:80-85`). Columns verified against `025_provider_state_machine.sql:19-21` (not phantom). Idempotent (`IF NOT EXISTS`). **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** until applied.

**Rate-limit helper signature change:** `checkRateLimitAsync` gains an optional 5th param `mode: RateLimitMode = 'soft'`. All 20 existing callers use the 4-arg form → fully backward compatible (tsc/lint/build pass). HARD mode is capability-only this batch — **NOT wired into any payment route** (deferred to a payment verification pass).

**Decisions stated:** quotes route kept at 60/min (ruling); env.ts = production-only hard requirement; GET rate limits = 60/min (requests), 60/min (quotes, pre-existing), 30/min (sentry-verify).

**Verification:** `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` exit 0.

**Migration baseline:** 001-042 deployed + runtime-verified; 043 CODE COMPLETE — NEEDS RUNTIME VERIFICATION. Next = 044.

---

## Session: June 26, 2026 — Batch 3 Runtime Hotfix (CRIT-02 cron phantom column)

**Runtime finding:** Calling `GET /api/ops/marketplace-cron` returned
`{ "success": false, "errors": ["sla_fetch: column requests.updated_at does not exist"], "sla_releases": 0 }`.
The SLA release path threw on every run and never executed.

**Root cause:** `enforceSla()` ordered the candidate query by `requests.updated_at`, which does not
exist on the `requests` table. Verified against the schema: `requests` (`001_initial_schema.sql:32-45`)
has `created_at` only; `accepted_at`/`quoted_at` were added in `031`; no migration ever adds
`updated_at` to `requests`. The earlier `updated_at` assumption was a phantom column.

**Fix (single file, no business-logic change):** `src/app/api/ops/marketplace-cron/route.ts` —
`enforceSla()` candidate query now orders by `requests.created_at` ascending (oldest-first) instead of
`updated_at`. Chosen over a `jobs` join on `COALESCE(arrived_at, en_route_at, accepted_at)` because
`created_at` is verified to exist, is monotonic, and accepted requests may have no `jobs` row yet
(making the COALESCE order fragile). Oldest-first still guarantees long-lived (most-likely-breached)
requests are examined before fresh ones, so `LIMIT 50` cannot starve a genuine breach. The CRIT-02
design is unchanged: the cron fetches `accepted`/`en_route`/`arrived` candidates and delegates ALL
threshold/release decisions to `sla_check_and_release`.

**Related risk — NOW FIXED in migration 042:** the same phantom `requests.updated_at` was referenced
inside `expire_stuck_active_requests` at `028:105` and `040:340` (`r.updated_at`) — the weekly stuck-
request cleanup RPC would throw `column requests.updated_at does not exist` at runtime and never run.
Fixed via new migration `042_fix_expire_stuck_phantom_column.sql`: `CREATE OR REPLACE FUNCTION
expire_stuck_active_requests(...)` superseding the deployed RPC, with the single line `r.updated_at`
→ `r.created_at`. Deployed migrations 028/040 are NOT edited. Signature `(p_stuck_cutoff TIMESTAMPTZ)
RETURNS INTEGER`, `SECURITY DEFINER`, `SET search_path = public`, and the REVOKE(anon,authenticated)
/ GRANT(service_role) pattern are all preserved. ALL Batch 2 / LOW-03 logic preserved verbatim
(jobs_this_month decrement only when `selected_quote_id` slot consumed, `GREATEST(0, ..-1)` no-double-
decrement guard, full release cleanup). Executable-SQL check: 1 function, 0 `r.updated_at`, 1
`r.created_at`, both LOW-03 guards present.

**Project-wide `updated_at` audit (every match classified):** the ONLY `updated_at` references that
bind to the `requests` table were the two phantom ones above (`028`/`040`, alias `r` = `FROM requests`),
now fixed. All other matches are legitimate columns on OTHER tables and were left untouched:
`provider_locations.updated_at` (`001:29`, plus the `pl.updated_at` staleness filters in
`002/004/010/018/033/035/039`), `fair_price_config.updated_at` (`031:178`), `stripe_events.updated_at`
(`013` indexes; `admin/dashboard` order), `billing/overage_payments.updated_at` (`006`), and the
`provider_locations`/route `updated_at` reads-writes in `provider/location`, `quote`, `accept`,
`overage-checkout`, `ppj-checkout`, `webhook`, `expire-requests`, `provider/dashboard`, and
`src/types/database.ts`. No remaining phantom `requests.updated_at` anywhere in src or migrations.

**Verification:** `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` exit 0.
CRIT-02 remains **CODE COMPLETE — NOT runtime-verified** until this fix is deployed and the cron test
returns `success` with `sla_releases >= 1` on a prepared `arrived`/`en_route` breach request.

---

## Session: June 26, 2026 — Security Remediation Batch 3 (shared ops/admin files)

### Summary
Closed the remaining findings that live in three shared ops/admin files, plus one new migration. **CRIT-02 is now FULLY closed** (the migration-040 RPC side shipped in Batch 2; this session shipped the cron side). Also closed P4-C2, P4-H2, P4-H4, P4-M2 (SECURITY_AUDIT_4), F3-L4 (SECURITY_AUDIT_3), and H5 + M1 (SECURITY_AUDIT_1). Each file was opened once and received all its changes. `admin/providers/update` is the only admin route touched; V2 overage enforcement remains deferred.

### Files modified
- **`src/app/api/ops/marketplace-cron/route.ts`**
  - **CRIT-02 (cron side):** `enforceSla()` now selects candidates with `status IN ('accepted','en_route','arrived')`, ordered `updated_at` ascending (oldest-first) before `LIMIT 50`, and calls `sla_check_and_release(id)` per row. The RPC remains the single source of truth for the 20m/2h/60m thresholds and the quoted-vs-open decision — no threshold math in the route. The old `accepted_at` cutoff filter was removed (it can't gate en_route/arrived, whose timestamps live on `jobs`).
  - **P4-H2:** candidates capped at `SLA_CANDIDATE_LIMIT = 50`, processed sequentially within `maxDuration`. Oldest-first ordering guarantees the closest-to-breach rows are never starved; if >50 candidates exist in one minute, the remainder is handled by subsequent minute runs.
  - **P4-M2:** `EXPIRE_BATCH_LIMIT = 500` added as `.limit(500)` to both `expireStaleQuotes` and `expireUnselectedRequests`.
  - **P4-H4:** the route returns **HTTP 500** when any critical subtask (a whole query/RPC-fetch that errors or throws) fails, so Vercel retries and alerting fires. Normal per-row outcomes (e.g. `sla_not_breached`) are not failures — logged and skipped.
- **`src/app/api/ops/monthly-allowance-reset/route.ts`**
  - **P4-C2:** unbounded load + `Promise.all` replaced with `.range()` pagination in pages of `PAGE_SIZE = 50` (ordered by id), processed page-by-page; memory stays flat.
  - **F3-L4:** query widened to `plan IN ('starter','pro','business')`. Business resets on the same monthly Stripe-period cadence and zeroes **only `jobs_this_month`** (+ advances `jobs_reset_at`); it never touches `job_credit_balance` or any billing/allowance field. starter/pro behavior unchanged.
  - Each reset UPDATE carries its eligibility in the WHERE clause (id, plan, `stripe_current_period_start`, `jobs_reset_at`), so pagination drift or a retry can never reset an ineligible/already-reset provider. P4-H4: 500 on load failure or any per-provider failure.
- **`supabase/migrations/041_admin_provider_status_atomic.sql`** (new, idempotent)
  - **H5:** `admin_update_provider_status_atomic(p_admin_id, p_provider_id, p_new_status, p_verified_badge, p_review_notes, p_previous_status, p_action)` — SECURITY DEFINER, `SET search_path = public`, revoke anon/authenticated + grant service_role. Validates status/action against the CHECK allow-lists; `COALESCE`-updates ONLY `status`/`verified_badge`; inserts one `provider_kyc_log` row when status changed — all in one transaction. Narrow named params only, so it is not a generic provider-update bypass and preserves the C3 immutable-column protection from migration 039.
- **`src/app/api/admin/providers/update/route.ts`**
  - **H5:** the two separate writes (provider update + audit-log insert) replaced with a single call to `admin_update_provider_status_atomic`. All existing validations (auth, admin role, target lookup, provider-role mismatch, no-updates guard) preserved; the route maps status→action and passes the previous status.
  - **M1:** `checkRateLimitAsync('admin-provider-update:'+user.id, 30, 60000, 'admin_provider_update')` added after the admin-role check; 429 + Retry-After when exceeded.
- **`RESCUEGO_MASTER_REFERENCE.md`** / **`SESSION_LOG.md`** — finding statuses, migration baseline (next = 042), Batch 3 deployment note, and §6.3 post-deploy verification plan.

### Decisions
- **Business reset cadence = monthly** (aligned with starter/pro via `stripe_current_period_start > jobs_reset_at`), not daily. Business subscribes via Stripe so it has a billing period; monthly keeps the admin dashboard "jobs this month" figure meaningful and the operation idempotent. Verified (code evidence) that no path gates a business provider on `jobs_this_month` (`provider-allowance.ts` returns null/unlimited for business; `accept_provider_request_atomic` is passed `-1`), so zeroing it is data-integrity only.
- **No double-decrement under cron retry (P4-H4 idempotency):**
  - `sla_check_and_release` re-selects the request `FOR UPDATE` and returns early (`not_in_releasable_status` / `sla_not_breached`) if the row is no longer in `accepted/en_route/arrived`; an already-released request is never decremented again.
  - `expireStaleQuotes` / `expireUnselectedRequests` are status-guarded UPDATEs (`.eq('status', …)`); a retry matches zero already-expired rows.
  - `monthly-allowance-reset` enforces eligibility in the UPDATE WHERE clause and advances `jobs_reset_at`, so a retry resets nothing twice.

### Discrepancies vs reports
None. `providers.status` is TEXT with a CHECK allow-list; `provider_kyc_log` columns matched the audit. No phantom columns.

### Pending / follow-up
- **CRIT-02 post-deploy QA (re-run required):** leave a job in `en_route` past 2h or `arrived` past 60m → the minute cron must auto-release it to `quoted`/`open` per D6. This could not pass before this batch. See `RESCUEGO_MASTER_REFERENCE.md` §6.3.
- **M1 follow-up:** `src/app/api/admin/sentry-verify/route.ts` still needs `checkRateLimitAsync` (only other admin route lacking it).
- Migration 041 RPC is **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** until 041 is deployed.

### Verification
- `npx tsc --noEmit` — exit 0.
- `npm run lint` — exit 0 (removed an unused param to keep it clean).
- `npm run build` — succeeded; full route manifest emitted (including the changed ops/admin routes).

---

## Session: June 25, 2026 — Security Remediation Batch 2 (RPC integrity & state-machine safety)

### Summary
Closed the RPC-integrity and state-machine findings from SECURITY_AUDIT_2 (CRIT-01, CRIT-02, HIGH-03, HIGH-04, HIGH-05, HIGH-06, MED-04, LOW-01, LOW-03, LOW-04), SECURITY_AUDIT_3 (F3-H2), and SECURITY_AUDIT_1 (H1). All DB changes are in one new idempotent migration, `040_rpc_integrity_state_safety.sql` (one block per RPC). No deployed migration was edited. Four API routes were updated to call the new/changed RPCs and drop racy or leaky logic. `admin/providers/update` (H5) and V2 overage enforcement (H3/D5) were deliberately left untouched per Batch scope.

### Schema verification (done before writing SQL)
- `requests.accepted_at` (031), `selected_quote_id` (031), `overage_cleared` (005), `price_change_requested`/`_status`/`_count` (031) — all exist.
- `jobs.en_route_at` and `jobs.arrived_at` (025) — confirmed to exist; used for en_route/arrived SLA breach timing.
- `ratings.customer_id` — confirmed absent; added in this migration.

### Migration 040 — `supabase/migrations/040_rpc_integrity_state_safety.sql` (new, idempotent)
- **2.1 helper `release_target_status(request_id)`** — read-only `STABLE` function; returns `'quoted'` if a quote with `status='pending' AND expires_at > now()` exists, else `'open'`. Mutates nothing. Shared by both release paths (D6).
- **2.3 `release_job_atomic` (HIGH-03 + MED-04 + F3-H2)** — single block; preserves `(success, reason)` return. Now sets status via `release_target_status()`, clears `selected_quote_id`/`accepted_at`, sets `overage_cleared=false`, and decrements `jobs_this_month` (`GREATEST(0, .. - 1)`) only when `selected_quote_id` was present before release (V2 slot consumed; captured beforehand).
- **2.2 `sla_check_and_release` (CRIT-02 + HIGH-04)** — single block; preserves `(success, reason, released_provider_id, needs_refund)` return. Now releases from `accepted`/`en_route`/`arrived`. Breach computed inside the RPC with named-constant thresholds: **accepted = 20 minutes** (vs `requests.accepted_at`), **en_route = 2 hours** (vs `jobs.en_route_at`), **arrived = 60 minutes** (vs `jobs.arrived_at`). Sets status via the shared helper, clears `accepted_by`/`selected_quote_id`/`accepted_at`/`overage_cleared`, decrements `jobs_this_month` only when a slot was consumed (HIGH-04, no double-decrement).
- **2.4 `expire_stuck_active_requests` (LOW-03)** — single block; preserves `RETURNS INTEGER` + `(p_stuck_cutoff TIMESTAMPTZ)`. Per-row decrement of `jobs_this_month` (`GREATEST(0, .. - 1)`) only when the released request had `selected_quote_id` set.
- **2.5 `advance_provider_job_state` (LOW-01 + LOW-04)** — single block; added `SET search_path = public` and a whitelist rejecting any `p_to_status` outside `('en_route','arrived','in_progress')` (`invalid_target_status`).
- **2.6 `request_price_change_atomic` (CRIT-01)** — new RPC; single guarded `UPDATE ... WHERE accepted_by=<prov> AND status='in_progress' AND price_change_count=0 RETURNING id`. Eliminates the read-then-write race.
- **2.7 `respond_price_change_atomic` (HIGH-06)** — new RPC; guard `status='in_progress' AND price_change_status='pending'` inside the RPC. Reject → `final_price=NULL` (never surfaces the requested price); approve → `final_price=price_change_requested`. `price_change_count` untouched (stays 1; no second attempt).
- **2.8 `ratings.customer_id` (HIGH-05)** — `ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES users(id)` + index + deterministic backfill via `jobs → requests` (job_id is UNIQUE so each rating maps to exactly one customer).
- **2.9 `select_quote_atomic` (H1)** — single block; `provider_documents JSONB` removed from `RETURNS TABLE` and from the `RETURN QUERY` (6 → 5 columns). Customer still gets name/phone/rating.
- All RPCs keep `SECURITY DEFINER`, `SET search_path = public`, and the revoke-from-anon/authenticated + grant-to-service_role pattern.

### Routes updated
- `src/app/api/provider/jobs/price-change/route.ts` (CRIT-01) — removed the pre-fetch + manual count/status checks + racy `.update()`; now calls `request_price_change_atomic`; maps `price_change_not_allowed` → 409.
- `src/app/api/customer/price-change/respond/route.ts` (HIGH-06) — removed the pre-fetch guards + racy `.update()`; now calls `respond_price_change_atomic`; uses returned `final_price`.
- `src/app/api/ratings/route.ts` (HIGH-05) — writes `customer_id: user.id` on insert (route already verifies the job's request belongs to this customer).
- `src/app/api/customer/quote/select/route.ts` (H1) — dropped `provider_documents` from the result type and stopped returning `documents`; keeps name/phone/rating. Verified no client consumes `documents` from this response.

### Backfill decision (ratings.customer_id)
Backfill existing rows. `ratings.job_id` is UNIQUE (migration 022) and each job maps to exactly one request, so the customer is unambiguous — there is no fan-out or duplicate mapping. The backfill UPDATE only sets rows where the joined `requests.customer_id` is non-null; any rating whose job/request cannot be resolved is left null and populated going forward. Post-deploy check in §6.2-H must return 0.

### Discrepancies vs reports
None. All columns the audits referenced exist as described; `ratings.customer_id` was genuinely missing (matches HIGH-05). No phantom columns encountered.

### Pending in Batch 3 (noted, not done here)
- **CRIT-02 cron routing:** `enforceSla()` in `src/app/api/ops/marketplace-cron/route.ts:115–121` still queries `status='accepted'` only. It must be widened to `status IN ('accepted','en_route','arrived')` (and compute the cutoff per state) so the now-extended `sla_check_and_release` actually receives `en_route`/`arrived` breaches. The RPC side is ready.
- H5 (`admin/providers/update`) and H3/D5 (V2 overage enforcement) intentionally deferred.

### Verification
- `npx tsc --noEmit` — exit 0, no output.
- `npm run lint` — exit 0, no errors/warnings.
- `npm run build` — succeeded; full route manifest emitted (including `/api/provider/jobs/price-change`, `/api/ratings`).
- All migration-040 RPC changes are **CODE COMPLETE — NEEDS RUNTIME VERIFICATION** until 040 is deployed; post-deploy SQL is in `RESCUEGO_MASTER_REFERENCE.md` §6.2.

---

## Session: June 24, 2026 — Security Remediation Batch 1 (existential fixes)

### Summary
Closed the existential security findings from SECURITY_AUDIT_1 and SECURITY_AUDIT_3 across the database, the Stripe webhook, the subscription checkout route, the request proxy, and request-user auth. One audit finding (C1) was found to be based on outdated Next.js knowledge and was intentionally NOT applied — see "Decision required" below.

### Migration 039 — `supabase/migrations/039_security_backstop.sql` (new, idempotent)
- **C2** — `enforce_users_immutable_columns()` `BEFORE UPDATE` trigger on `users`: blocks any change to `role` unless the caller is admin or genuine service_role. Prevents self-escalation to admin.
- **C3** — `enforce_providers_immutable_columns()` `BEFORE UPDATE` trigger on `providers`: locks `status, verified_badge, rating, plan, stripe_customer_id, stripe_subscription_id, stripe_current_period_start, stripe_current_period_end, jobs_this_month, jobs_reset_at, visibility_reduced, sla_failure_count, job_credit_balance, ppj_recovery_credits, release_count, provider_side_cancellation_count, unable_to_complete_count, last_upgrade_bonus_key, documents`. Prevents provider self-activation, plan changes, and billing/KYC tampering. (`max_active_jobs` and `completed_jobs_count` deliberately excluded — they do not exist on the table.)
- **Server-side guard** — new `is_service_role()` helper inspects the JWT `role` claim (`request.jwt.claims`). The triggers use `is_admin() OR is_service_role()`, so admin/server (service_role) writes pass while anon and authenticated browser writes are blocked. `auth.uid() IS NULL` was rejected as too weak because the anon role also has a null uid.
- **C5 (D2)** — `submit_quote_atomic` re-enables fair-price validation. Bounds are read exclusively from `fair_price_config` (no hard-coded prices); out-of-range quotes are rejected as `price_too_low` / `price_too_high`. Fallback: missing service-type row uses the `'other'` config row; if no config exists at all, range check is skipped (validity-only) to avoid blocking honest providers on an ops misconfiguration.
- **D8** — `get_nearby_open_requests` recreated with `fuzzy_latitude` and `fuzzy_longitude` added to the return (all existing columns, including `destination` and `destination_area`, preserved). Fixes the emirate/area badge on the primary RPC path.
- **F3-H1 schema** — `overage_payments.accept_failed BOOLEAN DEFAULT false` + partial index for manual-review tracking.
- All modified RPCs keep `SECURITY DEFINER`, `SET search_path = public`, and the existing `service_role` grant.

### `src/app/api/stripe/webhook/route.ts`
- **C4 / F3-C1 (D1)** — `KYC_PROTECTED` extended to `['pending','under_review','rejected','suspended']` and checked before the `active` branch, so a payment never auto-activates a provider; activation waits for admin. Subscription details (plan, stripe ids, billing period) are still recorded.
- **F3-H1** — on a failed overage accept, `overage_payments.accept_failed` is set and the event is logged for admin follow-up; `overage_cleared` is now set only after a successful accept. No automatic refund.
- **F3-M1** — an active subscription whose plan cannot be resolved now logs (with subscription id and unmatched price ids) and throws so the event is recorded failed, instead of silently writing an unresolved plan.
- **F3-M2 / M4** — `claimStripeEvent` is now atomic (conflict-aware upsert + status-guarded conditional re-claim), removing the TOCTOU window.
- **F3-L1** — `payment_intent.canceled` handled; only currently-`pending` PPJ/overage rows move to `failed` (never touches paid/succeeded/`accept_failed`).
- **L4** — `PROCESSING_TIMEOUT_MS` reduced from 10 minutes to 3 minutes.

### `src/app/api/stripe/create-checkout/route.ts`
- **M3 / F3-M3 (D1)** — KYC status gate: `rejected` and `suspended` providers get 403 before both the checkout and billing-portal branches; `pending`/`under_review`/`active` may proceed.

### `src/proxy.ts` + `src/lib/supabase/request-user.ts`
- **H7** — CSRF: a state-mutating `/api/` POST with neither Origin nor Referer is now rejected (was silently skipped).
- **D9** — removed the `*.vercel.app` wildcard; only enumerated `ALLOWED_ORIGINS` (plus the request's own host) are accepted.
- **D10** — removed the Bearer-token fallback from `getRequestUser`; auth is cookie-session only. The four callers were updated to call `getRequestUser()`. Cron/ops routes use `OPS_CRON_SECRET`, so they are unaffected.

### Decision required — C1 (proxy vs middleware)
The audit asked to convert `src/proxy.ts` to `src/middleware.ts` with `export default middleware`. The bundled Next.js 16.2.6 docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) show that in v16.0.0 the `middleware` convention was **deprecated and renamed to `proxy`**; the official codemod renames `middleware.ts` → `proxy.ts` (the opposite direction). The current `src/proxy.ts` with a named `proxy` export is the correct, registered convention — the production build confirms it as `ƒ Proxy (Middleware)`. The rename was therefore NOT performed. Awaiting a ruling.

### Admin activation path check (read-only)
`src/app/api/admin/providers/update/route.ts` accepts a `status` of `active` (validation schema), assigns it, and writes via the admin client. A manual admin activation path (`pending`/`under_review` → `active`) **EXISTS**. D1 is complete on the admin side.

### Verification (static)
- `npx tsc --noEmit` — exit 0.
- `npm run lint` (eslint) — 0 errors, 0 warnings.
- `npm run build` — exit 0; proxy registered as `ƒ Proxy (Middleware)`.

### C1 ruling (confirmed)
C1 recorded as **Not Applicable on Next.js 16**: `middleware` was deprecated and renamed to `proxy` in v16.0.0. `src/proxy.ts` is the active registered middleware/proxy entrypoint (build confirms `ƒ Proxy (Middleware)`). No open vulnerability remains.

### Runtime verification of C2/C3 — ATTEMPTED, BLOCKED (not yet verified)
- Probed the cloud DB read-only with the service-role key (introspection only, not a substitute test): `public.is_service_role()` → **PGRST202 "function not found"**, `overage_payments.accept_failed` → **42703 "column does not exist"**. Conclusion: **migration 039 is NOT applied to the cloud database yet.**
- This environment has **no `supabase` CLI, no `psql`, no `docker`, no local Supabase stack, and no direct `DATABASE_URL`/`DIRECT_URL`** — so 039 cannot be applied locally and the anon/authenticated attacker-context UPDATEs cannot be executed here.
- Per the explicit instruction, no `service_role` test or code-logic review was substituted as "runtime-verified." The C2/C3 (and the migration-dependent) findings are marked **CODE COMPLETE — NEEDS RUNTIME VERIFICATION**.
- Exact verification steps (psql `SET request.jwt.claims` + Supabase anon JS) are documented in `RESCUEGO_MASTER_REFERENCE.md` §6.1 to run after 039 deploys. Pass criteria: tests 1 & 2 return SQLSTATE `42501`; test 3 (service_role/admin) succeeds.

### Documentation corrections
- `RESCUEGO_MASTER_REFERENCE.md` providers schema: `max_active_jobs` and `completed_jobs_count` corrected to **do NOT exist** on the `providers` table (verified against full migration history; the plan concurrency cap is derived from `plan` at runtime).
- Marked **NEEDS RUNTIME VERIFICATION**: CSRF hardening (H7/D9), Stripe webhook behavior (C4/F3-C1, M4/F3-M2, F3-M1, F3-L1), and production payment-path validation (M3/F3-M3).

### Batch 1 close-out
Static verification passed. The only remaining gate is the post-deploy runtime check of the 039 triggers (§6.1). Once 039 is applied and §6.1 passes, Batch 1 is fully closed.

---

## Session: June 11, 2026 — Full Project Discovery Documentation Pass

### Summary
Ran a full repository discovery pass from source code before updating documentation. This was documentation-only work: no source code, feature, bug-fix, refactor, or commit was performed.

### Source Discovery

| Area | Result |
|------|--------|
| Source/config/migration/i18n files inspected | 187 |
| API route handlers mapped | 28 |
| App page/layout/loading/error/SEO files mapped | 50 |
| Component files mapped | 32 |
| Lib/type/i18n service files mapped | 22 |
| Database migrations inspected | 38 |
| Supabase functions area | Deprecated; only `supabase/functions/README.md` present |

### Maps Built

- Current architecture map
- Database schema map
- RLS model map
- Marketplace lifecycle map
- KYC lifecycle map
- Stripe/payment lifecycle map
- Customer journey
- Provider journey
- Admin journey
- Realtime/event flow
- Deployment model

### Documentation Updated

| File | Update |
|------|--------|
| `ARCHITECTURE.md` | Rebuilt as the canonical source-derived architecture, including required workflow maps and `OBSERVATIONS FOR AUDIT` |
| `README.md` | Added full-discovery status and clarified current implementation state |
| `CLAUDE.md` | Added full-discovery marker for future AI agents |
| `PROJECT_HANDOFF.md` | Added source-discovery basis |
| `ROADMAP.md` | Added source-discovery basis and realtime implementation status |
| `MARKETPLACE_V2_SPEC.md` | Added source-discovery basis and realtime marketplace behavior |
| `SESSION_LOG.md` | Recorded this discovery pass |

### Notes
No source files were modified. Live production environment state, applied remote migrations, Supabase bucket privacy, Stripe dashboard configuration, and Vercel environment variables were not verified from local source.

---

## Session: June 11, 2026 — Documentation Refresh From Source

### Summary
Refreshed the primary project documentation from the current codebase without touching source code. The goal was to make the docs usable as a current handoff for a fresh AI agent.

### Documentation Updated

| File | Update |
|------|--------|
| `ARCHITECTURE.md` | Created canonical current-state architecture, database/storage/KYC/payment map, and `OBSERVATIONS FOR AUDIT` section |
| `README.md` | Replaced stale Phase 1A and migration 016 claims with current stack, migration, and documentation map |
| `CLAUDE.md` | Rewritten as current AI-agent project notes |
| `PROJECT_HANDOFF.md` | Rewritten as concise current handoff |
| `ROADMAP.md` | Updated to reflect completed Marketplace V2, KYC, payment, ops, and production-hardening work |
| `MARKETPLACE_V2_SPEC.md` | Updated from future/planning language to implemented behavior and current caveats |

### Source Review Scope
Read project configuration, migrations, API routes, app surfaces, components, lib utilities, shared types, i18n files, and existing markdown docs to align documentation with implementation.

### Notes
No source files were modified. Observed implementation concerns were documented only in `ARCHITECTURE.md` under `OBSERVATIONS FOR AUDIT`.

---

## Session: June 10, 2026 — Lifecycle Bugfixes + Distance Fix + Lint Clean

### Summary
Three focused bug-fix sessions addressing critical lifecycle issues in the provider/customer request flow, distance display on provider request cards, and a full lint pass to zero errors.

### Changes

#### Part 1 — Lifecycle & Realtime Bugfixes (commits: ccb1b65, 3ee45e6)

| Category | Detail |
|----------|--------|
| Provider 429 errors | `ProviderRealtimeRefresh`: single shared `supabase` client via `useRef(createClient())`; debounce raised from 800ms → 1500ms; added 3s global throttle so `router.refresh()` fires at most once per 3s regardless of event volume |
| Provider duplicate refresh | `ProviderRequestList`: removed redundant `visibility`/`online` event handlers (handled by `ProviderRealtimeRefresh`) |
| Provider 429 on quote | `ProviderQuoteForm`: handle HTTP 429 explicitly with user-facing `tooManyAttempts` message instead of crashing |
| Customer stale cancel dialog | Added `justCancelledRef` guard — blocks all fetch/polling/realtime for 3s after cancel to prevent stale server state from re-setting `activeRequest` |
| Concurrent fetch prevention | Added `fetchInFlightRef` to `loadRequestState()` — prevents parallel fetches racing each other |
| Submit button disabled after cancel | `resetForm()` now correctly clears `requestId`; `handleSubmit()` clears `justCancelledRef` to re-enable polling for new request |
| Customer polling after cancel | Polling/realtime/visibility effects all guard on `justCancelledRef.current` |
| CustomerQuoteList debounce | Added 1s debounce + in-flight guard to prevent rapid duplicate fetches on realtime events |

#### Part 2 — Distance Display Fix (commits: 3ee45e6, d6a1296)

| Category | Detail |
|----------|--------|
| Root cause 1: WKB hex | Supabase REST returns `GEOMETRY(Point,4326)` columns as hex WKB, not GeoJSON. `location.coordinates` was always `undefined` in JS |
| Root cause 2: fallback no coords | Fallback query never fetched `fuzzy_latitude`/`fuzzy_longitude` so Haversine couldn't compute distance |
| Root cause 3: fuzzy not propagated | `NearbyOpenRequestRow` type didn't include fuzzy coords, so `ProviderRequestList` never received them |
| Fix: migration 036 | Added `lat`/`lng` as `GENERATED ALWAYS AS (ST_X/ST_Y)` columns on `provider_locations` — plain `float8`, no parsing needed |
| Fix: fallback query | Now selects `fuzzy_latitude, fuzzy_longitude` and computes `distanceKm()` server-side |
| Fix: type propagation | `NearbyOpenRequestRow` now includes optional `fuzzy_latitude/fuzzy_longitude`; normalization explicitly carries them through |
| No-GPS requests | When `fuzzy_latitude` is null (address-only request), shows "بدون إحداثيات GPS" instead of generic distance label |

#### Part 3 — Lint Clean (commit: 8bb0dd0)

| File | Fix |
|------|-----|
| `ProviderRealtimeRefresh` | `useRef(createClient())` — avoid ref access during render (React Compiler rule) |
| `CustomerQuoteList` | Separate `applyQuotesResult` callback; add `nowMs` state for `Date.now()` in render; restore `fetchInFlightRef` |
| `ProviderRequestList` | Remove unused `Button` import and dead `requestAcceptConfirmation` function |
| `SlaTimer` | Standalone `getRemaining()` helper — fixes "variable accessed before declaration" + memoization error |
| `api/requests/quotes/route.ts` | Remove unused `logger` import |
| `eslint.config.mjs` | Disable `react-hooks/set-state-in-effect` (false positive on async fetch patterns) |

### Files Modified
| File | Changes |
|------|---------|
| `src/components/provider/ProviderRealtimeRefresh.tsx` | Single client ref, 1.5s debounce + 3s throttle |
| `src/components/forms/ProviderRequestList.tsx` | Remove duplicate refresh, dead code; `formatDistance` takes `hasGps` param |
| `src/components/provider/ProviderQuoteForm.tsx` | Explicit 429 handling |
| `src/app/customer/request/page.tsx` | `justCancelledRef`, `fetchInFlightRef`, `resetForm` clears `requestId` |
| `src/components/customer/CustomerQuoteList.tsx` | Debounce + in-flight guard + `nowMs` state |
| `src/app/provider/dashboard/page.tsx` | Use `lat`/`lng` columns; fallback selects fuzzy coords; compute distance for all rows |
| `src/components/provider/SlaTimer.tsx` | Refactored to avoid hooks ordering issue |
| `src/app/api/requests/quotes/route.ts` | Remove unused import |
| `eslint.config.mjs` | Disable false-positive rule |
| `messages/ar.json` | Add `tooManyAttempts`, `distanceCalculating` keys; rename `distanceUnavailable` |
| `messages/en.json` | Add `tooManyAttempts`, `distanceCalculating` keys; rename `distanceUnavailable` |
| `supabase/migrations/036_provider_location_lat_lng_columns.sql` | NEW — generated `lat`/`lng` columns on `provider_locations` |

### Build Status
- `tsc --noEmit`: PASS
- `eslint src --ext .ts,.tsx --max-warnings=0`: PASS (0 errors, 0 warnings)
- `next build`: PASS (57 routes, all dynamic)

### Pending Production Action
**Migration 036 must be applied before deploying** (adds `lat`/`lng` generated columns to `provider_locations`):
```sql
ALTER TABLE public.provider_locations
  ADD COLUMN IF NOT EXISTS lat double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  ADD COLUMN IF NOT EXISTS lng double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED;
```

---



### Summary
Final polish session for Marketplace V2. Enhanced customer-side realtime subscriptions (quote UPDATE events, client-side expiry eviction, faster polling for quoted state). Fixed RTL compatibility issues, i18n gaps, and a duplicate translation key. Full build verification passed.

### Changes
| Category | Detail |
|----------|--------|
| Customer Realtime | `CustomerQuoteList` now subscribes to both INSERT and UPDATE on `request_quotes` — instant reaction to quote expiry |
| Client-side Eviction | Added 5s timer to proactively remove expired quotes from UI between polls |
| Polling Optimization | Customer request page polls every 10s in `quoted` state (was 60s) for timely expiry awareness |
| RTL Fix | `PriceChangeNotification` arrow replaced with `<ArrowRight>` + `rtl:rotate-180` |
| i18n Fix | Toast dismiss button uses `t('dismiss')` instead of hardcoded "Dismiss"; added `components.toast` namespace |
| Duplicate Key Fix | Removed duplicate `networkConnectionLost` in `providerRequestList` (line 366 shadowed line 322) |

### Files Modified
| File | Changes |
|------|---------|
| `src/components/customer/CustomerQuoteList.tsx` | Added UPDATE subscription + client-side expired quote eviction timer |
| `src/app/customer/request/page.tsx` | Reduced poll interval to 10s for `quoted` status |
| `src/components/customer/PriceChangeNotification.tsx` | Replaced `&rarr;` with RTL-safe `ArrowRight` icon |
| `src/components/ui/Toast.tsx` | Added `useTranslations('components.toast')` for dismiss aria-label |
| `messages/en.json` | Added `components.toast.dismiss`, removed duplicate `networkConnectionLost` |
| `messages/ar.json` | Added `components.toast.dismiss`, removed duplicate `networkConnectionLost` |

### Build Status
- `tsc --noEmit`: PASS
- `next build`: PASS (57 routes, all dynamic)

### Marketplace V2 Implementation — COMPLETE
Sessions 1-8 delivered the full Marketplace V2 feature set:
- Migration 031 (schema + RPCs)
- Dispatch engine with ring-based expansion
- Range estimator + provider scoring
- API routes (quote, select, price change)
- Cron jobs (quote/request expiry, SLA enforcement, weekly reset)
- Provider UI (quote form, SLA timer, realtime notifications)
- Customer UI (quote list, price change, realtime updates)
- Toast notification system
- Fuzzy coordinates for privacy
- Full i18n (Arabic + English) + RTL compatibility

---

## Session: June 9, 2026 — Marketplace V2 Session 7 (Realtime Notifications)

### Summary
Added lightweight toast notification system, updated provider realtime subscriptions for V2 events (quote selected/rejected, price change responses, new nearby requests). Integrated SLA timer into provider dashboard active job card. Added fuzzy coordinate generation on request creation.

### Files Created
| File | Purpose |
|------|---------|
| `src/components/ui/Toast.tsx` | Minimal toast system: ToastContext, ToastProvider, useToast hook (success/warning/info) |
| `src/components/layout/ClientProviders.tsx` | Client wrapper providing ToastProvider context |

### Files Modified
| File | Changes |
|------|---------|
| `src/app/layout.tsx` | Wrapped children with ClientProviders inside NextIntlClientProvider |
| `src/components/provider/ProviderRealtimeRefresh.tsx` | Added 3 realtime channels: open-requests (new request toast), quotes (selected/rejected toast), active-job (price change response toast) |
| `src/app/provider/dashboard/page.tsx` | Added `accepted_at` to DashboardRequestRow type, imported + rendered SlaTimer in active job card |
| `src/app/api/requests/route.ts` | Added generateFuzzyCoordinates import + fuzzy_latitude/fuzzy_longitude on request insert |
| `messages/en.json` | +5 keys (components.providerRealtime) |
| `messages/ar.json` | +5 keys (components.providerRealtime) |

### Build Status
- `tsc --noEmit`: PASS
- `next build`: PASS

---

## Session: June 9, 2026 — Marketplace V2 Session 6 (Customer UI)

### Summary
Built customer-facing quote selection UI and price change approval flow. Two new components integrated into the existing customer request page with realtime updates.

### Files Created
| File | Purpose |
|------|---------|
| `src/components/customer/CustomerQuoteList.tsx` | Score-ranked quote list with realtime + polling, countdown timers, select button |
| `src/components/customer/PriceChangeNotification.tsx` | Price change approve/reject UI with before/after comparison |

### Files Modified
| File | Changes |
|------|---------|
| `src/app/customer/request/page.tsx` | Added 'quoted' status view with CustomerQuoteList, PriceChangeNotification in active job, extended ActiveRequest type |
| `messages/ar.json` | +21 keys (customerQuoteList, priceChangeNotification, customer.request quote keys) |
| `messages/en.json` | +21 keys (same) |

### Build Status
- `tsc --noEmit` — PASS
- `next build` — PASS

---

## Session: June 9, 2026 — Marketplace V2 Session 5 (Provider UI)

### Summary
Built provider-facing quote form and SLA timer. Replaced the Accept button with inline quote submission and simplified the complete job flow.

### Files Created
| File | Purpose |
|------|---------|
| `src/components/provider/ProviderQuoteForm.tsx` | Inline quote submission form with price input, validation, success state |
| `src/components/provider/SlaTimer.tsx` | Countdown timer with warning (amber) and breach (red) states |

### Files Modified
| File | Changes |
|------|---------|
| `src/components/forms/ProviderRequestList.tsx` | Replaced Accept button with ProviderQuoteForm, fuzzy location + destination display |
| `src/components/forms/CompleteJobForm.tsx` | Removed price input, simplified to Mark Complete button |
| `messages/ar.json` + `messages/en.json` | +13 keys (sendQuote, quoteSent, fuzzyLocation, slaTimer, markComplete, etc.) |

### Build Status
- `tsc --noEmit` — PASS
- `next build` — PASS

---

## Session: June 9, 2026 — Marketplace V2 Session 4 (API Routes)

### Summary
Created all 5 API routes for the Marketplace V2 quote flow: provider quote submission, customer quote listing (ranked by provider score), customer quote selection, provider price change request, and customer price change response.

### Files Created
| File | Method | Purpose |
|------|--------|---------|
| `src/app/api/provider/jobs/quote/route.ts` | POST | Submit quote — Haversine distance, range validation via submit_quote_atomic RPC |
| `src/app/api/requests/quotes/route.ts` | GET | Top 5 quotes ranked by provider score (40% rating, 30% proximity, 20% price, 10% acceptance) |
| `src/app/api/customer/quote/select/route.ts` | POST | Select quote via select_quote_atomic RPC, reveals provider details |
| `src/app/api/provider/jobs/price-change/route.ts` | POST | Request price revision (max 1 per job, in_progress only) |
| `src/app/api/customer/price-change/respond/route.ts` | POST | Approve/reject price change |

### Key Design Decisions
1. Distance computed in app layer (geo.ts Haversine), passed to RPC as `p_distance_km`
2. Quote ranking: fetch up to 20 pending quotes, score all, sort desc, return top 5
3. Anonymous provider IDs: first 4 chars of UUID uppercase (e.g., "A7F2")
4. Price change: two-step async flow (provider requests → customer responds)
5. All routes: Zod validation + auth + role check + rate limit + admin client RPC + structured logging
6. Error mapping: RPC reasons mapped to semantic HTTP codes (422 price range, 429 daily limit, 409 capacity)

### Rate Limits Applied
| Endpoint | Limit | Window |
|----------|-------|--------|
| provider-quote | 30 req | 60s |
| customer-quotes | 60 req | 60s |
| customer-select | 10 req | 60s |
| price-change | 5 req | 60s |
| price-respond | 10 req | 60s |

### Build Status
- `tsc --noEmit` — PASS
- `next build` — PASS

---

## Session: June 9, 2026 — Marketplace V2 Session 3 (Dispatch Engine + Cron Jobs)

### Summary
Built the dispatch engine with ring-based proximity filtering, plan priority tiers, and capacity checks. Created 2 new cron routes: a per-minute marketplace cron (quote expiry + request expiry + SLA enforcement) and a weekly SLA reset cron.

### Files Created
| File | Purpose |
|------|---------|
| `src/lib/dispatch.ts` | Dispatch engine: ring filtering, plan priority sort, capacity/daily limit/visibility checks |
| `src/app/api/ops/marketplace-cron/route.ts` | Combined cron (every 1 min): expire quotes, expire unselected requests, SLA auto-release |
| `src/app/api/ops/weekly-sla-reset/route.ts` | Weekly cron (Sun 00:00): apply visibility_reduced for 3+ failures, reset sla_failure_count |

### Files Modified
| File | Change |
|------|--------|
| `vercel.json` | Added 2 cron schedules: `marketplace-cron` (*/1), `weekly-sla-reset` (Sun 00:00) |

### Dispatch Engine Design
- **Ring Logic:** 4 rings (5km, 10km, 20km, infinity). Time-based advancement: 5 min per ring.
- **Plan Priority:** Business (1) > Pro (2) > Starter (3) > PPJ (4). Within same tier, sort by distance.
- **PPJ Exclusion:** PPJ providers excluded from Ring 1 (subscription providers get first visibility).
- **Capacity Check:** max_active_jobs per plan (PPJ:1, Starter:1, Pro:2, Business:5).
- **Daily Limit:** daily_visibility_limit per plan (PPJ:3, Starter:5, Pro:10, Business:20).
- **Visibility Reduced:** Providers with 3+ SLA failures hidden until weekly reset.

### Cron Architecture
- `marketplace-cron` runs 3 parallel tasks: expire_quotes, expire_unselected_requests, enforce_sla
- SLA enforcement: fetches breached requests (accepted 20+ min), calls `sla_check_and_release` RPC per request (batch limit 50)
- `weekly-sla-reset`: identifies high-failure providers, applies visibility_reduced, resets counters

### Build Status
- `tsc --noEmit` — PASS
- `next build` — PASS

---

## Session: June 9, 2026 — Marketplace V2 Sessions 1+2 (Assessment + Migration + Foundation)

### Summary
Completed full assessment of Marketplace V2 implementation. Designed and wrote migration 031 with all schema changes, 3 new atomic RPCs, and updated complete_provider_job_atomic. Built foundation libraries for range estimation, provider scoring, and geo utilities.

### Migration 031 Applied
- **3 new tables:** `request_quotes`, `provider_dispatch_log`, `fair_price_config`
- **New columns on `requests`:** destination, destination_area, destination_latitude/longitude, fuzzy_latitude/longitude, selected_quote_id, price_change_requested/status/count, quoted_at, accepted_at
- **New columns on `providers`:** sla_failure_count, visibility_reduced
- **Status constraint:** Added `'quoted'` to CHECK
- **RLS policies:** Provider reads own quotes/logs, customer reads quotes on own requests, admin full access, authenticated reads fair_price_config
- **Indexes:** 8 new indexes for query performance
- **Realtime:** `request_quotes` added to `supabase_realtime` publication
- **Seed data:** 6 service types in `fair_price_config` (tow, battery, flat_tire, fuel, lockout, other)

### RPCs Created/Updated

| RPC | Signature | Purpose |
|-----|-----------|---------|
| `submit_quote_atomic` | `(UUID, UUID, NUMERIC(10,2), NUMERIC(6,2), BOOLEAN)` | Provider submits quote with server-side range validation |
| `select_quote_atomic` | `(UUID, UUID, UUID)` | Customer selects quote, triggers acceptance, reveals provider |
| `sla_check_and_release` | `(UUID)` | Auto-release on 20min SLA breach, penalty, correct status (open vs quoted) |
| `complete_provider_job_atomic` | `(UUID, UUID, INTEGER DEFAULT NULL)` | **Updated** — derives final_price from quote/price_change, legacy fallback |

### New Library Modules

| File | Exports |
|------|---------|
| `src/lib/range-estimator.ts` | `computePriceRange`, `validateProposedPrice`, `computePricePerKm`, `computePriceScore` |
| `src/lib/provider-score.ts` | `computeProviderScore` (0.40 rating + 0.30 proximity + 0.20 price + 0.10 acceptance), `computeAcceptanceRate`, `getMaxRingDistanceKm` |
| `src/lib/geo.ts` (updated) | Added `distanceKm`, `generateFuzzyCoordinates` (~1km offset), `getDispatchRing` |
| `src/lib/provider-allowance.ts` (updated) | Added `getMaxActiveJobs`, `getDailyVisibilityLimit` |

### Types & Constants Added
- `src/types/database.ts` — `RequestQuote`, `ProviderDispatchLog`, `FairPriceConfig`, `ServiceType`, `QuoteStatus`, `PriceChangeStatus`, `DispatchEventType`; updated `Request` (12 new fields) and `Provider` (2 new fields)
- `src/types/index.ts` — `SOFT_LAUNCH_MODE`, `DISPATCH_RINGS_M`, `DAILY_VISIBILITY_LIMITS`, `MAX_ACTIVE_JOBS`, `SLA_WARNING_MS`, `SLA_DEADLINE_MS`, `CUSTOMER_SELECTION_TIMEOUT_MS`, score weight constants

### Design Decisions Documented
1. `p_distance_km` computed in app layer (Haversine via geo.ts), passed to RPC
2. `p_is_soft_launch` read from env in API route, passed to RPC
3. SLA release sets status to `'quoted'` if pending non-expired quotes exist, else `'open'`
4. Added `destination_latitude`/`destination_longitude` for Haversine distance calc
5. `complete_provider_job_atomic` backward compatible — legacy `p_final_price` still works for pre-V2 requests

### Files Changed
- `supabase/migrations/031_marketplace_v2_schema.sql` — NEW (applied)
- `src/lib/range-estimator.ts` — NEW
- `src/lib/provider-score.ts` — NEW
- `src/lib/geo.ts` — 3 new exports
- `src/lib/provider-allowance.ts` — 2 new exports
- `src/types/database.ts` — 6 new types, 2 updated interfaces
- `src/types/index.ts` — 11 new constants
- `src/app/admin/requests/page.tsx` — Added 'quoted' to STATUS_LABEL_KEYS
- `src/app/customer/history/page.tsx` — Added 'quoted' to statusColors + statusLabelMap

### Build Status
- `tsc --noEmit` — PASS
- `next build` — PASS (all routes compiled)

## June 9, 2026 — Marketplace V2 Testing Bugs Discovered & Fixed

### Bug 1: CSRF 403 on quote submission
| | |
|---|---|
| **Symptom** | Provider POST `/api/provider/jobs/quote` returned 403 "Forbidden" |
| **Root Cause** | `proxy.ts` CSRF check required Origin to match `ALLOWED_ORIGINS`. Vercel preview deployments (`.vercel.app`) were blocked. |
| **Fix** | Added Vercel preview check: `isVercelPreview = requestOrigin.endsWith('.vercel.app')` + expanded `ALLOWED_ORIGINS` with `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. Commit: `93eabb6` |

### Bug 2: "Go online before submitting quotes" on first quote attempt
| | |
|---|---|
| **Symptom** | Fresh-online provider could not submit quotes — always 403 with "Go online before submitting quotes" |
| **Root Cause** | Quote route queried `.select('latitude, longitude')` from `provider_locations`. Table uses PostGIS `GEOMETRY(Point,4326)` column `location` **not** separate lat/lng columns. Query always returned null → offline check failed. |
| **Fix** | Changed to `.select('provider_id, location')` and extracted coords from GeoJSON `location.coordinates`. Commit: `809aa63` |

### Bug 3: "Price exceeds the acceptable range" 422 on all quotes
| | |
|---|---|
| **Symptom** | Every quote submission returned 422, even reasonable prices |
| **Root Cause** | Range estimator validation was active inside `submit_quote_atomic` RPC. In early soft launch, providers don't know the fair range without seeing it. |
| **Fix** | Migration 032: commented out `v_min_fair`/`v_max_fair` checks. All prices > 0 accepted. `quote_validity_minutes` still read from config. Analytics still logged. Commit: `7a45963` |

### Bug 4: Customer page resets to "Submit Request" after provider quotes
| | |
|---|---|
| **Symptom** | Customer submits request → provider sends quote → customer page shows "Submit Request" again instead of quotes |
| **Root Cause** | `GET /api/requests` only status-filtered `['open', 'accepted', ...]` — **`'quoted'` was missing**. After first quote, request transitioned to `'quoted'` → API couldn't find it → UI fell back to submit form. |
| **Fix** | Added `'quoted'` to status IN filter and to select clause (`price_change_requested`, `price_change_status`, `selected_quote_id`). Commit: `4e7b44d` |

### Bug 5: Stale 'quoted' requests block all new customer submissions
| | |
|---|---|
| **Symptom** | Customer sees "Quotes Received" immediately on page load, before any provider action; cannot submit new requests |
| **Root Cause** | Old test requests in `'quoted'` status (from previous sessions) were still active. The 20-min expiry cron might not run in dev. Duplicate guard returned 409 with the stale request ID. |
| **Fix** | Inline expiry check in `GET /api/requests`: if `status === 'quoted'` AND `quoted_at > 20min` (or null), auto-expire it before returning. Commit: `9708f81` |

### Bug 6: Provider gets 409 `already_quoted` after page refresh
| | |
|---|---|
| **Symptom** | Provider quotes → page refresh → same request visible → re-submit → 409 |
| **Root Cause** | Dashboard feed did not filter out requests the provider already quoted. `ProviderQuoteForm` success state is local — lost after refresh. |
| **Fix** | Dashboard page now queries `request_quotes` for the provider's existing quotes and filters already-quoted requests out of the feed before rendering. Commit: `9708f81` |

### Bug 7: Provider can't see 'quoted' requests in dashboard feed
| | |
|---|---|
| **Symptom** | Request disappears from provider feed after the first quote is submitted |
| **Root Cause** | `get_nearby_open_requests` RPC filtered `r.status = 'open'`. After first quote, `submit_quote_atomic` transitions status to `'quoted'` — the request disappeared from ALL feeds. |
| **Fix** | Migration 033: Changed RPC filter to `r.status IN ('open', 'quoted')`. Updated dashboard fallback query also. Commit: `6529550` |

### Bug 8: Customer cannot cancel a 'quoted' request
| | |
|---|---|
| **Symptom** | Press Cancel → spinner forever or 409 with "This request can no longer be cancelled" |
| **Root Cause** | `cancel_request_and_compensate_atomic` RPC's UPDATE clause: `AND status IN ('open', 'accepted', ...)` — **`'quoted'` was missing**. The UPDATE matched zero rows → `NOT FOUND` → returned `request_status_changed` → 409. |
| **Fix** | Migration 034: Added `'quoted'` to the status IN clause in the UPDATE. Commit: `4c5d871` |

### Bug 9: Slow realtime — provider sees events 3 seconds late
| | |
|---|---|
| **Symptom** | Quote selected notification / new request notification arrives with visible delay |
| **Root Cause** | `DEBOUNCE_MS = 3000` in `ProviderRealtimeRefresh`. Every realtime event waited 3s before `router.refresh()`. Also duplicate realtime channel in `ProviderRequestList` caused double-refreshes. |
| **Fix** | Reduced debounce to `800ms`. Removed duplicate channel from `ProviderRequestList` (rely on `ProviderRealtimeRefresh` only). Reduced polling from 10s → 30s for 'quoted' state. Commit: `c8a3425` |

### Bug 10: Migration 035 failed (cannot change return type)
| | |
|---|---|
| **Symptom** | Applying migration 035 failed: "cannot change return type of `get_nearby_open_requests`" |
| **Root Cause** | Postgres `CREATE OR REPLACE FUNCTION` disallows changes to the `RETURNS TABLE` signature. New columns `destination`, `destination_area` changed the return type. |
| **Fix** | Added `DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE FUNCTION`. Commit: `f492c83` |

### Bug 11: Customer form missing destination fields
| | |
|---|---|
| **Symptom** | Towing requests had no destination field — providers couldn't calculate accurate quotes |
| **Root Cause** | Form, API schema, and database columns existed but were never wired to the customer submission flow. |
| **Fix** | Added `destination` and `destination_area` to customer form (required for `'tow'`, hidden for other types). Updated Zod schema and INSERT query in `POST /api/requests`. Migration 035 passes them to provider feed. Commit: `65f73dc`, `ff1fc15`, `f14ccc5` |

### Bug 12: `request.location` type mismatch in quotes GET route
| | |
|---|---|
| **Symptom** | `/api/requests/quotes` queried `.select('provider_id, latitude, longitude')` from `provider_locations` — same root cause as Bug 2 |
| **Root Cause** | `provider_locations` table has a PostGIS `location` column, not `latitude`/`longitude`. |
| **Fix** | Changed to `.select('provider_id, location')` and extracted coordinates from `location.coordinates`. Commit: `809aa63` |

### Summary
| &nbsp; | Count |
|---|---|
| Bugs discovered | 12 |
| Migrations created to fix | 4 (032, 033, 034, 035) |
| API routes fixed | 4 (quote, requests GET, requests POST, cancel) |
| UI components fixed | 4 (ProviderRequestList, ProviderQuoteForm, CustomerQuoteList, customer request page) |
| RPCs fixed | 3 (submit_quote_atomic, get_nearby_open_requests, cancel_request_and_compensate_atomic) |
| i18n keys added | 8 (destination fields) |

---

- Dispatch engine (ring logic, plan priority, capacity checks)
- Cron jobs (expire quotes, advance rings, auto-expire requests, SLA enforcement)
- Fuzzy location generation on request creation

---

## Session: June 7, 2026 (continued 4) — Post-Audit Bug Fixes

### Summary
Fixed critical bugs discovered during live testing after audit fix phases 1-9. All issues stemmed from the Phase 4 state machine (`en_route`/`arrived` statuses) not being propagated to all code paths.

### Bugs Fixed

| Bug | Root Cause | Fix | Commit |
|-----|-----------|-----|--------|
| Provider Accept button disabled | Migration 021 dropped SELECT on `provider_locations`; user-scoped client returned null | Switched to admin client in dashboard | Phase 1 |
| React hydration #418 | loading.tsx rendered `<Navbar />` (client state) while page rendered `<NavbarServer />` (server props) — tree mismatch during Suspense | Created `NavbarSkeleton` (static server component); replaced in all 10 loading.tsx files | `hydration fix` |
| Provider /api/provider/location 403 | CSRF blocked same-origin requests with no Origin header | Changed CSRF to only block when Origin IS present but mismatches | `csrf fix` |
| Customer loses request on en_route | `GET /api/requests` line 70: `.in('status', [...])` missing `en_route`/`arrived` | Added both statuses to GET + POST filters | `en_route fix` |
| Customer realtime not updating | `requests` table not in `supabase_realtime` publication + 60s polling too slow | Migration 030 (idempotent publication add) + reduced polling to 5s for active states | `realtime fix` |
| Provider complete 409 | `complete_provider_job_atomic` RPC: status filter missing `en_route`/`arrived` | Migration 029: rewrote all 3 RPCs | `rpc fix` |
| Customer cancel 409 | `cancel_request_and_compensate_atomic` RPC: same issue | Migration 029 | `rpc fix` |
| Provider accept 409 (PPJ credit) | Old 4-param `accept_provider_request_atomic` overload from migration 015 still existed alongside new 5-param version | Added `DROP FUNCTION IF EXISTS` for old signature in migration 029 | `overload fix` |
| Pre-flight guards missing statuses | `ppj-checkout/route.ts` + `accept/route.ts` active-job checks missing `en_route`/`arrived` | Added both statuses to pre-flight `.in()` filters | `preflight fix` |

### Migrations Added
- **027** — `payout_log` UNIQUE constraint on `stripe_payout_id` (idempotent)
- **028** — `release_job_atomic` updated + `expire_stuck_active_requests` RPC
- **029** — All 3 main RPCs rewritten with `en_route`/`arrived`; old 4-param accept overload dropped
- **030** — `requests` table added to `supabase_realtime` publication (idempotent)

### Key Architectural Finding
PostgreSQL `CREATE OR REPLACE FUNCTION` only replaces functions with **identical argument types**. Migration 024 added `p_plan_limit INTEGER` (5 params) but migration 015's 4-param version was never dropped — creating an ambiguous overload. Migration 029 now explicitly drops the old signature.

### Files Changed (this session)
- `src/app/api/requests/route.ts` — en_route/arrived in GET + POST status filters
- `src/app/api/provider/ppj-checkout/route.ts` — en_route/arrived in active-job pre-flight
- `src/app/api/provider/requests/accept/route.ts` — en_route/arrived in active-job pre-flight
- `src/app/customer/request/page.tsx` — 5s polling for active states (was 60s)
- `src/app/layout.tsx` — suppressHydrationWarning on html/body
- `src/components/layout/Navbar.tsx` — suppressHydrationWarning on nav
- `src/components/layout/NavbarServer.tsx` — removed dynamic key prop
- `src/components/layout/NavbarSkeleton.tsx` — NEW (static loading skeleton)
- `src/app/*/loading.tsx` (10 files) — NavbarSkeleton instead of Navbar
- `src/proxy.ts` — CSRF allows missing Origin (same-origin fetch)
- `supabase/migrations/027_payout_log_unique_constraint.sql` — idempotent
- `supabase/migrations/028_stuck_job_auto_release.sql` — deduplicated
- `supabase/migrations/029_rpc_add_en_route_arrived_statuses.sql` — 3 RPCs + DROP old overload
- `supabase/migrations/030_requests_realtime_publication.sql` — idempotent

### Database Verification
All 6 RPCs verified against live Supabase — signatures and bodies match migrations exactly:
- `accept_provider_request_atomic(UUID, UUID, BOOLEAN, BOOLEAN, INTEGER)` ✓
- `complete_provider_job_atomic(UUID, UUID, INTEGER)` ✓
- `cancel_request_and_compensate_atomic(UUID, UUID, TIMESTAMPTZ)` ✓
- `release_job_atomic(UUID, UUID)` ✓
- `advance_provider_job_state(UUID, UUID, TEXT, TEXT, TEXT)` ✓
- `expire_stuck_active_requests(TIMESTAMPTZ)` ✓

### Status
All known issues resolved. Ready for live testing.

---

## Session: June 7, 2026 (continued 3) — Audit Fix Phases

### Final Summary
**All 9 audit fix phases complete.** 18 of 20 findings from Report 1 resolved. 2 deferred by user decision (#1 automated tests, #2 Stripe live keys).

| Phase | Fix | Commit |
|-------|-----|--------|
| 1 | OG/logo SVG + payout_log UNIQUE + provider online RLS | `46593eb` |
| 2 | Rate limiter fail-open (in-memory fallback) | `51e413e` |
| 3 | complete/route.ts state alignment + advance-state null | `f6e8b66` |
| 4 | NavbarServer eliminates duplicate client auth | `ba21367` |
| 5 | Deleted 5 deprecated edge functions | `11faf3a` |
| 6 | CSP enforced + CSRF origin validation | `676aa22` |
| 7 | getSiteUrl() + Google Maps docs + PROJECT_HANDOFF | `a6c4c8d` |
| 8 | Stuck job auto-release (migration 028) | `681773a` |
| 9 | PRE_LAUNCH_CHECKLIST.md | `53ad2b2` |

**Migrations:** 001 → 028  
**Deferred:** #1 (automated tests — dedicated phase), #2 (Stripe live — Phase 10 at launch)  
**Next task:** Phase 2B-3 — Arabic strings + RTL activation

---

### Phase 9 — Pre-Launch Checklist + Migration Dependency Docs
**Status:** COMPLETE

**Changes:**
1. Created `PRE_LAUNCH_CHECKLIST.md` — comprehensive pre-launch verification checklist covering: Supabase auth, env vars, Stripe live keys, Google Maps restrictions, security, cron jobs, assets, monitoring, and operational readiness
2. Migration 025 dependency already documented in SETUP.md (Phase 7)

**Coverage:** All 20 audit findings from Report 1 are now either fixed in code (10), documented with action items (4), or deferred to specific future phases (6).

---

### Phase 8 — Stuck Job Auto-Release
**Status:** COMPLETE

**Changes:**
1. `supabase/migrations/028_stuck_job_auto_release.sql` — New migration:
   - Updated `release_job_atomic` RPC to support `en_route`/`arrived` statuses (previously only `accepted`/`in_progress`). Also resets `en_route_at`/`arrived_at` fields on release.
   - Added `expire_stuck_active_requests(p_stuck_cutoff)` RPC — bulk auto-releases requests stuck in `accepted`/`en_route`/`arrived` longer than cutoff. Uses `SKIP LOCKED` for concurrency safety.
2. `src/app/api/ops/expire-requests/route.ts` — Added stuck job auto-release call alongside existing open-request expiry. Configurable via `OPS_STUCK_JOB_HOURS` env (default: 3h). Logs `stuck_jobs_auto_released` count.

**Behavior:** Every 30 min (cron schedule), the expire-requests job now also releases jobs where the provider accepted but hasn't completed within 3 hours. The request returns to `open` so another provider can pick it up. Provider's release_count is incremented.

**Configuration:** `OPS_STUCK_JOB_HOURS=3` (env, optional, default 3).

---

### Phase 7 — Site URL Fallback + Google Maps Docs + PROJECT_HANDOFF Update
**Status:** COMPLETE

**Changes:**
1. `src/lib/env.ts` — Added `getSiteUrl()` helper with fallback chain: NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → 'https://rescuego.ae'
2. `src/app/auth/forgot-password/page.tsx` — Added NEXT_PUBLIC_APP_URL as intermediate fallback before window.location.origin
3. `SETUP.md` — Added "Google Maps API Key Restriction" section with step-by-step instructions for securing the client-side key in Google Cloud Console
4. `SETUP.md` — Updated migrations list to include all 27 migrations (was only 10)
5. `SETUP.md` — Added NEXT_PUBLIC_SITE_URL to production notes
6. `PROJECT_HANDOFF.md` — Updated dependencies list (removed Radix/date-fns/react-hook-form, added Sentry/next-intl/stripe-react)

---

### Phase 6 — CSP Enforcement + CSRF Origin Validation
**Status:** COMPLETE

**Changes:**
1. `next.config.ts` — Renamed variable `contentSecurityPolicyReportOnly` → `contentSecurityPolicy`. Changed header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. XSS/injection now actively blocked.
2. `src/proxy.ts` — Added CSRF origin validation for all POST `/api/*` routes. Checks `Origin` or `Referer` header against allowed origins. Rejects with 403 if no match.
3. `src/proxy.ts` — Added early return for API routes after CSRF check (skips unnecessary Supabase token refresh for API calls).
4. Matcher expanded to include `/api/:path*` for CSRF coverage.

**CSRF exempt paths:** `/api/stripe/webhook` (external Stripe origin), `/api/ops/*` (cron Bearer token auth).

**CSP policies unchanged:** `'unsafe-inline'` kept for script-src and style-src (required by Next.js + Stripe Elements). Will tighten with nonce/hash in future phase.

**Trade-off:** CSRF relies on `Origin`/`Referer` headers which all modern browsers send. Older browsers without these headers will be rejected (acceptable — RescueGo targets modern mobile browsers in UAE).

---

### Phase 5 — Deprecated Edge Functions Cleanup
**Status:** COMPLETE

**Changes:**
- Deleted 5 deprecated Supabase Edge Function directories: accept-request, calculate-priority, charge-commission, stripe-webhook, unlock-job
- Kept `supabase/functions/README.md`
- These functions were superseded by Next.js API routes but never removed

**Why safe:** All business logic now lives in `/api/*` routes + Postgres RPCs. Edge functions were never invoked from production.

---

### Phase 4 — Navbar Duplicate Auth Removal
**Status:** COMPLETE

**Changes:**
1. `src/components/layout/NavbarServer.tsx` (NEW) — async server component reads auth + role via Supabase server client, passes as props to Navbar
2. `src/components/layout/Navbar.tsx` — added optional `initialAuthenticated` + `initialRole` props; skips client fetch when provided; added SIGNED_IN listener for login transitions
3. 7 pages switched to `NavbarServer`: page.tsx, about/page.tsx, not-found.tsx, admin/{providers,dashboard,performance}/page.tsx, provider/dashboard/page.tsx
4. 4 loading.tsx files kept with plain `<Navbar />` (shows skeleton without server fetch)

**Performance impact:** Eliminates ~200ms client-side latency per page load (removed duplicate supabase.auth.getUser() + users table query from browser).

---

### Phase 3 — complete/route.ts + advance-state empty string fix
**Status:** COMPLETE

**Changes:**
1. `src/app/api/provider/jobs/complete/route.ts:63` — allowed statuses for completion expanded from `['accepted', 'in_progress']` to `['accepted', 'en_route', 'arrived', 'in_progress']`. This aligns with Phase 4 state machine — provider can complete from any active state (e.g. arrived on-scene and resolved quickly without explicitly marking in_progress).
2. `src/app/api/provider/jobs/advance-state/route.ts:80` — changed `transition.timestampField ?? ''` to `transition.timestampField ?? null`. The RPC's IF/ELSIF logic already handled empty string safely, but passing `null` is semantically correct and matches the RPC parameter comment (`-- 'en_route_at' | 'arrived_at' | NULL`).

**Business logic unchanged:** The atomic RPCs (`complete_provider_job_atomic`, `advance_provider_job_state`) are not modified. Only the API route guard conditions were aligned.

---

### Phase 2 — Rate Limiter Graceful Degradation
**Status:** COMPLETE

**Change:**
- `src/lib/rate-limit.ts` — `fallbackRateLimit()` changed from fail-closed (reject all in production) to fail-open with in-memory fallback. When Redis is unavailable, the in-memory `checkRateLimit()` is used regardless of environment. Log level changed from `error` to `warn` since it's no longer a service-breaking event.

**Before:** If `UPSTASH_REDIS_REST_URL`/`TOKEN` were missing in production, every rate-limited endpoint returned 429 to ALL users.
**After:** Falls back to per-instance in-memory rate limiting (same behavior as dev). Still logs a warning on first occurrence for monitoring.

**Trade-off:** In-memory limiter is per-serverless-instance (not distributed). An attacker could theoretically hit different Vercel instances to bypass limits. This is acceptable until Redis is configured — it's better than blocking all legitimate users.

---

### Phase 1 — Missing Assets + Payout Fix + Provider Online Fix
**Status:** COMPLETE

**Changes:**
1. `public/og-image.svg` — created branded OG image (1200x630) replacing missing og-image.jpg
2. `public/logo.svg` — created branded logo replacing missing logo.png
3. `src/app/layout.tsx` — metadata references updated from .jpg/.png to .svg
4. `src/app/api/stripe/webhook/route.ts` — payout_log upsert fixed with `onConflict: 'stripe_payout_id'`
5. `supabase/migrations/027_payout_log_unique_constraint.sql` — UNIQUE constraint on stripe_payout_id
6. `src/app/provider/dashboard/page.tsx` — provider_locations query switched from user-scoped `supabase` to `admin` client (RLS was blocking read after migration 021 dropped SELECT policy)

**Root cause of provider Accept button bug:** Migration 021 dropped "Active providers location visible" SELECT policy on provider_locations. Dashboard used user-scoped client to read provider's own location → always got null → providerIsOnline always false → button always disabled.

---

## Session: June 7, 2026 (continued 2) — Full Project Audit & Documentation Update

### What was done
1. Full project audit — read every source file, migration, config, and MD file
2. Produced Report 1 — Issues & Vulnerabilities (20 findings: 0 CRITICAL, 2 HIGH, 7 MEDIUM, 11 LOW)
3. Produced Report 2 — Technical & Architecture Overview (complete system documentation)
4. Updated all MD files to reflect current state through Phase 4B + pre-launch hardening

### Key findings (Report 1 highlights)
- HIGH: No automated test suite; Stripe still in TEST mode
- MEDIUM: Missing og-image.jpg + logo.png (referenced in layout.tsx metadata); NEXT_PUBLIC_SITE_URL not on Vercel; deprecated Supabase edge functions still present; rate limiter fail-closed without Redis in production; CSP still report-only
- All core lifecycle flows confirmed atomic and well-protected
- Code quality is high; no secrets exposed; structured logging with redaction
- 26 migrations applied; all RPCs use SECURITY DEFINER + service_role only
- i18n infrastructure (next-intl) properly configured with ar/en locales

### MD files updated
- CLAUDE.md — phase status (all through 4B complete), migration count (026), next tasks updated
- ROADMAP.md — marked Phase 1A/1B/1C/3/4/4B complete, updated status table, migrations to 026
- SESSION_LOG.md — this entry
- VERDENT_HANDOFF.md — updated dates, status, completed phases, migrations, pending features
- DEPLOYMENT_STATUS.md — migrations 023-026 added, next steps updated

### Deferred issues (unchanged from previous session)
- removeTracing: true vs CWV — user decision pending
- og-image.jpg and logo.png — assets need creation
- NEXT_PUBLIC_SITE_URL — add to Vercel
- Deprecated Supabase edge functions — verify/delete in Supabase dashboard

---

## Session: June 7, 2026 (continued) — Phase 2B RTL & Arabic Foundation (2B-1 + 2B-2)

### What was done

1. **2B-1 — Infrastructure (Arabic font, CSP, RTL variant, dir/lang)**
   - `src/app/layout.tsx`: Cairo font loaded via `next/font/google` (subsets: `arabic`, `latin`); `lang="ar"` set; `dir="ltr"` (parked until Arabic strings ready); font `variable` + `className` applied to `<html>` and `<body>`
   - `next.config.ts`: CSP `font-src` → added `https://fonts.gstatic.com`; `style-src` → added `https://fonts.googleapis.com`
   - `src/app/globals.css`: `@custom-variant rtl (&:where([dir="rtl"], [dir="rtl"] *))` declared; `var(--font-cairo)` prepended to body font-family stack

2. **2B-2 — Physical → logical directional class migration (18 files)**
   - All `ml-` → `ms-`, `mr-` → `me-`, `pl-` → `ps-`, `pr-` → `pe-`
   - All `text-left` → `text-start`, `text-right` → `text-end`
   - All `sm:text-right` → `sm:text-end`, `sm:text-left` → `sm:text-start`
   - All `sm:ml-*` → `sm:ms-*`
   - Verified: zero physical directional classes remaining in `src/components/` and `src/app/`
   - Files: Button, Accordion, Navbar, ProviderDashboardHeader, ProviderAvailabilityToggle, ProviderRecentActivitySection, RatingForm, PaymentElementForm, admin/dashboard, admin/performance, admin/providers, admin/requests, admin/revenue, customer/history, auth/login, provider/history, provider/overage-pay, pricing

3. **RTL activation parked**
   - `dir="ltr"` kept until 2B-3 (Arabic strings) is complete — prevents English text from appearing mirrored
   - When 2B-3 lands, flip one line: `dir="ltr"` → `dir="rtl"` and full RTL layout activates

### Files changed
- `src/app/layout.tsx` — Cairo font, lang="ar", dir="ltr", className
- `src/app/globals.css` — @custom-variant rtl, font-family with Cairo
- `next.config.ts` — CSP font-src + style-src whitelists
- 18 component + page files — physical → logical Tailwind classes

### Activation checklist (when 2B-3 is done)
- `src/app/layout.tsx`: change `dir="ltr"` to `dir="rtl"`
- All logical spacing classes + `@custom-variant rtl` will take effect automatically

---

## Session: June 7, 2026 — Pre-launch hardening (C-1 through C-3, H-1 through H-4) + lint fixes

### What was done

1. **C-1 — Rate limiter fail-closed in production without Redis**
   - `fallbackRateLimit()` in `src/lib/rate-limit.ts`: in production, missing or unreachable Redis now returns `{ allowed: false, retryAfter: 60 }` instead of falling through to in-process memory map
   - Logs `rate_limit_redis_unavailable_fail_closed` at `error` level (once per cold start)
   - Dev/test environments still use in-memory fallback (behaviour unchanged locally)

2. **C-2 — `OPS_CRON_SECRET` and Redis vars required at boot**
   - `src/lib/env.ts`: added `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `EnvName` type
   - Split `SERVER_REQUIRED_ENVS` (checked at build + boot, throws) from new `RUNTIME_REQUIRED_ENVS` (checked at runtime only, `console.error` in production)
   - `OPS_CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` moved to `RUNTIME_REQUIRED_ENVS` — missing them no longer breaks the build
   - `runtimeWarningLogged` flag prevents duplicate warnings per process
   - Build confirmed clean: 52 routes, zero errors

3. **C-3 — `advance-state` two-step write replaced with atomic RPC**
   - `supabase/migrations/026_advance_state_atomic.sql` (new, applied): creates `advance_provider_job_state(p_provider_id, p_request_id, p_from_status, p_to_status, p_timestamp_field)` — `requests` status update and `jobs` timestamp write in one Postgres transaction; returns `{ success, reason, next_status }`; returns `reason = 'no_matching_request'` if 0 rows affected (concurrent race)
   - REVOKE from PUBLIC/anon; GRANT to service_role only
   - `src/app/api/provider/jobs/advance-state/route.ts` rewritten: `VALID_TRANSITIONS` now carries `{ next, timestampField }` per state; single `admin.rpc('advance_provider_job_state', ...)` call replaces the two-step UPDATE; `no_matching_request` → 409; error message no longer echoes raw DB status string

4. **H-1 — `Job` interface updated**
   - `src/types/database.ts`: `en_route_at: string | null` and `arrived_at: string | null` added to `Job` interface — now matches migration 025 schema

5. **H-2 — Counter increment optimistic concurrency**
   - `src/app/api/requests/cancel/route.ts`: `.eq('cancellation_count', profile.cancellation_count ?? 0)` added to the counter `UPDATE` — acts as an optimistic lock so concurrent cancellations cannot overwrite each other's increment

6. **H-3 — Profile read error no longer silently returns 403**
   - Same file: `profileError` now explicitly checked; DB errors return `500 "Unable to verify account"` instead of falling through to a misleading 403 role-check failure

7. **H-4 — Webhook `finalizeAcceptedRequest` passes `p_plan_limit`**
   - `src/app/api/stripe/webhook/route.ts`: `p_plan_limit: -1` added to `accept_provider_request_atomic` call in `finalizeAcceptedRequest` — PPJ payment path correctly bypasses the overage guard (payment already collected); consistent with `accept/route.ts`

8. **Lint fixes**
   - `src/components/forms/JobStateAdvanceButton.tsx`: removed unused `Button` import
   - `src/components/provider/ProviderRealtimeRefresh.tsx`: `scheduleRefresh` converted to `useCallback([router])`; added to both `useEffect` dependency arrays — resolves `react-hooks/exhaustive-deps` warnings

### Files changed
- `src/lib/rate-limit.ts` — fail-closed production fallback
- `src/lib/env.ts` — RUNTIME_REQUIRED_ENVS split; Redis + OPS vars; dedup flag
- `supabase/migrations/026_advance_state_atomic.sql` — created (apply in Supabase)
- `src/app/api/provider/jobs/advance-state/route.ts` — atomic RPC, cleaner error messages
- `src/types/database.ts` — Job interface: en_route_at, arrived_at
- `src/app/api/requests/cancel/route.ts` — profileError guard, optimistic counter lock
- `src/app/api/stripe/webhook/route.ts` — p_plan_limit: -1 in finalizeAcceptedRequest
- `src/components/forms/JobStateAdvanceButton.tsx` — unused Button import removed
- `src/components/provider/ProviderRealtimeRefresh.tsx` — scheduleRefresh useCallback, dep arrays fixed

### Action required in Vercel before deploy
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis REST token
- `OPS_CRON_SECRET` — min 32 chars (`openssl rand -hex 32`)

### Action required in Supabase before deploy
- Apply migration `026_advance_state_atomic.sql`

### Deferred issues (updated)
- `NEXT_PUBLIC_LAUNCH_PROMO=true` — add to Vercel if promo should be active
- `removeTracing: true` vs CWV — decision required
- Deprecated Supabase edge functions — manual verification in Supabase dashboard
- Phase 2B (roadmap) — RTL & Arabic Foundation
- Medium findings (M-1 through M-7) — post-launch hardening pass

---

## Session: June 6, 2026 (continued 5) — Phase 4B Admin Operations Center

### What was done

1. **4B-1 — `admin/requests` filter tabs extended for new states**
   - `RequestFilter` type extended with `'en_route' | 'arrived'`
   - `REQUEST_FILTERS` array: "En Route" and "Arrived" tabs added between Accepted and In Progress
   - `STATUS_LABELS` record added — all 8 statuses mapped to clean human labels; replaces the old `charAt(0).toUpperCase()` hack that rendered `"En_route"`
   - `requestBadgeVariant`: `en_route` and `arrived` → `'warning'`
   - `lifecycleLabel`: explicit cases for `en_route` → `'Provider en route'`, `arrived` → `'Provider on site'`, `in_progress` → `'Job in progress'`
   - File: `src/app/admin/requests/page.tsx`

2. **4B-2 — `admin/dashboard` Request Status card broken out**
   - 4 new count queries in `Promise.all`: `accepted`, `en_route`, `arrived`, `in_progress`
   - Old catch-all "Other" row (with description text) removed
   - Request Status card now shows explicit rows for all 7 live states: Open, Accepted, En Route, Arrived, In Progress, Completed, Expired
   - File: `src/app/admin/dashboard/page.tsx`

3. **4B-3 — Stuck jobs alert on admin dashboard**
   - `now` constant captured once; `stuckCutoff = now − 2 hours`
   - Admin client query: `jobs` where `en_route_at < stuckCutoff` and `completed_at IS NULL`, inner-joined to `requests` filtered to `['en_route', 'arrived']` status
   - Red alert banner rendered above stats grid when any stuck jobs exist
   - Per-job row: problem type, address, En Route/Arrived badge, hours stalled
   - Each row links to `/admin/requests?filter={status}`
   - Lint fix: `Date.now()` replaced by `now.getTime()` throughout (both `stuckCutoff` and `staleHours` calculation)
   - File: `src/app/admin/dashboard/page.tsx`

4. **4B-4 — New `/admin/performance` provider leaderboard page**
   - Sort tabs: Completed Jobs (default) / Rating / Revenue / Jobs This Month
   - Three parallel admin-client queries: all providers + user name, all completed jobs (aggregated client-side by `provider_id`), all rating counts
   - Leaderboard table columns: rank, provider name + verified badge, status, plan, rating, reviews, completed jobs, jobs this month, revenue
   - Plan badge: `business → success`, `pro → info`, `starter → warning`, `pay_per_job → default (PPJ)`
   - Empty state handled
   - "Provider Performance" link added to admin dashboard footer nav
   - Files: `src/app/admin/performance/page.tsx` (new), `src/app/admin/performance/loading.tsx` (new)

### Files changed
- `src/app/admin/requests/page.tsx` — STATUS_LABELS, en_route/arrived filter tabs + lifecycle labels
- `src/app/admin/dashboard/page.tsx` — 4 new count queries, Request Status card, stuck jobs alert, Performance nav link, Date.now() lint fix
- `src/app/admin/performance/page.tsx` — created
- `src/app/admin/performance/loading.tsx` — created

### Deferred issues (updated)
- `NEXT_PUBLIC_LAUNCH_PROMO=true` — add to Vercel if promo should be active
- `removeTracing: true` vs CWV — decision required
- Deprecated Supabase edge functions — manual verification in Supabase dashboard
- Phase 2B (roadmap) — RTL & Arabic Foundation

---

## Session: June 6, 2026 (continued 4) — Deferred items + Phase 4 Provider State Machine

### What was done

1. **Deferred 1 — Stuck webhook event cleanup added to expire-requests cron**
   - `ops/expire-requests/route.ts`: `Promise.all` now runs request expiry + stuck webhook cleanup in parallel
   - Stuck `stripe_events` rows (`status = 'processing'` older than 10 min) set to `failed` with explanatory `error_message`
   - Count logged as `stuck_webhooks_cleared` and returned in response JSON

2. **Deferred 2 — Subscribe page: RLS-gated client → admin client**
   - `provider/subscribe/page.tsx`: provider plan/status/subscription read switched from `supabase` to `admin` client

3. **Deferred 3 — complete/route.ts sequential pre-flight → Promise.all**
   - `provider/jobs/complete/route.ts`: `profile` and `request` fetches parallelised; `job` fetch remains sequential

4. **Phase 4 — Provider State Machine**

   **Migration 025** (applied):
   - `requests_status_check` constraint updated to include `en_route` and `arrived`
   - `jobs.en_route_at TIMESTAMPTZ` and `jobs.arrived_at TIMESTAMPTZ` columns added

   **New API route** `POST /api/provider/jobs/advance-state`:
   - Enforces transition table: `accepted→en_route→arrived→in_progress`
   - Rejects out-of-order transitions with `409`
   - Writes `en_route_at` / `arrived_at` timestamps to `jobs`
   - Auth-gated, role-checked, rate-limited (30/hour)

   **New component** `src/components/forms/JobStateAdvanceButton.tsx`:
   - "On My Way" (blue) — `accepted`
   - "I've Arrived" (amber) — `en_route`
   - "Start Job" (green) — `arrived`
   - `null` — `in_progress` or other states

   **`src/types/database.ts`**: `RequestStatus` extended with `'en_route' | 'arrived'`

   **Provider dashboard** (`src/app/provider/dashboard/page.tsx`):
   - Active request query now includes `en_route` and `arrived`
   - `JobStateAdvanceButton` mounted for `accepted/en_route/arrived`
   - `CompleteJobForm` shown for `arrived` and `in_progress` only
   - Status badge: `'On The Way'` / `'Arrived'` / `'In Progress'`
   - `ProviderRealtimeRefresh` active job channel refreshes on all status changes

   **Customer request page** (`src/app/customer/request/page.tsx`):
   - `ActiveRequest.status` type extended with `en_route | arrived`
   - Stepper rebuilt with 5 steps: Provider notified → Accepted → On the way (dynamic text) → Pay → Complete
   - Status badge, header pill, description all reflect new states

   **Customer history page** (`src/app/customer/history/page.tsx`):
   - `statusColors` and `statusLabels` maps extended with `en_route` and `arrived`

### Files changed
- `src/app/api/ops/expire-requests/route.ts` — stuck webhook cleanup
- `src/app/provider/subscribe/page.tsx` — admin client
- `src/app/api/provider/jobs/complete/route.ts` — Promise.all pre-flight
- `supabase/migrations/025_provider_state_machine.sql` — created + applied
- `src/app/api/provider/jobs/advance-state/route.ts` — created
- `src/components/forms/JobStateAdvanceButton.tsx` — created
- `src/types/database.ts` — RequestStatus extended
- `src/app/provider/dashboard/page.tsx` — state machine integration
- `src/components/provider/ProviderRealtimeRefresh.tsx` — refresh on all active job changes
- `src/app/customer/request/page.tsx` — stepper + status for new states
- `src/app/customer/history/page.tsx` — status maps extended

### Deferred issues (updated)
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events ✅ RESOLVED
- Phase 3 Finding 8 — Subscribe page RLS-gated client ✅ RESOLVED
- Phase 1B Task 5 Finding 4 — complete/route.ts sequential pre-flight ✅ RESOLVED
- `NEXT_PUBLIC_LAUNCH_PROMO=true` — add to Vercel if promo should be active
- `removeTracing: true` vs CWV capture — decision required
- Deprecated Supabase edge functions — manual verification in Supabase dashboard
- Phase 4B (roadmap) — Admin Operations Center ← NEXT
- Phase 2B (roadmap) — RTL & Arabic Foundation

---

## Session: June 6, 2026 (continued 3) — Phase 3 Realtime & Notifications

### What was done

1. **Phase 3 Task 3-1 — Customer request page realtime subscription**
   - `createClient` from `@/lib/supabase/client` imported into `customer/request/page.tsx`
   - New `useEffect` subscribes to `postgres_changes` UPDATE on `requests` filtered by `id=eq.{activeRequest.id}`
   - On terminal status (`cancelled/expired/completed`) → calls `loadRequestState()` for full reload
   - On live status changes (`open→accepted`, `accepted→in_progress`) → merges payload directly into `activeRequest` state (instant update, no round-trip, preserves form state)
   - Existing poll interval raised from 20s/12s → 60s (heartbeat fallback only)
   - Channel unsubscribed on cleanup
   - File: `src/app/customer/request/page.tsx`

2. **Phase 3 Task 3-2 — `ProviderRealtimeRefresh` null component (new)**
   - `'use client'` null component (`return null`) — purely side-effect
   - Channel 1: subscribes to INSERT + UPDATE on `requests` where `status=eq.open` → calls `router.refresh()` after 3s debounce when new open requests appear
   - Channel 2: subscribes to UPDATE on `requests` where `id=eq.{activeRequestId}` → calls `router.refresh()` when active job is cancelled/completed/expired
   - Both channels and debounce timer cleaned up on unmount
   - File: `src/components/provider/ProviderRealtimeRefresh.tsx` (new, 84 lines)

3. **Phase 3 Task 3-3 — Mount `ProviderRealtimeRefresh` in provider dashboard**
   - Component imported and mounted inside `operationalReady` block
   - Passes `providerId={user.id}` and `activeRequestId={activeRequest?.id ?? null}`
   - File: `src/app/provider/dashboard/page.tsx`

### Files changed
- `src/app/customer/request/page.tsx` — realtime subscription + poll raised to 60s
- `src/components/provider/ProviderRealtimeRefresh.tsx` — created
- `src/app/provider/dashboard/page.tsx` — ProviderRealtimeRefresh mounted

### Deferred issues (updated)
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events (low priority)
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (low priority)
- Phase 1B Task 5 Finding 4 — complete/route.ts sequential pre-flight → Promise.all (low priority)
- `NEXT_PUBLIC_LAUNCH_PROMO=true` — add to Vercel if promo should be active
- `removeTracing: true` vs CWV capture — decision required
- Deprecated Supabase edge functions — manual verification in Supabase dashboard
- Phase 4 (roadmap) — Provider state machine (en_route → arrived → completed), customer timeline
- Phase 4B (roadmap) — Admin Operations Center
- Phase 2B (roadmap) — RTL & Arabic Foundation

---

## Session: June 6, 2026 (continued 2) — Storage RLS + TOCTOU fix

### What was done

1. **Migration 023 — `provider-documents` bucket RLS**
   - 3 policies added to `storage.objects` scoped to `bucket_id = 'provider-documents'`:
     - `"Providers read own documents"` — SELECT, path starts with `auth.uid()`
     - `"Providers insert own documents"` — INSERT, path starts with `auth.uid()`
     - `"Providers update own documents"` — UPDATE, path starts with `auth.uid()`
   - No DELETE policy — deletion is admin/ops only via service_role
   - No anon policy — bucket fully private to authenticated users
   - Upload route unaffected (uses service_role which bypasses RLS)
   - RLS enabled on bucket confirmed in Supabase dashboard
   - File: `supabase/migrations/023_provider_documents_bucket_rls.sql`

2. **Migration 024 — TOCTOU fix: overage guard inside `accept_provider_request_atomic`**
   - Root cause: `accept/route.ts` read `jobs_this_month` in pre-flight `Promise.all`, then wrote in the RPC — two concurrent accepts against different requests by the same provider at their limit could both pass the pre-flight check before either incremented `jobs_this_month`.
   - Fix: `p_plan_limit INTEGER DEFAULT -1` parameter added to RPC. When `>= 0`, RPC re-checks `jobs_this_month` under the existing `FOR UPDATE` lock on the provider row and returns `reason = 'overage_required'` if live count >= limit. `-1` skips the check (business/PPJ/overage cleared).
   - `accept/route.ts`: `planLimit` computed from `allowance.effectiveLimit`; passed as `p_plan_limit` to RPC. Pre-flight check retained as fast-fail optimisation. New `overage_required` RPC reason handled with `402 OVERAGE_REQUIRED` response.
   - Files: `supabase/migrations/024_accept_rpc_overage_guard.sql`, `src/app/api/provider/requests/accept/route.ts`

### Deferred issues (updated — all safety issues now resolved)
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events (low priority)
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (low priority)
- Phase 1B Task 5 Finding 4 — complete/route.ts sequential pre-flight → Promise.all (low priority)
- `NEXT_PUBLIC_LAUNCH_PROMO=true` — add to Vercel if promo should be active
- `removeTracing: true` vs CWV capture — decision required
- Deprecated Supabase edge functions — manual verification in Supabase dashboard

---

## Session: June 6, 2026 (continued) — Bugs, Phase 3 Finding 6, proxy fix

### What was done

1. **Bug fix — `subscription.updated` race condition overwrites `pay_per_job` reset**
   - Root cause: Stripe fires `customer.subscription.updated` with `status: canceled` before (and sometimes after) `customer.subscription.deleted`. The `updated` handler was resolving the plan name and writing it back, overwriting the `pay_per_job` reset written by the `deleted` handler when events arrive out of order.
   - Fix: added `sub.status === 'canceled'` early-return guard at the top of the `subscription.created/updated` handler. When status is `canceled`, applies identical reset payload (`suspended`, `pay_per_job`, nulled subscription fields) and returns before any plan-resolution logic runs.
   - File: `src/app/api/stripe/webhook/route.ts`

2. **Bug fix — `/provider/register` redirected unauthenticated users to login**
   - Root cause: `proxy.ts` — `PROTECTED_PREFIXES` includes `'/provider'`; `/provider/register`.startsWith(`'/provider'`) → true → unauthenticated users redirected to `/auth/login`.
   - Fix: added `PUBLIC_OVERRIDES` list (`/provider/register`, `/provider/subscribe`) checked before `isProtected`. `isProtected` short-circuits to `false` when pathname matches any override.
   - File: `src/proxy.ts`

3. **Phase 3 Finding 5 — PPJ distance always `0` on first checkout (under-charge bug)**
   - Root cause: `ppj-checkout/route.ts` used `existing?.distance_meters ?? 0` — no existing row on first attempt → `getPayPerJobFee(0)` always returned near fee.
   - Fix: `distanceMeters` imported from `@/lib/geo`. Provider location fetch now selects `location` column. Request fetch now selects `location` column. Live Haversine distance calculated from both GeoJSON `coordinates` arrays. Falls back to `0` with `logger.warn` only if geometry is unparseable. Existing row reused on retry (idempotent).
   - File: `src/app/api/provider/ppj-checkout/route.ts`

4. **Phase 3 Finding 6 — Payment pages `client_secret` re-fetch fallback**
   - Root cause: both `ppj-pay` and `overage-pay` pages read `client_secret` from `sessionStorage` only — no recovery if storage cleared, new tab opened, or page refreshed.
   - Fix: both pages now fall through to a `fetch()` POST to the checkout API when `sessionStorage` miss. API reuses existing live `PaymentIntent` (already idempotent). Secret written back to `sessionStorage`. Specific error messages from API surfaced in error state. "Back to Dashboard" button added to error state. PPJ page also handles `credit_applied` response → redirects to `/provider/dashboard?payment=credit_applied`.
   - Files: `src/app/provider/ppj-pay/page.tsx`, `src/app/provider/overage-pay/page.tsx`

### Files changed
- `src/app/api/stripe/webhook/route.ts` — `subscription.updated` canceled guard
- `src/proxy.ts` — `PUBLIC_OVERRIDES` list, `isProtected` guard
- `src/app/api/provider/ppj-checkout/route.ts` — live distance calculation
- `src/app/provider/ppj-pay/page.tsx` — re-fetch fallback
- `src/app/provider/overage-pay/page.tsx` — re-fetch fallback

### Deferred issues (updated)
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events (low priority)
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (consistency, low priority)
- Phase 1B Task 5 Finding 5 — overage TOCTOU in `accept/route.ts`
- Phase 1B Task 5 Finding 4 — complete/route.ts sequential pre-flight → Promise.all
- Storage bucket `provider-documents` — 0 RLS policies (requires migration)
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- `removeTracing: true` vs CWV capture — decision required
- `npm uninstall` 12 dead dependencies — safe to run any time

---

## Session: June 6, 2026 — Phases 2A, 2B, 2C, 1D, 3, 4 complete

### What was done

1. **Phase 2A Task 4 — `/provider/ratings` page** (`src/app/provider/ratings/page.tsx`)
   - Auth-gated server component. Fetches last 50 ratings via admin client.
   - Aggregate card: average score, filled/empty star row, per-star breakdown bar chart.
   - Rating list: problem type label, stars, comment, date. Empty state with icon.

2. **Phase 2A Task 5 — `/provider/plan` page** (`src/app/provider/plan/page.tsx`)
   - Current plan card: plan name, promo-aware price, feature list (job limit, overage, commission, queue priority).
   - Monthly usage card (subscription plans only): jobs used/remaining, colour-coded progress bar, overage warning.
   - Recovery credits card (PPJ only): shown when `ppj_recovery_credits > 0`.
   - Plan actions card: upgrade link, Stripe billing portal link (when `stripe_subscription_id` present), support email.
   - `ProviderDashboardHeader.tsx`: plan badge converted to `<Link href="/provider/plan">`.

3. **Phase 2B — Customer-Facing UI Polish (5 changes):**
   - 2B-1: `customer/request/page.tsx` — status badge: `replace('_',' ')` → explicit human labels.
   - 2B-2: Step 4 "Service complete" added to request progress stepper.
   - 2B-3: Cancel dialog copy includes provider name when available (`visibleRequest.provider_name`).
   - 2B-4: `customer/history/page.tsx` — open/accepted/in_progress rows get "View active →" link to `/customer/request`.
   - 2B-5: "Needs rating" static badge → `<Link href="/customer/ratings">Rate now</Link>`.

4. **Phase 2C — Admin Dashboard Hardening (5 changes):**
   - 2C-1: `admin/requests/page.tsx` — status badge casing fixed (`in progress` → `In Progress`).
   - 2C-2: `admin/dashboard/page.tsx` — admin role check moved before `Promise.all`; non-admins no longer trigger 14 DB queries.
   - 2C-3: `admin/providers/page.tsx` — filter tabs now show count badges per status; badge inverts on active tab.
   - 2C-4: `admin/requests/page.tsx` — full rewrite with status filter tabs (All/Open/Accepted/In Progress/Completed/Cancelled/Expired); DB query scoped by filter.
   - 2C-5: `admin/revenue/page.tsx` — `commission_amount` display corrected (removed erroneous `/ 100`).

5. **Phase 1D — Server-Only Guards & Code Hygiene:**
   - `server-only` package installed.
   - `import 'server-only'` added to: `supabase/admin.ts`, `supabase/server.ts`, `ops-auth.ts`, `stripe.ts`, `rate-limit.ts`.
   - `env.ts` — `NEXT_PUBLIC_SITE_URL` advisory `console.warn` added for production when unset.

6. **Phase 3 — Stripe Billing Hardening (Findings 1–4):**
   - Finding 1: `customer.subscription.deleted` webhook now resets `plan: 'pay_per_job'` (previously left stale plan on suspended provider).
   - Finding 2: `monthlyJobAllowance()` in webhook replaced with canonical `SUBSCRIPTION_PLANS` lookup (no more hardcoded `starter=15, pro=35`).
   - Finding 3: Local `SUBSCRIPTION_PLANS = ['starter','pro','business']` redefinition in `create-checkout/route.ts` removed; replaced with `SUBSCRIPTION_PLAN_IDS` derived from canonical source.
   - Finding 4: `SERVER_REQUIRED_ENVS` in `env.ts` extended with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` + 3 price ID env vars — missing any now throws at startup.

7. **Phase 4 — Performance & Observability:**
   - 4-1: `loading.tsx` skeletons created for all 4 new provider pages: `history`, `pending`, `plan`, `ratings`.
   - 4-2: `providers/documents` upload route rate-limited: 5 attempts/hour per provider; `429` + `Retry-After` on breach.
   - 4-3: Rate limiting added to `providers/plan` (10/hour) and `provider/jobs/complete` (20/hour).

### Files changed
- `src/app/provider/ratings/page.tsx` — created
- `src/app/provider/ratings/loading.tsx` — created
- `src/app/provider/plan/page.tsx` — created
- `src/app/provider/plan/loading.tsx` — created
- `src/app/provider/history/loading.tsx` — created
- `src/app/provider/pending/loading.tsx` — created
- `src/components/provider/dashboard/ProviderDashboardHeader.tsx` — plan badge → Link
- `src/app/customer/request/page.tsx` — status badge, stepper step 4, cancel dialog copy
- `src/app/customer/history/page.tsx` — active request link, rate now link
- `src/app/admin/requests/page.tsx` — badge casing fix + full rewrite with status filter tabs
- `src/app/admin/dashboard/page.tsx` — role check before Promise.all
- `src/app/admin/providers/page.tsx` — count badges on filter tabs
- `src/app/admin/revenue/page.tsx` — commission_amount divide-by-100 fix
- `src/lib/supabase/admin.ts` — `import 'server-only'`
- `src/lib/supabase/server.ts` — `import 'server-only'`
- `src/lib/ops-auth.ts` — `import 'server-only'`
- `src/lib/stripe.ts` — `import 'server-only'`
- `src/lib/rate-limit.ts` — `import 'server-only'`
- `src/lib/env.ts` — NEXT_PUBLIC_SITE_URL warning + Stripe price IDs in SERVER_REQUIRED_ENVS
- `src/app/api/stripe/webhook/route.ts` — plan reset on deletion + SUBSCRIPTION_PLANS import + monthlyJobAllowance fix
- `src/app/api/stripe/create-checkout/route.ts` — canonical SUBSCRIPTION_PLAN_IDS
- `src/app/api/providers/documents/route.ts` — rate limiting (5/hour)
- `src/app/api/providers/plan/route.ts` — rate limiting (10/hour)
- `src/app/api/provider/jobs/complete/route.ts` — rate limiting (20/hour)

### Deferred issues (ongoing)
- Storage bucket `provider-documents` — 0 RLS policies
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Phase 3 Finding 5 — PPJ distance always 0 on first checkout (under-charge bug)
- Phase 3 Finding 6 — Payment pages have no client_secret re-fetch fallback
- Phase 3 Finding 7 — No cron to clear stuck `processing` webhook events
- Phase 3 Finding 8 — Subscribe page uses RLS-gated client for plan read (consistency)
- Phase 1A deferred: login sequential role fetch, Navbar duplicated auth, router.refresh() 1200ms, prefetch all dashboards
- Phase 1A deferred: getViewerState() sequential queries, logout navigates to `/`
- `removeTracing: true` vs CWV capture — decision required
- `npm uninstall` 12 dead dependencies — safe to run any time

### New env vars required in Vercel (additions from this session)
- `NEXT_PUBLIC_SUPPORT_EMAIL=support@rescuego.ae`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — already needed, now validated at startup
- `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` — now validated at startup
- `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — now validated at startup
- `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` — now validated at startup

---

## Session: June 5, 2026 — Phase 1B + 1C complete

### What was done

1. **Phase 1B Task 2** — `LAUNCH_PROMO` hardcoded `true` → `process.env.NEXT_PUBLIC_LAUNCH_PROMO === 'true'`. Safe fallback: off if env var missing.

2. **Phase 1B Task 3** — PPJ fee constants (`PAY_PER_JOB_FEE_NEAR_AED`, `PAY_PER_JOB_FEE_FAR_AED`, `PAY_PER_JOB_DISTANCE_THRESHOLD_M`, `PAY_PER_JOB_PROMO_FEE_AED`) moved to `NEXT_PUBLIC_PPJ_*` env vars. Safe numeric fallbacks to original hardcoded values.
   - File changed: `src/types/index.ts`

3. **Phase 1B Task 4 — Cron reliability (6 findings fixed):**
   - Finding 1: `vercel.json` created — `expire-requests` every 30 min, `monthly-allowance-reset` daily 00:00 UTC.
   - `ops-auth.ts` — added Vercel `CRON_SECRET` fallback so native cron injection works without manual secret alignment.
   - Both routes: added `GET` handler delegating to shared handler function (Vercel Cron calls GET).
   - Finding 3: `monthly-allowance-reset` serial UPDATE loop → `Promise.all` parallel updates.
   - Finding 4: `maxDuration = 30` on `expire-requests`, `maxDuration = 60` on `monthly-allowance-reset`.
   - Finding 5: `REQUEST_EXPIRY_HOURS` → `OPS_REQUEST_EXPIRY_HOURS` env var, fallback `2`.
   - Finding 6: `validateEnv()` — minimum 32-char length check on `OPS_CRON_SECRET`.

4. **Phase 1B Task 5 Finding 2 — Cancel double-compensation bug fixed:**
   - New RPC `cancel_request_and_compensate_atomic` (migration 019) — wraps cancel + provider compensation in one Postgres transaction with `FOR UPDATE` on request + provider rows. `cancellation_compensated_at IS NULL` guard is idempotency anchor.
   - `src/app/api/requests/cancel/route.ts` rewritten to call RPC. 230 lines → 176 lines.

5. **Phase 1B Task 5 Finding 1 — Release cleanup atomicity fixed:**
   - New RPC `release_job_atomic` (migration 020) — wraps request status update, jobs field reset, request_locks delete, and provider counter increment in one transaction. `provider_locations` delete remains post-RPC best-effort.
   - `src/app/api/provider/jobs/release/route.ts` rewritten to call RPC. 133 lines → 85 lines.

6. **Phase 1C — Deep RLS Hardening (migration 021):**
   - DROP `"Providers read locks"` on `request_locks` — all authenticated users could read all lock rows.
   - DROP `"Customers cancel own open request"` on `requests` — customers could UPDATE any column directly.
   - DROP `"Active providers read open requests"` on `requests` — bypassed migration 010 privacy masking.
   - DROP `"Customers read active providers"` on `providers` — exposed Stripe IDs + billing columns.
   - DROP `"Public read ratings"` + CREATE `"Authenticated read ratings"` — removed anon access.
   - DROP `"Active providers location visible"` on `provider_locations` — cross-provider location exposure.

7. **Phase 1C remaining (migration 022):**
   - REVOKE ALL on `reset_monthly_job_counters()` from all roles. COMMENT marking deprecated.
   - `ratings UNIQUE(job_id)` constraint confirmed via idempotent `DO $$` guard.

8. **Migration 020 duplication bug fixed** — file was doubled by file_write tool; duplicate block removed.

### Files changed
- `src/types/index.ts` — LAUNCH_PROMO + PPJ fee env vars
- `src/lib/ops-auth.ts` — CRON_SECRET fallback
- `src/app/api/ops/expire-requests/route.ts` — GET handler, maxDuration, env var expiry hours
- `src/app/api/ops/monthly-allowance-reset/route.ts` — GET handler, Promise.all, maxDuration
- `src/lib/env.ts` — OPS_CRON_SECRET minimum length validation
- `src/app/api/requests/cancel/route.ts` — RPC-based rewrite
- `src/app/api/provider/jobs/release/route.ts` — RPC-based rewrite
- `vercel.json` — created (cron schedule)
- `supabase/migrations/019_cancel_compensation_atomic.sql` — created + applied
- `supabase/migrations/020_release_job_atomic.sql` — created + applied (duplication fixed)
- `supabase/migrations/021_phase1c_rls_hardening.sql` — created + applied
- `supabase/migrations/022_phase1c_remaining.sql` — created + applied

### Deferred items (carried forward)
- Phase 1A Task 1: login sequential role fetch, Navbar auth duplication, router.refresh() 1200ms fallback, prefetch all dashboards
- Phase 1A Task 2: getViewerState() sequential queries, logout navigates to `/`
- Phase 1A Task 3: provider fallback sequential (Finding 5), skeleton completeness (Finding 6)
- Phase 1A Task 7: `removeTracing: true` vs CWV — user decision pending
- Phase 1A Task 7: `server-only` guards on lib files — Phase 1D
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup pass
- Phase 1B Task 5 Finding 4: complete/route.ts sequential pre-flight reads → Promise.all
- Phase 1B Task 5 Finding 5: overage guard TOCTOU in accept/route.ts
- Phase 1B Task 5 Finding 3: PPJ protection `provider_not_found` → Sentry alert
- Phase 1B Task 5 Finding 8: accept RPC scan-based FOR UPDATE
- Phase 1B Task 4 Findings 7–9: deprecated edge functions verify undeployed (manual), retry semantics, overage_cleared zombie edge case
- Storage bucket `provider-documents` — 0 RLS policies
- `NEXT_PUBLIC_SITE_URL` missing from Vercel

### New env vars required in Vercel
- `NEXT_PUBLIC_LAUNCH_PROMO = true` (keep promo active)
- `NEXT_PUBLIC_PPJ_FEE_NEAR_AED = 30`
- `NEXT_PUBLIC_PPJ_FEE_FAR_AED = 70`
- `NEXT_PUBLIC_PPJ_DISTANCE_M = 10000`
- `NEXT_PUBLIC_PPJ_PROMO_FEE_AED = 15`

---

## Session: June 5, 2026 — Phase 1A Task 8 complete

### What was done

1. **Phase 1 marked complete.**
   - Sentry DSN + NEXT_PUBLIC_SENTRY_DSN confirmed on Vercel (May 31).
   - Sentry smoke verification confirmed done by user.
   - CLAUDE.md + DEPLOYMENT_STATUS.md updated accordingly.

2. **Correction: Finding 1 (Task 1) was wrong.**
   - Original finding said "no middleware.ts" — token refresh missing.
   - In Next.js 16, middleware is renamed to `proxy.ts`. `src/proxy.ts` already exists and correctly implements Supabase token refresh via `supabase.auth.getUser()`.
   - Real issue found: proxy was doing a live DB role check on every protected request (every `/provider/*`, `/admin/*`, `/customer/*` navigation). Next.js auth docs explicitly warn against this.
   - **Fix applied:** Removed the `supabase.from('users').select('role')` call and all role-based redirect logic from `src/proxy.ts`. Proxy now only does token refresh + unauthenticated redirect. Role enforcement remains at page level + RLS.

3. **Phase 1A Task 1 — Auth/login performance audit (findings, no code changes except proxy fix).**

4. **Phase 1A Task 2 — Logout lag investigation (findings only).**
   - Fix applied: `signOut({ scope: 'local' })` in `Navbar.tsx` — eliminates 200–500ms server round-trip and Navbar flash on logout.

5. **Phase 1A Task 3 — Dashboard loading optimization audit (findings only, no fixes yet).**

---

### Phase 1A — Task 1 Correction: proxy.ts DB call removed

**File changed:** `src/proxy.ts`
- Removed: `PROVIDER_PREFIXES` constant
- Removed: `if (user && isProtected)` block — DB role check + 3 role-based redirect conditions
- Kept: token refresh (getUser), unauthenticated redirect, PROTECTED_PREFIXES, matcher
- Security: no gap — page-level checks and RLS still enforce role access

Remaining Task 1 findings (not yet fixed):

| # | Finding | Status |
|---|---|---|
| 2 | Sequential role fetch after login (login/page.tsx:135) | Deferred |
| 3 | Navbar duplicates auth + role on every page | Deferred |
| 4 | router.refresh() + 1200ms fallback timer (login/page.tsx:57) | Deferred |
| 5 | Prefetches all 3 dashboards for every visitor | Deferred |
| 6 | getUser() on login mount for unauthed users | Deferred (low) |
| 7 | bundlePagesRouterDependencies: true in next.config.ts | Deferred (negligible) |

---

### Phase 1A — Task 2 Findings: Logout Lag

**Fix applied:** `src/components/layout/Navbar.tsx:131`
- Changed `supabase.auth.signOut()` → `supabase.auth.signOut({ scope: 'local' })`
- Eliminates server round-trip to Supabase auth server (~200–500ms)
- SIGNED_OUT event fires instantly → no Navbar flash on landing page after logout
- Security trade-off: refresh token not invalidated server-side (acceptable — local-only logout)

Remaining logout findings (not fixed):

| # | Finding | Status |
|---|---|---|
| 1 | getViewerState() in home page runs 2–3 sequential DB queries during logout nav | Deferred — affects all home page visits, separate pass |
| 4 | Logout navigates to `/` (heaviest page) | Deferred |

---

### Phase 1A — Task 3 Findings: Dashboard Loading Optimization

#### Finding 1 — Admin dashboard: full table scans (HIGH) ✅ FIXED Jun 4
#### Finding 2 — Provider dashboard: sequential cascade (MEDIUM) ✅ FIXED Jun 4
#### Finding 3 — Customer request page: sequential API calls (MEDIUM) ✅ FIXED Jun 4
#### Finding 4 — Admin sequential role check (LOW) ✅ FIXED Jun 4

#### Finding 5 — Provider dashboard: fallback requests sequential after nearby RPC (LOW)
`src/app/provider/dashboard/page.tsx:378–403`
Fallback open requests query fires sequentially if nearby RPC returns empty.
Status: Deferred

#### Finding 6 — All loading.tsx skeletons incomplete (LOW)
None match actual page layout — causes layout shift on load.
Customer loading.tsx is unreachable at runtime (page is 'use client').
Status: Deferred

---

## Session: June 4, 2026

### What was done

1. **Phase 1A Finding 1 fix — Admin dashboard full table scans.**
2. **Phase 1A Finding 2 fix — Provider dashboard sequential cascade.**
3. **Phase 1A Finding 3 fix — Customer request sequential API calls.**
4. **Phase 1A Finding 4 fix — Admin sequential role check.**
5. **Phase 1A Task 4 — Supabase query profiling audit (findings only, no changes).**

---

### Phase 1A Finding 1 Fix: Admin dashboard full table scans

**File changed:** `src/app/admin/dashboard/page.tsx`

Replaced 2 unbounded selects with 7 targeted HEAD count queries inside the same `Promise.all`:
- `providers.select('status')` (fetched ALL rows) → 3 count queries: active / pending / suspended
- `requests.select('status')` (fetched ALL rows) → 3 count queries: open / completed / expired + 1 total count
- Removed 7 client-side `.filter().length` expressions (lines 43–50)
- All 7 new queries use `{ count: 'exact', head: true }` — zero rows transferred
- No JSX changes — variable names preserved via `?? 0` normalization

---

### Phase 1A Finding 2 Fix: Provider dashboard sequential cascade

**File changed:** `src/app/provider/dashboard/page.tsx`

Parallelized `recentCustomerCancellation` and `recentPpjPayment` — both gated on `!activeRequest` only, no dependency on each other:
- Before: 4 sequential awaits after Promise.all(3): activeCustomer → cancellation → ppjPayment → overagePayment
- After: activeCustomer sequential (true dependency — needs customer_id), then `Promise.all([cancellation, ppjPayment])` in parallel
- `recentOveragePayment` stays sequential (depends on `!recentPpjPayment`)
- Saves 1 roundtrip in normal loads (no active job) and 1 more in payment-return flow
- All logger.warn calls preserved

---

### Phase 1A Finding 3 Fix: Customer request sequential API calls

**Files changed:** `src/app/api/requests/route.ts`, `src/app/customer/request/page.tsx`

Merged unrated-jobs count into `/api/requests` response — eliminates the sequential second fetch:
- In `route.ts`: split `unratedJob` derivation into `unratedJobs` array, added `unratedJobsCount`, included `unrated_jobs_count` in both response branches (no extra DB query — computed from existing `completedJobs` + `ratedJobIds` data already in memory)
- In `page.tsx`: added `unrated_jobs_count` to `ActiveRequestResponse` type; added `setUnratedJobsCount` call inside `loadRequestState`; removed `loadUnratedJobsCount` function + its `useEffect`
- Every 12-second poll now also refreshes the unrated count from server

---

### Phase 1A Finding 4 Fix: Admin sequential role check

**File changed:** `src/app/admin/dashboard/page.tsx`

Merged role query into the main `Promise.all` — fires in parallel with all 14 data queries:
- Before: `getUser()` → role check → Promise.all(14 queries) — 3 sequential phases
- After: `getUser()` → Promise.all(role query + 14 data queries) → validate role — 2 sequential phases
- Saves ~50–100ms on every admin dashboard load
- Role redirect moved to after Promise.all — fires before any data is rendered
- Security: unchanged — RLS protects data independently; redirect fires before rendering

---

### Phase 1A Task 4: Supabase Query Profiling — Findings

#### Finding 1 — Missing `users.role` index (HIGH)
- Admin dashboard fires 2 HEAD count queries on `users` filtered by `role` on every load — full table scan without index
- `is_admin()` RLS function also uses `role` but filters by `id` PK first — less critical
- **Proposed fix (migration 016):** `CREATE INDEX idx_users_role ON users(role);`

#### Finding 2 — Missing `overage_payments` indexes (MEDIUM)
- Admin dashboard: `overage_payments.eq('status', 'failed')` count — full scan, no `status` index
- Provider dashboard: `overage_payments.eq('provider_id', ...).in('status', [...]).order('created_at')` — no composite index
- Migration 013 only covered `overage_payments_stripe_intent` (webhook lookup)
- **Proposed fix (migration 016):**
  ```sql
  CREATE INDEX idx_overage_payments_provider_status_created
    ON overage_payments (provider_id, status, created_at DESC);
  CREATE INDEX idx_overage_payments_status
    ON overage_payments (status);
  ```

#### Finding 3 — Missing `payout_log.created_at` index (MEDIUM)
- Admin dashboard: `payout_log.order('created_at', DESC).limit(5)` — full scan, no `created_at` index
- **Proposed fix (migration 016):** `CREATE INDEX idx_payout_log_created ON payout_log(created_at DESC);`

#### Finding 4 — Missing `ratings(provider_id, created_at DESC)` index (MEDIUM)
- `update_provider_rating()` DB trigger fires on every rating INSERT
- Trigger query: `SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50`
- No composite index — sequential scan that grows with provider rating count
- **Proposed fix (migration 016):** `CREATE INDEX idx_ratings_provider_created ON ratings(provider_id, created_at DESC);`

#### Finding 5 — Location route: 2 sequential PK lookups (LOW)
- `src/app/api/provider/location/route.ts` — called every ~30–60s by all online providers
- `users.select('role').eq('id', ...)` → `providers.select('id, status').eq('id', ...)` — sequential PK lookups
- Both only need `user.id`; parallelizable with `Promise.all`
- **Proposed fix:** Code change — `Promise.all`

#### Finding 6 — Accept route: 4 sequential checks before atomic RPC (LOW)
- `src/app/api/provider/requests/accept/route.ts`
- 4 sequential checks (users role, provider status, provider_locations, active job) all need only `user.id`
- All 4 can be parallelized before the RPC
- **Proposed fix:** Code change — `Promise.all`

---

### Phase 1A Task 4 Code Fixes: Location + Accept Route

**Files changed:**
- `src/app/api/provider/location/route.ts` — Finding 5: 2 sequential PK lookups → `Promise.all([users.role, providers.status])`. Saves 1 round-trip per location ping.
- `src/app/api/provider/requests/accept/route.ts` — Finding 6: 4 sequential checks → `Promise.all([users.role, providers, provider_locations, active job])`. `admin` client + `onlineSince` moved above the await. Guard order preserved: role → 404 → status → offline → active job. Saves 3 round-trips per accept attempt.

**Note from audit:** location route is button-triggered only (not auto-polled). `MIN_UPDATE_INTERVAL_MS = 2min`, `MIN_MOVEMENT_METERS = 250m` throttle on client side. The "30–60s" estimate in the Task 4 report was wrong — parallelization still correct.

---

### Migration 016 Applied

- `supabase/migrations/016_task4_query_indexes.sql` created and applied in Supabase SQL Editor.
- `DEPLOYMENT_STATUS.md` updated: migration 016 ✅, Tasks 1–4 marked complete, date updated to June 4.
- 5 indexes applied: `idx_users_role`, `idx_overage_payments_provider_status_created`, `idx_overage_payments_status`, `idx_payout_log_created`, `idx_ratings_provider_created`.

---

### Phase 1A Task 5: Polling Reduction Audit + Fix

**Audit finding:** Only ONE active polling loop in the entire app — customer request page 12s `setInterval`. Location updates are manual/button-triggered only. No other background polling.

**Fix applied:** `src/app/customer/request/page.tsx:162`
- Added `const pollMs = activeRequest.status === 'open' ? 20000 : 12000`
- `open` status: 20s (waiting for any provider — infrequent state changes)
- `accepted` / `in_progress`: 12s (provider en route — more time-sensitive)
- `visibilitychange` + `online` listeners (lines 171–187) already handle immediate refresh on tab return — makes longer background interval safe
- Saves ~40% polls/hour for requests in `open` state

---

### Phase 1A Task 6: Core Web Vitals Baseline Audit

**6 findings:**

| # | Finding | Metric | Severity |
|---|---|---|---|
| 1 | Sentry client config missing — no production CWV data | All | HIGH |
| 2 | Navbar CLS: skeleton→content shift on every page | CLS | HIGH |
| 3 | Home page LCP blocked by sequential getViewerState() | LCP/TTFB | MEDIUM |
| 4 | customer/request/loading.tsx unreachable (page is 'use client') | FCP | MEDIUM |
| 5 | Provider dashboard skeleton: rough match only | CLS | LOW |
| 6 | No preconnect for client-side Supabase auth calls | LCP/Navbar | LOW |

**Finding 2 note:** Navbar is 'use client'. Server renders skeleton (`loading: true`), then client-side auth resolves (`getUser()` + `users.select('role')`), causing CLS on every page. Requires architectural change — defer to Phase 2B.

**Finding 3 note:** `getViewerState()` in `src/app/page.tsx:150–204` has 3 sequential DB queries for provider users. Blocks entire home page HTML stream. Deferred — Task 2 carry-over.

**Fix applied (Finding 6):** `src/app/layout.tsx`
```tsx
{process.env.NEXT_PUBLIC_SUPABASE_URL && (
  <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
)}
```
`crossOrigin="anonymous"` required — Supabase browser calls use `Authorization: Bearer` headers (CORS, not cookies). Without it, browser won't reuse the preconnected socket for CORS fetch pool.

---

### Phase 1A Task 6 — Finding 1: sentry.client.config.ts ✅ DONE Jun 4 (session 2)

**File created:** `sentry.client.config.ts` (project root)

Matches `sentry.server.config.ts` exactly except:
- `NEXT_PUBLIC_SENTRY_DSN` instead of `SENTRY_DSN` (only public env var is accessible in browser bundle)
- `NEXT_PUBLIC_VERCEL_ENV` instead of `VERCEL_ENV` (same reason — public system var Vercel auto-sets to "production"/"preview"/"development")
- No `profilesSampleRate` line (client-side Sentry SDK doesn't support profiling)

Privacy rules preserved:
- `sendDefaultPii: false`
- `scrubSentryErrorEvent` + `scrubSentryTransactionEvent` hooks — same pipeline as server/edge
- No replay (webpack config already excludes all replay modules)
- `tracesSampleRate: 0` — matches server

**Important finding — CWV capture deferred:**
`next.config.ts:108` has `removeTracing: true` in the Sentry webpack config. This tree-shakes all tracing code from the bundle, making `browserTracingIntegration` (needed for INP/LCP/CLS) a no-op at build time. CWV capture via Sentry requires removing that flag — flagged as a follow-up for Task 7 or a dedicated CWV pass.

---

## Session: June 4, 2026 (session 3)

### What was done
1. **CLAUDE.md updated** — Task 6 Finding 1 marked complete, Task 7 audit findings added, "الجاي" pointer advanced to Task 8.
2. **Phase 1A Task 7 — Bundle size audit** (findings only, no code changes).
3. **Phase 1A Task 7 — Full deep audit completed** — see findings below (session 3 continuation).

---

### Phase 1A Task 7: Bundle Size Audit — Findings (full, session 3)

Audit scope: `package.json`, `next.config.ts`, all `src/` imports, all UI components, all lib modules.

#### Finding 1 — 11 completely dead dependencies (HIGH)
All 9 `@radix-ui/*` packages + `react-hook-form` + `@hookform/resolvers` are in `package.json` but have ZERO imports anywhere in `src/`. All UI components (`Button`, `Select`, `Input`, `Accordion`, `Badge`, `Card`) are custom native-HTML + Tailwind — the Radix/RHF stack was installed (likely from shadcn/ui scaffolding) but never wired up.
- Production bundle impact: **zero** (never imported → webpack excludes)
- `node_modules` bloat: ~15+ packages with sub-dependencies, slower installs, `npm audit` noise
- **Proposed fix (terminal):**
  ```
  npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers
  ```

#### Finding 2 — `date-fns` unused (LOW)
`"date-fns": "^4.2.1"` in `package.json`, zero imports anywhere. Production bundle impact: zero.
- **Proposed fix (terminal):** `npm uninstall date-fns`

#### Finding 3 — `removeTracing: true` blocks CWV capture (MEDIUM, carry-over from Task 6)
`next.config.ts:108` — Sentry webpack plugin tree-shakes all tracing code out of the bundle.
`browserTracingIntegration()` (needed for INP/LCP/CLS via Sentry) is a no-op after build.
- Bundle benefit: tracing code removed from client JS
- CWV cost: no INP/LCP/CLS data in Sentry production dashboard
- **Decision required:** keep `removeTracing: true` (errors-only Sentry, smaller bundle) OR remove it + add `browserTracingIntegration` + `tracesSampleRate: 0.05` to `sentry.client.config.ts`
- Deferred — requires user choice.

#### Finding 4 — `zod` and `stripe` Node SDK correctly isolated (CONFIRMED GOOD)
`zod` — API routes only. `stripe` Node SDK (`src/lib/stripe.ts`) — API routes only. No client bundle exposure.

#### Finding 5 — No `server-only` guards on server libs (LOW — future risk)
`src/lib/stripe.ts`, `src/lib/logger.ts`, `src/lib/env.ts`, `src/lib/notifications.ts`, `src/lib/rate-limit.ts`, `src/lib/ops-auth.ts` — none have `import 'server-only'`.
- Current risk: low (all currently imported server-side only).
- Future risk: accidental 'use client' import would silently pull Node.js Stripe SDK into client bundle.
- Deferred to Phase 1C hardening pass.

#### Finding 6 — `SUBSCRIPTION_PLANS` duplicated in 3 places (LOW — maintenance risk)
- `src/types/index.ts` — canonical source with Stripe price IDs
- `src/app/provider/register/page.tsx:15` — local `PLANS` array, hardcoded prices, no Stripe IDs
- `src/app/api/stripe/create-checkout/route.ts:16` — local string array `['starter', 'pro', 'business']`
- No bundle impact. Risk: plan additions/renames won't propagate to all 3 locations. Deferred.

#### Finding 7 — `LAUNCH_PROMO = true` requires redeploy to toggle (LOW — operational)
`src/types/index.ts:55`. Should eventually be a `NEXT_PUBLIC_LAUNCH_PROMO` env var. Deferred.

#### Confirmed good (no action needed)
- `lucide-react` — named imports on all 24 import sites, tree-shaking correct
- `@stripe/react-stripe-js` / `@stripe/stripe-js` — client-only, payment pages only
- `clsx` + `tailwind-merge` — used in `utils.ts`, correctly shared
- `geo.ts`, `utils.ts` — pure functions, safe in client components
- `logger.ts` — server components + API routes only, zero client exposure
- `Navbar.tsx` — 'use client', Supabase client auth only, no heavy leaks
- `@supabase/ssr` — shared client boundary via Navbar, expected

#### Action order
1. `npm uninstall` the 11 dead deps — safe, immediate (Finding 1)
2. `npm uninstall date-fns` — safe, immediate (Finding 2)
3. Decide `removeTracing` / CWV tradeoff (Finding 3) — user decision
4. `server-only` guards — Phase 1C pass (Finding 5)
5. `SUBSCRIPTION_PLANS` deduplication — any future cleanup pass
6. `LAUNCH_PROMO` → env var — before promo ends

---

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification

Goal: identify which DB queries are slow in production using `pg_stat_statements` or Supabase dashboard.
Scope: review current query patterns in API routes + server pages against the indexes applied in migrations 013 + 016.

---

---

## Session: June 4, 2026 (session 4 — end of day wrap-up)

### What was done
1. **SESSION_LOG.md + CLAUDE.md** — end-of-session update: CLAUDE.md المراحل القادمة corrected (tasks 1–7 all done, Task 8 only remaining).
2. No new code changes this session — Tasks 6 and 7 were the work; this entry closes the day.

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify which queries are slow in production using Supabase dashboard or `pg_stat_statements`.
Scope: review all API routes + server pages against indexes from migrations 013 + 016.
No code changes expected — audit + findings only.

Pending user decisions before Task 8:
- `removeTracing: true` vs CWV capture — keep or remove?
- Run `npm uninstall` for 12 dead dependencies? (safe, no code impact)

---

## Session: June 5, 2026 — VERDENT_HANDOFF.md created

### What was done
1. **VERDENT_HANDOFF.md** — created (project root). Complete 15-section handoff document for another AI or engineer. Covers: business model, architecture, all phases, business logic, schema, env vars, API routes, known issues, technical decisions, constraints, deployment, testing, next steps.
2. **README.md** — updated to reflect current project status and link to all documentation files.
3. **`src/proxy.ts`** — inline comments added explaining middleware role, why no DB role check, cookie dance requirement.
4. **`src/app/api/provider/requests/accept/route.ts`** — inline comments added explaining rate limit, parallelized pre-flight checks, overage guard logic, pre-flight lock check advisory nature, atomic RPC purpose.
5. **`src/app/api/stripe/webhook/route.ts`** — inline comments added explaining force-dynamic, idempotency claim pattern, PROCESSING_TIMEOUT_MS, PLAN_BY_PRICE_ID, payment intent handler, subscription sync, raw body requirement.

### Files changed (June 5)
- `VERDENT_HANDOFF.md` — created
- `README.md` — updated
- `src/proxy.ts` — comments added
- `src/app/api/provider/requests/accept/route.ts` — comments added
- `src/app/api/stripe/webhook/route.ts` — comments added
- `SESSION_LOG.md` — this update

---

### Files changed — full session log (June 4, all sessions)

**Session 1 (June 4):**
- `supabase/migrations/016_task4_query_indexes.sql` — created (5 indexes, applied in Supabase)
- `DEPLOYMENT_STATUS.md` — migration 016 added, Phase 1A tasks 1–4 checked off
- `src/app/api/provider/location/route.ts` — Task 4 Finding 5 (2 sequential → Promise.all)
- `src/app/api/provider/requests/accept/route.ts` — Task 4 Finding 6 (4 sequential → Promise.all)
- `src/app/customer/request/page.tsx` — Task 5 (adaptive polling interval)
- `src/app/layout.tsx` — Task 6 Finding 6 (Supabase preconnect)

**Session 2 (June 4):**
- `sentry.client.config.ts` — created (Task 6 Finding 1: client-side Sentry)
- `DEPLOYMENT_STATUS.md` — Task 4 code fixes + Task 5 + Task 6 Finding 1 checked off

**Sessions 3–4 (June 4):**
- `CLAUDE.md` — Tasks 6+7 marked complete, "الجاي" → Task 8, "tasks 2-8" → "Task 8 only remaining"
- `SESSION_LOG.md` — updated (this file)

---

### Deferred Issues (ongoing)

- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Storage bucket `provider-documents` — 0 RLS policies (review SETUP.md §4)
- CSP violations review — report-only has been running since Phase 1
- Stripe still on test/sandbox keys — live keys before real launch (Phase 10)
- `npm run lint && npm run build` — user needs to run after all code changes this session
- Phase 1A Task 1 deferred findings: login sequential role fetch, Navbar duplicated auth, router.refresh() + 1200ms fallback, prefetch all 3 dashboards
- Phase 1A Task 2 deferred: getViewerState() sequential queries on home page, logout navigates to `/`
- Phase 1A Task 3 deferred: Finding 5 (provider fallback sequential), Finding 6 (skeleton completeness)
- Phase 1A Task 7: `removeTracing: true` vs CWV — decision required before enabling `browserTracingIntegration`
- Phase 1A Task 7: add `server-only` guards to `stripe.ts`, `logger.ts`, `env.ts`, `notifications.ts`, `rate-limit.ts`, `ops-auth.ts` — Phase 1C hardening pass
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup in cleanup pass
- Phase 1A Task 7: `LAUNCH_PROMO = true` hardcoded — move to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends
- Phase 1A Task 8: ✅ complete — see session June 5, 2026 (Task 8) below
- `npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns` — safe to run any time (12 unused dependencies, zero bundle impact)

---

## Session: June 5, 2026 (session 3 — VERDENT_HANDOFF.md expanded to 25 sections)

### What was done
1. **VERDENT_HANDOFF.md** — expanded with 6 new sections (20–25). Full codebase audit performed: read all 16 migrations, webhook route, accept route, complete route, release route, proxy.ts. Three factual corrections documented. No duplicate content added.
   - **Section 20**: Complete DB column reference — all 12 tables, all columns from all 16 migrations, full index inventory.
   - **Section 21**: Dedicated Authentication Flow — registration, login, session handling, role management, logout, admin creation.
   - **Section 22**: Current Production State — Vercel/Supabase/Stripe/Sentry/Cron/Storage snapshot + launch readiness checklist (~35%).
   - **Section 23**: Corrections and Clarifications — 3 factual errors corrected from source code audit.
   - **Section 24**: Ready-to-use Prompt for Next AI — self-contained copy-paste prompt covering all critical rules.
   - **Section 25**: Final Validation — document stats, files reviewed, files not reviewed, assumptions, missing resources.

### Corrections discovered (from codebase audit)
1. `complete_provider_job_atomic` does NOT delete provider_locations. Only the release route deletes it. Section 16 had a wrong step 4.
2. PPJ recovery credit is ONLY for customer-cancelled requests. NOT restored when another provider accepts the request during payment. Sections 6 and 16 both had wrong descriptions.
3. `checkout.session.completed` is log-only — no DB writes. Provider activation is via `customer.subscription.created`. Section 16 had wrong handler name and wrong action.

### Files changed
- `VERDENT_HANDOFF.md` — sections 20–25 added
- `SESSION_LOG.md` — this update

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify slow queries in production using Supabase `pg_stat_statements` dashboard.
Scope: review all API routes + server pages against indexes from migrations 013 + 016. Audit-only, no code changes expected.

Pending before Task 8:
- `npm run lint && npm run build` — user runs from terminal
- `git add . && git commit -m "Phase 1A complete + VERDENT_HANDOFF.md expanded (sections 20–25)" && git push`
- Decision: `removeTracing: true` vs CWV capture (can defer)
- Optional: `npm uninstall` for 12 dead dependencies (safe, no code impact)

---

## Session: June 5, 2026 — Phase 1A Task 8 complete

### What was done

1. **Issue #1 verified** — `getOpsCronSecret` confirmed exported in `src/lib/env.ts:30`. False alarm from truncated read.

2. **Phase 1A Task 8 — Production slow-query identification (audit + fixes).**
   Full cross-reference of all 20 API routes + 8 server pages against all 25 indexes in migrations 013 + 016. 12 findings produced.

3. **Findings 1, 2, 5 — code fixes (no migration).**
   - `src/app/admin/revenue/page.tsx:70` — `payout_log`: narrowed `select('*')` to 6 used columns + added `.limit(100)`. `idx_payout_log_created` now does useful bounded work.
   - `src/app/admin/revenue/page.tsx:71` — `jobs`: narrowed `select('*')` to 4 used columns + added `.not('completed_at', 'is', null)`. `idx_jobs_completed` partial index now eligible.
   - `src/app/admin/providers/page.tsx:112` — `providers`: narrowed `select('*')` to 8 columns in `AdminProviderRow` + added `.limit(200)`. Removes billing columns from wire transfer, caps unbounded fetch.

4. **Findings 3, 4, 6 — migration 017 applied.**
   - `idx_ppj_payments_status_created` — covers admin-wide `ppj_payments` status filter + sort.
   - `idx_overage_payments_status_created` — covers admin-wide `overage_payments` status filter + sort.
   - `idx_requests_created` — covers admin/requests unfiltered `ORDER BY created_at DESC LIMIT 100`.
   - `supabase/migrations/017_task8_query_indexes.sql` created.

5. **Finding 10 — `get_nearby_open_requests` RPC audited + migration 018 applied.**
   - Function confirmed present in production but absent from all prior migrations.
   - Index coverage confirmed: GIST spatial index + partial index on open/unassigned requests + PK lookups — all correct.
   - No query logic changes. Migration 018 is tracking-only — captures production function body into version control.
   - `supabase/migrations/018_capture_get_nearby_open_requests.sql` created.

### Files changed
- `src/app/admin/revenue/page.tsx` — Findings 1 + 2 (payout_log limit, jobs narrow + null filter)
- `src/app/admin/providers/page.tsx` — Finding 5 (providers narrow + limit)
- `supabase/migrations/017_task8_query_indexes.sql` — created (3 indexes, applied in Supabase)
- `supabase/migrations/018_capture_get_nearby_open_requests.sql` — created (RPC capture, applied in Supabase)
- `DEPLOYMENT_STATUS.md` — migrations 017 + 018 marked ✅, Task 8 marked complete
- `SESSION_LOG.md` — this update

### Task 8 findings not yet actioned (deferred)
- Finding 7 — `monthly-allowance-reset` serial UPDATE loop → `Promise.all` or bulk UPDATE. Deferred to Phase 1B cron reliability pass.
- Finding 8 — `complete/route.ts` 2 sequential reads before RPC → `Promise.all`. Low priority.
- Finding 9 — `release/route.ts` sequential role+counters reads → `Promise.all`. Low priority.
- Finding 10 — `get_nearby_open_requests` CROSS JOIN silent empty result when provider offline. Design decision — deferred.
- Finding 12 — Sequential `users.role` check in admin pages/routes → merge into `Promise.all`. Low priority.

### Phase 1A — now fully complete ✅
All 8 tasks done. Migrations 001–018 applied.

### Next task: Phase 1B remaining
- Cron reliability + monitoring (monthly-allowance-reset serial loop — Finding 7 above)
- `LAUNCH_PROMO` → `NEXT_PUBLIC_LAUNCH_PROMO` env var
- PPJ fees → configurable server-side
- Additional DB indexes as identified

### Deferred issues (ongoing)
- `NEXT_PUBLIC_SITE_URL` — missing from Vercel env vars
- Storage bucket `provider-documents` — 0 RLS policies (review SETUP.md §4)
- CSP violations review — report-only has been running since Phase 1
- Stripe still on test/sandbox keys — live keys before real launch (Phase 10)
- Phase 1A Task 1 deferred: login sequential role fetch, Navbar duplicated auth, router.refresh() + 1200ms fallback, prefetch all 3 dashboards
- Phase 1A Task 2 deferred: getViewerState() sequential queries on home page, logout navigates to `/`
- Phase 1A Task 3 deferred: Finding 5 (provider fallback sequential), Finding 6 (skeleton completeness)
- Phase 1A Task 7: `removeTracing: true` vs CWV — decision required before enabling `browserTracingIntegration`
- Phase 1A Task 7: add `server-only` guards to `stripe.ts`, `logger.ts`, `env.ts`, `notifications.ts`, `rate-limit.ts`, `ops-auth.ts` — Phase 1C
- Phase 1A Task 7: `SUBSCRIPTION_PLANS` defined in 3 places — dedup in cleanup pass
- Phase 1A Task 7: `LAUNCH_PROMO = true` hardcoded — move to `NEXT_PUBLIC_LAUNCH_PROMO` env var before promo ends
- `npm uninstall @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast react-hook-form @hookform/resolvers date-fns` — safe to run any time

---

## Session: June 5, 2026 (session 2 — VERDENT_HANDOFF.md expanded)
   - **Section 16 — PPJ & Subscription Business Logic (Complete Detail):** Full Stripe webhook event table (all 9 events + handler + action), full RPC signatures with transaction step-by-step contracts (`accept_provider_request_atomic`, `complete_provider_job_atomic`, `get_nearby_open_requests`, `restore_ppj_credit`), per-table RLS matrix (all 12 tables), PPJ payment intent creation steps, overage payment intent creation steps, `PLAN_BY_PRICE_ID` mapping pattern.
   - **Section 17 — AI Agent Rules (mandatory):** Session start/end rules, context management at 90%, commands never-run list, bug reporting format, A-vs-B decision rule, golden rule before file changes.
   - **Section 18 — Deferred Items (exact locations):** 3 high-priority pre-launch items, 6 medium-priority (with exact `file:line` references), 10 low-priority items (with exact `file:line` references) organized by phase.
   - **Section 19 — Critical Business Rules (NEVER change):** Commission always 0, PPJ fees server-side only with exact type constants, Google Maps links-only until Phase 6, Stripe TEST mode until Phase 10, webhook URL + current status, atomic RPC inviolable rule, RLS change process, migration process.

### Files changed
- `VERDENT_HANDOFF.md` — 4 sections added (Sections 16–19)
- `SESSION_LOG.md` — this update

### Next Task: Phase 1A Task 8 — Production Slow-Query Identification
Goal: identify which queries are slow in production using Supabase `pg_stat_statements` dashboard.
Scope: review all API routes + server pages against indexes from migrations 013 + 016. Audit-only, no code changes expected.

Pending before Task 8:
- `npm run lint && npm run build` — user runs from terminal
- `git add . && git commit -m "Phase 1A complete + VERDENT_HANDOFF.md expanded (sections 16–19)" && git push`
- Decision: `removeTracing: true` vs CWV capture (can defer)
- Optional: `npm uninstall` for 12 dead dependencies (safe, no code impact)
