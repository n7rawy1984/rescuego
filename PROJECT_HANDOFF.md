# RescueGo Project Handoff

Generated on: 2026-05-21  
Project root: `D:\emergancy\موقع سيو\NEXT\rescuego`

This handoff is written for an AI agent or engineer who will only receive the project zip plus this report. It documents the current codebase literally, including routes, APIs, database migrations, environment variables, known issues, and build status.

## 1. Stack & Versions

### Framework

- Next.js: `16.2.6`
- Router: App Router (`src/app/...`). There is no `pages/` directory.
- React: `19.2.4`
- React DOM: `19.2.4`
- TypeScript: yes (`tsconfig.json`, strict mode enabled)
- Node version used during verification: `v24.14.1`
- npm version used during verification: `11.11.0`
- Package manager: npm (`package-lock.json` exists)

`AGENTS.md` says:

```md
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
```

The local Next docs were checked at `node_modules/next/dist/docs/index.md`. The docs confirm two routers and state:

```md
## App Router and Pages Router

Next.js has two different routers:

- **App Router**: The newer router that supports new React features like Server Components.
- **Pages Router**: The original router, still supported and being improved.
```

### Dependencies

From `package.json`:

```json
{
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toast": "^1.2.15",
    "@stripe/stripe-js": "^9.6.0",
    "@supabase/ssr": "^0.10.3",
    "@supabase/supabase-js": "^2.106.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.2.1",
    "lucide-react": "^1.16.0",
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-hook-form": "^7.76.0",
    "stripe": "^22.1.1",
    "tailwind-merge": "^3.6.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

### CSS / UI Strategy

- Tailwind CSS v4 via `@import "tailwindcss";` in `src/app/globals.css`.
- No shadcn registry setup is present.
- There are hand-written reusable UI primitives in `src/components/ui`.
- Icons use `lucide-react` in the landing page and some UI.
- Global CSS:

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --primary: #f97316;
  --primary-foreground: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --border: #e2e8f0;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --destructive: #ef4444;
  --success: #22c55e;
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html, body {
  max-width: 100vw;
  overflow-x: hidden;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

### Data / Auth / Hosting

- ORM: none.
- Database: Supabase Postgres with PostGIS via SQL migrations in `supabase/migrations`.
- Auth: Supabase Auth via `@supabase/ssr` and `@supabase/supabase-js`.
- Payments: Stripe Checkout, Stripe webhooks, Stripe server SDK.
- Maps: Google Maps Geocoding API used from client-side customer request page; Maps JavaScript UI is not implemented yet.
- Hosting target: Vercel or similar Next.js hosting. No `vercel.json` exists.

## 2. Folder Structure

`bash` is not available on this Windows machine, so `tree -L 4 -I 'node_modules|.next|.git|dist'` could not be run literally. Equivalent depth-4 output excluding `node_modules`, `.next`, `.git`, and `dist`:

```txt
.
├── public
│   ├── file.svg
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
├── src
│   ├── app
│   │   ├── about
│   │   │   └── page.tsx
│   │   ├── admin
│   │   │   ├── dashboard
│   │   │   ├── providers
│   │   │   ├── requests
│   │   │   └── revenue
│   │   ├── api
│   │   │   ├── admin
│   │   │   ├── customers
│   │   │   ├── provider
│   │   │   ├── providers
│   │   │   ├── ratings
│   │   │   ├── requests
│   │   │   └── stripe
│   │   ├── auth
│   │   │   ├── login
│   │   │   └── register
│   │   ├── customer
│   │   │   ├── ratings
│   │   │   └── request
│   │   ├── pricing
│   │   │   └── page.tsx
│   │   ├── provider
│   │   │   ├── dashboard
│   │   │   ├── register
│   │   │   └── subscribe
│   │   ├── recovery
│   │   │   ├── abu-dhabi
│   │   │   ├── ajman
│   │   │   ├── dubai
│   │   │   ├── ras-al-khaimah
│   │   │   └── sharjah
│   │   ├── favicon.ico
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── robots.ts
│   │   └── sitemap.ts
│   ├── components
│   │   ├── forms
│   │   │   ├── AdminProviderActions.tsx
│   │   │   ├── CompleteJobForm.tsx
│   │   │   ├── ProviderRequestList.tsx
│   │   │   └── RatingForm.tsx
│   │   ├── layout
│   │   │   ├── Footer.tsx
│   │   │   └── Navbar.tsx
│   │   ├── map
│   │   └── ui
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       └── Select.tsx
│   ├── lib
│   │   ├── supabase
│   │   │   ├── admin.ts
│   │   │   ├── client.ts
│   │   │   └── server.ts
│   │   ├── env.ts
│   │   ├── stripe.ts
│   │   └── utils.ts
│   ├── types
│   │   ├── database.ts
│   │   └── index.ts
│   └── proxy.ts
├── supabase
│   ├── functions
│   │   ├── accept-request
│   │   │   └── index.ts
│   │   ├── calculate-priority
│   │   │   └── index.ts
│   │   ├── charge-commission
│   │   │   └── index.ts
│   │   ├── stripe-webhook
│   │   │   └── index.ts
│   │   └── unlock-job
│   │       └── index.ts
│   └── migrations
│       ├── 001_initial_schema.sql
│       ├── 002_rpc_functions.sql
│       └── 003_harden_provider_rls.sql
├── .env.example
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── eslint.config.mjs
├── next.config.ts
├── next-env.d.ts
├── package.json
├── package-lock.json
├── postcss.config.mjs
├── README.md
├── SETUP.md
├── src.rar
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

## 3. Routing Map

Build output reports these App Router routes:

```txt
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /about
├ ƒ /admin/dashboard
├ ƒ /admin/providers
├ ƒ /admin/requests
├ ƒ /admin/revenue
├ ƒ /api/admin/providers/update
├ ƒ /api/customers/profile
├ ƒ /api/provider/jobs/complete
├ ƒ /api/provider/requests/accept
├ ƒ /api/providers/documents
├ ƒ /api/providers/plan
├ ƒ /api/providers/profile
├ ƒ /api/ratings
├ ƒ /api/requests
├ ƒ /api/stripe/create-checkout
├ ƒ /api/stripe/webhook
├ ○ /auth/login
├ ○ /auth/register
├ ƒ /customer/ratings
├ ○ /customer/request
├ ○ /pricing
├ ƒ /provider/dashboard
├ ○ /provider/register
├ ○ /provider/subscribe
├ ○ /recovery/abu-dhabi
├ ○ /recovery/ajman
├ ○ /recovery/dubai
├ ○ /recovery/ras-al-khaimah
├ ○ /recovery/sharjah
├ ○ /robots.txt
└ ○ /sitemap.xml
```

Legend from Next build:

```txt
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
ƒ Proxy (Middleware)
```

Route details:

| URL path | File path | Type | Component mode | Auth-protected |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | page | server component | no |
| `/about` | `src/app/about/page.tsx` | page | server component | no |
| `/pricing` | `src/app/pricing/page.tsx` | page | server component | no |
| `/auth/login` | `src/app/auth/login/page.tsx` | page | client component | no |
| `/auth/register` | `src/app/auth/register/page.tsx` | page | client component | no |
| `/customer/request` | `src/app/customer/request/page.tsx` | page | client component | yes, protected by `src/proxy.ts` customer matcher |
| `/customer/ratings` | `src/app/customer/ratings/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server role guard |
| `/provider/register` | `src/app/provider/register/page.tsx` | page | client component | no initial route guard, form requires Supabase Auth after sign-up |
| `/provider/subscribe` | `src/app/provider/subscribe/page.tsx` | page | server component redirect | no; redirects to `/provider/register` |
| `/provider/dashboard` | `src/app/provider/dashboard/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server data guard |
| `/admin/dashboard` | `src/app/admin/dashboard/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server role guard |
| `/admin/providers` | `src/app/admin/providers/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server role guard |
| `/admin/requests` | `src/app/admin/requests/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server role guard |
| `/admin/revenue` | `src/app/admin/revenue/page.tsx` | page | server component | yes, protected by `src/proxy.ts` and server role guard |
| `/recovery/dubai` | `src/app/recovery/dubai/page.tsx` | page | server component | no |
| `/recovery/abu-dhabi` | `src/app/recovery/abu-dhabi/page.tsx` | page | server component | no |
| `/recovery/sharjah` | `src/app/recovery/sharjah/page.tsx` | page | server component | no |
| `/recovery/ajman` | `src/app/recovery/ajman/page.tsx` | page | server component | no |
| `/recovery/ras-al-khaimah` | `src/app/recovery/ras-al-khaimah/page.tsx` | page | server component | no |
| `/robots.txt` | `src/app/robots.ts` | metadata route | server | no |
| `/sitemap.xml` | `src/app/sitemap.ts` | metadata route | server | no |
| `/api/admin/providers/update` | `src/app/api/admin/providers/update/route.ts` | API route | server | yes, admin role checked in route |
| `/api/customers/profile` | `src/app/api/customers/profile/route.ts` | API route | server | yes, authenticated user checked |
| `/api/providers/profile` | `src/app/api/providers/profile/route.ts` | API route | server | yes, authenticated user checked |
| `/api/providers/documents` | `src/app/api/providers/documents/route.ts` | API route | server | yes, provider role checked |
| `/api/providers/plan` | `src/app/api/providers/plan/route.ts` | API route | server | yes, provider role checked |
| `/api/requests` | `src/app/api/requests/route.ts` | API route | server | yes, customer role checked |
| `/api/provider/requests/accept` | `src/app/api/provider/requests/accept/route.ts` | API route | server | yes, provider role and active status checked |
| `/api/provider/jobs/complete` | `src/app/api/provider/jobs/complete/route.ts` | API route | server | yes, provider role and ownership checked |
| `/api/ratings` | `src/app/api/ratings/route.ts` | API route | server | yes, customer role and ownership checked |
| `/api/stripe/create-checkout` | `src/app/api/stripe/create-checkout/route.ts` | API route | server | yes, provider role and provider_id ownership checked |
| `/api/stripe/webhook` | `src/app/api/stripe/webhook/route.ts` | API route | server | protected by Stripe webhook signature |

Route protection is centralized in `src/proxy.ts`:

```ts
export const config = {
  matcher: ['/provider/:path*', '/admin/:path*', '/customer/:path*'],
}
```

## 4. API Routes & Server Actions

There are no Server Actions in the current codebase. All mutations use App Router API routes.

### `POST /api/customers/profile`

- File: `src/app/api/customers/profile/route.ts`
- Input JSON:

```ts
{
  name: string // min 2 max 120
  phone: string // min 8 max 30
  email: string // email max 160
}
```

- Output success:

```json
{ "id": "auth-user-uuid" }
```

- Output errors: `{ "error": "..." }`
- External services: Supabase Auth session, Supabase service-role database upsert.
- Purpose: creates/updates a `users` row with role `customer`.
- Important validation:

```ts
if (user.email && user.email.toLowerCase() !== parsed.data.email.toLowerCase()) {
  return NextResponse.json({ error: 'Email does not match the authenticated account' }, { status: 400 })
}
```

### `POST /api/providers/profile`

- File: `src/app/api/providers/profile/route.ts`
- Input JSON:

```ts
{
  name: string
  phone: string
  email: string
}
```

- Output success: `{ "id": "auth-user-uuid" }`
- External services: Supabase Auth session, Supabase service-role database upsert.
- Purpose: creates/updates `users` role `provider` and `providers` row with `plan: 'pay_per_job'`, `status: 'pending'`.

Real code:

```ts
await admin
  .from('providers')
  .upsert({
    id: user.id,
    plan: 'pay_per_job',
    status: 'pending',
  })
```

### `POST /api/providers/documents`

- File: `src/app/api/providers/documents/route.ts`
- Input: `multipart/form-data`
  - `emirates_id`: File
  - `license`: File
  - `vehicle`: File
- Output success:

```json
{
  "documents": {
    "emirates_id_url": "user-id/emirates_id.jpg",
    "license_url": "user-id/license.pdf",
    "vehicle_photo_url": "user-id/vehicle.png"
  }
}
```

- External services: Supabase Auth session, Supabase Storage bucket `provider-documents`, Supabase database.
- Validation:

```ts
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const DOCUMENT_FIELDS = ['emirates_id', 'license', 'vehicle'] as const
```

### `POST /api/providers/plan`

- File: `src/app/api/providers/plan/route.ts`
- Input JSON:

```ts
{ plan: 'pay_per_job' }
```

- Output success: `{ "success": true }`
- Purpose: only sets free/pay-per-job plan. Paid subscriptions go through Stripe Checkout.

### `POST /api/requests`

- File: `src/app/api/requests/route.ts`
- Input JSON:

```ts
{
  problem_type: 'flat_tire' | 'battery' | 'tow' | 'other'
  location_address: string
  note?: string | null
  coords?: { lng: number; lat: number } | null
}
```

- Coordinate validation:

```ts
lng: z.number().min(51).max(57),
lat: z.number().min(22).max(27),
```

- Output success:

```json
{ "id": "request-uuid" }
```

- Purpose: customer creates a roadside request with static MVP price estimates.
- External services: Supabase Auth session, Supabase database.

### `POST /api/provider/requests/accept`

- File: `src/app/api/provider/requests/accept/route.ts`
- Input JSON:

```ts
{ request_id: string /* uuid */ }
```

- Output success:

```json
{ "success": true, "request_id": "request-uuid" }
```

- Purpose: active provider accepts an open request.
- Security checks:
  - Authenticated user required.
  - `users.role` must be `provider`.
  - `providers.status` must be `active`.
  - Provider cannot have another active `accepted` or `in_progress` job.
  - Request update only succeeds if status is currently `open`.

Real update:

```ts
await admin
  .from('requests')
  .update({ status: 'accepted', accepted_by: user.id })
  .eq('id', parsed.data.request_id)
  .eq('status', 'open')
```

### `POST /api/provider/jobs/complete`

- File: `src/app/api/provider/jobs/complete/route.ts`
- Input JSON:

```ts
{
  request_id: string
  final_price: number // integer, 1..10000 AED
}
```

- Output success:

```json
{ "success": true, "job_id": "job-uuid" }
```

- Purpose: provider completes accepted job and sets final price.
- Current MVP limitation: commission fields are set to zero. Premium job commission automation is not implemented yet.

Real code:

```ts
commission_rate: 0,
commission_amount: 0,
completed_at: completedAt,
```

### `POST /api/ratings`

- File: `src/app/api/ratings/route.ts`
- Input JSON:

```ts
{
  job_id: string
  provider_id: string
  stars: number // 1..5
  comment?: string | null
}
```

- Output success: `{ "success": true }`
- Purpose: customer rates a completed job.
- Security checks:
  - Authenticated user required.
  - User role must be `customer`.
  - Job provider must match submitted provider.
  - Job request customer must be current user.
  - Request status must be `completed`.
  - `completed_at` must be non-null.
  - Duplicate rating for same job is rejected.

### `POST /api/admin/providers/update`

- File: `src/app/api/admin/providers/update/route.ts`
- Input JSON:

```ts
{
  provider_id: string
  status?: 'pending' | 'active' | 'suspended'
  verified_badge?: boolean
}
```

- Output success: `{ "success": true }`
- Purpose: admin activates/suspends providers and toggles verified badge.
- Security check:

```ts
if (profile?.role !== 'admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### `POST /api/stripe/create-checkout`

- File: `src/app/api/stripe/create-checkout/route.ts`
- Input JSON:

```ts
{
  plan: 'starter' | 'pro' | 'business'
  provider_id: string
}
```

- Output success:

```json
{ "url": "https://checkout.stripe.com/..." }
```

- External services: Supabase Auth, Supabase database, Stripe Customers, Stripe Checkout Sessions.
- Security:
  - Rejects invalid plans.
  - Rejects missing Stripe price IDs.
  - Auth required.
  - `user.id` must equal `provider_id`.
  - `users.role` must be `provider`.

Real ownership check:

```ts
if (user.id !== provider_id) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### `POST /api/stripe/webhook`

- File: `src/app/api/stripe/webhook/route.ts`
- Input: raw Stripe webhook body.
- Output success: `{ "received": true }`
- External services: Stripe webhook verification, Supabase service-role database.
- Events handled:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `payout.created`
  - `payout.paid`
- Idempotency/event log:

```ts
const { data: existing } = await supabase.from('stripe_events').select('id').eq('id', event.id).single()
if (existing) return NextResponse.json({ received: true })

await supabase.from('stripe_events').insert({ id: event.id, type: event.type, payload: event })
```

## 5. Database Schema

There is no Prisma or Drizzle schema. Database schema is SQL migrations under `supabase/migrations`.

### `supabase/migrations/001_initial_schema.sql`

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  role TEXT CHECK (role IN ('customer','provider','admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE providers (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT CHECK (plan IN ('starter','pro','business','pay_per_job')),
  status TEXT CHECK (status IN ('pending','active','suspended')) DEFAULT 'pending',
  rating NUMERIC(3,2) DEFAULT 5.00,
  jobs_this_month INTEGER DEFAULT 0,
  verified_badge BOOLEAN DEFAULT false,
  documents JSONB,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE provider_locations (
  provider_id UUID PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  location GEOMETRY(Point,4326) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES users(id),
  location GEOMETRY(Point,4326) NOT NULL,
  location_address TEXT,
  problem_type TEXT CHECK (problem_type IN ('flat_tire','battery','tow','other')),
  note TEXT,
  status TEXT CHECK (status IN ('open','accepted','in_progress','completed','cancelled')) DEFAULT 'open',
  accepted_by UUID REFERENCES providers(id),
  price_estimate_min INTEGER,
  price_estimate_max INTEGER,
  final_price INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID UNIQUE REFERENCES requests(id),
  provider_id UUID REFERENCES providers(id),
  commission_rate NUMERIC(5,2),
  commission_amount INTEGER,
  stripe_payment_intent_id TEXT,
  completed_at TIMESTAMPTZ
);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID UNIQUE REFERENCES jobs(id),
  provider_id UUID REFERENCES providers(id),
  stars INTEGER CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE request_locks (
  request_id UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id),
  locked_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  payload JSONB
);

CREATE TABLE payout_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stripe_payout_id TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'AED',
  arrival_date DATE,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_estimates (
  problem_type TEXT PRIMARY KEY,
  min_aed INTEGER NOT NULL,
  max_aed INTEGER NOT NULL
);

INSERT INTO price_estimates VALUES
  ('flat_tire', 80, 200),
  ('battery', 100, 250),
  ('tow', 200, 800),
  ('other', 150, 500);

CREATE INDEX idx_requests_location ON requests USING GIST(location);
CREATE INDEX idx_provider_locations ON provider_locations USING GIST(location);
CREATE INDEX idx_provider_locations_updated ON provider_locations(updated_at);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_providers_status ON providers(status);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own data" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin full access" ON users FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Providers read own data" ON providers FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Providers update own data" ON providers FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin full access" ON providers FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Customers read active providers" ON providers FOR SELECT USING (status = 'active');

CREATE POLICY "Providers insert own location" ON provider_locations FOR INSERT WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "Providers update own location" ON provider_locations FOR UPDATE USING (auth.uid() = provider_id) WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "Active providers location visible" ON provider_locations FOR SELECT USING (EXISTS (SELECT 1 FROM providers WHERE id = provider_id AND status = 'active'));

CREATE POLICY "Customers read own requests" ON requests FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "Customers create requests" ON requests FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Customers cancel own open request" ON requests FOR UPDATE USING (auth.uid() = customer_id AND status = 'open');
CREATE POLICY "Active providers read open requests" ON requests FOR SELECT USING (status = 'open' AND EXISTS (SELECT 1 FROM providers WHERE id = auth.uid() AND status = 'active'));
CREATE POLICY "Provider reads accepted request" ON requests FOR SELECT USING (accepted_by = auth.uid());
CREATE POLICY "Admin full access" ON requests FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Provider reads own jobs" ON jobs FOR SELECT USING (provider_id = auth.uid());
CREATE POLICY "Admin full access" ON jobs FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Customer creates rating" ON ratings FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM jobs JOIN requests ON requests.id = jobs.request_id WHERE jobs.id = job_id AND requests.customer_id = auth.uid()));
CREATE POLICY "Public read ratings" ON ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access" ON ratings FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Providers read locks" ON request_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin full access" ON request_locks FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access only" ON stripe_events FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin full access only" ON payout_log FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Public read price estimates" ON price_estimates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access" ON price_estimates FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE OR REPLACE FUNCTION update_provider_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE providers
  SET rating = (
    SELECT ROUND(AVG(stars)::NUMERIC, 2)
    FROM (
      SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50
    ) last50
  )
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_provider_rating
AFTER INSERT ON ratings
FOR EACH ROW EXECUTE FUNCTION update_provider_rating();

CREATE OR REPLACE FUNCTION check_provider_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rating < 3.0 AND (SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id) >= 5 THEN
    UPDATE providers SET status = 'suspended' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_check_suspension
AFTER UPDATE OF rating ON providers
FOR EACH ROW EXECUTE FUNCTION check_provider_suspension();
```

### `supabase/migrations/002_rpc_functions.sql`

```sql
CREATE OR REPLACE FUNCTION get_nearby_providers(
  p_lng DOUBLE PRECISION,
  p_lat DOUBLE PRECISION,
  p_radius INTEGER DEFAULT 5000,
  p_stale_threshold TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes'
)
RETURNS TABLE (
  id UUID,
  plan TEXT,
  rating NUMERIC,
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.plan,
    p.rating,
    ST_Distance(
      pl.location::geography,
      ST_Point(p_lng, p_lat)::geography
    ) AS distance_meters
  FROM providers p
  JOIN provider_locations pl ON p.id = pl.provider_id
  WHERE
    p.status = 'active'
    AND pl.updated_at >= p_stale_threshold
    AND ST_DWithin(
      pl.location::geography,
      ST_Point(p_lng, p_lat)::geography,
      p_radius
    )
  ORDER BY
    CASE p.plan
      WHEN 'business' THEN 1
      WHEN 'pro' THEN 2
      WHEN 'starter' THEN 3
      WHEN 'pay_per_job' THEN 4
    END ASC,
    p.rating DESC,
    distance_meters ASC
  LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION reset_monthly_job_counters()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE providers SET jobs_this_month = 0 WHERE status = 'active';
$$;
```

### `supabase/migrations/003_harden_provider_rls.sql`

```sql
DROP POLICY IF EXISTS "Providers update own data" ON providers;
DROP POLICY IF EXISTS "Users update own data" ON users;

-- Provider profile mutations are handled by authenticated server routes using
-- the service role. This prevents a browser client from self-activating,
-- changing plan tiers, or awarding itself a verified badge.
--
-- User profile mutations are also handled by authenticated server routes using
-- the service role. This prevents browser clients from changing their own role.
```

### Relationships Diagram

```txt
auth.users (Supabase Auth user)
  -> public.users.id

users.id
  -> providers.id (1:0/1, provider profile)
  -> requests.customer_id (1:many customer requests)

providers.id
  -> provider_locations.provider_id (1:0/1 live location)
  -> requests.accepted_by (1:many accepted requests)
  -> jobs.provider_id (1:many completed/active jobs)
  -> ratings.provider_id (1:many ratings)
  -> request_locks.provider_id (1:many temporary locks)

requests.id
  -> jobs.request_id (1:0/1)
  -> request_locks.request_id (1:0/1)

jobs.id
  -> ratings.job_id (1:0/1)

stripe_events and payout_log are standalone Stripe audit tables.
price_estimates is a static lookup table keyed by problem_type.
```

## 6. Environment Variables

`.env.example` exists and contains no secret values:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

Environment variable usage found by searching `NEXT_PUBLIC_` and `process.env`:

| Variable | Used in | Service | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/proxy.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/admin.ts`, `src/lib/env.ts` | Supabase | Public project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/proxy.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/env.ts` | Supabase | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/admin.ts`, `src/lib/env.ts` | Supabase | Server only; never expose client-side |
| `STRIPE_SECRET_KEY` | `src/lib/stripe.ts`, `src/lib/env.ts` | Stripe | Server only |
| `STRIPE_WEBHOOK_SECRET` | `src/app/api/stripe/webhook/route.ts`, `src/lib/env.ts` | Stripe | Server only |
| `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` | `src/types/index.ts`, `src/app/api/stripe/create-checkout/route.ts`, `src/lib/env.ts` | Stripe | Public price ID |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` | `src/types/index.ts`, `src/app/api/stripe/create-checkout/route.ts`, `src/lib/env.ts` | Stripe | Public price ID |
| `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` | `src/types/index.ts`, `src/app/api/stripe/create-checkout/route.ts`, `src/lib/env.ts` | Stripe | Public price ID |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `.env.example`, `SETUP.md` | Stripe | Documented but not currently referenced in code |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `src/app/customer/request/page.tsx`, `.env.example`, `SETUP.md` | Google Maps | Used client-side for geocoding after browser location |
| `NEXT_PUBLIC_APP_URL` | `src/lib/env.ts`, `src/app/api/stripe/create-checkout/route.ts` | App/Stripe redirects | Defaults to `http://localhost:3000` in `getAppUrl()` |

Real env helper:

```ts
type EnvName =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_PRO_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID'
  | 'NEXT_PUBLIC_APP_URL'

export function requireEnv(name: EnvName): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}
```

## 7. Auth Flow

### Supabase Clients

Server client at `src/lib/supabase/server.ts`:

```ts
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

Browser client at `src/lib/supabase/client.ts`:

```ts
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase public environment variables')
  }

  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
  )
}
```

Admin service-role client at `src/lib/supabase/admin.ts`:

```ts
export function createAdminClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

### Customer Sign Up

1. User opens `/auth/register`.
2. Client calls:

```ts
await supabase.auth.signUp({
  email: form.email,
  password: form.password,
  options: { data: { name: form.name, phone: form.phone } },
})
```

3. Client POSTs to `/api/customers/profile`.
4. API writes `users` row with role `customer`.
5. Client routes to `/customer/request`.

### Provider Sign Up

1. User opens `/provider/register`.
2. Client calls Supabase `auth.signUp`.
3. Client POSTs to `/api/providers/profile`.
4. API writes:
   - `users.role = 'provider'`
   - `providers.plan = 'pay_per_job'`
   - `providers.status = 'pending'`
5. Client uploads documents to `/api/providers/documents`.
6. Client selects pay-per-job or paid plan.
7. Paid plans POST to `/api/stripe/create-checkout`.
8. Stripe webhook later updates subscription/provider status.

### Sign In

`src/app/auth/login/page.tsx`:

```ts
const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
...
const { data: userData } = await supabase.from('users').select('role').eq('id', data.user.id).single()
if (userData?.role === 'admin') router.push('/admin/dashboard')
else if (userData?.role === 'provider') router.push('/provider/dashboard')
else router.push('/customer/request')
```

### Route Protection

`src/proxy.ts` redirects unauthenticated users:

```ts
if (pathname.startsWith('/provider/dashboard') && !user) {
  return NextResponse.redirect(new URL('/auth/login?redirect=/provider/dashboard', request.url))
}

if (pathname.startsWith('/admin') && !user) {
  return NextResponse.redirect(new URL('/auth/login?redirect=/admin', request.url))
}

if (pathname.startsWith('/customer') && !user) {
  return NextResponse.redirect(new URL(`/auth/login?redirect=${pathname}`, request.url))
}
```

Role enforcement:

```ts
if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
  return NextResponse.redirect(new URL('/', request.url))
}

if (pathname.startsWith('/provider/dashboard') && profile?.role !== 'provider') {
  return NextResponse.redirect(new URL('/', request.url))
}

if (pathname.startsWith('/customer') && profile?.role !== 'customer') {
  return NextResponse.redirect(new URL('/', request.url))
}
```

### Role Model

From `src/types/database.ts`:

```ts
export type UserRole = 'customer' | 'provider' | 'admin'
export type ProviderPlan = 'starter' | 'pro' | 'business' | 'pay_per_job'
export type ProviderStatus = 'pending' | 'active' | 'suspended'
```

## 8. Third-Party Integrations

### Supabase

Used for:

- Auth sessions and sign-up/sign-in.
- Postgres database.
- RLS-protected application tables.
- Private provider document storage bucket.
- Service-role admin operations in server routes.

Files:

- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/admin.ts`
- `src/proxy.ts`
- All API routes under `src/app/api`
- Protected server pages under `src/app/admin`, `src/app/provider/dashboard`, `src/app/customer/ratings`

### Stripe

Used for:

- Provider subscription checkout.
- Stripe customer creation.
- Webhook processing.
- Payout logging.

Files:

- `src/lib/stripe.ts`
- `src/app/api/stripe/create-checkout/route.ts`
- `src/app/api/stripe/webhook/route.ts`

Webhook endpoint:

```txt
POST /api/stripe/webhook
```

### Google Maps

Used for:

- Reverse geocoding browser geolocation in `src/app/customer/request/page.tsx`.

Current code:

```ts
const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

if (!googleMapsKey) {
  setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
} else {
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleMapsKey}`)
  const data = await res.json()
  if (data.results?.[0]) setAddress(data.results[0].formatted_address)
  else setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
}
```

### Supabase Edge Functions

These exist under `supabase/functions`, but the Next.js MVP currently uses App Router API routes for active frontend flows.

Files:

- `supabase/functions/accept-request/index.ts`
- `supabase/functions/calculate-priority/index.ts`
- `supabase/functions/charge-commission/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/unlock-job/index.ts`

They should be reviewed before production because they may duplicate or diverge from Next API route logic.

## 9. Key Business Logic Files

1. `src/proxy.ts` - route-level auth/session refresh and role redirects.
2. `src/lib/env.ts` - required env var validation and app URL helper.
3. `src/lib/supabase/server.ts` - SSR Supabase client using Next cookies.
4. `src/lib/supabase/client.ts` - browser Supabase client.
5. `src/lib/supabase/admin.ts` - service-role Supabase client for privileged server operations.
6. `src/lib/stripe.ts` - Stripe server client and AED/fils helpers.
7. `src/lib/utils.ts` - labels, class merging, commission calculation helper.
8. `src/app/api/customers/profile/route.ts` - customer profile/role creation.
9. `src/app/api/providers/profile/route.ts` - provider profile creation.
10. `src/app/api/providers/documents/route.ts` - document upload validation and storage.
11. `src/app/api/providers/plan/route.ts` - pay-per-job plan selection.
12. `src/app/api/requests/route.ts` - customer request creation and price estimate assignment.
13. `src/app/api/provider/requests/accept/route.ts` - provider accept flow and job upsert.
14. `src/app/api/provider/jobs/complete/route.ts` - provider completion with final price.
15. `src/app/api/ratings/route.ts` - customer rating validation and insert.
16. `src/app/api/admin/providers/update/route.ts` - admin provider activation/suspension.
17. `src/app/api/stripe/create-checkout/route.ts` - Stripe Checkout validation and session creation.
18. `src/app/api/stripe/webhook/route.ts` - Stripe webhook signature verification and subscription sync.
19. `supabase/migrations/001_initial_schema.sql` - tables, RLS policies, indexes, triggers.
20. `supabase/migrations/003_harden_provider_rls.sql` - removes unsafe self-update policies.

## 10. Known Issues / TODOs / Bugs

Search command:

```txt
rg -n "NEXT_PUBLIC_|process\.env|TODO|FIXME|HACK|@ts-ignore|eslint-disable" . -g "!*node_modules*" -g "!*.next*" -g "!dist*"
```

No `TODO`, `FIXME`, `HACK`, `@ts-ignore`, or local `eslint-disable` markers were found.

Known issues and risks:

- `src/app/layout.tsx` contains mojibake in Arabic SEO keywords:

```ts
'Ø³Ø·Ø­Ø© Ø¯Ø¨ÙŠ',
'Ø®Ø¯Ù…Ø© Ø±ÙŠÙƒÙØ±ÙŠ Ø¯Ø¨ÙŠ',
'Ù…Ø³Ø§Ø¹Ø¯Ø© Ø³ÙŠØ§Ø±Ø§Øª Ø§Ù„Ø¥Ù…Ø§Ø±Ø§Øª',
```

- Several UI files contain mojibake emoji/text artifacts from encoding, for example `src/components/forms/ProviderRequestList.tsx` has:

```ts
const problemIcons: Record<string, string> = { flat_tire: 'ðŸ”§', battery: 'âš¡', tow: 'ðŸš›', other: 'ðŸ”' }
```

- `src/app/provider/dashboard/page.tsx` also includes mojibake in rendered strings:

```tsx
{'â­'.repeat(Math.round(provider.rating))}
{remaining !== null ? remaining : 'âˆž'}
```

- Google reverse geocoding is called directly from the browser with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. This is normal for public Google Maps browser keys only if the key is restricted by HTTP referrer and API scopes.
- Provider dashboard lists all open requests visible through RLS, not true 5 km proximity yet. Phase 2 PostGIS matching exists as SQL RPC but is not integrated into the dashboard flow.
- Pay-per-job commission payment is not implemented in the Next app flow.
- Premium commission automation is not implemented in the Next app flow; `complete` currently sets commission to zero.
- Browser push, Twilio/SMS, live tracking, Distance Matrix, and full Google Maps UI are not implemented.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is documented but not currently used in code.
- Auth will not work until Supabase project URL/key and migrations are configured.
- Stripe checkout will not work until Stripe secret, webhook secret, and price IDs are configured.
- No automated test suite exists.
- `src.rar` exists at the repository root. It is not referenced by the app and may be an accidental archive artifact.
- Git working tree has many uncommitted files/changes. Current git history only has the initial commit.

User complaints/history to preserve:

- User reported the public landing UI looked broken in the browser.
- The homepage was found to contain incorrect TanStack Router code in `src/app/page.tsx`, which was incompatible with Next App Router. It has now been replaced with a valid Next server page so lint/build pass.

## 11. Current Task Context

The user is preparing a complete handoff package for another AI agent that will not have access to the machine or GitHub. The agent will only see the zip and this report.

Immediate user request:

1. Create `PROJECT_HANDOFF.md` at project root.
2. Ensure `.env.example` exists with all keys and no values.
3. Ensure `README.md` is up to date.
4. Run the build command and paste result at the bottom of this file.

Broader product context:

- RescueGo is a UAE roadside recovery marketplace SaaS.
- Current MVP order of importance from the user: foundation/security/auth/Stripe, then customer request flow, provider registration/docs, dashboard/accept flow, admin review, rating, public SEO pages.
- Do not start advanced Phase 2 features yet: live tracking, Twilio, complex commission automation, full PostGIS matching integration.
- Do not redesign the app unnecessarily.

## 12. Build & Run Commands

From `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  }
}
```

Exact commands:

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

No test script exists:

```bash
npm test
# not configured
```

No database migration script exists. Apply migrations manually in Supabase SQL editor or with Supabase CLI if added later:

```txt
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rpc_functions.sql
supabase/migrations/003_harden_provider_rls.sql
```

No seed script exists.

## 13. Recent Changes

Last 20 git commits:

```txt
48e7674 Initial commit from Create Next App
```

Current uncommitted status at handoff generation:

```txt
 M README.md
 M next.config.ts
 M package-lock.json
 M package.json
 M src/app/globals.css
 M src/app/layout.tsx
 M src/app/page.tsx
 M tsconfig.json
?? SETUP.md
?? src.rar
?? src/app/about/
?? src/app/admin/
?? src/app/api/
?? src/app/auth/
?? src/app/customer/
?? src/app/pricing/
?? src/app/provider/
?? src/app/recovery/
?? src/app/robots.ts
?? src/app/sitemap.ts
?? src/components/
?? src/lib/
?? src/proxy.ts
?? src/types/
?? supabase/
```

Changes made during this handoff pass:

- `src/app/page.tsx`: replaced invalid TanStack Router homepage code with a valid Next App Router server component landing page.
- `README.md`: clarified missing test/migration/seed scripts and recorded current lint/build verification.
- `PROJECT_HANDOFF.md`: added this complete handoff package.

## 14. Build Verification Result

### `npm run lint`

```txt
> rescuego@0.1.0 lint
> eslint
```

Exit code: `0`

### `npm run build`

```txt
> rescuego@0.1.0 build
> next build

▲ Next.js 16.2.6 (Turbopack)

  Creating an optimized production build ...
✓ Compiled successfully in 13.1s
  Running TypeScript ...
  Finished TypeScript in 10.5s ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (0/34) ...
  Generating static pages using 3 workers (8/34) 
  Generating static pages using 3 workers (16/34) 
  Generating static pages using 3 workers (25/34) 
✓ Generating static pages using 3 workers (34/34) in 789ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /about
├ ƒ /admin/dashboard
├ ƒ /admin/providers
├ ƒ /admin/requests
├ ƒ /admin/revenue
├ ƒ /api/admin/providers/update
├ ƒ /api/customers/profile
├ ƒ /api/provider/jobs/complete
├ ƒ /api/provider/requests/accept
├ ƒ /api/providers/documents
├ ƒ /api/providers/plan
├ ƒ /api/providers/profile
├ ƒ /api/ratings
├ ƒ /api/requests
├ ƒ /api/stripe/create-checkout
├ ƒ /api/stripe/webhook
├ ○ /auth/login
├ ○ /auth/register
├ ƒ /customer/ratings
├ ○ /customer/request
├ ○ /pricing
├ ƒ /provider/dashboard
├ ○ /provider/register
├ ○ /provider/subscribe
├ ○ /recovery/abu-dhabi
├ ○ /recovery/ajman
├ ○ /recovery/dubai
├ ○ /recovery/ras-al-khaimah
├ ○ /recovery/sharjah
├ ○ /robots.txt
└ ○ /sitemap.xml


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Exit code: `0`
