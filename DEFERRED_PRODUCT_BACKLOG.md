# RescueGo — Deferred Product / UX Backlog

This file tracks product, UX, pricing, and non-security findings discovered during live testing. It is intentionally **separate** from `ARCHITECTURE.md` (system design and security architecture) and `PROJECT_STATUS.md` (current security findings and open state). Items here are deferred until the security remediation batches are closed and runtime-verified.

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

### P11 — Quote-status feedback messages to the provider (submitted / rejected) to teach fair pricing
- **Type:** UX/Copy
- **Priority:** Medium
- **Severity:** Commercial (better pricing behavior → more accepted quotes → more completed jobs)
- **Effort:** S
- **Target batch:** UX & State Machine (closely related to P5)
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** Give the provider clear feedback through the quote lifecycle so they learn to submit fair, competitive prices:
  1. **On quote submission:** when the provider submits a price, show a message confirming their price has reached the customer and is awaiting the customer's approval (e.g. "تم إرسال سعرك للعميل وهو في انتظار الموافقة").
  2. **On customer rejection:** if the customer does not accept the provider's quote (selects someone else / the quote is rejected or expires), show a message telling the provider their price was not accepted by the customer and inviting them to submit a more suitable/competitive price (e.g. "لم يوافق العميل على سعرك — حاول تقديم سعر مناسب ليوافق عليه العميل").
- **Rationale (owner):** these messages train providers to price fairly and competitively over time, which improves the marketplace (more quotes accepted, fewer stranded customers). All copy must be in simple, clear Arabic (ties directly to P5, which covers the fair-price *rejection* wording — keep both consistent).
- **Relationship to P5:** P5 is specifically about the fair-price *bounds* rejection message (price out of allowed range, simple Arabic, no raw codes). P11 is broader — it covers the *customer*-driven quote outcomes (submitted-and-waiting, customer-rejected). Implement them together as one Arabic-copy pass over the quote lifecycle so messaging is consistent.
- **QA scenario:**
  1. Provider submits a quote on an open request.
  - **Expected:** a clear Arabic message that the price was sent to the customer and is awaiting approval.
  2. The customer selects a different provider (or the quote is rejected/expires).
  - **Expected:** a clear Arabic message that the customer did not accept the price, encouraging a more suitable price next time. No raw codes, no English.

## Cross-cutting verification reminders (post-security)

### P12 — Cancellation notice lingers + has no request identifier
- **Type:** UX/Copy
- **Priority:** Medium
- **Severity:** UX
- **Effort:** S
- **Target batch:** UX & State Machine
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** Observed on the provider dashboard after a customer cancelled a job. Two issues on the same notice card ("ألغى العميل هذا الطلب… تم إلغاء Battery Issue بواسطة العميل، دفعتك محمية، وأي رصيد استرداد مؤهل يُعالج تلقائياً"):
  1. **The notice persists every time:** it keeps showing on the dashboard on every visit/refresh even though the provider has already seen it AND already received the recovery credit (the credit is clearly shown in their account, and their record already marks the job as customer-cancelled). A one-time cancellation notice should be dismissible (a "تم/إغلاق" action) or auto-clear after acknowledgement — it should not re-appear indefinitely.
  2. **No request identifier:** the message says "هذا الطلب" ("this request") with NO request number or identifier. If the provider has more than one request, they can't tell which one is meant. Every notice must carry a clear reference — a request ID/number, or at least service type + time (e.g. "Battery Issue — 12:06") — so the provider knows exactly which request the message refers to.
- **QA scenario:**
  1. A customer cancels a provider's job; provider views the dashboard.
  - **Expected:** the cancellation notice shows once, is dismissible (or clears after acknowledgement), and does not re-appear on every refresh once acknowledged.
  2. Inspect the notice text.
  - **Expected:** it identifies the specific request (ID/number, or service type + time), not a generic "this request."

### P13 — PPJ payment prompt shows "pay 15 AED" even when the provider has a recovery credit
- **Type:** UX/Copy (PPJ flow)
- **Priority:** Medium
- **Severity:** UX (confusing/alarming to the provider; logic is already correct)
- **Effort:** S
- **Target batch:** UX & State Machine (part of the PPJ messaging pass; ties to P7 + P11)
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** Found during PPJ end-to-end testing. A PPJ provider who had a recovery credit (from an earlier customer cancellation) was selected. The system correctly applied the credit and finalized the job immediately without going to Stripe (the credit covers the per-job fee — logically correct). BUT the UI still showed the "pay 15 AED within 10 minutes" prompt with the countdown timer before/around the auto-finalize. That payment-and-countdown message is wrong for a provider who has a credit — it's misleading and alarming (they think they must pay and may "time out" even though the credit covers it).
- **Desired behavior:** when the selected PPJ provider has an available recovery credit, the prompt must NOT say "pay 15 AED within 10 minutes." Instead show something like: "لديك رصيد سابق — اضغط لتأكيد استخدام الرصيد واستلام بيانات العميل" ("You have an existing credit — tap to confirm using it and receive the customer's details"). No payment amount, no 10-minute countdown framed as a payment deadline. The action confirms credit use and reveals contact / finalizes the job.
- **Note:** the underlying logic is already correct (credit is consumed, job finalized, no Stripe charge). This is purely a UI/copy branch in PpjPaymentPrompt: detect `job_credit_balance > 0` (or the recovery-credit flag) for the selected PPJ provider and render the credit-confirmation message instead of the pay-15/countdown message. Keep both copies simple Arabic (consistent with P5/P11).
- **QA scenario:**
  1. A PPJ provider with a recovery credit is selected by a customer.
  - **Expected:** the prompt offers to confirm using the existing credit (no "pay 15 AED", no payment-deadline countdown); confirming reveals contact + finalizes the job.
  2. A PPJ provider with NO credit is selected.
  - **Expected:** the normal "pay 15 AED within 10 minutes" prompt + countdown (unchanged from P7).

### P14 — Subscriber daily quote limits (5/10/20/3) — review before Phase 3 wires the SSOT
- **Type:** Pricing / Dispatch (plan limits)
- **Priority:** Low
- **Severity:** Commercial
- **Effort:** XS (values-only change, once Phase 3 wires `get_provider_limits()` into the enforcement RPCs)
- **Target batch:** Dispatch Tuning / Tiered Dispatch Phase 3 (`select_quote_atomic` + `submit_quote_atomic` rebuild)
- **Target release:** Decide during Phase 3, or post-launch
- **Status:** OPEN
- **Detail:** Currently ALL plans do NOT share the same daily quote limit — this was a factual correction made during migration 051 (Tiered Dispatch Phase 1): the differentiated limits (starter 5 / pro 10 / business 20 / pay_per_job 3, enforced in `submit_quote_atomic` since migration 039) are ALREADY LIVE, not uniform. Raised during 051 Phase 1 while building the `get_provider_limits()` single-source-of-truth function: should these values be revisited (e.g. raised further for higher subscription tiers as a stronger perk, or tightened on `business` if broker/reseller abuse is observed)?
- **Owner decision:** Deferred — this is a pricing/product decision, not a schema decision. `get_provider_limits()` was created in migration 051 as exact live-behavior parity (no values changed). Decide at Phase 3 (`select_quote_atomic`/`submit_quote_atomic` gate rebuild) or post-launch, informed by soft-launch usage data — particularly whether `business`'s daily limit of 20 is being abused by brokers/resellers submitting quotes across many requests. When decided, the ONLY change needed is the values inside `get_provider_limits()` — every consuming RPC adopts it automatically once Phase 3 wires them to call it instead of their own hardcoded CASE blocks (that is the point of the SSOT function).
- **QA scenario:**
  1. As each plan tier, submit quotes up to the daily limit (starter 5, pro 10, business 20, pay_per_job 3).
  - **Expected:** the (n+1)th quote of the day is rejected `daily_limit_reached` for each plan at its respective threshold, matching `get_provider_limits()`'s current values.

### P15 — Quote-submission route: hardcoded English error messages (no i18n)
- **Type:** UX/Copy
- **Priority:** Medium
- **Severity:** UX (also an AGENTS.md compliance gap)
- **Effort:** S (translation batch, no logic change)
- **Target batch:** UX & State Machine (copy) — coordinate with the next i18n/translation pass across provider-facing API routes
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** Found during Tiered Dispatch Phase 3 Step 2 design (`TIERED_DISPATCH_051_ANALYSIS.md`). `src/app/api/provider/jobs/quote/route.ts`'s `errorMessages` mapping table (lines ~136-145) returns hardcoded English strings for every rejection reason — it never calls `getTranslations()` / `useTranslations()`, violating AGENTS.md §A4.1 (all user-facing strings must be translated, Arabic first).
- **Proposed i18n keys** (existing 8 reasons + 2 new ones Phase 3 Item B adds):

  | reason code | proposed i18n key |
  |---|---|
  | `request_not_found` | `provider.quote.errors.requestNotFound` |
  | `request_not_quotable` | `provider.quote.errors.requestNotQuotable` |
  | `provider_not_active` | `provider.quote.errors.providerNotActive` |
  | `already_quoted` | `provider.quote.errors.alreadyQuoted` |
  | `capacity_full` | `provider.quote.errors.capacityFull` |
  | `daily_limit_reached` | `provider.quote.errors.dailyLimitReached` |
  | `price_too_low` | `provider.quote.errors.priceTooLow` |
  | `price_too_high` | `provider.quote.errors.priceTooHigh` |
  | `visibility_window_not_open` (new, Phase 3 Item B) | `provider.quote.errors.visibilityWindowNotOpen` |
  | `visibility_calc_failed` (new, Phase 3 Item B) | `provider.quote.errors.visibilityCalcFailed` |

  Keys go in both `messages/ar.json` (written first) and `messages/en.json`.
- **Owner decision:** Deferred — this is a translation-batch task, not a schema/RPC change. Bundling it into the tier-delay migration would widen that migration's blast radius for an unrelated concern. Ships with the next i18n/translation pass, not as part of Phase 3 Items A-F.
- **QA scenario:**
  1. Trigger each rejection reason above as a provider with the UI in Arabic.
  - **Expected:** the shown message is Arabic (from `messages/ar.json`), not a hardcoded English string.

- **CRIT-02 (P4b) — DONE, runtime-verified on production (June 26, 2026).** The `en_route`/`arrived` SLA auto-release was tested: minute cron returned `sla_releases: 1` and the released request reset to `open` with all stale state (`accepted_by`, `selected_quote_id`, `accepted_at`) cleared per D6. Kept here as a regression check to re-run after any future change to the SLA RPCs or the marketplace-cron route. NOTE: P10 may reveal an en_route-specific stuck case — re-verify there.

### P16 — `expire_stale_open_requests` exists live but has no `CREATE FUNCTION` in migration history (schema drift)
- **Type:** Schema
- **Priority:** Medium
- **Severity:** Operational (migration history is not the source of truth for this function — cannot be reproduced from `supabase/migrations/` alone)
- **Effort:** S (capture live definition into a new reconciliation migration, body unchanged)
- **Target batch:** Follow-up to migration 056 (grants hotfix)
- **Target release:** Soft Launch
- **Status:** OPEN
- **Detail:** Found while auditing all `public`-schema function grants for migration 056. `expire_stale_open_requests` is called from `src/app/api/ops/expire-requests/route.ts:27` (admin client, cron route) and exists live in the database, but no `CREATE FUNCTION public.expire_stale_open_requests` statement exists anywhere in `supabase/migrations/*.sql` — it was created directly against the live database (SQL editor or ad hoc), bypassing migration history entirely. Migration 056 hardens its grants safely via live-OID lookup (name-based, not signature-hardcoded), so it is not a blocker for 056. But the function's definition is currently unreproducible from version control.
- **Owner decision:** Deferred — capture via `SELECT pg_get_functiondef('public.expire_stale_open_requests(timestamptz)'::regprocedure);` run against production, then commit its exact live body into a new reconciliation migration (body unchanged, grants already normalized by 056). Not bundled into 056 itself (grants-only scope).
- **QA scenario:**
  1. Run the `pg_get_functiondef` query above against production and diff its output against the reconciliation migration once written.
  - **Expected:** byte-identical body; the reconciliation migration is a no-op against the live function, purely a version-control capture.

### P17 — Bounded sliding selection window (DEFERRED post-launch alternative to `quoted_at`+20min)
- **Type:** State machine / Lifecycle
- **Priority:** Low (post-launch only)
- **Severity:** UX (only if real usage shows a problem)
- **Effort:** M (touches `submit_quote_atomic`, `requests/route.ts` GET masking, `marketplace-cron` expiry)
- **Target batch:** Post-launch, only if triggered by real usage data
- **Target release:** After Launch
- **Status:** DEFERRED (not rejected)
- **Detail:** During the LB-13 investigation, a redesign was proposed as an alternative to the current `quoted_at` + 20-minute expiry rule (which is set once by the first quote and never refreshed by later quotes). The current rule was formally APPROVED for launch (Medo, July 15, 2026 — see `PROJECT_STATUS.md` §6 LB-13, §15), confirmed by a live production test on request `b61b8e4f-a8ac-409a-bac3-28f9d085a56c`. This item preserves the alternative design so it is not lost, for evaluation only if real usage data later shows a problem.
- **Conceptual rule (preserved for future evaluation):**
  ```
  selection_expiry = MIN(latest_valid_quote_time + selection_window, created_at + max_request_lifetime)
  ```
  i.e., the customer's selection window would slide forward with each new valid quote (bounded by an overall maximum request lifetime from `created_at`), instead of being fixed relative to the first quote only.
- **Owner decision:** Deferred, not rejected. Evaluate ONLY if real usage data shows customers losing valid quotes to expiry, or a high re-request rate after expiry, post-launch.
- **QA scenario (for future evaluation, not now):**
  1. Track, post-launch, how often a `quoted` request expires while it still has valid/unexpired quotes attached.
  2. Track how often a customer re-creates a request shortly after one expires.
  - **Expected trigger for revisiting this item:** either rate is meaningfully high in real usage.

### P18 — "Location not recorded" copy shown despite coordinates existing
- **Type:** UX/Copy
- **Priority:** Low
- **Severity:** UX (misleading copy, not data loss)
- **Effort:** XS
- **Target batch:** UX & State Machine (copy)
- **Target release:** After Launch
- **Status:** OPEN
- **Detail:** Found during the July 15, 2026 PPJ quote-display live production test. The customer-facing page shows "location not recorded" even though the request has exact and fuzzy coordinates recorded — the copy is keyed off `location_address` being NULL, not off whether coordinates exist. This is misleading copy (implies no location data was captured at all), not an actual data-loss bug.
- **Owner decision:** Low-priority — fix the copy to check coordinate presence (or fall back to a neutral "no address label provided" wording) instead of implying location data is missing.
- **QA scenario:**
  1. Create a request with GPS coordinates but no free-text address.
  - **Expected (after fix):** the customer page does not claim location was "not recorded"; it reflects that coordinates exist even without a text address.

### P19 — Overage-payment economics redesign + re-evaluate submission-time blocking
- **Type:** Product / Payments
- **Priority:** Medium
- **Severity:** Fairness/UX (no financial loss today — the path is unreachable)
- **Effort:** L (Stripe flow redesign + new UI entry point + RPC changes)
- **Target batch:** Post-launch (or before Phase 3 Steps 4–5 if prioritized earlier)
- **Target release:** After Launch
- **Status:** OPEN
- **Detail:** Found during the migration 057 (Phase 3 Step 3) design review. Hard-blocking quote submission for a provider who has exhausted their monthly allowance (base + credits) was considered and explicitly NOT implemented, because the current pre-submission/pre-quote overage-payment path is unreachable in the live V2 marketplace UI: its only trigger, the legacy `/api/provider/requests/accept` 402 branch (`ProviderRequestList.tsx`'s `handleAccept()`), is dead code — `src/app/api/provider/requests/accept/route.ts` now unconditionally returns `403 V2_QUOTE_REQUIRED` for all subscription plans (LB-6), before any overage check runs. `requests.overage_cleared` therefore has no live pre-quote writer today. In addition, the current request-bound overage-payment model has no refund/reuse mechanism if a provider pays and is never selected for that request (`overage_payments` money is request-specific and non-transferable). Blocking submission today would be a dead end for an exhausted provider with no way to unblock themselves.
- **Owner decision:** Deferred. Migration 057 ships an informational, non-blocking exhaustion warning instead (`warning_code: 'monthly_allowance_exhausted'` on successful quote submission).
- **QA scenario (for future evaluation, not now):**
  1. Redesign the overage-payment flow to be reachable pre-submission and either request-agnostic (reusable credit) or refundable if never selected.
  2. Only then re-evaluate whether submission-time blocking for exhausted providers is fair and worth implementing.

### P20 — Legacy overage-payment UI audit/retirement (orphaned dead code)
- **Type:** Tech debt / Cleanup
- **Priority:** Low
- **Severity:** None (dead code, no live impact)
- **Effort:** S
- **Target batch:** Cleanup pass
- **Target release:** After Launch
- **Status:** OPEN
- **Detail:** Found during the migration 057 design review (same investigation as P19). `ProviderRequestList.tsx`'s legacy `handleAccept()` 402 branch, its `showOverageModal` state/modal, `handleOverageConfirm()`, and the entire `/provider/overage-pay` checkout page are now unreachable in production: the only route that could return the `402 OVERAGE_REQUIRED` status these depend on (`/api/provider/requests/accept`) unconditionally returns `403 V2_QUOTE_REQUIRED` before reaching that code path (LB-6). This dead UI was intentionally NOT removed as part of migration 057 (out of scope, no functional risk from leaving it) but should be audited and retired in a dedicated cleanup pass to avoid confusing future maintainers.
- **Owner decision:** Deferred to a cleanup pass. Do not remove opportunistically alongside unrelated feature work.
- **QA scenario:**
  1. Confirm no live code path can return `402 OVERAGE_REQUIRED` from `/api/provider/requests/accept` (already true per LB-6).
  2. Remove `showOverageModal`, `handleOverageConfirm()`, the 402 branch in `handleAccept()`, and `/provider/overage-pay` (or repurpose it if P19's redesign reintroduces a reachable overage flow).

---

### P21 — Deeper cancellation-attribution branching defect (independent of Phase 2 billing-period work)
- **Type:** State machine / Schema
- **Priority:** Medium
- **Severity:** Operational (affects which counter/attribution a cancellation is recorded against, not billing correctness itself)
- **Effort:** Unknown — needs a dedicated read-only investigation before sizing
- **Target batch:** Not yet assigned
- **Target release:** TBD
- **Status:** OPEN — flagged during the July 22, 2026 Phase 2 billing-period integrity work, NOT investigated in technical depth as part of that work or this documentation update.
- **Detail:** During the Phase 2 billing-period integrity session (migrations 058/059), a separate, independent defect in how job cancellations are attributed was noted — distinct from the billing-period/first-activation issue that session actually fixed. `providers.provider_side_cancellation_count` and `providers.unable_to_complete_count` (both protected by the migration-039/058 immutable-column trigger) are the two relevant counters; the exact branching logic that decides which counter increments for a given cancellation path has not yet been traced end-to-end in this documentation pass — a repo search this session found these two columns referenced only inside migration SQL (009, 020, 028, 039, 040, 042, 058) and `src/types/database.ts`, with no application-layer call site found by that search. **This entry is a placeholder to not lose the finding, not a confirmed root-cause writeup.**
- **Owner decision:** Deferred — out of scope for the Phase 2 billing-period batch (058/059), which was scoped strictly to activation/renewal period-date integrity and first-activation initialization.
- **Required before this can be sized:** a dedicated read-only trace of every write site for `provider_side_cancellation_count` and `unable_to_complete_count` across all cancellation/release paths (customer cancel, provider release, SLA auto-release, stuck-job auto-release), confirming whether the correct counter is attributed to the correct actor/path in every branch.
- **QA scenario (for the future investigation, not now):**
  1. Trigger each distinct cancellation/release path (customer-initiated cancel, provider-initiated release, SLA timeout auto-release, stuck-job auto-release) against a test provider.
  - **Expected (once investigated):** each path increments the counter that correctly attributes responsibility for that specific cancellation; misattribution in any branch is the defect to confirm or rule out.

### P22 — Billing-period renewal path: runtime verification pending (real or Stripe Test-Clock renewal cycle)
- **Type:** Payments / State machine
- **Priority:** High
- **Severity:** Operational (the fix is code-complete and applied; only the proof is missing)
- **Effort:** S (requires either waiting for a real Stripe renewal or driving a Stripe Test Clock)
- **Target batch:** Follow-up to Phase 2 Billing-Period Integrity (migrations 058/059)
- **Target release:** Before this fix can be considered fully proven
- **Status:** OPEN — pending task, not a known defect
- **Detail:** The July 22, 2026 production runtime test for the Phase 2 billing-period fix (`resolveSubscriptionPeriod()`, `initialize_first_subscription_atomic`) only exercised the **activation/upgrade** branch (a new provider completing a job then upgrading to Starter via checkout). The **renewal** branch — an already-`first_activation_at`-initialized provider's subscription renewing on its normal cycle — has not been exercised since the fix shipped. Code inspection (`src/app/api/stripe/webhook/route.ts:684-697`) confirms the renewal `updatePayload` object writes only `status`, `stripe_subscription_id`, `stripe_current_period_start`, `stripe_current_period_end` (plus `plan`/`job_credit_balance`/`last_upgrade_bonus_key` only inside the upgrade branch) and never `jobs_this_month`/`jobs_reset_at`/`first_activation_at` — but this is a code-level guarantee, not a runtime-confirmed one.
- **Owner decision:** Pending — see `PROJECT_STATUS.md` §6 "Billing-Period Integrity (Phase 2)" for full detail. Do not mark the renewal path as runtime-verified until this test is run.
- **QA scenario:**
  1. Drive a real elapsed billing period, or a Stripe Test Clock, to fire a `customer.subscription.updated` renewal event for an already-initialized provider.
  - **Expected:** fresh `stripe_current_period_start/end` are written; `jobs_this_month`, `jobs_reset_at`, and `first_activation_at` are all left untouched by this event (they only change via the monthly-reset cron or a future first-activation, which cannot re-fire for this provider).

---

## Open questions for the owner (resolve before the Pricing & Destination batch)

1. **Pricing model (now clearer):** The new model must measure TWO distance legs — provider→breakdown location AND breakdown→destination — not the single leg the current formula uses. Final formula after consulting real recovery operators — distance-based (two-leg), flat per emirate pair, or hybrid? (Affects P1 + P2 + the P9 restore/redesign together.)
2. **Destination coordinates:** Will destination be captured as a picked point on a map (real coordinates), or inferred from the chosen emirate + area (the 7-emirate dropdown)? (Determines whether P2 is L or XL effort — option (a) coordinates vs option (b) per-emirate-pair table.)

---

*Last updated: June 28, 2026 — security Batches 1–4 deployed/verified (migrations 039–043). Added P7 (PPJ post-selection fee-gate model), P8 (tiered dispatch is dead code — wire-up decision deferred), P9 (fair-price bounds temporarily widened, LAUNCH BLOCKER — formula to be redesigned two-leg with emirate destination, NOT restored to current values). P9 enriched and marked DONE for the widen step: migration `044_temp_widen_fair_price_bounds.sql` created (min_price_per_km=0.01, max_price_per_km=10000, base_fee unchanged; RPC `submit_quote_atomic` unchanged); confirmed formula `v_min_fair = base_fee + distance_km × min_price_per_km`, `v_max_fair = base_fee + distance_km × max_price_per_km`. Added P10 (premature SLA message on en_route / customer stuck — needs diagnosis), P11 (quote-status feedback messages to provider: submitted-and-waiting, customer-rejected — teaches fair pricing, ties to P5), P12 (cancellation notice lingers on dashboard + has no request identifier), and P13 (PPJ payment prompt shows "pay 15 AED" + countdown even when the provider has a recovery credit — should offer credit-confirmation copy instead; logic already correct, UI/copy only). PPJ post-selection fee gate (migration 045) deployed and in end-to-end testing. Env-var incident resolved (Stripe + cron keys corrected to test). This is a living file; add new testing findings in the same format as they appear.*

*Update July 8, 2026 — Added P14 (subscriber daily quote limits 5/10/20/3 are already live since migration 039, not uniform; reviewing/adjusting these values is deferred to Tiered Dispatch Phase 3, when the new `get_provider_limits()` SSOT function created in migration 051 is wired into the enforcement RPCs).*

*Update July 13, 2026 — Added P16 (`expire_stale_open_requests` has no `CREATE FUNCTION` anywhere in `supabase/migrations/` — live schema drift discovered during the migration 056 grants-hotfix audit; migration 056 hardens its grants safely via live-OID lookup regardless, but its definition still needs a reconciliation migration).*

*Update July 12, 2026 — Added P15 (quote-submission route's `errorMessages` table is hardcoded English, no `getTranslations()`, found during Tiered Dispatch Phase 3 Step 2 design; deferred to the next i18n/translation pass, proposed keys recorded).*

*Update July 15, 2026 — Added P17 (bounded sliding selection window — deferred alternative to the newly approved `quoted_at`+20min binding decision, conceptual formula preserved) and P18 ("location not recorded" misleading copy shown despite coordinates existing, found during the PPJ quote-display live production test).*

*Update July 16, 2026 — Added P19 (overage-payment economics redesign + re-evaluate submission-time blocking, deferred during the migration 057 / Phase 3 Step 3 design review — the current pre-submission overage path is unreachable dead code per LB-6, and the request-bound overage model has no refund/reuse if a provider pays and is never selected) and P20 (legacy overage-payment UI audit/retirement — `ProviderRequestList.tsx`'s orphaned 402 branch, `showOverageModal`, and `/provider/overage-pay` are dead code today; flagged for a dedicated cleanup pass, not removed as part of 057).*

*Update July 22, 2026 — Added P21 (a separate, independent cancellation-attribution branching defect flagged during the Phase 2 billing-period integrity work — `provider_side_cancellation_count`/`unable_to_complete_count` write-site attribution not yet traced end-to-end; placeholder only, not a confirmed root-cause writeup) and P22 (Phase 2 billing-period fix's renewal path — code-complete, applied to production July 22, 2026 — is still pending a real or Stripe Test-Clock renewal-cycle runtime test; only the activation/upgrade branch has been runtime-verified so far). See `PROJECT_STATUS.md` §6 "Billing-Period Integrity (Phase 2)" and `SESSION_LOG.md`'s July 22, 2026 entry for full detail.*
