import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeOpsRequest } from '@/lib/ops-auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest) {
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
  let resetCount = 0

  for (const provider of dueProviders) {
    const { error: updateError } = await supabase
      .from('providers')
      .update({
        jobs_this_month: 0,
        jobs_reset_at: provider.stripe_current_period_start,
      })
      .eq('id', provider.id)
      .eq('stripe_current_period_start', provider.stripe_current_period_start)

    if (updateError) {
      logger.error({
        event: 'monthly_allowance_reset_provider_failed',
        provider_id: provider.id,
        error: updateError.message,
      })
      continue
    }

    resetCount += 1
  }

  logger.info({
    event: 'monthly_allowance_reset_completed',
    providers_checked: providers?.length ?? 0,
    providers_reset: resetCount,
  })

  return NextResponse.json({
    success: true,
    providers_checked: providers?.length ?? 0,
    providers_reset: resetCount,
  })
}
