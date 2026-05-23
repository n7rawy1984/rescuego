import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import type Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    logger.error({
      event: 'stripe_webhook_failed',
      error: error instanceof Error ? error.message : 'Invalid signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase.from('stripe_events').select('id').eq('id', event.id).single()
  if (existing) {
    logger.info({
      event: 'stripe_webhook_duplicate',
      stripe_event_id: event.id,
      event_type: event.type,
    })
    return NextResponse.json({ received: true })
  }

  const { error: eventInsertError } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type, payload: event })
  if (eventInsertError) {
    logger.error({
      event: 'stripe_webhook_failed',
      stripe_event_id: event.id,
      event_type: event.type,
      error: eventInsertError.message,
    })
  }

  logger.info({
    event: 'stripe_webhook_processing',
    stripe_event_id: event.id,
    event_type: event.type,
  })

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'suspended' : 'pending'
    const plan = (sub.metadata?.plan ?? 'starter') as string
    const { error } = await supabase.from('providers').update({ status, plan, stripe_subscription_id: sub.id }).eq('stripe_customer_id', sub.customer as string)
    if (error) {
      logger.error({
        event: 'stripe_webhook_failed',
        stripe_event_id: event.id,
        event_type: event.type,
        error: error.message,
      })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { error } = await supabase.from('providers').update({ status: 'suspended', stripe_subscription_id: null }).eq('stripe_customer_id', sub.customer as string)
    if (error) {
      logger.error({
        event: 'stripe_webhook_failed',
        stripe_event_id: event.id,
        event_type: event.type,
        error: error.message,
      })
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const { error } = await supabase.from('providers').update({ status: 'suspended' }).eq('stripe_customer_id', invoice.customer as string)
    if (error) {
      logger.error({
        event: 'stripe_webhook_failed',
        stripe_event_id: event.id,
        event_type: event.type,
        error: error.message,
      })
    }
  }

  if (event.type === 'payout.created' || event.type === 'payout.paid') {
    const payout = event.data.object as Stripe.Payout
    const { error } = await supabase.from('payout_log').upsert({
      stripe_payout_id: payout.id,
      amount: payout.amount,
      currency: payout.currency.toUpperCase(),
      arrival_date: new Date(payout.arrival_date * 1000).toISOString().split('T')[0],
      status: payout.status,
    })
    if (error) {
      logger.error({
        event: 'stripe_webhook_failed',
        stripe_event_id: event.id,
        event_type: event.type,
        error: error.message,
      })
    }
  }

  logger.info({
    event: 'stripe_webhook_processed',
    stripe_event_id: event.id,
    event_type: event.type,
  })

  return NextResponse.json({ received: true })
}
