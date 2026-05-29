import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import { logger } from '@/lib/logger'
import { getProviderAllowance } from '@/lib/provider-allowance'
import { OVERAGE_FEE_AED, PROVIDER_STALE_MINUTES } from '@/types'
import type { ProviderPlan, ProviderStatus } from '@/types'

const schema = z.object({ request_id: z.string().uuid() })

type ProviderBillingRow = {
  id: string
  plan: ProviderPlan
  status: ProviderStatus
  stripe_customer_id: string | null
  jobs_this_month: number
  job_credit_balance: number | null
}

type RequestRow = {
  id: string
  status: string
}

type OveragePaymentRow = {
  id: string
  fee_aed: number
  status: string
  stripe_payment_intent_id: string | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: provider } = await admin
    .from('providers')
    .select('id, plan, status, stripe_customer_id, jobs_this_month, job_credit_balance')
    .eq('id', user.id)
    .single<ProviderBillingRow>()

  if (!provider || provider.plan === 'pay_per_job') {
    return NextResponse.json({ error: 'Only subscribed providers can pay overage fees' }, { status: 403 })
  }
  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Account must be active' }, { status: 403 })
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

  const allowance = getProviderAllowance({
    plan: provider.plan,
    jobsThisMonth: provider.jobs_this_month,
    jobCreditBalance: provider.job_credit_balance,
  })

  if (!allowance.hasMonthlyAllowance || allowance.effectiveLimit === null) {
    return NextResponse.json({ error: 'This plan does not require overage payments' }, { status: 403 })
  }

  if (provider.jobs_this_month < allowance.effectiveLimit) {
    return NextResponse.json({ error: 'You still have included jobs available for this billing period' }, { status: 409 })
  }

  const { data: request } = await admin
    .from('requests')
    .select('id, status')
    .eq('id', parsed.data.request_id)
    .eq('status', 'open')
    .single<RequestRow>()

  if (!request) return NextResponse.json({ error: 'Request not found or no longer open' }, { status: 404 })

  const stripe = getStripe()

  const { data: existing } = await admin
    .from('overage_payments')
    .select('id, fee_aed, status, stripe_payment_intent_id')
    .eq('request_id', parsed.data.request_id)
    .eq('provider_id', user.id)
    .maybeSingle<OveragePaymentRow>()

  if (existing?.status === 'paid') {
    return NextResponse.json({ error: 'Overage already paid for this request' }, { status: 409 })
  }

  if (existing?.stripe_payment_intent_id && existing.status === 'pending') {
    try {
      const existingPaymentIntent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id)
      if (existingPaymentIntent.status !== 'canceled' && existingPaymentIntent.client_secret) {
        logger.info({
          event: 'overage_checkout_reused',
          provider_id: user.id,
          request_id: parsed.data.request_id,
          payment_intent_id: existingPaymentIntent.id,
        })
        return NextResponse.json({
          client_secret: existingPaymentIntent.client_secret,
          fee_aed: existing.fee_aed,
        })
      }
    } catch (error) {
      logger.warn({
        event: 'overage_checkout_reuse_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        payment_intent_id: existing.stripe_payment_intent_id,
        error: error instanceof Error ? error.message : 'Payment Intent not found',
      })
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: OVERAGE_FEE_AED * 100,
    currency: 'aed',
    payment_method_types: ['card'],
    customer: provider.stripe_customer_id ?? undefined,
    metadata: {
      provider_id: user.id,
      request_id: parsed.data.request_id,
      fee_type: 'overage',
      provider_plan: provider.plan,
    },
    description: `RescueGo Overage - ${OVERAGE_FEE_AED} AED (extra job beyond monthly limit)`,
  })

  if (!paymentIntent.client_secret) {
    logger.error({
      event: 'overage_checkout_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      payment_intent_id: paymentIntent.id,
      error: 'Payment Intent missing client secret',
    })
    return NextResponse.json({ error: 'Failed to create overage payment' }, { status: 500 })
  }

  const { error: overageRecordError } = await admin.from('overage_payments').upsert(
    {
      provider_id: user.id,
      request_id: parsed.data.request_id,
      fee_aed: OVERAGE_FEE_AED,
      stripe_payment_intent_id: paymentIntent.id,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider_id,request_id' }
  )

  if (overageRecordError) {
    logger.error({
      event: 'overage_checkout_record_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      payment_intent_id: paymentIntent.id,
      error: overageRecordError.message,
    })
    return NextResponse.json({ error: 'Failed to save overage payment' }, { status: 500 })
  }

  logger.info({
    event: 'overage_checkout_created',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    payment_intent_id: paymentIntent.id,
    fee_aed: OVERAGE_FEE_AED,
    plan: provider.plan,
  })

  return NextResponse.json({ client_secret: paymentIntent.client_secret, fee_aed: OVERAGE_FEE_AED })
}
