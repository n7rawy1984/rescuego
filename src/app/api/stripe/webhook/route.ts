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

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const { fee_type, provider_id, request_id } = paymentIntent.metadata ?? {}

    if (fee_type === 'pay_per_job' && provider_id && request_id) {
      const { error: paymentError } = await supabase
        .from('ppj_payments')
        .update({ status: 'paid' })
        .eq('stripe_payment_intent_id', paymentIntent.id)

      if (paymentError) {
        logger.error({
          event: 'stripe_webhook_failed',
          stripe_event_id: event.id,
          event_type: event.type,
          payment_intent_id: paymentIntent.id,
          error: paymentError.message,
        })
      }

      const { data: updatedRequest } = await supabase
        .from('requests')
        .update({ status: 'accepted', accepted_by: provider_id })
        .eq('id', request_id)
        .eq('status', 'open')
        .select('id')
        .single()

      if (updatedRequest) {
        const { data: provider } = await supabase
          .from('providers')
          .select('jobs_this_month')
          .eq('id', provider_id)
          .single<{ jobs_this_month: number | null }>()

        await Promise.all([
          supabase
            .from('providers')
            .update({ jobs_this_month: (provider?.jobs_this_month ?? 0) + 1 })
            .eq('id', provider_id),
          supabase
            .from('jobs')
            .upsert({ request_id, provider_id }, { onConflict: 'request_id' }),
          supabase
            .from('request_locks')
            .delete()
            .eq('request_id', request_id),
        ])

        logger.info({
          event: 'ppj_payment_accepted_request',
          provider_id,
          request_id,
          payment_intent_id: paymentIntent.id,
          fee_aed: paymentIntent.amount / 100,
        })
      } else {
        logger.warn({
          event: 'ppj_payment_request_already_taken',
          provider_id,
          request_id,
          payment_intent_id: paymentIntent.id,
        })
      }
    }

    if (fee_type === 'overage' && provider_id && request_id) {
      const { error: overageError } = await supabase
        .from('requests')
        .update({ overage_cleared: true })
        .eq('id', request_id)

      if (overageError) {
        logger.error({
          event: 'stripe_webhook_failed',
          stripe_event_id: event.id,
          event_type: event.type,
          payment_intent_id: paymentIntent.id,
          error: overageError.message,
        })
      }

      const { data: updatedRequest } = await supabase
        .from('requests')
        .update({ status: 'accepted', accepted_by: provider_id })
        .eq('id', request_id)
        .eq('status', 'open')
        .select('id')
        .single()

      if (updatedRequest) {
        const { data: provider } = await supabase
          .from('providers')
          .select('jobs_this_month')
          .eq('id', provider_id)
          .single<{ jobs_this_month: number | null }>()

        await Promise.all([
          supabase
            .from('providers')
            .update({ jobs_this_month: (provider?.jobs_this_month ?? 0) + 1 })
            .eq('id', provider_id),
          supabase
            .from('jobs')
            .upsert({ request_id, provider_id }, { onConflict: 'request_id' }),
          supabase
            .from('request_locks')
            .delete()
            .eq('request_id', request_id),
        ])

        logger.info({
          event: 'overage_payment_accepted_request',
          provider_id,
          request_id,
          payment_intent_id: paymentIntent.id,
        })
      } else {
        logger.warn({
          event: 'overage_payment_request_already_taken',
          provider_id,
          request_id,
          payment_intent_id: paymentIntent.id,
        })
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const { fee_type, provider_id, request_id } = paymentIntent.metadata ?? {}

    if ((fee_type === 'pay_per_job' || fee_type === 'overage') && provider_id && request_id) {
      const { error } = await supabase
        .from('ppj_payments')
        .update({ status: 'failed' })
        .eq('stripe_payment_intent_id', paymentIntent.id)

      if (error) {
        logger.error({
          event: 'stripe_webhook_failed',
          stripe_event_id: event.id,
          event_type: event.type,
          payment_intent_id: paymentIntent.id,
          error: error.message,
        })
      }

      logger.warn({
        event: 'ppj_or_overage_payment_failed',
        fee_type,
        provider_id,
        request_id,
        payment_intent_id: paymentIntent.id,
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
