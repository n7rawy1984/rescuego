import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const cancelSchema = z.object({
  request_id: z.string().uuid(),
})

type CustomerCounterRow = {
  cancellation_count: number | null
  late_cancellation_count: number | null
}

type CancelRpcResult = {
  success: boolean
  reason: string | null
  late_cancellation: boolean
  compensation_type: string | null
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

  const { data: cancelRows, error: cancelError } = await admin.rpc('cancel_request_and_compensate_atomic', {
    p_customer_id: user.id,
    p_request_id: parsed.data.request_id,
  })

  const result = (cancelRows as CancelRpcResult[] | null)?.[0] ?? null

  if (cancelError || !result?.success) {
    const reason = cancelError?.message ?? result?.reason ?? 'unknown'

    if (reason === 'request_not_found') {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (reason === 'request_not_cancellable') {
      return NextResponse.json({ error: 'This request can no longer be cancelled' }, { status: 409 })
    }

    if (reason === 'request_status_changed') {
      return NextResponse.json({ error: 'This request could not be cancelled' }, { status: 409 })
    }

    logger.warn({
      event: 'customer_cancel_request_failed',
      customer_id: user.id,
      request_id: parsed.data.request_id,
      error: reason,
    })
    return NextResponse.json({ error: 'This request could not be cancelled' }, { status: 409 })
  }

  const isLateCancellation = result.late_cancellation
  let compensationType = result.compensation_type ?? 'none'

  if (result.reason === 'provider_not_found_compensation_skipped') {
    logger.error({
      event: 'customer_cancel_provider_compensation_skipped',
      customer_id: user.id,
      request_id: parsed.data.request_id,
      reason: 'provider_not_found',
    })
  }

  if (!isLateCancellation) {
    const { data: paidPpjPayment } = await admin
      .from('ppj_payments')
      .select('provider_id, stripe_payment_intent_id')
      .eq('request_id', parsed.data.request_id)
      .eq('status', 'paid')
      .is('recovery_credit_restored_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ provider_id: string; stripe_payment_intent_id: string | null }>()

    if (paidPpjPayment?.provider_id) {
      const { data: protectionRows, error: protectionError } = await admin.rpc('restore_ppj_credit_for_cancelled_paid_request', {
        p_provider_id: paidPpjPayment.provider_id,
        p_request_id: parsed.data.request_id,
        p_payment_intent_id: paidPpjPayment.stripe_payment_intent_id,
      })
      const protection = (protectionRows as PpjProtectionResult[] | null)?.[0] ?? null

      if (protectionError || !protection?.success) {
        logger.warn({
          event: 'customer_cancel_paid_ppj_protection_skipped',
          provider_id: paidPpjPayment.provider_id,
          request_id: parsed.data.request_id,
          reason: protectionError?.message ?? protection?.reason ?? 'PPJ protection not applied',
        })
      } else {
        compensationType = 'ppj_recovery_credit'
        logger.info({
          event: 'customer_cancel_paid_ppj_credit_restored',
          provider_id: paidPpjPayment.provider_id,
          request_id: parsed.data.request_id,
          credits: protection.ppj_recovery_credits,
        })
      }
    }
  }

  await admin
    .from('request_locks')
    .delete()
    .eq('request_id', parsed.data.request_id)

  await admin
    .from('users')
    .update({
      cancellation_count: (profile.cancellation_count ?? 0) + 1,
      late_cancellation_count: (profile.late_cancellation_count ?? 0) + (isLateCancellation ? 1 : 0),
    })
    .eq('id', user.id)

  logger.info({
    event: 'customer_cancel_request_success',
    customer_id: user.id,
    request_id: parsed.data.request_id,
    late_cancellation: isLateCancellation,
    compensation_type: compensationType,
  })

  return NextResponse.json({
    success: true,
    request_id: parsed.data.request_id,
    late_cancellation: isLateCancellation,
    compensation_type: compensationType,
  })
}
