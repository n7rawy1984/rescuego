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

  // Rate limit: 60 attempts per 60s per provider. Prevents accept-spamming.
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
  // "Online" = provider_locations row updated within last PROVIDER_STALE_MINUTES (5 min).
  const onlineSince = new Date(Date.now() - PROVIDER_STALE_MINUTES * 60 * 1000).toISOString()

  // All four pre-flight checks only need user.id — fire them in parallel.
  // Guard order below must stay: role → 404 → status → offline → active job.
  const [
    { data: profile },
    { data: provider, error: providerError },
    { data: providerLocation },
    { data: activeJob },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('providers').select('id, status, plan, jobs_this_month, job_credit_balance').eq('id', user.id).single<ProviderRow>(),
    admin.from('provider_locations').select('provider_id').eq('provider_id', user.id).gte('updated_at', onlineSince).maybeSingle(),
    admin.from('requests').select('id').eq('accepted_by', user.id).in('status', ['accepted', 'en_route', 'arrived', 'in_progress']).limit(1).maybeSingle(),
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

  // Overage guard: subscribed providers (starter/pro) who have exhausted their
  // monthly allowance (including any job_credit_balance from upgrades) must pay
  // the 12 AED overage fee before the accept can proceed. Returns HTTP 402 with
  // code OVERAGE_REQUIRED so the client can redirect to /provider/overage-pay.
  // Business plan providers are unlimited — this block is skipped for them.
  // PPJ plan providers never reach this guard (hasMonthlyAllowance = false).
  //
  // The pre-flight check here is a fast-fail optimisation only.
  // The authoritative check runs inside accept_provider_request_atomic under
  // the FOR UPDATE lock on the provider row (migration 024 — TOCTOU fix).
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

  // Determine the plan limit to pass to the RPC for atomic enforcement.
  // -1 = no limit (business plan, PPJ, or overage already cleared).
  // For subscription plans still within limit, also pass -1 — the guard
  // only needs to fire when the provider is AT the limit (handled above).
  // When overage_cleared = true the limit is intentionally bypassed.
  const { data: overageClearedRow } = allowance.hasMonthlyAllowance && allowance.effectiveLimit !== null
    ? await admin.from('requests').select('overage_cleared').eq('id', parsed.data.request_id).single()
    : { data: null }
  const planLimit = (
    allowance.hasMonthlyAllowance &&
    allowance.effectiveLimit !== null &&
    !overageClearedRow?.overage_cleared
  ) ? allowance.effectiveLimit : -1

  // Pre-flight lock check: if another provider is mid-payment (PPJ or overage),
  // they hold a 60-second lock on this request. Fail fast here rather than
  // reaching the atomic RPC, which would also reject but with a DB round-trip.
  // This check is advisory — the RPC does a second authoritative lock check
  // inside the transaction to prevent TOCTOU races.
  const { data: activeLock } = await admin
    .from('request_locks')
    .select('provider_id, locked_until')
    .eq('request_id', parsed.data.request_id)
    .gt('locked_until', new Date().toISOString())
    .maybeSingle<RequestLockRow>()

  if (activeLock && activeLock.provider_id !== user.id) {
    return NextResponse.json({ error: 'Request is temporarily locked by another provider' }, { status: 409 })
  }

  // Atomic RPC: locks the provider row (FOR UPDATE), checks for active jobs,
  // checks the request lock, updates the request to 'accepted', inserts a job
  // record, increments jobs_this_month, and deletes the lock — all in one
  // Postgres transaction. Returns success=false + reason on any conflict.
  // p_consume_ppj_credit=false here because PPJ credit consumption is handled
  // via the payment webhook flow (payment_intent.succeeded), not here.
  const { data: acceptedRows, error: acceptError } = await admin.rpc('accept_provider_request_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
    p_increment_jobs: true,
    p_consume_ppj_credit: false,
    p_plan_limit: planLimit,
  })

  const accepted = (acceptedRows as AcceptRpcResult[] | null)?.[0] ?? null

  if (acceptError || !accepted?.success) {
    logger.warn({
      event: 'accept_request_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: acceptError?.message ?? accepted?.reason ?? 'Request is no longer available',
    })

    if (accepted?.reason === 'overage_required') {
      return NextResponse.json(
        {
          error: `You've reached your monthly job limit. Accept this job for ${OVERAGE_FEE_AED} AED?`,
          code: 'OVERAGE_REQUIRED',
          overage_fee_aed: OVERAGE_FEE_AED,
          request_id: parsed.data.request_id,
        },
        { status: 402 }
      )
    }

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
