# Tiered Dispatch (Migration 051+) — Pre-Implementation Conflict Analysis

**Status: read-only analysis only. No migrations written. No application code changed as part of this analysis.**
Produced by reading migrations 010, 018, 031, 035, 039, 040, 045, 046, 047, 048, 049, 050 and the application files listed in §0. Purpose: give a new session everything needed to write the actual 051+ migrations and code without re-deriving this analysis from scratch.

---

## §0 Approved product decisions (binding)

**D1 — Tiered visibility with dynamic delays.** Radius becomes 150 km. Visibility delay per plan tier depends on a snapshot of online providers (fresh GPS ≤5 min) within 150 km of the request, taken ONCE at request creation and frozen on the request row:
- ≤10 providers in range: business 0 min / pro +2 / starter +4 / PPJ +6
- 11–20 providers: business 0 / pro +3 / starter +6 / PPJ +9
- 21+ providers: business 0 / pro +4 / starter +8 / PPJ +12
- Zero online **subscribers** (not just PPJ) in range at creation → no delays, everyone sees immediately, nearest-first. This fallback wins over the fewer-than-10-total-providers rule if both apply.
- Fewer than 10 total online providers in range → radius opens beyond 150 km; tier delays still apply to the far providers; except when the zero-subscriber fallback applies.

**D2 — Enforcement lives in the RPCs, not the UI.** Both `get_nearby_open_requests` and `submit_quote_atomic` must enforce tier-delay + radius server-side (feed-only delays are bypassable via realtime events or direct API calls).

**D3 — The admin-client dashboard fallback query must be removed or replaced** by a policy-compliant path. Current fallback has no radius/GPS/plan filter and must not survive as a bypass.

**D4 — Subscribers at their monthly limit are blocked from SUBMITTING quotes entirely** (starter 15/month, pro 35/month, business unlimited). This becomes the primary control; the existing select-time overage gate remains only as a backstop. Provider must see a clear upgrade/wait message before sending.

**D5 — Daily quote counter refund, narrow rule.** Refund a provider's daily quote counter only when: their quote was the SELECTED one, AND the customer cancelled, before PPJ payment (PPJ) or after acceptance (subscribers). Pending quotes on cancelled/expired requests are never refunded.

**D6 — `visibility_reduced` becomes enforced** (currently write-only).

### Clarifying decisions (Q1–Q5, final, binding)

- **Q1:** Delay reference point = `requests.created_at` only. Never `quoted_at`.
- **Q2:** The fewer-than-10 rule uses the frozen creation-time snapshot. Never re-evaluated live.
- **Q3:** Zero-subscriber fallback = zero online **subscribers** specifically (not zero providers of any plan). Wins over the fewer-than-10 rule.
- **Q4:** D4's monthly block applies to starter (15) and pro (35) only. Business unlimited. PPJ has no monthly cap and must not be given one.
- **Q5:** `visibility_reduced` = **+5 minutes delay penalty on top of the provider's tier delay** (no exclusion, no ranking change). `weekly_sla_reset_atomic` must clear it to `false` when it resets `sla_failure_count`.

---

## §1 Database-layer findings (migrations 031, 039, 040, 045, 047–050)

### Schema for the D1 snapshot
`requests` has no snapshot columns today. Needed: an integer online-provider-count snapshot, a discrete tier-bucket label (safer than re-deriving thresholds independently inside two different RPCs), and a zero-subscriber-fallback boolean (Q3 is a distinct condition from "≤10 total providers," not a special case of it — must be its own flag). Per-tier delay minutes should be computed from the bucket via a lookup/CASE at query time, not stored as 4 separate columns (keeps policy changes centralized). Backfill: existing rows cannot be retroactively reconstructed (no history of past online-provider counts exists anywhere) — any backfill is a placebo (NULL/sentinel), and both redesigned RPCs must have explicit, non-guessable fallback behavior for `NULL`/legacy rows (do not let a naive `<= 10` comparison against NULL silently fail-open or fail-closed).

### `get_nearby_open_requests` (live version = migration 039)
Signature: `(p_radius int DEFAULT 5000, p_limit int DEFAULT 20, p_stale_threshold timestamptz DEFAULT now()-5min)`. SQL STABLE SECURITY DEFINER. CTE `current_provider` joins `providers`+`provider_locations` on `auth.uid()`, filtered `status='active'` + GPS freshness — this is the only eligibility gate today; it has **no plan awareness at all**. Main SELECT masks `customer_id/location_address/note/final_price` to NULL (privacy masking from migration 010, extended in 039 with fuzzy coords) — must be preserved verbatim. Filters `status IN (open,quoted) AND accepted_by IS NULL AND ST_DWithin`. **Granted to `authenticated + service_role`** — callable directly by a provider's own session, which is exactly why D2 requires the tier/radius check to live inside this RPC (server-side), not only in the caller.
Redesign needs: new radius default (150,000 m), a plan lookup joined into the CTE, elapsed-time gate math (`now() - created_at` per Q1, against a per-bucket/per-plan delay), a second live-population check for the beyond-150km rule (open product question: live-checked or snapshot-based — ambiguous in the current D1 wording), and a `DROP FUNCTION + CREATE OR REPLACE` (return-type changes require this, confirmed twice already in this function's own history: 035→039).

### `submit_quote_atomic` (live version = migration 039)
11 sequential steps, `SECURITY DEFINER`, **granted to `service_role` only** (never callable by a provider's own session — a materially different trust boundary than the feed RPC). Order: (1) lock+validate request, (2) lock+validate provider, (3) duplicate-quote check, (4) hardcoded per-plan `v_max_active`/`v_daily_limit` (own copy, not read from `provider-allowance.ts` or `types/index.ts`), (5) active-job capacity check, (6) **daily quote count** — unconditional `COUNT(*) WHERE sent_at::DATE=CURRENT_DATE`, no refund concept, (7) fair-price validation, (8) analytics, (9) insert quote, (10) first-quote transition `open→quoted` + `quoted_at`, (11) dispatch log insert.
D2's tier/radius check inserts as a new step **after (2), before (3)** — validating provider first, then checking eligibility before wasting a duplicate-check cycle on an ineligible provider; this closes both the UI bypass and any direct-API-call bypass in one place, since this function is the sole write path for quote creation regardless of caller.
D4's monthly block is **entirely new logic** here (no monthly check exists in this function today, only daily+capacity); it duplicates numbers already hardcoded in `select_quote_atomic` (047/048), `provider-allowance.ts`, and `types/index.ts` — a third/fourth copy of the same constants, a real drift risk.
D5's refund hooks into step (6)'s WHERE clause (must learn to exclude rows marked refunded).

### `select_quote_atomic` evolution (031→040→045→047→048)
PPJ branch (045) and overage-gate branch (047, hardened by 048's `FOR UPDATE` fix) are separate, later-added branches on top of the base accept flow. The 047→048 pair is the **directly applicable internal precedent** for how 051+ migrations should be diffed: 048's header explicitly states it is byte-identical to 047 except one line, confirming the discipline this team already uses correctly once (the same discipline that migration 046 violated, later fixed by 050).

### D5 refund mechanics — column vs. derivation
`cancel_request_and_compensate_atomic` (049) compensates `jobs_this_month`/`ppj_recovery_credits` only on **late** cancellations; it never touches `request_quotes` and has no refund concept. The PPJ pre-payment-cancel case (D5's second condition) falls in the **non-late** branch, which today does nothing at all. `expire_ppj_payment_selection_atomic` (045) similarly never touches the daily counter (by design — nothing was "consumed" on a timeout). **Pure derivation is fragile**: `selected_quote_id` is cleared by SLA-release and PPJ-timeout paths, and the quote's own `status` field is also overwritten (`rejected`) by those same paths — the only reason a cancellation-refund would be derivable at all is "the quote's status was never overwritten by an unrelated path," an implicit, fragile signal. **Recommendation: an explicit nullable refund-marker column on `request_quotes`**, set once inside `cancel_request_and_compensate_atomic`'s new branch, mirroring the exact `cancellation_compensated_at` idempotency pattern already used in the same function. The daily-count query then becomes a trivial, cheap, single-table `... AND refund_marker IS NULL` predicate.

### Migration sequencing
Hard dependency order: (1) `requests` schema (snapshot columns) → (2) `request_quotes` schema (refund column, can run parallel to 1) → (3) `get_nearby_open_requests` rewrite (depends on 1) → (4) `submit_quote_atomic` rewrite (depends on 1 and 2) → (5) `cancel_request_and_compensate_atomic` rewrite (depends on 2). D6's +5min penalty and its `weekly_sla_reset_atomic` clearing should fold into steps 3/4's migrations rather than ship separately. Every `DROP FUNCTION` step loses existing grants and must re-apply them exactly (`get_nearby_open_requests` → `authenticated + service_role`; `submit_quote_atomic` and `cancel_request_and_compensate_atomic` → `service_role` only, never `authenticated`). Every rewritten function body must be diffed line-by-line against its immediately-preceding live version before applying (the 046-lesson, already correctly modeled by 047→048).

---

## §2 Application-layer findings

### Timer budget — one real conflict
Worst case: 21+ bucket, PPJ (+12) + `visibility_reduced` (+5, Q5) = **+17 min** before a provider even sees the request.
- Quote validity (10 min): not threatened — starts only at actual submission.
- **Customer-selection timeout (20 min) — conflicts.** `marketplace-cron/route.ts`'s `expireUnselectedRequests` expires `status='quoted'` requests once `quoted_at < now-20min`, a direct table UPDATE keyed on `quoted_at` = timestamp of the very first quote from **any** tier. Since business is 0-delay in every bucket, `quoted_at` ≈ creation time whenever any business provider is online in range — meaning the 20-min clock starts almost immediately regardless of slower tiers' delays. A PPJ provider becoming visible at T+17 in a request whose `quoted_at` was set near T+0 has only a **3-minute** effective window before auto-expiry — worst exactly in the 21+ bucket, where PPJ's delay is longest. **This timer's reference point (or duration) must change before 051 ships; this is a product decision, not a code detail** (open question).
- Open-request expiry (2h) and SLA thresholds (20m/2h/60m from `accepted_at`): no conflict, unaffected by pre-acceptance delay timing.

### Realtime — confirmed, code-traced side-channel
`ProviderRealtimeRefresh.tsx`'s `provider-open-requests` channel fires an unconditional "new request nearby" toast + `router.refresh()` on every `requests` INSERT with `status=eq.open`, with zero eligibility check in the callback. Traced through to `dashboard/page.tsx:428-453`: the primary tiered RPC call only replaces the feed when it returns a **non-empty** array; any empty result (including the now-common case of "in range but tier delay not yet elapsed") falls through to the **unfiltered admin fallback query** (`status IN (open,quoted), accepted_by IS NULL`, no radius/GPS/plan filter — this is the exact D3 target). So: INSERT → toast → refresh → tiered RPC still empty → fallback fires anyway → **early visibility leak, confirmed by direct code trace, not hypothetical.** D3 removal is a hard prerequisite for D1/D2 to have any real effect, not a separate cleanup item. Minimal fix: make the open-requests channel a neutral silent refresh trigger only (drop the eligibility-implying toast) AND remove/replace the fallback so the refreshed data can never leak through it.

### Scoring/ranking
Live (not dead) scoring lives in `src/app/api/requests/quotes/route.ts` via `computeProviderScore` (`provider-score.ts`), used for the customer-facing top-5 list on `quoted` requests. `getMaxRingDistanceKm(4)` is hardcoded to **50 km** everywhere it's called — once the radius opens to 150 km, providers between 50–150 km all collapse to `proximityScore=0`, degrading ranking for the majority of the newly-visible range; must be reconciled (raise the ceiling or make the normalizer non-linear). No plan-tier priority exists in this live scoring formula today (plan only affects visibility timing under D1, never final ranking) — consistent with D1-D6, not a conflict, just worth stating explicitly. `dispatch.ts` is confirmed **fully dead** (no importers anywhere) and structurally incompatible with the new model (5/10/20km escalating rings vs. a fixed 150km + frozen-count delay model); its `visibility_reduced`-as-hard-exclusion semantics directly contradict Q5 and must not be ported forward — **recommend deleting the file entirely**, not adapting it. The `acceptanceRate`/monthly-resetting-`completedJobs` placeholder defect in the live scoring formula (`computeAcceptanceRate(jobs_this_month, jobs_this_month+1)` always yields a meaningless ratio that craters every month-start) is confirmed real and live, but is a **pre-existing, independent defect unrelated to D1-D6** — recommend deferring it to its own track rather than bundling into 051+.

### Cron interactions
Only `expireUnselectedRequests` (the 20-min customer-selection timeout, see Timer budget above) assumes the old, untiered visibility model in a way that conflicts with D1. `expireStaleQuotes`, `enforceSla`, `expirePpjPaymentWindows`, and the 2h/3h expiry routes (`expire-requests/route.ts`) all key off timestamps set downstream of visibility (per-quote validity, acceptance, selection, payment) and are unaffected.

### UI surface
1. **`dashboard/page.tsx` fallback query (lines ~441-453)** — the confirmed D3 target; highest-priority change, must ship together with the RPC redesign, not after.
2. `ProviderRequestList` (not read this session — unread dependency) likely needs changes once `requestFeedMode`'s `'fallback'` value is removed.
3. `ProviderQuoteForm.tsx` has no pre-submit D4 check today (only reacts to post-submit error codes, via the already-implemented body-first-parsing pattern from the prior session's fix) — extend with a new error code (e.g. `monthly_limit_reached`) and/or a pre-submit disabled state using the already-server-computed `allowance` object (`getProviderAllowance`, already available in `dashboard/page.tsx`).
4. `dashboard/page.tsx`'s existing `upgradePrompt` block is a natural, already-existing integration point to extend for D4's harder "at limit" state.
5. `ProviderRealtimeRefresh`'s open-requests toast must stop implying eligibility (see Realtime above).

### Risk classification (highlights)
- **High-risk lifecycle/RPC:** `submit_quote_atomic` redesign, `cancel_request_and_compensate_atomic` D5 branch.
- **Launch-blocking (not deferrable):** dashboard fallback removal (D3) — without it, D1/D2 have no real effect.
- **High-risk, needs explicit product sign-off:** 20-minute customer-selection-timeout re-anchoring.
- **Safe code-only:** realtime toast/refresh behavior, quote-form pre-check, `dispatch.ts` deletion, proximity-normalizer reconciliation (though ranking-visible, so verify manually before shipping).
- **Launch-defer candidate:** `acceptanceRate`/`completedJobs` scoring defect fix (independent of D1-D6).
- **Migration-only:** schema additions, D6 penalty + reset-clearing (folded into the RPC migrations).

---

## §3 Full conflict list (consolidated)

1. D1's 150 km vs. `PROVIDER_RADIUS_METERS=5000` and the RPC's `p_radius` default.
2. D1/D2 vs. dead `dispatch.ts`'s ring model — not reusable.
3. D2 vs. `get_nearby_open_requests`'s `authenticated`-callable grant — enforcement must be inside the RPC.
4. **D3 fallback removal is a hard prerequisite for D1/D2** — confirmed by direct code trace (realtime → refresh → empty tiered result → fallback leak).
5. D4 vs. `submit_quote_atomic`'s total absence of a monthly check — new logic, triple-duplicates existing constants.
6. D4's flat 15/35 vs. `getProviderAllowance`'s credit-adjusted `effectiveLimit` — unresolved (open question).
7. D5 vs. both release RPCs — neither has any refund concept today; the PPJ pre-payment-cancel case is currently a no-op branch.
8. D5 derivation is fragile (`selected_quote_id`/quote `status` overwritten by unrelated release paths) — recommend an explicit column.
9. D6 (`visibility_reduced`) — only referenced in dead code today, with hard-exclusion semantics that contradict Q5; no existing clearing mechanism before Q5 required one.
10. **20-min customer-selection timeout vs. D1's worst-case +17 min delay** — confirmed conflicting in the 21+ bucket.
11. 50 km proximity normalizer vs. 150 km radius — live ranking degradation.
12. Triple-duplicated plan-limit constants (DB RPC, `provider-allowance.ts`, `types/index.ts`).
13. GPS-freshness mismatch: quote route's 15-min window vs. feed RPC's/dashboard's 5-min window vs. D1's "≤5 min" snapshot spec.
14. `requests.location` defaults to a fixed Dubai-downtown point with no customer coordinates — would misassign the D1 snapshot count.
15. Realtime open-requests toast implies eligibility independent of the fallback issue (#4) — its own side-channel.

## §4 Open product questions (must be answered before writing 051+ migrations)

1. Is the "fewer than 10 total online providers → radius opens beyond 150 km" trigger evaluated against the frozen creation-time snapshot (like the tier bucket, per Q2) or re-checked live at read time? Q2 only confirmed the bucket-freezing; this specific trigger condition is still ambiguous.
2. Does D4's submit-time block apply to the raw plan limit (15/35) or the credit-adjusted `effectiveLimit` (`planLimit + creditBalance`)? Note the existing select-time backstop gate may not account for credit balance either — may need one consistent answer for both gates.
3. Fix approach for the 20-minute customer-selection timeout: change its reference column (e.g. to `created_at`), extend its duration, or decouple it (e.g. don't start counting until a minimum elapsed time)? Product decision, not implementation detail.
4. Should `ProviderRealtimeRefresh`'s open-requests toast be removed entirely, or deferred until eligibility is positively known? Minimal-risk answer is "remove," but changes a currently-visible notification — needs explicit sign-off.

**Pre-existing live bug (independent of 051):** `select_quote_atomic` ignores `job_credit_balance` while the dashboard promises `effectiveLimit = planLimit + credits` since migration 008; credits are granted and reset but never consumed anywhere. Q2's resolution must cover consumption semantics, both gates, and whether this ships inside 051 Phase 3 or earlier.

**Q3's duplicate count is 3, not 2:** `src/app/api/requests/route.ts:157` (`quotedAge > 20 * 60 * 1000`, response-only masking of the customer's own GET) and `src/app/api/ops/marketplace-cron/route.ts:109` (`cutoffMs = 20 * 60 * 1000`, the actual `quoted → expired` DB write) both hardcode the literal independently of `src/types/index.ts:100`'s `CUSTOMER_SELECTION_TIMEOUT_MS`, which is defined but imported nowhere. Both live spots key off `quoted_at`. 051 must update the duration/reference-column in all three places together (and either wire up or delete the orphaned constant) — updating only the cron leaves the customer's own request view masking/unmasking on the old 20-min/`quoted_at` rule while the cron enforces a different one. No functional duplicate found in customer-facing UI: `CustomerQuoteList.tsx`'s `expiresIn` countdown is the separate 10-min per-quote validity timer (`quote.expires_at`), and the one place `quoted_at` reaches the client (`requests/quotes/route.ts:218`) is typed but unused (dead field).

**Fallback-coordinates snapshot poisoning (conflict #14, confirmed reachable via normal usage, not just an edge case):** any customer who types an address instead of tapping "use my location" (the likely default path for many users, not just GPS-permission-denied) submits `coords: null`, and `requests/route.ts:310-312` silently pins `location` to the fixed literal `POINT(55.2708 25.2048)` with no stored flag distinguishing it from a real downtown-Dubai request (only an indirect proxy: `fuzzy_latitude`/`fuzzy_longitude` are also `NULL` in this case, since `fuzzy` is only computed when `coords` is present). Phase 1 must not compute the D1 snapshot (online-provider count / tier bucket) directly against fallback coordinates — needs explicit detection (e.g. the fuzzy-null proxy, or a dedicated flag added in the same Phase 1 migration) and defined fallback behavior before the snapshot logic ships.

## §5 Phased implementation plan (plan only — no SQL, no code)

- **Phase 0:** resolve the 4 open questions in §4.
- **Phase 1 (schema, additive):** `requests` snapshot/bucket/zero-subscriber-flag columns; `request_quotes` D5 refund-marker column.
- **Phase 2:** redesign `get_nearby_open_requests` (new radius default, plan-aware CTE, tier/elapsed-time/fallback/zero-subscriber logic, preserve privacy masking, re-apply grants, full diff vs. 039).
- **Phase 3:** redesign `submit_quote_atomic` (tier/radius enforcement insert after provider-lock, D4 monthly block per Phase 0's answer, D5 exclusion predicate, full diff vs. 039, re-apply `service_role`-only grants).
- **Phase 4:** `cancel_request_and_compensate_atomic` D5 refund branch (new condition independent of `v_is_late`, idempotency-guarded, full diff vs. 049).
- **Phase 5:** fold D6's +5 min penalty into Phase 2/3's bodies; add the clearing step to `weekly_sla_reset_atomic`.
- **Phase 6 (application layer, can start in parallel once RPC signatures are agreed):** remove/replace the dashboard fallback (D3, launch-blocking); update the dashboard's RPC call site; neutralize the realtime toast; add D4 pre-submit UI messaging; inspect/update `ProviderRequestList`; reconcile the 50 km proximity normalizer; delete `dispatch.ts`; resolve the 20-minute timeout per Phase 0.
- **Explicitly deferred, out of scope for 051+:** the `acceptanceRate`/`completedJobs` scoring defect; consolidating the triple-duplicated plan-limit constants (do opportunistically when touching D4's code, not a blocker).

---

*This file is a planning artifact for migration 051+. It should be read in full before any 051+ migration or code change is written. Update or delete it once 051+ ships and its findings are either resolved or superseded.*
