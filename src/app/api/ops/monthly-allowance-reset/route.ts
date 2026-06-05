import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeOpsRequest } from '@/lib/ops-auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ResetProviderRow = {
  id: string
  plan: string
  jobs_this_month: number | null
  stripe_current_period_start: string | null
  jobs_reset_at: string | null
}

function shouldResetProvider(provider: ResetProviderRow): boolean {
  if (provider.plan !== 'starter' && provider.plan !== 'pro') return false
  if (!provider.stripe_current_period_start) return false

  const periodStart = new Date(provider.stripe_current_period_start).getTime()
  const jobsResetAt = provider.jobs_reset_at ? new Date(provider.jobs_reset_at).getTime() : 0

  return periodStart > jobsResetAt
}

async function handleMonthlyAllowanceReset(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()
  const { data: providers, error } = await supabase
    .from('providers')
    .select('id, plan, jobs_this_month, stripe_current_period_start, jobs_reset_at')
    .in('plan', ['starter', 'pro'])
    .not('stripe_subscription_id', 'is', null)
    .returns<ResetProviderRow[]>()

  if (error) {
    logger.error({ event: 'monthly_allowance_reset_failed', error: error.message })
    return NextResponse.json({ error: 'Failed to load providers for reset' }, { status: 500 })
  }

  const dueProviders = (providers ?? []).filter(shouldResetProvider)

  const results = await Promise.all(
    dueProviders.map(async (provider) => {
      let updateQuery = supabase
        .from('providers')
        .update({
          jobs_this_month: 0,
          job_credit_balance: 0,
          jobs_reset_at: provider.stripe_current_period_start,
        })
        .eq('id', provider.id)
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
        return 'failed' as const
      }

      if (!updatedProvider) {
        logger.warn({
          event: 'monthly_allowance_reset_provider_skipped',
          provider_id: provider.id,
          reason: 'Provider period was already reset or changed before update',
        })
        return 'skipped' as const
      }

      return 'reset' as const
    })
  )

  const resetCount = results.filter((r) => r === 'reset').length
  const skippedCount = results.filter((r) => r === 'skipped').length
  const failedCount = results.filter((r) => r === 'failed').length

  logger.info({
    event: 'monthly_allowance_reset_completed',
    providers_checked: providers?.length ?? 0,
    providers_due: dueProviders.length,
    providers_reset: resetCount,
    providers_skipped: skippedCount,
    providers_failed: failedCount,
  })

  if (failedCount > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'Some provider allowance resets failed',
        providers_checked: providers?.length ?? 0,
        providers_due: dueProviders.length,
        providers_reset: resetCount,
        providers_skipped: skippedCount,
        providers_failed: failedCount,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    providers_checked: providers?.length ?? 0,
    providers_due: dueProviders.length,
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
