# Deferred Product Backlog

Items that are real, confirmed gaps but are intentionally NOT bundled into
the change that discovered them. Each entry states why it's deferred and
what unblocks it. Do not silently fix these opportunistically — they ship
as their own reviewed change.

---

## Quote-submission route: hardcoded English error messages (no i18n)

**Found during:** Phase 3 Step 2 design (`submit_quote_atomic` tier-delay
enforcement, `TIERED_DISPATCH_051_ANALYSIS.md`).

**Gap:** `src/app/api/provider/jobs/quote/route.ts`'s `errorMessages`
mapping table (lines ~136-145) returns hardcoded English strings for every
rejection reason — it never calls `getTranslations()` / `useTranslations()`,
violating AGENTS.md §A4.1 (all user-facing strings must be translated,
Arabic first).

**Current entries needing i18n keys** (existing 8 + the 2 new ones Item B
adds):

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
| `visibility_window_not_open` (new, Item B) | `provider.quote.errors.visibilityWindowNotOpen` |
| `visibility_calc_failed` (new, Item B) | `provider.quote.errors.visibilityCalcFailed` |

Keys go in both `messages/ar.json` (written first) and `messages/en.json`.

**Why deferred:** this is a translation-batch task, not a schema/RPC change.
Bundling it into the tier-delay migration would widen that change's blast
radius for an unrelated concern.

**Ships:** with the next i18n/translation pass across provider-facing API
routes — not as part of Phase 3 Items A-F.

---
