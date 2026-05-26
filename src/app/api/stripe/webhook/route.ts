import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { notificationEvents } from '@/lib/notifications'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { ProviderPlan } from '@/types'

export const dynamic = 'force-dynamic'

type StripeEventStatus = 'processing' | 'processed' | 'failed'

type StripeEventRow = {
  status: StripeEventStatus | null
  processing_started_at: string | null
}

type SubscriptionPlan = Exclude<ProviderPlan, 'pay_per_job'>

const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000

const PLAN_BY_PRICE_ID = new Map<string, SubscriptionPlan>(
  [
    [process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, 'starter'],
    [process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, 'pro'],
    [process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID, 'business'],
  ].filter((entry): entry is [string, SubscriptionPlan] => Boolean(entry[0]))
)

function isProcessingStale(startedAt: string | null): boolean {
  if (!startedAt) return true
  return Date.now() - new Date(startedAt).getTime() > PROCESSING_TIMEOUT_MS
}

async function claimStripeEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<NextResponse | null> {
  const { data: existing, error: lookupError } = await supabase
    .from('stripe_events')
    .select('status, processing_started_at')
    .eq('id', event.id)
    .maybeSingle<StripeEventRow>()

  if (lookupError) {
    logger.error({
      event: 'stripe_webhook_failed',
      stripe_event_id: event.id,
      event_type: event.type,
      error: lookupError.message,
    })
    return NextResponse.json({ error: 'Failed to read webhook event status' }, { status: 500 })
  }

  if (existing?.status === 'processed') {
    logger.info({
      event: 'stripe_webhook_duplicate',
      stripe_event_id: event.id,
      event_type: event.type,
    })
    return NextResponse.json({ received: true })
  }

  if (existing?.status === 'processing' && !isProcessingStale(existing.processing_started_at)) {
    logger.warn({
      event: 'stripe_webhook_already_processing',
      stripe_event_id: event.id,
      event_type: event.type,
    })
    return NextResponse.json({ error: 'Webhook event is already processing' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const write = existing
    ? supabase
      .from('stripe_events')
      .update({
        status: 'processing',
        processing_started_at: now,
        error_message: null,
        updated_at: now,
      })
      .eq('id', event.id)
    : supabase
      .from('stripe_events')
      .insert({
        id: event.id,
        type: event.type,
        payload: event,
        status: 'processing',
        processing_started_at: now,
        updated_at: now,
      })

  const { error } = await write

  if (error) {
    logger.error({
      event: 'stripe_webhook_failed',
      stripe_event_id: event.id,
      event_type: event.type,
      error: error.message,
    })
    return NextResponse.json({ error: 'Failed to claim webhook event' }, { status: 500 })
  }

  return null
}

async function setStripeEventStatus(
  supabase: SupabaseClient,
  eventId: string,
  status: StripeEventStatus,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('stripe_events')
    .update({
      status,
      processed_at: status === 'processed' ? now : null,
      error_message: errorMessage ?? null,
      updated_at: now,
    })
    .eq('id', eventId)

  if (error) {
    logger.error({
      event: 'stripe_webhook_status_update_failed',
      stripe_event_id: eventId,
      error: error.message,
    })
  }
}

function throwIfError(error: { message: string } | null, message: string): void {
  if (error) {
    throw new Error(`${message}: ${error.message}`)
  }
}

function stripeUnixToIso(timestamp: number | undefined): string | null {
  return typeof timestamp === 'number' ? new Date(timestamp * 1000).toISOString() : null
}

function isSubscriptionPlan(plan: string | undefined): plan is SubscriptionPlan {
  return plan === 'starter' || plan === 'pro' || plan === 'business'
}

function getSubscriptionItemPriceIds(subscription: Stripe.Subscription): string[] {
  const items = subscription.items?.data ?? []

  return items
    .map((item) => {
      const price = item.price
      if (!price) return null
      return typeof price === 'string' ? price : price.id
    })
    .filter((priceId): priceId is string => Boolean(priceId))
}

function resolveSubscriptionPlan(subscription: Stripe.Subscription): {
  plan: SubscriptionPlan | null
  source: 'price_id' | 'metadata' | 'unresolved'
  priceIds: string[]
} {
  const priceIds = getSubscriptionItemPriceIds(subscription)
  const primaryPriceId = priceIds[0]

  if (primaryPriceId) {
    const primaryPlan = PLAN_BY_PRICE_ID.get(primaryPriceId)
    if (primaryPlan) return { plan: primaryPlan, source: 'price_id', priceIds }
  }

  for (const priceId of priceIds) {
    const plan = PLAN_BY_PRICE_ID.get(priceId)
    if (plan) return { plan, source: 'price_id', priceIds }
  }

  const metadataPlan = subscription.metadata?.plan
  if (isSubscriptionPlan(metadataPlan)) {
    return { plan: metadataPlan, source: 'metadata', priceIds }
  }

  return { plan: null, source: 'unresolved', priceIds }
}

async function incrementProviderJobCount(
  supabase: SupabaseClient,
  providerId: string
): Promise<void> {
  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('jobs_this_month')
    .eq('id', providerId)
    .single<{ jobs_this_month: number | null }>()

  throwIfError(providerError, 'Failed to read provider job count')

  const { error } = await supabase
    .from('providers')
    .update({ jobs_this_month: (provider?.jobs_this_month ?? 0) + 1 })
    .eq('id', providerId)

  throwIfError(error, 'Failed to increment provider job count')
}

async function finalizeAcceptedRequest(
  supabase: SupabaseClient,
  providerId: string,
  requestId: string
): Promise<boolean> {
  const { data: updatedRequest, error: updateError } = await supabase
    .from('requests')
    .update({ status: 'accepted', accepted_by: providerId })
    .eq('id', requestId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle<{ id: string }>()

  if (updateError) {
    throw new Error(`Failed to accept request: ${updateError.message}`)
  }

  if (!updatedRequest) return false

  const { error: jobError } = await supabase
    .from('jobs')
    .upsert({ request_id: requestId, provider_id: providerId }, { onConflict: 'request_id' })
  throwIfError(jobError, 'Failed to upsert job')

  const { error: lockError } = await supabase
    .from('request_locks')
    .delete()
    .eq('request_id', requestId)
  throwIfError(lockError, 'Failed to clear request lock')

  await incrementProviderJobCount(supabase, providerId)

  return true
}

async function processPaymentIntentSucceeded(
  supabase: SupabaseClient,
  stripeEvent: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { fee_type, provider_id, request_id } = paymentIntent.metadata ?? {}

  if (fee_type === 'pay_per_job' && provider_id && request_id) {
    const { error: paymentError } = await supabase
      .from('ppj_payments')
      .update({ status: 'paid' })
      .eq('stripe_payment_intent_id', paymentIntent.id)
    throwIfError(paymentError, 'Failed to mark PPJ payment as paid')

    const accepted = await finalizeAcceptedRequest(supabase, provider_id, request_id)

    if (accepted) {
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
        stripe_event_id: stripeEvent.id,
      })
    }
  }

  if (fee_type === 'overage' && provider_id && request_id) {
    const { error: paymentError } = await supabase
      .from('overage_payments')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .eq('stripe_payment_intent_id', paymentIntent.id)
    throwIfError(paymentError, 'Failed to mark overage payment as paid')

    const { error: overageError } = await supabase
      .from('requests')
      .update({ overage_cleared: true })
      .eq('id', request_id)
    throwIfError(overageError, 'Failed to mark overage as cleared')

    const accepted = await finalizeAcceptedRequest(supabase, provider_id, request_id)

    if (accepted) {
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
        stripe_event_id: stripeEvent.id,
      })
    }
  }
}

async function processPaymentIntentFailed(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { fee_type, provider_id, request_id } = paymentIntent.metadata ?? {}

  if (fee_type === 'pay_per_job' && provider_id && request_id) {
    const { error } = await supabase
      .from('ppj_payments')
      .update({ status: 'failed' })
      .eq('stripe_payment_intent_id', paymentIntent.id)
    throwIfError(error, 'Failed to mark PPJ payment as failed')

    logger.warn({
      event: 'ppj_payment_failed',
      provider_id,
      request_id,
      payment_intent_id: paymentIntent.id,
    })
  }

  if (fee_type === 'overage' && provider_id && request_id) {
    const { error } = await supabase
      .from('overage_payments')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('stripe_payment_intent_id', paymentIntent.id)
    throwIfError(error, 'Failed to mark overage payment as failed')

    logger.warn({
      event: notificationEvents.overageFailed,
      provider_id,
      request_id,
      payment_intent_id: paymentIntent.id,
    })
  }
}

async function processStripeEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  logger.info({
    event: 'stripe_webhook_processing',
    stripe_event_id: event.id,
    event_type: event.type,
  })

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'suspended' : 'pending'
    const resolvedPlan = resolveSubscriptionPlan(sub)
    const subscriptionWithPeriod = sub as Stripe.Subscription & {
      current_period_start?: number
      current_period_end?: number
    }
    const currentPeriodStart = stripeUnixToIso(subscriptionWithPeriod.current_period_start)
    const currentPeriodEnd = stripeUnixToIso(subscriptionWithPeriod.current_period_end)
    const updatePayload: {
      status: string
      stripe_subscription_id: string
      stripe_current_period_start: string | null
      stripe_current_period_end: string | null
      plan?: SubscriptionPlan
    } = {
      status,
      stripe_subscription_id: sub.id,
      stripe_current_period_start: currentPeriodStart,
      stripe_current_period_end: currentPeriodEnd,
    }

    if (resolvedPlan.plan) {
      updatePayload.plan = resolvedPlan.plan
    } else {
      logger.warn({
        event: 'stripe_subscription_plan_unresolved',
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
        price_ids: resolvedPlan.priceIds,
        metadata_plan: sub.metadata?.plan ?? null,
        price_mapping_configured: PLAN_BY_PRICE_ID.size,
      })
    }

    const { error } = await supabase
      .from('providers')
      .update(updatePayload)
      .eq('stripe_customer_id', stripeCustomerId)
    throwIfError(error, 'Failed to update provider subscription')

    logger.info({
      event: 'stripe_subscription_synced',
      stripe_subscription_id: sub.id,
      stripe_customer_id: stripeCustomerId,
      plan: resolvedPlan.plan,
      plan_source: resolvedPlan.source,
      price_ids: resolvedPlan.priceIds,
      subscription_status: sub.status,
    })

    if (status === 'suspended') {
      logger.warn({
        event: notificationEvents.subscriptionRequiresAttention,
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
        subscription_status: sub.status,
      })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { error } = await supabase
      .from('providers')
      .update({
        status: 'suspended',
        stripe_subscription_id: null,
        stripe_current_period_start: null,
        stripe_current_period_end: null,
      })
      .eq('stripe_customer_id', sub.customer as string)
    throwIfError(error, 'Failed to delete provider subscription')
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const { error } = await supabase
      .from('providers')
      .update({ status: 'suspended' })
      .eq('stripe_customer_id', invoice.customer as string)
    throwIfError(error, 'Failed to suspend provider after invoice failure')
    logger.warn({
      event: notificationEvents.subscriptionRequiresAttention,
      stripe_customer_id: invoice.customer,
      invoice_id: invoice.id,
    })
  }

  if (event.type === 'payment_intent.succeeded') {
    await processPaymentIntentSucceeded(supabase, event, event.data.object as Stripe.PaymentIntent)
  }

  if (event.type === 'payment_intent.payment_failed') {
    await processPaymentIntentFailed(supabase, event.data.object as Stripe.PaymentIntent)
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
    throwIfError(error, 'Failed to upsert payout')
  }
}

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
      event: notificationEvents.webhookFailed,
      error: error instanceof Error ? error.message : 'Invalid signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const claimResponse = await claimStripeEvent(supabase, event)
  if (claimResponse) return claimResponse

  try {
    await processStripeEvent(supabase, event)
    await setStripeEventStatus(supabase, event.id, 'processed')

    logger.info({
      event: 'stripe_webhook_processed',
      stripe_event_id: event.id,
      event_type: event.type,
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown webhook processing error'
    await setStripeEventStatus(supabase, event.id, 'failed', errorMessage)

    logger.error({
      event: notificationEvents.webhookFailed,
      stripe_event_id: event.id,
      event_type: event.type,
      error: errorMessage,
    })

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
