# RescueGo — Deferred Product / UX Backlog

This file tracks product, UX, pricing, and non-security findings discovered during live testing. It is intentionally **separate** from `RESCUEGO_MASTER_REFERENCE.md` (which is the security/architecture source of truth). Items here are deferred until the security remediation batches are closed and runtime-verified.

**How to use this file:** Add new findings as they come up during testing. Each item gets the full field set below. Do not start implementing any of these until the security batches (1–5) are closed, unless explicitly re-prioritized.

---

## Field definitions

Every backlog item carries these fields:

| Field | Meaning |
|---|---|
| **Type** | What part of the system it touches (Pricing, Schema, State machine, UX/Copy, Dispatch, CSS/Layout) |
| **Priority** | *When* we work on it (High / Medium / Low) |
| **Severity** | *How much impact* it has — independent of timing (see scale below) |
| **Effort** | Rough implementation size (XS / S / M / L / XL) |
| **Target batch** | Which future batch it belongs to |
| **Target release** | Soft Launch / After Launch / Phase 2 |
| **Status** | OPEN / IN PROGRESS / PARTIALLY COVERED / DONE |
| **Owner decision** | The decision taken and *why*, so we remember the reasoning later |
| **QA scenario** | Concrete steps + expected result, so this file doubles as a test checklist |

### Severity scale
- **Commercial** — affects money, conversion, or revenue
- **UX** — affects experience but not money directly
- **Operational** — affects running the platform / providers
- **Compliance** — regulatory requirement

### Priority vs Severity (why both)
Priority answers "when do we do it." Severity answers "how badly does it hurt if we don't." A High-severity-Commercial item can still be Medium-priority if it's blocked on an external input (e.g. real pricing data).

### Effort scale
XS = under an hour · S = a few hours · M = a day · L = multi-day · XL = needs schema + flow + logic changes together

### Status legend
- **OPEN** — logged, not started, deferred
- **IN PROGRESS** — currently being worked
- **PARTIALLY COVERED** — some of it is handled by an existing/in-flight security batch
- **DONE** — implemented and verified

---

## Proposed future batches

These are the grouping buckets the items below map to. They run **after** the security batches.

| Batch | Scope | Depends on |
|---|---|---|
| **UX & State Machine** | Remove redundant "start task" button, enforce/clarify "complete task", button layout | Security Batch 2 + 3 deployed (state machine RPC is now protected) |
| **Pricing & Destination** | Emirate dropdown (mandatory), destination coordinates, new pricing formula | Real recovery-operator pricing input from owner |
| **Dispatch Tuning** | Enforce ring eligibility in quote API (MED-01) and related ranking improvements | — |

**Execution order (agreed):** Security Batch 3 → Batch 4 → security complete → full QA → **UX batch** → **Pricing batch** → Launch. Pricing is intentionally last because the owner will consult real recovery operators first, and doing it earlier means doing it twice.

---

## Backlog items

### P1 — Price estimates are inflated / unrealistic
- **Type:** Pricing
- **Priority:** Medium
- **Severity:** Commercial
- **Effort:** XS (data-only; no code)
- **Target batch:** Pricing & Destination
- **Target release:** After Launch (tuning)
- **Status:** OPEN
- **Detail:** During testing, the financial estimates shown are sometimes too high / exaggerated relative to realistic market prices.
- **Owner decision:** Deferred until after consulting real recovery operators. **Reason:** the numbers will change once real prices are known, so tuning now would be wasted. Because security Batch 1 (C5/D2) re-enabled fair-price bounds **read from the `fair_price_config` table**, these can be changed directly in the config table with **no code change**.
- **QA scenario:**
  1. Create a request with a known problem type and distance.
  2. Compare the shown estimate against the agreed real-world price for that scenario.
  - **Expected:** estimate falls within the realistic band defined in `fair_price_config`.

### P2 — Destination (emirate) not factored into pricing; mandatory emirate dropdown needed
- **Type:** Pricing + Schema
- **Priority:** High
- **Severity:** Commercial
- **Effort:** L–XL (see dependency)
- **Target batch:** Pricing & Destination
- **Target release:** Soft Launch (decision pending — see open question)
- **Status:** OPEN
- **Detail:** Pricing is calculated on distance-to-customer, not distance-to-destination. If a customer is nearby but wants the vehicle towed to another emirate, the provider prices as if the job is short and is under-paid for the real (longer) work. The destination emirate is not reflected in the estimate.
- **Proposed solution (owner):**
  1. Make the **emirate a mandatory field** chosen from a dropdown (the 7 UAE emirates), not free text — prevents spelling errors and binds it to pricing.
  2. Keep a **separate optional field** for free text (workshop name, home, etc.).
  3. The emirate list must be linked to the pricing system.
- **CRITICAL technical dependency (raises effort to L–XL):** The codebase has **no `destination_lat` / `destination_lng`** — it stores `destination_text` and `destination_area` only, not coordinates. A mandatory emirate dropdown alone is **S effort**, but making destination actually affect the price requires either (a) destination coordinates added to the schema + request-creation flow, or (b) a per-emirate-pair pricing table keyed off the dropdown. This is **not just a dropdown** — it is schema + flow + pricing-formula work. Decide the approach before sizing.
- **Owner decision:** Group with P1 and do once, after real prices are known — changing the pricing model (P1) touches the same code; avoid editing pricing twice.
- **QA scenario:**
  1. Create a request where customer is in Dubai but destination is Sharjah.
  2. Submit as a provider near the customer.
  - **Expected:** the estimate/fee reflects the destination distance (Dubai→Sharjah), not just proximity to the customer.
  3. Try to submit a request without selecting an emirate.
  - **Expected:** blocked; emirate is mandatory and chosen from the 7-emirate dropdown (no free-text spelling).

### P3 — "Nearest-first" request visibility / cheapest-from-nearest to customer
- **Type:** Dispatch
- **Priority:** Low
- **Severity:** Commercial
- **Effort:** S (only the MED-01 gap)
- **Target batch:** Dispatch Tuning
- **Target release:** After Launch
- **Status:** PARTIALLY COVERED (core already implemented)
- **Detail:** Owner wants requests to surface to the nearest providers, so the customer sees the lowest prices from nearby providers (commercially correct).
- **Current reality (confirmed during testing):** Already implemented — ring-based dispatch (5km / 10km / 20km / unlimited), `get_nearby_open_requests` RPC sorts by distance, and `provider-score.ts` ranks quotes using distance, price, rating, and completion count. Live test confirmed a request surfaced to multiple providers who quoted, and the customer chose among them.
- **Outstanding improvement:** Audit finding **MED-01** — ring eligibility is **not enforced in the quote submission API**, so a far provider could still submit a quote even when they should be excluded. Low priority; deferred to Dispatch Tuning.
- **QA scenario:**
  1. Place two providers at different distances from a request (one inside ring 1, one far outside).
  - **Expected (after MED-01 fix):** the far provider cannot submit a quote when ring rules should exclude them.

### P4a — Redundant "Start Task" button in the provider job flow
- **Type:** State machine
- **Priority:** Medium
- **Severity:** UX
- **Effort:** M (flow change, not just UI)
- **Target batch:** UX & State Machine
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** After the provider presses "I have arrived" (`arrived`), two buttons appear: "Start Task" and "Complete Task". Pressing "Start Task" has no visible effect because "Complete Task" was already showing. The provider has effectively already arrived and started working — the meaningful action is "Complete Task".
- **Owner decision:** The "Start Task" button is redundant and should be removed.
- **Caution:** The state machine (`accepted → en_route → arrived → in_progress → completed`) is protected by the `advance_provider_job_state` RPC, modified in security Batch 2 (LOW-04 whitelist). Removing the button is a **flow change** that must stay consistent with that RPC's allowed transitions — do it after Batch 2/3 are deployed and stable, and adjust the RPC's whitelist if a state is dropped.
- **QA scenario:**
  1. Take a job to `arrived`.
  - **Expected (after fix):** only "Complete Task" shows; no redundant "Start Task". The lifecycle still completes correctly and the RPC accepts the transition.

### P4b — Enforce / add consequences for not pressing "Complete Task"
- **Type:** Security (already in flight)
- **Priority:** High
- **Severity:** Operational
- **Effort:** —
- **Target batch:** Security Batch 2 + 3 (CRIT-02)
- **Target release:** Soft Launch (blocker)
- **Status:** DONE (runtime-verified)
- **Detail:** A provider who arrives and then abandons the job without completing it should face consequences (auto-release). This is exactly **CRIT-02**.
- **Resolution:** RPC side shipped in Batch 2; cron side (widening `enforceSla()` in `marketplace-cron` to query `accepted`/`en_route`/`arrived`, ordered oldest-first by `created_at`) shipped in Batch 3. A phantom-column hotfix (migration 042 + route fix: `requests.updated_at` → `created_at`) was required and applied. CRIT-02 is now **fully closed and runtime-verified on production**: the minute cron returned `success: true` with `sla_releases: 1`, and the released request was confirmed reset to `open` with `accepted_by`, `selected_quote_id`, and `accepted_at` all cleared (per D6 + MED-04). Thresholds in effect: accepted 20m / en_route 2h / arrived 60m.
- **Remaining UX work (still open):** The *technical* enforcement is done. The provider-facing UX that tells them to complete is tracked separately in **P4c**, and the redundant "Start Task" button is **P4a**.
- **QA scenario (passed — kept for regression):**
  1. Provider presses Arrived.
  2. Provider leaves the request (no completion).
  3. Timer (60 min for arrived) expires.
  - **Expected:** request auto-released; returns to `quoted` if valid quotes remain, else `open` (per D6); job slot decremented; provider penalized per SLA logic. **Result: PASS.**

### P4c — Tell the provider they must press "Complete" to get rated / keep receiving requests
- **Type:** UX/Copy
- **Priority:** Medium
- **Severity:** UX
- **Effort:** XS
- **Target batch:** UX & State Machine
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** There should be clear copy explaining that the provider must press "Complete Task" to (a) close the life cycle, (b) get the customer's rating, and (c) keep receiving new requests. Without this, providers may forget to complete (observed in testing — completion was delayed).
- **Owner decision:** Worth doing for soft launch; directly affects whether real providers complete the loop.
- **QA scenario:**
  1. Provider reaches the final step of a job.
  - **Expected:** visible message stating completion is required for rating and to keep receiving requests.

### P4d — Cancel-task button placement
- **Type:** CSS/Layout
- **Priority:** Low
- **Severity:** UX
- **Effort:** XS
- **Target batch:** UX & State Machine
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** The container holding the cancel-task button should appear on the far left, not next to the live-cycle action buttons of the active job, to avoid accidental clicks / visual confusion.
- **QA scenario:**
  1. View an active job with lifecycle action buttons.
  - **Expected:** cancel control is visually separated (far left), not adjacent to the primary lifecycle actions.

### P5 — Fair-price rejection message must be in simple Arabic for the provider
- **Type:** UX/Copy
- **Priority:** Medium
- **Severity:** UX
- **Effort:** XS
- **Target batch:** UX & State Machine (copy) — coordinate with Pricing & Destination since the threshold numbers come from there
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** When the fair-price validation (re-enabled in security Batch 1, C5/D2) rejects a quote that is below or above the configured bounds, the message shown to the provider must be in **Arabic, in simple language the provider can understand** — not a raw code like `price_too_low` / `price_too_high` and not English. The provider should clearly understand that their quoted price is outside the acceptable range and roughly what to do (raise or lower it).
- **Note:** The RPC returns a reason code (`price_too_low` / `price_too_high`); the route/UI layer must map that code to a friendly Arabic sentence. This is a presentation concern, not a logic change — the bounds themselves stay in `fair_price_config`.
- **QA scenario:**
  1. As a provider, submit a quote far below the configured minimum for the service type.
  - **Expected:** a clear Arabic message telling the provider the price is too low and to enter a higher amount (no English, no raw code).
  2. Submit a quote far above the configured maximum.
  - **Expected:** a clear Arabic message telling the provider the price is too high.

### P6 — Two admin nav buttons share the same label ("لوحة التحكم") with different links
- **Type:** UX/Copy + Navigation
- **Priority:** Medium
- **Severity:** UX
- **Effort:** XS
- **Target batch:** UX & State Machine
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** In the admin navbar, two buttons carry the identical label "لوحة التحكم" but link to different destinations (`/admin/dashboard` vs `/admin/providers`). An admin cannot tell which is which without clicking. Each button should be named after its destination — e.g. "لوحة الإدارة" for the dashboard and "إدارة مقدمي الخدمة" for the providers page (matching the in-page titles already shown on each screen).
- **QA scenario:**
  1. Open the admin area and inspect the navbar.
  - **Expected:** the two nav buttons have distinct, destination-descriptive labels; no two buttons share the same label while linking to different pages.

### P7 — PPJ (pay-per-job) re-enabled via post-selection fee gate (NEW MODEL)
- **Type:** State machine + Payments
- **Priority:** High
- **Severity:** Commercial
- **Effort:** M–L
- **Target batch:** PPJ re-enable (own task, in progress — read-only plan stage)
- **Target release:** Soft Launch
- **Status:** IN PROGRESS (design/diagnosis)
- **Detail:** PPJ checkout was disabled — NOT intentionally; commit `c0a03b0` (Marketplace-V2 Session 5) replaced the per-card "Accept / Pay and Accept" button with `<ProviderQuoteForm>`, orphaning `handleAccept` → the PPJ flow has no UI entry point. The PPJ code (ppj-checkout, ppj-pay, webhook, RPC) is all intact, just never invoked.
- **New chosen model (better than restoring V1):** PPJ providers submit a quote like everyone else. When the customer selects a PPJ provider's quote, the provider sees "Your price was accepted — pay the [15 AED] fee to reveal the customer's details," pays, and only then receives contact details + assignment. Subscribers get details immediately on selection (no per-job fee). This reuses V2 quoting and fixes a V1 gap (V1 PPJ never set a service price — `final_price` was left NULL; the 15 AED was only the platform fee).
- **Payment window:** 5 min unpaid → warning; 10 min total unpaid → selection cancelled, request returns to pool, customer sees other providers again.
- **Critical design constraints (for implementation):**
  - The 10-min PAYMENT timer (selection→payment) must be SEPARATE from the SLA timer. SLA clock starts only AFTER payment + assignment. An unpaid-but-selected PPJ provider must NOT get SLA penalties.
  - Competing quotes must be HELD (not expired) during the 10-min window so they're still selectable if the PPJ provider fails to pay.
  - Must not break `select_quote_atomic` (Batch 2), SLA logic (Batch 2/3), the PPJ payment-bypass guard (kept — it's on the legacy path, correct defense-in-depth), or any Batch 1–4 fix.
- **403 guard verdict:** KEEP as-is. It's on the legacy free-accept HTTP route; the webhook assigns via the RPC directly (no HTTP call), so the guard cannot block PPJ assignment.

### P8 — Tiered (plan-priority) dispatch is dead code — wire it up or drop it (DECISION DEFERRED)
- **Type:** Dispatch
- **Priority:** Medium
- **Severity:** Commercial
- **Effort:** M
- **Target batch:** Dispatch Tuning (post-launch decision)
- **Target release:** Decision: before or after soft launch (TBD)
- **Status:** OPEN (documented, not wired)
- **Detail:** `src/lib/dispatch.ts` contains a fully-implemented plan-tiered dispatch the owner designed: `getDispatchPriority(plan)` (Business=1, Pro=2, Starter=3, PPJ=4), `computeCurrentRing()` (time-based ring expansion 5/10/15 min → ring 1/2/3/4), `filterDispatchCandidates()` (sorts by priority then distance), PPJ excluded from ring 1. **It has ZERO callers** — never imported or invoked anywhere in `src`.
- **What's actually live:** dispatch is purely GEOGRAPHIC via `get_nearby_open_requests` — every active+online provider within the 5 km radius sees the same open requests at once, ordered by distance ASC. No plan priority, no time-delay by plan.
- **Decision needed:** wire up the tiered dispatch (Business sees new requests first, then Pro after a delay, then Starter) before soft launch, or defer to post-launch. This is the "request shown to Business first, then Pro, then Starter" behavior the owner remembered designing — it exists but is not connected.
- **Note:** This intersects MED-01 (P3) and the legacy-accept question (H2).

### P9 — TEMPORARY: fair-price bounds widened for testing (LAUNCH BLOCKER to redesign)
- **Type:** Pricing (temporary test accommodation)
- **Priority:** High (as a launch blocker)
- **Severity:** Commercial / security (re-opens C5 while widened)
- **Effort:** XS (config-table only)
- **Target batch:** done as migration 044 (widen); redesign is part of Pricing & Destination
- **Target release:** MUST be resolved before Soft Launch
- **Status:** DONE (widen migration 044 created) — redesign still OPEN (launch blocker)
- **Detail:** The fair-price min/max bounds in `fair_price_config` block test quotes. They were TEMPORARILY WIDENED (not disabled — the validation logic stays fully active) via **migration `044_temp_widen_fair_price_bounds.sql`**: it sets `min_price_per_km = 0.01` and `max_price_per_km = 10000` for **all** service types and leaves `base_fee` unchanged, so test quotes at or above the base-fee floor pass while the RPC still runs its range check. The RPC (`submit_quote_atomic`, migration 039) is **not modified** — only the config-table coefficients change. Reversible by changing the numbers (but see owner decision: do NOT restore — redesign).
- **Exact formula confirmed against `submit_quote_atomic` (migration `039_security_backstop.sql:262-274`):**
  - `v_min_fair = base_fee + (distance_km × min_price_per_km)`
  - `v_max_fair = base_fee + (distance_km × max_price_per_km)`
  - reject `price_too_low` if `proposed_price < v_min_fair`; reject `price_too_high` if `proposed_price > v_max_fair`.
  - `distance_km` is the **single leg** provider→customer (computed route-side, haversine). This single-leg measure is exactly what the redesign must replace.
  - After widening (044): floor ≈ `base_fee` (e.g. tow ≈ 100 AED, since `100 + distance×0.01`), ceiling effectively unbounded (e.g. `100 + 5km×10000 = 50,100 AED`). Amounts **below** `base_fee` are still correctly rejected `price_too_low` — expected, not a failure.
- **Owner decision — do NOT treat the current values as the restore target.** The current formula (`base_fee` + distance × per-km rate, single distance: provider→customer) is considered INADEQUATE by the owner because it measures only one leg. The real model must measure TWO legs: provider→breakdown location, and breakdown location→destination (where the recovery takes the vehicle). The current bounds will be REPLACED, not restored, as part of P2 (mandatory emirate dropdown + destination in pricing). So instead of saving the current values as a restore target, leave a prominent reminder that the whole fair-price formula must be REDESIGNED alongside the 7-emirate destination list, after consulting real recovery operators (ties to P1 + P2).
- **Previous seeded values (migration 031) — for the record only, NOT a restore target (the formula will be redesigned, not reverted):** tow 3–8/100, battery 2–5/80, flat_tire 2–5/60, fuel 2–5/50, lockout 2–6/70, other 2–6/80 (`min_price_per_km`–`max_price_per_km`/`base_fee`).
- **Launch-blocker reminder:** while widened, any provider can submit almost any price at/above the base-fee floor (C5 effectively re-opened). Before soft launch, the fair-price model must be **redesigned (two-leg distance: provider→breakdown + breakdown→destination, tied to the mandatory 7-emirate destination dropdown)** and re-enabled with realistic operator-informed bounds — see P1 and P2.
- **QA scenario:**
  1. After applying migration 044, as a provider submit a **reasonable low** quote that is **above the base-fee floor** for the service type (e.g. tow with base_fee 100 → quote ~120 AED).
  - **Expected:** accepted (passes the widened range).
  2. Submit a **high** quote (e.g. 5,000 AED).
  - **Expected:** accepted (below the widened ceiling).
  3. Submit a quote **below** the base-fee floor (e.g. tow at 20 AED while base_fee is 100).
  - **Expected:** still rejected `price_too_low` — confirms validation is widened, **not disabled**.

### P10 — SLA "time exceeded" message on en_route is premature and/or no release action fires
- **Type:** State machine + UX (possible SLA bug)
- **Priority:** High
- **Severity:** Operational (customer left stuck)
- **Effort:** S–M (needs diagnosis first)
- **Target batch:** UX & State Machine (but diagnose first — may be a real SLA bug)
- **Target release:** Soft Launch (blocker if the release truly doesn't fire)
- **Status:** OPEN — needs diagnosis
- **Detail:** Observed in live testing on an active job in `en_route` ("في الطريق"): the card showed "تم تجاوز الوقت المحدد" (time exceeded) while the provider could legitimately still be on the way (long distance). Two distinct problems:
  1. **Premature message:** the en_route SLA threshold is 2 hours (set in Batch 2 precisely to allow for traffic/distance). If the message appears well before 2h (e.g. after ~20 min, the `accepted` threshold), the UI is showing the wrong threshold for the en_route state — a display bug where the countdown/label uses the `accepted` 20-min threshold instead of the en_route 2h threshold.
  2. **No action / customer stuck:** the message appeared but NO action followed — the request did not release, and the customer stayed attached to the provider even after refreshing BOTH the customer and provider pages. The state was frozen.
- **Why this matters / link to CRIT-02:** CRIT-02 (verified) auto-releases a breached en_route/arrived job via the minute cron, returning the request to the pool. Here the message showed but no release happened. Two hypotheses to distinguish during diagnosis:
  - (a) The message is premature (UI uses the 20-min `accepted` threshold on an en_route job), so the real 2h threshold hasn't been reached — meaning the cron is CORRECT not to release yet, and the only bug is the misleading UI message. (Most likely.)
  - (b) The 2h threshold actually elapsed and the cron did NOT release — a real CRIT-02 gap in this path. (Less likely — CRIT-02 verified with sla_releases:1 — but this specific en_route-stuck scenario should be re-tested.)
- **Diagnosis needed:** measure how long after entering en_route the message appears. ~20 min → UI threshold bug (problem 1). 2h+ and still stuck → real release bug (problem 2). Confirm what the provider-facing countdown is bound to vs the actual SLA RPC thresholds (accepted 20m / en_route 2h / arrived 60m).
- **QA scenario:**
  1. Provider advances a job to en_route and waits.
  - **Expected:** no "time exceeded" message before the 2h en_route threshold; once a real threshold is breached, the cron auto-releases the request back to the pool (customer no longer stuck), per CRIT-02 / D6.

## Cross-cutting verification reminders (post-security)

- **CRIT-02 (P4b) — DONE, runtime-verified on production (June 26, 2026).** The `en_route`/`arrived` SLA auto-release was tested: minute cron returned `sla_releases: 1` and the released request reset to `open` with all stale state (`accepted_by`, `selected_quote_id`, `accepted_at`) cleared per D6. Kept here as a regression check to re-run after any future change to the SLA RPCs or the marketplace-cron route. NOTE: P10 may reveal an en_route-specific stuck case — re-verify there.

---

## Open questions for the owner (resolve before the Pricing & Destination batch)

1. **Pricing model (now clearer):** The new model must measure TWO distance legs — provider→breakdown location AND breakdown→destination — not the single leg the current formula uses. Final formula after consulting real recovery operators — distance-based (two-leg), flat per emirate pair, or hybrid? (Affects P1 + P2 + the P9 restore/redesign together.)
2. **Destination coordinates:** Will destination be captured as a picked point on a map (real coordinates), or inferred from the chosen emirate + area (the 7-emirate dropdown)? (Determines whether P2 is L or XL effort — option (a) coordinates vs option (b) per-emirate-pair table.)

---

## Note on roadmap linkage

The security batches (1–5) were an **unplanned track** that emerged from the four security audits — they are not part of the original `ROADMAP.md` phases. The roadmap and these tracks have **not yet been formally merged**. This is intentional for now: finish the security work first, then do a single consolidation pass (planned to be handed to Codex inside the project) that merges security batches, product backlog, and the original roadmap into one source of truth. Do not stop to restructure the roadmap mid-remediation.

---

*Last updated: June 27, 2026 — security Batches 1–4 deployed/verified (migrations 039–043). Added P7 (PPJ post-selection fee-gate model), P8 (tiered dispatch is dead code — wire-up decision deferred), P9 (fair-price bounds temporarily widened, LAUNCH BLOCKER — formula to be redesigned two-leg with emirate destination, NOT restored to current values). P9 enriched and marked DONE for the widen step: migration `044_temp_widen_fair_price_bounds.sql` created (min_price_per_km=0.01, max_price_per_km=10000, base_fee unchanged; RPC `submit_quote_atomic` unchanged); confirmed formula `v_min_fair = base_fee + distance_km × min_price_per_km`, `v_max_fair = base_fee + distance_km × max_price_per_km`. Env-var incident resolved (Stripe + cron keys corrected to test). This is a living file; add new testing findings in the same format as they appear.*
