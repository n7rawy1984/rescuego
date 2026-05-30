import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPayPerJobFee } from '@/lib/utils'
import { LAUNCH_PROMO, PROVIDER_STALE_MINUTES } from '@/types'

const schema = z.object({ request_id: z.string().uuid() })

type ProviderBillingRow = {
  id: string
  plan: string
  status: string
  stripe_customer_id: string | null
  jobs_this_month: number | null
  ppj_recovery_credits: number | null
}

type RequestRow = {
  id: string
  status: string
}

type PpjPaymentRow = {
  id: string
  status: string
  stripe_payment_intent_id: string | null
  fee_aed: number
  distance_meters: number
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimit = await checkRateLimitAsync(`ppj-checkout:${user.id}`, 10, 60 * 60 * 1000, 'provider_ppj_checkout')
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many checkout attempts. Please wait.' }, { status: 429 })
  }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string | null }>()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can create PPJ checkout payments' }, { status: 403 })
  }

  const { data: provider } = await admin
    .from('providers')
    .select('id, plan, status, stripe_customer_id, jobs_this_month, ppj_recovery_credits')
    .eq('id', user.id)
    .single<ProviderBillingRow>()

  if (!provider) {
    return NextResponse.json({ error: 'Provider profile not found' }, { status: 404 })
  }
  if (provider.plan !== 'pay_per_job') {
    return NextResponse.json({ error: 'Only Pay Per Job providers use this endpoint' }, { status: 403 })
  }
  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Account must be active to accept requests' }, { status: 403 })
  }

  const onlineSince = new Date(Date.now() - PROVIDER_STALE_MINUTES * 60 * 1000).toISOString()
  const { data: providerLocation } = await admin
    .from('provider_locations')
    .select('provider_id')
    .eq('provider_id', user.id)
    .gte('updated_at', onlineSince)
    .maybeSingle()

  if (!providerLocation) {
    return NextResponse.json({ error: 'Go online before accepting requests.' }, { status: 403 })
  }

  const { data: activeJob } = await admin
    .from('requests')
    .select('id')
    .eq('accepted_by', user.id)
    .in('status', ['accepted', 'in_progress'])
    .limit(1)
    .maybeSingle()

  if (activeJob) {
    return NextResponse.json({ error: 'Complete your active job before accepting another request' }, { status: 409 })
  }

  const { data: request } = await admin
    .from('requests')
    .select('id, status')
    .eq('id', parsed.data.request_id)
    .eq('status', 'open')
    .single<RequestRow>()

  if (!request) {
    return NextResponse.json({ error: 'Request not found or no longer open' }, { status: 404 })
  }

  const { data: existing } = await admin
    .from('ppj_payments')
    .select('id, status, stripe_payment_intent_id, fee_aed, distance_meters')
    .eq('request_id', parsed.data.request_id)
    .eq('provider_id', user.id)
    .maybeSingle<PpjPaymentRow>()

  const distanceMeters = existing?.distance_meters ?? 0
  const feeAed = getPayPerJobFee(distanceMeters)

  if ((provider.ppj_recovery_credits ?? 0) > 0) {
    const { data: creditedRequest, error: acceptError } = await admin
      .from('requests')
      .update({ status: 'accepted', accepted_by: user.id })
      .eq('id', parsed.data.request_id)
      .eq('status', 'open')
      .is('accepted_by', null)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (acceptError || !creditedRequest) {
      logger.warn({
        event: 'ppj_credit_accept_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        error: acceptError?.message ?? 'Request is no longer available',
      })
      return NextResponse.json({ error: 'Request is no longer available' }, { status: 409 })
    }

    const { data: creditedProvider, error: providerUpdateError } = await admin
      .from('providers')
      .update({
        ppj_recovery_credits: Math.max(0, (provider.ppj_recovery_credits ?? 0) - 1),
        jobs_this_month: (provider.jobs_this_month ?? 0) + 1,
      })
      .eq('id', user.id)
      .gt('ppj_recovery_credits', 0)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (providerUpdateError || !creditedProvider) {
      await admin
        .from('requests')
        .update({ status: 'open', accepted_by: null })
        .eq('id', parsed.data.request_id)
        .eq('accepted_by', user.id)
        .in('status', ['accepted', 'in_progress'])

      logger.error({
        event: 'ppj_credit_consume_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        error: providerUpdateError?.message ?? 'No recovery credit was consumed',
      })
      return NextResponse.json({ error: 'Recovery credit could not be applied. Please try again.' }, { status: 409 })
    }

    const [{ error: jobError }, { error: lockError }] = await Promise.all([
      admin
        .from('jobs')
        .upsert({ request_id: parsed.data.request_id, provider_id: user.id }, { onConflict: 'request_id' }),
      admin
        .from('request_locks')
        .delete()
        .eq('request_id', parsed.data.request_id),
    ])

    if (jobError || lockError) {
      logger.error({
        event: 'ppj_credit_assignment_cleanup_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        job_error: jobError?.message,
        lock_error: lockError?.message,
      })
      return NextResponse.json({ error: 'Recovery credit assignment needs support review' }, { status: 500 })
    }

    logger.info({
      event: 'ppj_recovery_credit_applied',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      credits_remaining: Math.max(0, (provider.ppj_recovery_credits ?? 0) - 1),
    })

    return NextResponse.json({
      success: true,
      credit_applied: true,
      request_id: parsed.data.request_id,
      message: 'One PPJ recovery credit was applied to this request.',
    })
  }

  const stripe = getStripe()

  if (existing?.stripe_payment_intent_id && existing.status === 'pending') {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id)
      if (paymentIntent.status !== 'canceled' && paymentIntent.client_secret) {
        logger.info({
          event: 'ppj_checkout_reused',
          provider_id: user.id,
          request_id: parsed.data.request_id,
          payment_intent_id: paymentIntent.id,
        })
        return NextResponse.json({ client_secret: paymentIntent.client_secret, fee_aed: existing.fee_aed })
      }
    } catch (error) {
      logger.warn({
        event: 'ppj_checkout_reuse_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        payment_intent_id: existing.stripe_payment_intent_id,
        error: error instanceof Error ? error.message : 'Payment Intent not found',
      })
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: feeAed * 100,
    currency: 'aed',
    payment_method_types: ['card'],
    customer: provider.stripe_customer_id ?? undefined,
    metadata: {
      provider_id: user.id,
      request_id: parsed.data.request_id,
      fee_type: 'pay_per_job',
      distance_meters: String(distanceMeters),
      promo_applied: String(LAUNCH_PROMO),
    },
    description: `RescueGo Pay Per Job - ${feeAed} AED acceptance fee${LAUNCH_PROMO ? ' (promo)' : ''}`,
  })

  if (!paymentIntent.client_secret) {
    logger.error({
      event: 'ppj_checkout_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      payment_intent_id: paymentIntent.id,
      error: 'Payment Intent missing client secret',
    })
    return NextResponse.json({ error: 'Failed to create checkout payment' }, { status: 500 })
  }

  const { error: paymentError } = await admin.from('ppj_payments').upsert(
    {
      provider_id: user.id,
      request_id: parsed.data.request_id,
      fee_aed: feeAed,
      distance_meters: distanceMeters,
      stripe_payment_intent_id: paymentIntent.id,
      status: 'pending',
      promo_applied: LAUNCH_PROMO,
    },
    { onConflict: 'provider_id,request_id' }
  )

  if (paymentError) {
    logger.error({
      event: 'ppj_checkout_record_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      payment_intent_id: paymentIntent.id,
      error: paymentError.message,
    })
    return NextResponse.json({ error: 'Failed to save checkout payment' }, { status: 500 })
  }

  logger.info({
    event: 'ppj_checkout_created',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    payment_intent_id: paymentIntent.id,
    fee_aed: feeAed,
    promo: LAUNCH_PROMO,
  })

  return NextResponse.json({ client_secret: paymentIntent.client_secret, fee_aed: feeAed })
}
