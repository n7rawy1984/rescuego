import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getProviderAllowance } from '@/lib/provider-allowance'
import { OVERAGE_FEE_AED, PROVIDER_STALE_MINUTES } from '@/types'
import type { ProviderPlan, ProviderStatus } from '@/types'

const acceptSchema = z.object({
  request_id: z.string().uuid(),
})

type ProviderRow = {
  id: string
  status: ProviderStatus
  plan: ProviderPlan
  jobs_this_month: number
  job_credit_balance: number | null
}

type RequestLockRow = {
  provider_id: string | null
  locked_until: string
}

type AcceptRpcResult = {
  success: boolean
  reason: string | null
  jobs_this_month: number | null
  ppj_recovery_credits: number | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = acceptSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`provider-accept:${user.id}`, 60, 60 * 1000, 'provider_request_accept')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many accept attempts. Please try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  const admin = createAdminClient()
  const onlineSince = new Date(Date.now() - PROVIDER_STALE_MINUTES * 60 * 1000).toISOString()

  const [
    { data: profile },
    { data: provider, error: providerError },
    { data: providerLocation },
    { data: activeJob },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('providers').select('id, status, plan, jobs_this_month, job_credit_balance').eq('id', user.id).single<ProviderRow>(),
    admin.from('provider_locations').select('provider_id').eq('provider_id', user.id).gte('updated_at', onlineSince).maybeSingle(),
    admin.from('requests').select('id').eq('accepted_by', user.id).in('status', ['accepted', 'in_progress']).limit(1).maybeSingle(),
  ])

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can accept requests' }, { status: 403 })
  }

  if (providerError || !provider) {
    return NextResponse.json({ error: 'Provider profile not found' }, { status: 404 })
  }

  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Your provider account must be active before accepting requests' }, { status: 403 })
  }

  if (!providerLocation) {
    return NextResponse.json({ error: 'Go online before accepting requests.' }, { status: 403 })
  }

  if (activeJob) {
    return NextResponse.json({ error: 'Complete your active job before accepting another request' }, { status: 409 })
  }

  // Overage guard - subscribed providers only
  const allowance = getProviderAllowance({
    plan: provider.plan,
    jobsThisMonth: provider.jobs_this_month,
    jobCreditBalance: provider.job_credit_balance,
  })
  if (allowance.hasMonthlyAllowance) {
    if (allowance.effectiveLimit !== null && provider.jobs_this_month >= allowance.effectiveLimit) {
      const { data: overageCleared } = await admin
        .from('requests')
        .select('overage_cleared')
        .eq('id', parsed.data.request_id)
        .single()

      if (!overageCleared?.overage_cleared) {
        logger.warn({
          event: 'accept_request_overage_blocked',
          provider_id: user.id,
          request_id: parsed.data.request_id,
          plan: provider.plan,
          jobs_this_month: provider.jobs_this_month,
          plan_limit: allowance.effectiveLimit,
          job_credit_balance: allowance.creditBalance,
          overage_fee_aed: OVERAGE_FEE_AED,
        })
        return NextResponse.json(
          {
            error: `You've used all ${allowance.effectiveLimit} included jobs this month. Accept this job for ${OVERAGE_FEE_AED} AED?`,
            code: 'OVERAGE_REQUIRED',
            overage_fee_aed: OVERAGE_FEE_AED,
            request_id: parsed.data.request_id,
          },
          { status: 402 }
        )
      }
    }
  }

  const { data: activeLock } = await admin
    .from('request_locks')
    .select('provider_id, locked_until')
    .eq('request_id', parsed.data.request_id)
    .gt('locked_until', new Date().toISOString())
    .maybeSingle<RequestLockRow>()

  if (activeLock && activeLock.provider_id !== user.id) {
    return NextResponse.json({ error: 'Request is temporarily locked by another provider' }, { status: 409 })
  }

  const { data: acceptedRows, error: acceptError } = await admin.rpc('accept_provider_request_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
    p_increment_jobs: true,
    p_consume_ppj_credit: false,
  })

  const accepted = (acceptedRows as AcceptRpcResult[] | null)?.[0] ?? null

  if (acceptError || !accepted?.success) {
    logger.warn({
      event: 'accept_request_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: acceptError?.message ?? accepted?.reason ?? 'Request is no longer available',
    })

    if (accepted?.reason === 'active_job_exists') {
      return NextResponse.json({ error: 'Complete your active job before accepting another request' }, { status: 409 })
    }

    if (accepted?.reason === 'locked_by_another_provider') {
      return NextResponse.json({ error: 'Request is temporarily locked by another provider' }, { status: 409 })
    }

    return NextResponse.json({ error: 'Request is no longer available' }, { status: 409 })
  }

  logger.info({
    event: 'accept_request_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    plan: provider.plan,
    jobs_this_month: accepted.jobs_this_month ?? provider.jobs_this_month + 1,
  })

  return NextResponse.json({ success: true, request_id: parsed.data.request_id })
}
