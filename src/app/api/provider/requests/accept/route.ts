import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
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

  // Pre-flight checks: role + provider profile.
  // Guard order: role → 404 → status → PPJ gate → V2 gate.
  const [
    { data: profile },
    { data: provider, error: providerError },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('providers').select('id, status, plan, jobs_this_month, job_credit_balance').eq('id', user.id).single<ProviderRow>(),
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

  // PPJ providers must pay the per-job acceptance fee via /api/provider/ppj-checkout.
  // This route never assigns a Pay Per Job job for free (defense-in-depth: the UI already
  // routes PPJ providers to checkout at ProviderRequestList.tsx, but the server must enforce
  // it too — a stale/alternate client or direct call must not bypass payment).
  if (provider.plan === 'pay_per_job') {
    logger.warn({
      event: 'accept_request_blocked_ppj_payment_required',
      provider_id: user.id,
      request_id: parsed.data.request_id,
    })
    return NextResponse.json(
      {
        error: 'Pay Per Job providers must complete the acceptance fee payment.',
        code: 'PPJ_PAYMENT_REQUIRED',
        request_id: parsed.data.request_id,
      },
      { status: 403 }
    )
  }

  // Subscription providers (starter / pro / business) must go through the V2
  // marketplace quote flow. The PPJ guard above already returned 403 for PPJ
  // providers, so any plan reaching this point is a subscriber.
  logger.warn({
    event: 'accept_request_blocked_v2_required',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    plan: provider.plan,
  })
  return NextResponse.json(
    {
      error: 'Please submit a quote through the marketplace.',
      code: 'V2_QUOTE_REQUIRED',
      request_id: parsed.data.request_id,
    },
    { status: 403 }
  )

  // NOTE: Legacy accept path (providerLocation check, activeJob check, overage
  // guard, accept_provider_request_atomic RPC) has been removed. All plans are
  // now blocked above — PPJ by the PPJ guard, subscribers by the V2 guard.
  // To re-enable the legacy flow for a specific plan, remove the corresponding
  // guard block above and restore this code from git history.
}

