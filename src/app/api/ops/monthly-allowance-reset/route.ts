import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeOpsRequest } from '@/lib/ops-auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// P4-C2: process providers in fixed-size pages so memory and concurrency stay flat
// regardless of provider count (no unbounded load + Promise.all over the whole table).
const PAGE_SIZE = 50

type ResetProviderRow = {
  id: string
  plan: string
  jobs_this_month: number | null
  stripe_current_period_start: string | null
  jobs_reset_at: string | null
}

// Eligibility for the monthly period reset. Applies to every subscription plan
// (starter, pro, business) — all reset jobs_this_month on the Stripe billing-period
// boundary. F3-L4: business is included so its counter does not drift upward forever.
function shouldResetProvider(provider: ResetProviderRow): boolean {
  if (!provider.stripe_current_period_start) return false

  const periodStart = new Date(provider.stripe_current_period_start).getTime()
  const jobsResetAt = provider.jobs_reset_at ? new Date(provider.jobs_reset_at).getTime() : 0

  return periodStart > jobsResetAt
}

// Builds the period-boundary fields cleared on reset.
// F3-L4: business has no monthly job allowance and no credit semantics, so it only
// zeroes jobs_this_month (data integrity). It must NOT touch job_credit_balance or any
// billing/allowance field. starter/pro additionally reset job_credit_balance as before.
function resetFieldsFor(provider: ResetProviderRow): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    jobs_this_month: 0,
    jobs_reset_at: provider.stripe_current_period_start,
  }
  if (provider.plan === 'starter' || provider.plan === 'pro') {
    fields.job_credit_balance = 0
  }
  return fields
}

async function resetProvider(
  supabase: ReturnType<typeof createAdminClient>,
  provider: ResetProviderRow
): Promise<'reset' | 'skipped' | 'failed'> {
  // Eligibility is enforced AT UPDATE TIME in the WHERE clause (not only the pre-check),
  // so pagination drift or a Vercel retry can never reset an ineligible/already-reset row:
  //   - id + plan pin the exact provider and plan,
  //   - stripe_current_period_start must still match the period we computed,
  //   - jobs_reset_at must still be the pre-reset value (or null).
  // Advancing jobs_reset_at to the current period makes the operation idempotent.
  let updateQuery = supabase
    .from('providers')
    .update(resetFieldsFor(provider))
    .eq('id', provider.id)
    .eq('plan', provider.plan)
    .eq('stripe_current_period_start', provider.stripe_current_period_start)

  updateQuery = provider.jobs_reset_at
    ? updateQuery.eq('jobs_reset_at', provider.jobs_reset_at)
    : updateQuery.is('jobs_reset_at', null)

  const { data: updatedProvider, error: updateError } = await updateQuery
    .select('id')
    .maybeSingle<{ id: string }>()

  if (updateError) {
    logger.error({
      event: 'monthly_allowance_reset_provider_failed',
      provider_id: provider.id,
      error: updateError.message,
    })
    return 'failed'
  }

  if (!updatedProvider) {
    logger.warn({
      event: 'monthly_allowance_reset_provider_skipped',
      provider_id: provider.id,
      reason: 'Provider period was already reset or changed before update',
    })
    return 'skipped'
  }

  return 'reset'
}

async function handleMonthlyAllowanceReset(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()

  let checked = 0
  let due = 0
  let resetCount = 0
  let skippedCount = 0
  let failedCount = 0
  let loadFailed = false
  let offset = 0

  // P4-C2: page through providers; never hold the whole table in memory.
  for (;;) {
    const { data: page, error } = await supabase
      .from('providers')
      .select('id, plan, jobs_this_month, stripe_current_period_start, jobs_reset_at')
      .in('plan', ['starter', 'pro', 'business'])
      .not('stripe_subscription_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<ResetProviderRow[]>()

    if (error) {
      logger.error({ event: 'monthly_allowance_reset_failed', error: error.message, offset })
      loadFailed = true
      break
    }

    if (!page || page.length === 0) break

    checked += page.length
    const duePage = page.filter(shouldResetProvider)
    due += duePage.length

    // Sequential within a page keeps concurrency bounded.
    for (const provider of duePage) {
      const outcome = await resetProvider(supabase, provider)
      if (outcome === 'reset') resetCount++
      else if (outcome === 'skipped') skippedCount++
      else failedCount++
    }

    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  logger.info({
    event: 'monthly_allowance_reset_completed',
    providers_checked: checked,
    providers_due: due,
    providers_reset: resetCount,
    providers_skipped: skippedCount,
    providers_failed: failedCount,
    load_failed: loadFailed,
  })

  // P4-H4: a critical load failure OR any per-provider failure returns 500 so Vercel
  // retries and alerting fires. Retries are safe — the update-time guards above are idempotent.
  if (loadFailed || failedCount > 0) {
    return NextResponse.json(
      {
        success: false,
        error: loadFailed ? 'Failed to load providers for reset' : 'Some provider allowance resets failed',
        providers_checked: checked,
        providers_due: due,
        providers_reset: resetCount,
        providers_skipped: skippedCount,
        providers_failed: failedCount,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    providers_checked: checked,
    providers_due: due,
    providers_reset: resetCount,
    providers_skipped: skippedCount,
    providers_failed: failedCount,
  })
}

export async function GET(req: NextRequest) {
  return handleMonthlyAllowanceReset(req)
}

export async function POST(req: NextRequest) {
  return handleMonthlyAllowanceReset(req)
}
