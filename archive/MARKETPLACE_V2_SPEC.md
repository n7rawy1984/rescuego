# Marketplace V2 Spec

Last refreshed: 2026-06-11

Full source discovery on 2026-06-11 inspected Marketplace API routes, pages, components, helpers, and migrations before this spec was refreshed.

This file documents the current implemented behavior. For broader architecture, read `ARCHITECTURE.md`.

## Goal

Marketplace V2 changes RescueGo from first-accept-wins to quote selection:

1. Customer creates a request.
2. Providers see fuzzy request information.
3. Providers submit quotes.
4. Customer chooses a quote.
5. Exact customer details are revealed to the chosen provider.
6. Job proceeds through provider lifecycle states.

## Customer Request Creation

Route:

- `POST /api/requests`

Current behavior:

- Authenticated customer only.
- Rate limited.
- Validates problem type, phone, address, and UAE coordinates when provided.
- Blocks a customer from creating another active request.
- Stores exact location as a PostGIS point.
- Stores fuzzy latitude/longitude when customer GPS coordinates are supplied.
- Stores destination text and destination area when supplied.
- Does not currently populate destination latitude/longitude.
- Starts the request in `open` status.

## Provider Discovery

Current nearby request behavior includes:

- Active provider requirement in provider-facing routes.
- Online provider location requirement for quoting.
- Stale location protection.
- UAE coordinate validation.
- Fuzzy customer location display before quote selection.

Legacy nearby/accept helpers still exist for compatibility with old PPJ and overage flows.

Realtime:

- Requests are published through Supabase realtime.
- Request quotes are published through Supabase realtime.
- Customer quote UI subscribes to quote insert/update events.
- Provider dashboard refresh logic subscribes to request, quote, and provider-location events with debounce/throttle guards.

## Quote Submission

Route:

- `POST /api/provider/jobs/quote`

Database RPC:

- `submit_quote_atomic`

Current behavior:

- Authenticated provider only.
- Provider role required.
- Provider must be `active`.
- Provider must be online.
- Provider location must be fresh.
- Request must be `open` or `quoted`.
- Provider-to-customer distance is computed server-side.
- Quote amount must pass route-level broad validation.
- RPC inserts or updates the provider quote.
- Request status becomes `quoted`.

Important current caveat:

- Migration `032_relax_fair_price_validation.sql` disabled database fair price range enforcement. It was RE-ENABLED by migration `039_security_backstop.sql` (Batch 1, C5/D2) and is currently TEMPORARILY WIDENED by migration `044_temp_widen_fair_price_bounds.sql` for testing — the validation still runs (`v_min_fair = base_fee + distance_km × min_price_per_km`, `v_max_fair = base_fee + distance_km × max_price_per_km`) but with bounds 0.01/10000 so any reasonable test amount above the base-fee floor passes. The fair-price formula is a LAUNCH BLOCKER to redesign (two-leg distance + mandatory emirate destination), NOT to restore — see DEFERRED_PRODUCT_BACKLOG.md P9/P1/P2.

## Quote Listing

Route:

- `GET /api/requests/quotes`

Current behavior:

- Authenticated customer only.
- Customer must own the request.
- Request must be `quoted`.
- Returns pending, non-expired quotes.
- Enriches quotes with provider profile, rating, completed job count, and distance.
- Uses provider scoring helper to sort quotes.
- Returns up to five quotes.
- Provider information is limited for customer selection.

## Quote Selection

Route:

- `POST /api/customer/quote/select`

Database RPC:

- `select_quote_atomic`

Current behavior:

- Authenticated customer only.
- Customer owns the request.
- Selected quote must belong to the request.
- Selected quote must be pending and not expired.
- RPC accepts selected quote.
- RPC rejects competing pending quotes.
- Request is assigned to the selected provider.
- Request status becomes `accepted`.
- Provider details are returned to the customer.

## Provider Job Lifecycle

Routes:

- `POST /api/provider/jobs/advance-state`
- `POST /api/provider/jobs/price-change`
- `POST /api/customer/price-change/respond`
- `POST /api/provider/jobs/complete`
- `POST /api/provider/jobs/release`

Lifecycle:

- `accepted`
- `en_route`
- `arrived`
- `in_progress`
- `completed`

Price-change behavior:

- Provider can request one price change during `in_progress`.
- Customer can approve or reject the pending price change.
- Completion uses approved price change first.

Completion price resolution:

1. Approved price change, if present.
2. Selected quote price, if present.
3. Legacy `final_price` fallback.

## Quote Expiration and SLA

Ops route:

- `/api/ops/marketplace-cron`

Current behavior:

- Expires pending quotes.
- Expires quoted requests after the configured selection timeout.
- Runs SLA release for overdue accepted jobs.

Current caveat:

- The route reports zero SLA warnings sent. Warning delivery is not currently implemented there.

## Provider Eligibility

Provider marketplace participation should require:

- Authenticated provider role.
- Provider row owned by the user.
- `providers.status = active`.
- Online location.
- Fresh provider location.
- Capacity and allowance checks where applicable.

Providers in these statuses should not participate:

- `pending`
- `under_review`
- `rejected`
- `suspended`

## Customer Privacy

Before quote selection:

- Providers should see fuzzy location only.
- Providers should not see customer contact details.
- Providers should not see exact customer address/coordinates beyond what is intentionally fuzzed.

After quote selection:

- Selected provider can receive exact request details needed to complete the job.
- Customer receives selected provider contact details.

## Legacy Compatibility

The old first-accept endpoint remains in code:

- `POST /api/provider/requests/accept`

Payment routes can still call legacy acceptance RPCs after successful PPJ or overage payment.

This means Marketplace V2 is implemented, but the legacy path has not been fully removed.

## Related Files

- `src/app/api/requests/route.ts`
- `src/app/api/requests/quotes/route.ts`
- `src/app/api/customer/quote/select/route.ts`
- `src/app/api/provider/jobs/quote/route.ts`
- `src/app/api/provider/jobs/advance-state/route.ts`
- `src/app/api/provider/jobs/price-change/route.ts`
- `src/app/api/customer/price-change/respond/route.ts`
- `src/app/api/provider/jobs/complete/route.ts`
- `src/lib/dispatch.ts`
- `src/lib/provider-score.ts`
- `src/lib/range-estimator.ts`
- `supabase/migrations/031_marketplace_v2.sql`
- `supabase/migrations/032_relax_fair_price_validation.sql`
- `supabase/migrations/033_marketplace_v2_helpers.sql`
- `supabase/migrations/035_destination_helpers.sql`
