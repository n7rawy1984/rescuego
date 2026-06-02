import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const cancelSchema = z.object({
  request_id: z.string().uuid(),
})

type RequestRow = {
  id: string
  customer_id: string
  status: string
  accepted_by: string | null
  cancellation_compensated_at: string | null
}

type ProviderCompensationRow = {
  id: string
  plan: string
  jobs_this_month: number | null
  ppj_recovery_credits: number | null
}

type CustomerCounterRow = {
  cancellation_count: number | null
  late_cancellation_count: number | null
}

type PpjProtectionResult = {
  success: boolean
  reason: string | null
  ppj_recovery_credits: number | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = cancelSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-cancel:${user.id}`, 20, 60 * 60 * 1000, 'customer_request_cancel')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many cancellation attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, cancellation_count, late_cancellation_count')
    .eq('id', user.id)
    .single<CustomerCounterRow & { role: string | null }>()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customers can cancel recovery requests' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: request, error: requestLookupError } = await admin
    .from('requests')
    .select('id, customer_id, status, accepted_by, cancellation_compensated_at')
    .eq('id', parsed.data.request_id)
    .single<RequestRow>()

  if (requestLookupError || !request || request.customer_id !== user.id) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const retryingCompensation = request.status === 'cancelled'
    && Boolean(request.accepted_by)
    && !request.cancellation_compensated_at

  if (['completed', 'expired'].includes(request.status) || (request.status === 'cancelled' && !retryingCompensation)) {
    return NextResponse.json({ error: 'This request can no longer be cancelled' }, { status: 409 })
  }

  const assignedProviderId = request.accepted_by
  const isLateCancellation = Boolean(
    assignedProviderId && (retryingCompensation || ['accepted', 'in_progress'].includes(request.status))
  )
  const now = new Date().toISOString()

  if (!retryingCompensation) {
    const { data: cancelledRequest, error: cancelError } = await admin
      .from('requests')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: user.id,
        cancellation_actor: 'customer',
        cancellation_compensation_type: isLateCancellation ? null : 'none',
        cancellation_compensated_at: isLateCancellation ? null : now,
      })
      .eq('id', request.id)
      .eq('customer_id', user.id)
      .in('status', ['open', 'accepted', 'in_progress'])
      .select('id')
      .maybeSingle<{ id: string }>()

    if (cancelError || !cancelledRequest) {
      logger.warn({
        event: 'customer_cancel_request_failed',
        customer_id: user.id,
        request_id: request.id,
        error: cancelError?.message ?? 'Request status changed before cancellation',
      })
      return NextResponse.json({ error: 'This request could not be cancelled' }, { status: 409 })
    }
  }

  let compensationType: 'ppj_recovery_credit' | 'subscription_usage_restore' | 'none' = 'none'

  if (isLateCancellation && assignedProviderId && !request.cancellation_compensated_at) {
    const { data: provider, error: providerError } = await admin
      .from('providers')
      .select('id, plan, jobs_this_month, ppj_recovery_credits')
      .eq('id', assignedProviderId)
      .single<ProviderCompensationRow>()

    if (providerError || !provider) {
      logger.error({
        event: 'customer_cancel_provider_compensation_lookup_failed',
        customer_id: user.id,
        provider_id: assignedProviderId,
        request_id: request.id,
        error: providerError?.message ?? 'Provider not found',
      })
      return NextResponse.json({ error: 'Request cancelled, but compensation review is required' }, { status: 202 })
    }

    if (provider.plan === 'pay_per_job') {
      const { error: creditError } = await admin
        .from('providers')
        .update({ ppj_recovery_credits: (provider.ppj_recovery_credits ?? 0) + 1 })
        .eq('id', provider.id)

      if (creditError) {
        logger.error({
          event: 'customer_cancel_ppj_credit_failed',
          provider_id: provider.id,
          request_id: request.id,
          error: creditError.message,
        })
        return NextResponse.json({ error: 'Request cancelled, but PPJ credit review is required' }, { status: 202 })
      }

      compensationType = 'ppj_recovery_credit'
    } else if (provider.plan === 'starter' || provider.plan === 'pro') {
      const { error: restoreError } = await admin
        .from('providers')
        .update({ jobs_this_month: Math.max(0, (provider.jobs_this_month ?? 0) - 1) })
        .eq('id', provider.id)

      if (restoreError) {
        logger.error({
          event: 'customer_cancel_subscription_restore_failed',
          provider_id: provider.id,
          request_id: request.id,
          error: restoreError.message,
        })
        return NextResponse.json({ error: 'Request cancelled, but usage restoration review is required' }, { status: 202 })
      }

      compensationType = 'subscription_usage_restore'
    }

    const { error: compensationMarkError } = await admin
      .from('requests')
      .update({
        cancellation_compensated_at: now,
        cancellation_compensation_type: compensationType,
      })
      .eq('id', request.id)
      .is('cancellation_compensated_at', null)

    if (compensationMarkError) {
      logger.warn({
        event: 'customer_cancel_compensation_mark_failed',
        provider_id: assignedProviderId,
        request_id: request.id,
        compensation_type: compensationType,
        error: compensationMarkError.message,
      })
    }
  }

  if (!isLateCancellation) {
    const { data: paidPpjPayment } = await admin
      .from('ppj_payments')
      .select('provider_id, stripe_payment_intent_id')
      .eq('request_id', request.id)
      .eq('status', 'paid')
      .is('recovery_credit_restored_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ provider_id: string; stripe_payment_intent_id: string | null }>()

    if (paidPpjPayment?.provider_id) {
      const { data: protectionRows, error: protectionError } = await admin.rpc('restore_ppj_credit_for_cancelled_paid_request', {
        p_provider_id: paidPpjPayment.provider_id,
        p_request_id: request.id,
        p_payment_intent_id: paidPpjPayment.stripe_payment_intent_id,
      })
      const protection = (protectionRows as PpjProtectionResult[] | null)?.[0] ?? null

      if (protectionError || !protection?.success) {
        logger.warn({
          event: 'customer_cancel_paid_ppj_protection_skipped',
          provider_id: paidPpjPayment.provider_id,
          request_id: request.id,
          reason: protectionError?.message ?? protection?.reason ?? 'PPJ protection not applied',
        })
      } else {
        compensationType = 'ppj_recovery_credit'
        logger.info({
          event: 'customer_cancel_paid_ppj_credit_restored',
          provider_id: paidPpjPayment.provider_id,
          request_id: request.id,
          credits: protection.ppj_recovery_credits,
        })
      }
    }
  }

  await admin
    .from('request_locks')
    .delete()
    .eq('request_id', request.id)

  if (!retryingCompensation) {
    await admin
      .from('users')
      .update({
        cancellation_count: (profile.cancellation_count ?? 0) + 1,
        late_cancellation_count: (profile.late_cancellation_count ?? 0) + (isLateCancellation ? 1 : 0),
      })
      .eq('id', user.id)
  }

  logger.info({
    event: 'customer_cancel_request_success',
    customer_id: user.id,
    provider_id: assignedProviderId,
    request_id: request.id,
    late_cancellation: isLateCancellation,
    compensation_type: compensationType,
  })

  return NextResponse.json({
    success: true,
    request_id: request.id,
    late_cancellation: isLateCancellation,
    compensation_type: compensationType,
  })
}
