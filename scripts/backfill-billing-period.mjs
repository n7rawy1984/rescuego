// scripts/backfill-billing-period.mjs
//
// PHASE 1 — Billing-period backfill for the 5 existing subscribed providers.
// One-time operational script. NOT part of the Next.js app runtime.
//
// Writes ONLY these three columns, keyed on provider_id:
//   stripe_current_period_start, stripe_current_period_end, jobs_reset_at
// Never touches jobs_this_month, job_credit_balance, plan, status, or any
// other column. Counter initialization is explicitly out of scope (Phase 2).
//
// Retrieval source of truth: this script does NOT assume where Stripe puts
// current_period_start/current_period_end based on SDK docs alone. It reads
// BOTH candidate locations at runtime and reports empirically which one is
// actually populated for THIS account/SDK combination:
//   (a) subscription.items.data[0].current_period_start/end  (item-level)
//   (b) subscription.current_period_start/end                (root-level,
//       the field the existing webhook currently reads via a cast in
//       src/app/api/stripe/webhook/route.ts — kept here only as a fallback
//       so the script proves rather than assumes which one is live)
// Item-level is preferred when both are present, since it is the more
// specific value; the console output always shows which source was used.
//
// Stripe client: constructed exactly like src/lib/stripe.ts (no apiVersion
// override), so this script observes precisely what the app's own webhook
// would observe from the same account/SDK version.
//
// Supabase client: constructed exactly like src/lib/supabase/admin.ts
// (service-role key, autoRefreshToken/persistSession disabled) — the same
// JWT shape the webhook uses, which satisfies is_service_role() in the
// providers immutable-column trigger (trg_providers_immutable_columns,
// supabase/migrations/039_security_backstop.sql).
//
// Env loading: no dotenv dependency in this repo's package.json — use
// Node's built-in --env-file flag (Node >= 20.6) against .env.local, the
// same file the Next.js app already reads its env from.
//
// Run (Windows PowerShell, from repo root):
//   node --env-file=.env.local scripts/backfill-billing-period.mjs
//   node --env-file=.env.local scripts/backfill-billing-period.mjs --apply

import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// --- Fixed from Medo's live mapping query (section 1.5 output) ---
const TARGETS = [
  { providerId: 'a3e86d6e-d065-4bc6-a8fa-87a715f6d619', stripeSubscriptionId: 'sub_1Tbo51FMT92KvbYRnekMnLLh', expectedPlan: 'business' },
  { providerId: '08d88b31-ba7a-419d-8d80-336a6ebbe9d3', stripeSubscriptionId: 'sub_1TaeJYFMT92KvbYRk12i4RG7', expectedPlan: 'business' },
  { providerId: '8cb79777-8aa2-4e98-b887-52405766b6e0', stripeSubscriptionId: 'sub_1TmvmMFMT92KvbYRAFwwtuHj', expectedPlan: 'pro' },
  { providerId: '20acff85-cccc-4ace-babb-23d2a931fed3', stripeSubscriptionId: 'sub_1TbPDKFMT92KvbYRuXNR5Lck', expectedPlan: 'pro' },
  { providerId: '8f20b5b4-49a8-4000-a78f-cfc63c934197', stripeSubscriptionId: 'sub_1TuEY6FMT92KvbYRyOfMfFoR', expectedPlan: 'starter' },
]

const APPLY = process.argv.includes('--apply')

function requireEnv(name) {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Run with: node --env-file=.env.local scripts/backfill-billing-period.mjs`
    )
  }
  return v
}

function unixToIso(ts) {
  return typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null
}

function getStripe() {
  // Mirrors src/lib/stripe.ts exactly: no apiVersion override, so this
  // script sees the same API shape the live webhook sees.
  return new Stripe(requireEnv('STRIPE_SECRET_KEY'))
}

function getAdminSupabase() {
  // Mirrors src/lib/supabase/admin.ts exactly.
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function classify(stripe, target) {
  let sub
  try {
    sub = await stripe.subscriptions.retrieve(target.stripeSubscriptionId, {
      expand: ['items.data.price'],
    })
  } catch (err) {
    return { ...target, decision: 'RAISE', reason: `stripe_retrieve_failed: ${err.message}` }
  }

  const items = sub.items && sub.items.data ? sub.items.data : []

  if (items.length === 0) {
    return { ...target, decision: 'RAISE', reason: 'subscription_has_zero_items', status: sub.status }
  }
  if (items.length > 1) {
    return {
      ...target,
      decision: 'RAISE',
      reason: 'subscription_has_multiple_items_cannot_disambiguate',
      status: sub.status,
      items: items.map((i) => ({ id: i.id, price: i.price && i.price.id })),
    }
  }

  const item = items[0]

  // Empirical probe of both candidate locations — never assumed.
  const itemStartRaw = item.current_period_start
  const itemEndRaw = item.current_period_end
  const rootStartRaw = sub.current_period_start
  const rootEndRaw = sub.current_period_end

  let source = null
  let periodStartRaw = null
  let periodEndRaw = null

  if (typeof itemStartRaw === 'number' && typeof itemEndRaw === 'number') {
    source = 'item_level'
    periodStartRaw = itemStartRaw
    periodEndRaw = itemEndRaw
  } else if (typeof rootStartRaw === 'number' && typeof rootEndRaw === 'number') {
    source = 'root_level_fallback_unexpected'
    periodStartRaw = rootStartRaw
    periodEndRaw = rootEndRaw
  }

  const diagnostic = {
    item_level_present: typeof itemStartRaw === 'number' && typeof itemEndRaw === 'number',
    root_level_present: typeof rootStartRaw === 'number' && typeof rootEndRaw === 'number',
  }

  if (!source) {
    return {
      ...target,
      decision: 'RAISE',
      reason: 'no_period_dates_found_on_root_or_item',
      status: sub.status,
      diagnostic,
    }
  }

  const periodStart = unixToIso(periodStartRaw)
  const periodEnd = unixToIso(periodEndRaw)

  if (sub.status === 'canceled' || sub.status === 'incomplete' || sub.status === 'incomplete_expired') {
    return {
      ...target,
      decision: 'SKIP',
      reason: `stripe_status_${sub.status}_inconsistent_with_db_active_subscriber`,
      status: sub.status,
      source,
      diagnostic,
    }
  }

  const flag =
    sub.status === 'past_due'
      ? 'past_due_proceeding_period_dates_still_valid'
      : sub.status === 'trialing'
      ? 'trialing_proceeding_unexpected_for_this_plan_set'
      : null

  return {
    ...target,
    decision: 'PROCEED',
    reason: flag,
    status: sub.status,
    source,
    diagnostic,
    periodStart,
    periodEnd,
  }
}

async function preWriteReverify(supabase, row) {
  const { data, error } = await supabase
    .from('providers')
    .select('id, stripe_subscription_id, stripe_current_period_start, stripe_current_period_end, jobs_reset_at')
    .eq('id', row.providerId)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: `reverify_query_failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'provider_id_no_longer_exists' }
  }
  if (data.stripe_subscription_id !== row.stripeSubscriptionId) {
    return {
      ok: false,
      reason: `stripe_subscription_id_changed (now: ${data.stripe_subscription_id})`,
    }
  }
  if (
    data.stripe_current_period_start !== null ||
    data.stripe_current_period_end !== null ||
    data.jobs_reset_at !== null
  ) {
    return {
      ok: false,
      reason: 'target_date_columns_no_longer_all_null_possible_webhook_or_renewal_wrote_them',
    }
  }
  return { ok: true }
}

async function main() {
  if (TARGETS.length !== 5) {
    throw new Error(`Expected exactly 5 TARGETS entries, got ${TARGETS.length}.`)
  }

  const stripe = getStripe()
  const supabase = getAdminSupabase()

  const results = []
  for (const target of TARGETS) {
    results.push(await classify(stripe, target))
  }

  console.log('\n=== CLASSIFICATION (dry run — no writes yet) ===')
  console.table(
    results.map((r) => ({
      providerId: r.providerId,
      subscriptionId: r.stripeSubscriptionId,
      expectedPlan: r.expectedPlan,
      decision: r.decision,
      status: r.status,
      source: r.source,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      reason: r.reason,
    }))
  )

  const raised = results.filter((r) => r.decision === 'RAISE')
  const skipped = results.filter((r) => r.decision === 'SKIP')
  const proceed = results.filter((r) => r.decision === 'PROCEED')

  if (raised.length > 0) {
    console.log(`\n${raised.length} row(s) RAISED — needs Medo review before any write. Details:`)
    console.dir(raised, { depth: null })
  }
  if (skipped.length > 0) {
    console.log(`\n${skipped.length} row(s) SKIPPED (will not be written). Details:`)
    console.dir(skipped, { depth: null })
  }

  if (!APPLY) {
    console.log('\nDry run complete. No writes performed. Re-run with --apply only after this output is reviewed and approved.')
    return
  }

  console.log(`\n=== PRE-WRITE RE-VERIFICATION + APPLY for ${proceed.length} PROCEED row(s) ===`)
  for (const row of proceed) {
    const reverify = await preWriteReverify(supabase, row)
    if (!reverify.ok) {
      console.error(`BLOCKED provider ${row.providerId}: ${reverify.reason} — no write performed.`)
      continue
    }

    const { data, error } = await supabase
      .from('providers')
      .update({
        stripe_current_period_start: row.periodStart,
        stripe_current_period_end: row.periodEnd,
        jobs_reset_at: row.periodStart, // jobs_reset_at = real period_start
      })
      .eq('id', row.providerId)
      .select('id, stripe_current_period_start, stripe_current_period_end, jobs_reset_at')

    if (error) {
      console.error(`FAILED provider ${row.providerId}:`, error.message)
      continue
    }
    if (!data || data.length !== 1) {
      console.error(`UNEXPECTED row count for provider ${row.providerId}:`, data)
      continue
    }
    console.log(`OK provider ${row.providerId}:`, data[0])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
