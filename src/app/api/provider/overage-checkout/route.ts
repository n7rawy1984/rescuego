import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'
import { logger } from '@/lib/logger'
import { OVERAGE_FEE_AED } from '@/types'

const schema = z.object({ request_id: z.string().uuid() })

type ProviderBillingRow = {
  id: string
  plan: string
  status: string
  stripe_customer_id: string | null
  jobs_this_month: number
}

type RequestRow = {
  id: string
  status: string
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
    .select('id, plan, status, stripe_customer_id, jobs_this_month')
    .eq('id', user.id)
    .single<ProviderBillingRow>()

  if (!provider || provider.plan === 'pay_per_job') {
    return NextResponse.json({ error: 'Only subscribed providers can pay overage fees' }, { status: 403 })
  }
  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Account must be active' }, { status: 403 })
  }

  const { data: request } = await admin
    .from('requests')
    .select('id, status')
    .eq('id', parsed.data.request_id)
    .eq('status', 'open')
    .single<RequestRow>()

  if (!request) return NextResponse.json({ error: 'Request not found or no longer open' }, { status: 404 })

  const stripe = getStripe()
  const paymentIntent = await stripe.paymentIntents.create({
    amount: OVERAGE_FEE_AED * 100,
    currency: 'aed',
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
