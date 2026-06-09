# RescueGo — Marketplace V2 Specification
# Phase 6+7+8 Merged: Competitive Quotes + Dispatch + Pricing

**Status:** Design Approved — Implementation Starting
**Estimated Sessions:** 7-8
**Migration:** 031

---

## Overview

**Current model:** First provider to accept wins. Provider self-reports final_price.
**New model:** Providers compete with price quotes. Customer chooses. final_price = approved quote.

---

## Request Flow (Complete Lifecycle)

```
Customer submits request
├── problem_type (existing)
├── GPS location (existing)
├── destination — required if towing, optional otherwise
├── destination_area — required if towing, optional otherwise
└── notes (optional)
        ↓
status = 'open'
System generates fuzzy_latitude/longitude (~1km offset)
        ↓
DISPATCH ENGINE activates
Ring 1 (0-5km) — 5 min: Business → Pro → Starter (PPJ excluded)
Ring 2 (5-10km) — 5 min: all + PPJ enters Ring 1
Ring 3 (10-20km) — 5 min: all + PPJ enters Ring 2
Ring 4 (20+km) — 5 min: all + PPJ enters Ring 3
After Ring 4 → reset Ring 1 with fresh provider check
        ↓
Provider sees request:
├── Capacity Check: active_jobs < max_active_jobs
│   Starter: 1 | Pro: 2 | Business: 5 | PPJ: 1
├── Daily limit check (PPJ:3 | Starter:5 | Pro:10 | Business:20)
├── Fuzzy location + problem type + destination (if towing)
└── CTA: "Send Price Quote"
        ↓
Provider sends quote:
├── Range Estimator validates (server-side, hidden from provider)
│   Input: distance_km (Haversine) + service_type
│   Config: fair_price_config table (admin-managed)
│   Below min → reject: "السعر منخفض جداً ولا يعكس تكلفة الخدمة"
│   Above max → reject: "السعر مرتفع جداً"
├── Motivational message:
│   "ضع سعراً عادلاً — العملاء يختارون بناءً على السعر والتقييم.
│    السعر العادل يجعلك الخيار الأول دائماً"
└── Quote valid 10 min (configurable)
        ↓
First quote received → status = 'quoted'
        ↓
Customer sees Top 5 by Provider Score:
├── score = (rating×0.40) + (proximity×0.30) + (price×0.20) + (acceptance_rate×0.10)
├── New Provider Boost: <10 completed jobs → rating +0.5 in formula
├── Each card (anonymous): Provider #XXXX | ⭐ | ✅ verified | distance | price | countdown
├── Tabs: Recommended | Best Value | Nearest
└── Customer has 20 minutes to select → else expired
        ↓
Customer selects:
├── Cancellation warning shown
├── PPJ: Stripe Capture 15 AED (SOFT_LAUNCH_MODE=true → fee=0, no Stripe)
├── Subscription: deduct from allowance
└── status = 'accepted'
        ↓
Full details revealed:
├── Provider sees: customer name + phone + exact GPS + Maps link
└── Customer sees: provider name + phone + one document photo + rating
        ↓
SLA Timer:
├── 10 min → Warning notification to provider
└── 20 min no en_route →
    ├── Auto Release
    ├── PPJ: Refund 15 AED (or soft_launch void)
    ├── Provider Score -5
    ├── SLA Failure Counter +1
    └── 3+ failures/week → Visibility Reduction
        ↓
en_route → arrived → in_progress
        ↓
Price Change (max 1 per job, in_progress only):
├── Provider requests revision
├── Customer approves or rejects
└── Rejected → original proposed_price stands
        ↓
Completion:
├── final_price = approved_price_change OR proposed_price
├── Provider CANNOT manually enter price at completion
├── status = 'completed'
├── Customer rates provider
└── System logs to provider_dispatch_log
```

---

## Status Lifecycle

```
open → quoted → accepted → en_route → arrived → in_progress → completed
                                                             ↘ cancelled
                                                             ↘ expired
```

| Status | Meaning |
|--------|---------|
| open | No quotes yet, dispatch active |
| quoted | At least one quote received, customer choosing |
| accepted | Customer selected + payment confirmed |
| en_route | Provider traveling to customer |
| arrived | Provider at location |
| in_progress | Job started |
| completed | Job done, rated |
| cancelled | Customer or admin cancelled |
| expired | 20 min timeout with no selection |

Future states (not in this phase): `customer_no_show` | `provider_no_show`

---

## Dispatch Engine

### Priority per Ring
1. Business (highest)
2. Pro
3. Starter
4. PPJ (lowest, excluded from Ring 1)

### Timing
- Each ring: 5 minutes
- Total cycle: 20 minutes (4 rings)
- After cycle: reset to Ring 1 with fresh provider list

### Provider Visibility Rules
- **Daily limits:** PPJ: 3 | Starter: 5 | Pro: 10 | Business: 20
- **Capacity:** max_active_jobs per plan (computed, not stored)
  - Starter: 1 | Pro: 2 | Business: 5 | PPJ: 1
  - `active = count(requests WHERE accepted_by=provider AND status IN ('accepted','en_route','arrived','in_progress'))`
  - If active >= max → invisible to dispatch
- **SLA violations:** 3+ per week → visibility reduction

### Distance Calculation
- **v1 (now):** Haversine (straight-line km) from `src/lib/geo.ts`
- **v2 (future):** Google Distance Matrix API for real driving distance

---

## Range Estimator (Server-Side Only)

### Input
- `distance_km` — Haversine between customer GPS and destination (or 0 if no destination)
- `service_type` — towing | battery | fuel | tire | lockout

### Config Table: `fair_price_config`
| Column | Type | Purpose |
|--------|------|---------|
| service_type | TEXT UNIQUE | Service identifier |
| min_price_per_km | NUMERIC(8,2) | Floor per km |
| max_price_per_km | NUMERIC(8,2) | Ceiling per km |
| base_fee | NUMERIC(8,2) | Fixed base regardless of distance |
| quote_validity_minutes | INTEGER | Default 10 |

### Formula
```
min_fair_price = base_fee + (distance_km × min_price_per_km)
max_fair_price = base_fee + (distance_km × max_price_per_km)
```

### Validation
- `proposed_price < min_fair_price` → reject: "السعر منخفض جداً ولا يعكس تكلفة الخدمة"
- `proposed_price > max_fair_price` → reject: "السعر مرتفع جداً"
- Provider cannot submit outside range

### Admin Controls
- All values in `fair_price_config` table
- Admin can update live — takes effect immediately
- No hardcoding anywhere

---

## Provider Score

### Formula
```
score = (rating × 0.40) + (proximity_score × 0.30) + (price_score × 0.20) + (acceptance_rate × 0.10)
```

### New Provider Boost
- Providers with < 10 completed jobs → rating gets +0.5 bonus in formula only
- Prevents cold-start problem where new providers never get selected

### Component Scoring (all normalized 0-1)
- **rating:** provider avg rating / 5.0
- **proximity_score:** 1 - (distance_km / max_ring_distance)
- **price_score:** 1 - ((proposed_price - min_fair_price) / (max_fair_price - min_fair_price))
- **acceptance_rate:** completed_jobs / total_accepted_jobs

### Tracked Metrics (per provider)
- Acceptance Rate
- Completion Rate
- Average Response Time
- Cancellation Rate
- Release Rate
- Price Fairness (avg price_per_km vs baseline)
- SLA Compliance
- SLA Failure Count (resets weekly)

---

## Database Changes (Migration 031)

### Add to `requests` table
```sql
destination TEXT,
destination_area TEXT,
fuzzy_latitude NUMERIC(10,7),
fuzzy_longitude NUMERIC(10,7),
selected_quote_id UUID REFERENCES request_quotes(id),
price_change_requested NUMERIC(10,2) DEFAULT NULL,
price_change_status TEXT CHECK (price_change_status IN ('pending','approved','rejected')) DEFAULT NULL,
price_change_count INTEGER DEFAULT 0
```
Update status CHECK constraint to include `'quoted'` and `'expired'`.

### Add to `providers` table
```sql
sla_failure_count INTEGER DEFAULT 0,
visibility_reduced BOOLEAN DEFAULT FALSE
```
Note: `max_active_jobs` is derived from plan, NOT stored.
Note: `current_active_jobs` is computed from requests table, NOT stored.

### New table: `request_quotes`
```sql
CREATE TABLE request_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id),
  provider_id UUID NOT NULL REFERENCES providers(id),
  proposed_price NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','selected','rejected','expired')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  selected_at TIMESTAMPTZ,
  UNIQUE(request_id, provider_id)
);
```

### New table: `provider_dispatch_log`
```sql
CREATE TABLE provider_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  request_id UUID NOT NULL REFERENCES requests(id),
  distance_km NUMERIC(6,2),
  proposed_price NUMERIC(10,2),
  service_type TEXT,
  price_per_km NUMERIC(8,2),
  was_selected BOOLEAN DEFAULT FALSE,
  sla_met BOOLEAN,
  is_soft_launch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New table: `fair_price_config`
```sql
CREATE TABLE fair_price_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT UNIQUE NOT NULL,
  min_price_per_km NUMERIC(8,2) NOT NULL,
  max_price_per_km NUMERIC(8,2) NOT NULL,
  base_fee NUMERIC(8,2) NOT NULL DEFAULT 0,
  quote_validity_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## API Routes

### POST /api/provider/jobs/quote
Submit price quote for a request.
- Validates: capacity + daily limit + range + not already quoted + status in (open, quoted)
- Creates `request_quotes` row
- First quote → updates request status to 'quoted'
- Logs to `provider_dispatch_log`

### GET /api/requests/quotes
Customer fetches top 5 quotes for their active request.
- Sorted by Provider Score
- Returns anonymous provider info (no name/phone)

### POST /api/customer/quote/select
Customer selects a quote.
- Validates: quote not expired + status = 'quoted'
- PPJ: Stripe Capture (or soft_launch void)
- Subscription: deduct allowance
- status → 'accepted', accepted_by = provider
- Rejects all other pending quotes
- Returns full provider details for reveal

### POST /api/provider/jobs/price-change
Provider requests price revision.
- Only during `in_progress`
- Validates: `price_change_count = 0` (max 1 per job)
- Sets `price_change_requested` + status = 'pending'

### POST /api/customer/price-change/respond
Customer approves or rejects price change.
- Approved: `final_price = new price`
- Rejected: `final_price = proposed_price`

---

## Atomic RPCs

### submit_quote_atomic(provider_id, request_id, proposed_price)
1. Validate provider capacity (computed)
2. Validate daily limit not exceeded
3. Validate price within range (fair_price_config)
4. Validate request status IN ('open', 'quoted')
5. Validate no existing quote from this provider
6. INSERT into request_quotes
7. UPDATE request status to 'quoted' if first quote
8. INSERT into provider_dispatch_log

### select_quote_atomic(customer_id, request_id, quote_id)
1. Validate quote exists and not expired
2. Validate request status = 'quoted'
3. Validate request belongs to customer
4. SET request status = 'accepted', accepted_by = quote.provider_id
5. SET request selected_quote_id = quote_id
6. UPDATE selected quote status = 'selected'
7. UPDATE all other quotes for this request → status = 'rejected'
8. RETURN provider details (name, phone, documents)

### sla_check_and_release(request_id)
1. Check if 20 min passed since accepted_at without en_route
2. Release: status → 'open', accepted_by → NULL, selected_quote_id → NULL
3. PPJ: flag for Stripe refund
4. Provider: score -5, sla_failure_count +1
5. Check 3+ failures/week → set visibility_reduced = true
6. Log SLA failure to provider_dispatch_log

---

## Soft Launch Configuration

### Environment Variable
```
SOFT_LAUNCH_MODE=true   # Vercel env var
```

### Behavior when `true`:
- PPJ fee = 0 (no Stripe capture)
- No Stripe payment on quote selection
- `is_soft_launch = true` logged in dispatch_log
- All other features fully operational (dispatch, quotes, scoring, SLA)

### Behavior when `false` (after ~2 months):
- PPJ fee = 15 AED via Stripe Capture
- Full production billing

---

## Cron Jobs

| Job | Frequency | Action |
|-----|-----------|--------|
| Expire quotes | Every 1 min | Set status='expired' WHERE expires_at < now() |
| Advance dispatch ring | Every 5 min | Expand visibility to next ring |
| Auto-expire request | Every 1 min | Expire if 20 min after first quote with no selection |
| SLA enforcement | Every 1 min | Warning at 10 min, auto-release at 20 min |
| Weekly reset | Weekly | Reset sla_failure_count, apply visibility reductions |

---

## Realtime Subscriptions

### Customer receives:
- New quote arrives → update quote list
- Quote expires → remove from list
- 20 min no selection → show expired state
- Price change requested → show approve/reject UI

### Provider receives:
- Selected by customer → reveal customer details + start SLA timer
- Quote rejected/expired → remove from active quotes
- SLA warning at 10 min → "5 دقائق متبقية لتأكيد الانطلاق"
- Price change approved/rejected → notification

---

## Anti-Abuse Rules

| Rule | Prevention |
|------|-----------|
| Quote Spam | Max 1 quote per provider per request, Top 5 shown only |
| Price Wars | Range Estimator blocks extremes |
| Ghost Providers | SLA 20 min → auto-release + score penalty |
| External Bypass | Anonymous until after payment |
| Customer No-Show | 20 min to select or expires |
| PPJ No-Pay | Capture immediate on selection |
| Release Abuse | 3+ per week → visibility reduction |
| Price Manipulation | Max 1 price change per job, must be approved |

---

## Admin Dashboard (Fairness)

### Provider Score Card (0-100)
- Rating, Completion Rate, Acceptance Rate
- Response Time, Cancellation Rate
- Price Fairness, SLA Compliance, Release Rate

### Fair Price Config
- Per service type: min/max per km + base fee
- Live updates — takes effect immediately

### Soft Launch Analytics
- Requests created/day
- Avg quotes per request
- Customer selection rate
- Avg price per service type
- Avg response time
- Cancellation rate | Release rate
- Most requested service type
- SLA compliance rate

### Fairness Monitor
- Providers sorted by overall score
- Flag outliers (consistently high prices, low SLA)
- Future: auto-boost fair providers in dispatch priority

---

## Changes to Existing Code

### complete_provider_job_atomic (minimal)
- Remove `final_price` as user input parameter
- Instead: read `final_price` from `price_change_status = 'approved'` → use that price, else use `request_quotes.proposed_price` where `status = 'selected'`

### Customer request form
- Add `destination` field (required if problem_type = 'tow', optional otherwise)
- Add `destination_area` field (same condition)

### Provider request feed (ProviderRequestList)
- Show fuzzy location instead of hidden message
- Show destination for towing requests
- Replace "Accept" button with "Send Quote" button

### Provider dashboard (active job)
- Remove direct completion price input
- Add SLA timer UI
- Add "Waiting for customer" state after quote sent

### accept_request_atomic
- Will be DEPRECATED (replaced by submit_quote_atomic + select_quote_atomic)
- Keep for backward compatibility during migration, remove after full rollout

---

## DO NOT

- Do NOT apply migration without showing SQL first and getting approval
- Do NOT hardcode prices, distances, or time limits (all from config/env)
- Do NOT reveal provider identity before payment confirmed
- Do NOT allow price change after completion or more than once
- Do NOT change existing Stripe webhook flows beyond new refund case
- Do NOT remove accept_request_atomic until full rollout confirmed

---

## Future Phases (Not in This Implementation)

- Phase 9: Commission on final_price (% per plan tier)
- Phase 10: Visibility Credits (replace daily limits), Stripe Production keys
- Phase 11: Fraud detection, customer_no_show/provider_no_show states
- Phase 12: UAE legal compliance
- Future: Google Distance Matrix (replace Haversine)
- Future: Dynamic PPJ fee based on distance
- Future: Automated fairness boost/reduction
# RescueGo — Marketplace V2 Specification
# Phase 6+7+8 Merged: Competitive Quotes + Dispatch + Pricing

**Status:** Design Approved — Implementation Starting
**Estimated Sessions:** 7-8
**Migration:** 031

---

## Overview

**Current model:** First provider to accept wins. Provider self-reports final_price.
**New model:** Providers compete with price quotes. Customer chooses. final_price = approved quote.

---

## Request Flow (Complete Lifecycle)

```
Customer submits request
├── problem_type (existing)
├── GPS location (existing)
├── destination — required if towing, optional otherwise
├── destination_area — required if towing, optional otherwise
└── notes (optional)
        ↓
status = 'open'
System generates fuzzy_latitude/longitude (~1km offset)
        ↓
DISPATCH ENGINE activates
Ring 1 (0-5km) — 5 min: Business → Pro → Starter (PPJ excluded)
Ring 2 (5-10km) — 5 min: all + PPJ enters Ring 1
Ring 3 (10-20km) — 5 min: all + PPJ enters Ring 2
Ring 4 (20+km) — 5 min: all + PPJ enters Ring 3
After Ring 4 → reset Ring 1 with fresh provider check
        ↓
Provider sees request:
├── Capacity Check: active_jobs < max_active_jobs
│   Starter: 1 | Pro: 2 | Business: 5 | PPJ: 1
├── Daily limit check (PPJ:3 | Starter:5 | Pro:10 | Business:20)
├── Fuzzy location + problem type + destination (if towing)
└── CTA: "Send Price Quote"
        ↓
Provider sends quote:
├── Range Estimator validates (server-side, hidden from provider)
│   Input: distance_km (Haversine) + service_type
│   Config: fair_price_config table (admin-managed)
│   Below min → reject: "السعر منخفض جداً ولا يعكس تكلفة الخدمة"
│   Above max → reject: "السعر مرتفع جداً"
├── Motivational message:
│   "ضع سعراً عادلاً — العملاء يختارون بناءً على السعر والتقييم.
│    السعر العادل يجعلك الخيار الأول دائماً"
└── Quote valid 10 min (configurable)
        ↓
First quote received → status = 'quoted'
        ↓
Customer sees Top 5 by Provider Score:
├── score = (rating×0.40) + (proximity×0.30) + (price×0.20) + (acceptance_rate×0.10)
├── New Provider Boost: <10 completed jobs → rating +0.5 in formula
├── Each card (anonymous): Provider #XXXX | ⭐ | ✅ verified | distance | price | countdown
├── Tabs: Recommended | Best Value | Nearest
└── Customer has 20 minutes to select → else expired
        ↓
Customer selects:
├── Cancellation warning shown
├── PPJ: Stripe Capture 15 AED (SOFT_LAUNCH_MODE=true → fee=0, no Stripe)
├── Subscription: deduct from allowance
└── status = 'accepted'
        ↓
Full details revealed:
├── Provider sees: customer name + phone + exact GPS + Maps link
└── Customer sees: provider name + phone + one document photo + rating
        ↓
SLA Timer:
├── 10 min → Warning notification to provider
└── 20 min no en_route →
    ├── Auto Release
    ├── PPJ: Refund 15 AED (or soft_launch void)
    ├── Provider Score -5
    ├── SLA Failure Counter +1
    └── 3+ failures/week → Visibility Reduction
        ↓
en_route → arrived → in_progress
        ↓
Price Change (max 1 per job, in_progress only):
├── Provider requests revision
├── Customer approves or rejects
└── Rejected → original proposed_price stands
        ↓
Completion:
├── final_price = approved_price_change OR proposed_price
├── Provider CANNOT manually enter price at completion
├── status = 'completed'
├── Customer rates provider
└── System logs to provider_dispatch_log
```

---

## Status Lifecycle

```
open → quoted → accepted → en_route → arrived → in_progress → completed
                                                             ↘ cancelled
                                                             ↘ expired
```

| Status | Meaning |
|--------|---------|
| open | No quotes yet, dispatch active |
| quoted | At least one quote received, customer choosing |
| accepted | Customer selected + payment confirmed |
| en_route | Provider traveling to customer |
| arrived | Provider at location |
| in_progress | Job started |
| completed | Job done, rated |
| cancelled | Customer or admin cancelled |
| expired | 20 min timeout with no selection |

Future states (not in this phase): `customer_no_show` | `provider_no_show`

---

## Dispatch Engine

### Priority per Ring
1. Business (highest)
2. Pro
3. Starter
4. PPJ (lowest, excluded from Ring 1)

### Timing
- Each ring: 5 minutes
- Total cycle: 20 minutes (4 rings)
- After cycle: reset to Ring 1 with fresh provider list

### Provider Visibility Rules
- **Daily limits:** PPJ: 3 | Starter: 5 | Pro: 10 | Business: 20
- **Capacity:** max_active_jobs per plan (computed, not stored)
  - Starter: 1 | Pro: 2 | Business: 5 | PPJ: 1
  - `active = count(requests WHERE accepted_by=provider AND status IN ('accepted','en_route','arrived','in_progress'))`
  - If active >= max → invisible to dispatch
- **SLA violations:** 3+ per week → visibility reduction

### Distance Calculation
- **v1 (now):** Haversine (straight-line km) from `src/lib/geo.ts`
- **v2 (future):** Google Distance Matrix API for real driving distance

---

## Range Estimator (Server-Side Only)

### Input
- `distance_km` — Haversine between customer GPS and destination (or 0 if no destination)
- `service_type` — towing | battery | fuel | tire | lockout

### Config Table: `fair_price_config`
| Column | Type | Purpose |
|--------|------|---------|
| service_type | TEXT UNIQUE | Service identifier |
| min_price_per_km | NUMERIC(8,2) | Floor per km |
| max_price_per_km | NUMERIC(8,2) | Ceiling per km |
| base_fee | NUMERIC(8,2) | Fixed base regardless of distance |
| quote_validity_minutes | INTEGER | Default 10 |

### Formula
```
min_fair_price = base_fee + (distance_km × min_price_per_km)
max_fair_price = base_fee + (distance_km × max_price_per_km)
```

### Validation
- `proposed_price < min_fair_price` → reject: "السعر منخفض جداً ولا يعكس تكلفة الخدمة"
- `proposed_price > max_fair_price` → reject: "السعر مرتفع جداً"
- Provider cannot submit outside range

### Admin Controls
- All values in `fair_price_config` table
- Admin can update live — takes effect immediately
- No hardcoding anywhere

---

## Provider Score

### Formula
```
score = (rating × 0.40) + (proximity_score × 0.30) + (price_score × 0.20) + (acceptance_rate × 0.10)
```

### New Provider Boost
- Providers with < 10 completed jobs → rating gets +0.5 bonus in formula only
- Prevents cold-start problem where new providers never get selected

### Component Scoring (all normalized 0-1)
- **rating:** provider avg rating / 5.0
- **proximity_score:** 1 - (distance_km / max_ring_distance)
- **price_score:** 1 - ((proposed_price - min_fair_price) / (max_fair_price - min_fair_price))
- **acceptance_rate:** completed_jobs / total_accepted_jobs

### Tracked Metrics (per provider)
- Acceptance Rate
- Completion Rate
- Average Response Time
- Cancellation Rate
- Release Rate
- Price Fairness (avg price_per_km vs baseline)
- SLA Compliance
- SLA Failure Count (resets weekly)

---

## Database Changes (Migration 031)

### Add to `requests` table
```sql
destination TEXT,
destination_area TEXT,
fuzzy_latitude NUMERIC(10,7),
fuzzy_longitude NUMERIC(10,7),
selected_quote_id UUID REFERENCES request_quotes(id),
price_change_requested NUMERIC(10,2) DEFAULT NULL,
price_change_status TEXT CHECK (price_change_status IN ('pending','approved','rejected')) DEFAULT NULL,
price_change_count INTEGER DEFAULT 0
```
Update status CHECK constraint to include `'quoted'` and `'expired'`.

### Add to `providers` table
```sql
sla_failure_count INTEGER DEFAULT 0,
visibility_reduced BOOLEAN DEFAULT FALSE
```
Note: `max_active_jobs` is derived from plan, NOT stored.
Note: `current_active_jobs` is computed from requests table, NOT stored.

### New table: `request_quotes`
```sql
CREATE TABLE request_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id),
  provider_id UUID NOT NULL REFERENCES providers(id),
  proposed_price NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','selected','rejected','expired')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  selected_at TIMESTAMPTZ,
  UNIQUE(request_id, provider_id)
);
```

### New table: `provider_dispatch_log`
```sql
CREATE TABLE provider_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  request_id UUID NOT NULL REFERENCES requests(id),
  distance_km NUMERIC(6,2),
  proposed_price NUMERIC(10,2),
  service_type TEXT,
  price_per_km NUMERIC(8,2),
  was_selected BOOLEAN DEFAULT FALSE,
  sla_met BOOLEAN,
  is_soft_launch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New table: `fair_price_config`
```sql
CREATE TABLE fair_price_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT UNIQUE NOT NULL,
  min_price_per_km NUMERIC(8,2) NOT NULL,
  max_price_per_km NUMERIC(8,2) NOT NULL,
  base_fee NUMERIC(8,2) NOT NULL DEFAULT 0,
  quote_validity_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## API Routes

### POST /api/provider/jobs/quote
Submit price quote for a request.
- Validates: capacity + daily limit + range + not already quoted + status in (open, quoted)
- Creates `request_quotes` row
- First quote → updates request status to 'quoted'
- Logs to `provider_dispatch_log`

### GET /api/requests/quotes
Customer fetches top 5 quotes for their active request.
- Sorted by Provider Score
- Returns anonymous provider info (no name/phone)

### POST /api/customer/quote/select
Customer selects a quote.
- Validates: quote not expired + status = 'quoted'
- PPJ: Stripe Capture (or soft_launch void)
- Subscription: deduct allowance
- status → 'accepted', accepted_by = provider
- Rejects all other pending quotes
- Returns full provider details for reveal

### POST /api/provider/jobs/price-change
Provider requests price revision.
- Only during `in_progress`
- Validates: `price_change_count = 0` (max 1 per job)
- Sets `price_change_requested` + status = 'pending'

### POST /api/customer/price-change/respond
Customer approves or rejects price change.
- Approved: `final_price = new price`
- Rejected: `final_price = proposed_price`

---

## Atomic RPCs

### submit_quote_atomic(provider_id, request_id, proposed_price)
1. Validate provider capacity (computed)
2. Validate daily limit not exceeded
3. Validate price within range (fair_price_config)
4. Validate request status IN ('open', 'quoted')
5. Validate no existing quote from this provider
6. INSERT into request_quotes
7. UPDATE request status to 'quoted' if first quote
8. INSERT into provider_dispatch_log

### select_quote_atomic(customer_id, request_id, quote_id)
1. Validate quote exists and not expired
2. Validate request status = 'quoted'
3. Validate request belongs to customer
4. SET request status = 'accepted', accepted_by = quote.provider_id
5. SET request selected_quote_id = quote_id
6. UPDATE selected quote status = 'selected'
7. UPDATE all other quotes for this request → status = 'rejected'
8. RETURN provider details (name, phone, documents)

### sla_check_and_release(request_id)
1. Check if 20 min passed since accepted_at without en_route
2. Release: status → 'open', accepted_by → NULL, selected_quote_id → NULL
3. PPJ: flag for Stripe refund
4. Provider: score -5, sla_failure_count +1
5. Check 3+ failures/week → set visibility_reduced = true
6. Log SLA failure to provider_dispatch_log

---

## Soft Launch Configuration

### Environment Variable
```
SOFT_LAUNCH_MODE=true   # Vercel env var
```

### Behavior when `true`:
- PPJ fee = 0 (no Stripe capture)
- No Stripe payment on quote selection
- `is_soft_launch = true` logged in dispatch_log
- All other features fully operational (dispatch, quotes, scoring, SLA)

### Behavior when `false` (after ~2 months):
- PPJ fee = 15 AED via Stripe Capture
- Full production billing

---

## Cron Jobs

| Job | Frequency | Action |
|-----|-----------|--------|
| Expire quotes | Every 1 min | Set status='expired' WHERE expires_at < now() |
| Advance dispatch ring | Every 5 min | Expand visibility to next ring |
| Auto-expire request | Every 1 min | Expire if 20 min after first quote with no selection |
| SLA enforcement | Every 1 min | Warning at 10 min, auto-release at 20 min |
| Weekly reset | Weekly | Reset sla_failure_count, apply visibility reductions |

---

## Realtime Subscriptions

### Customer receives:
- New quote arrives → update quote list
- Quote expires → remove from list
- 20 min no selection → show expired state
- Price change requested → show approve/reject UI

### Provider receives:
- Selected by customer → reveal customer details + start SLA timer
- Quote rejected/expired → remove from active quotes
- SLA warning at 10 min → "5 دقائق متبقية لتأكيد الانطلاق"
- Price change approved/rejected → notification

---

## Anti-Abuse Rules

| Rule | Prevention |
|------|-----------|
| Quote Spam | Max 1 quote per provider per request, Top 5 shown only |
| Price Wars | Range Estimator blocks extremes |
| Ghost Providers | SLA 20 min → auto-release + score penalty |
| External Bypass | Anonymous until after payment |
| Customer No-Show | 20 min to select or expires |
| PPJ No-Pay | Capture immediate on selection |
| Release Abuse | 3+ per week → visibility reduction |
| Price Manipulation | Max 1 price change per job, must be approved |

---

## Admin Dashboard (Fairness)

### Provider Score Card (0-100)
- Rating, Completion Rate, Acceptance Rate
- Response Time, Cancellation Rate
- Price Fairness, SLA Compliance, Release Rate

### Fair Price Config
- Per service type: min/max per km + base fee
- Live updates — takes effect immediately

### Soft Launch Analytics
- Requests created/day
- Avg quotes per request
- Customer selection rate
- Avg price per service type
- Avg response time
- Cancellation rate | Release rate
- Most requested service type
- SLA compliance rate

### Fairness Monitor
- Providers sorted by overall score
- Flag outliers (consistently high prices, low SLA)
- Future: auto-boost fair providers in dispatch priority

---

## Changes to Existing Code

### complete_provider_job_atomic (minimal)
- Remove `final_price` as user input parameter
- Instead: read `final_price` from `price_change_status = 'approved'` → use that price, else use `request_quotes.proposed_price` where `status = 'selected'`

### Customer request form
- Add `destination` field (required if problem_type = 'tow', optional otherwise)
- Add `destination_area` field (same condition)

### Provider request feed (ProviderRequestList)
- Show fuzzy location instead of hidden message
- Show destination for towing requests
- Replace "Accept" button with "Send Quote" button

### Provider dashboard (active job)
- Remove direct completion price input
- Add SLA timer UI
- Add "Waiting for customer" state after quote sent

### accept_request_atomic
- Will be DEPRECATED (replaced by submit_quote_atomic + select_quote_atomic)
- Keep for backward compatibility during migration, remove after full rollout

---

## DO NOT

- Do NOT apply migration without showing SQL first and getting approval
- Do NOT hardcode prices, distances, or time limits (all from config/env)
- Do NOT reveal provider identity before payment confirmed
- Do NOT allow price change after completion or more than once
- Do NOT change existing Stripe webhook flows beyond new refund case
- Do NOT remove accept_request_atomic until full rollout confirmed

---

## Future Phases (Not in This Implementation)

- Phase 9: Commission on final_price (% per plan tier)
- Phase 10: Visibility Credits (replace daily limits), Stripe Production keys
- Phase 11: Fraud detection, customer_no_show/provider_no_show states
- Phase 12: UAE legal compliance
- Future: Google Distance Matrix (replace Haversine)
- Future: Dynamic PPJ fee based on distance
- Future: Automated fairness boost/reduction
