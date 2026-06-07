import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { notificationEvents } from '@/lib/notifications'
import { SUBSCRIPTION_PLANS } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { ProviderPlan } from '@/types'

// force-dynamic prevents Next.js from caching this route. Stripe webhooks
// must always hit the live handler, never a cached response.
export const dynamic = 'force-dynamic'

type StripeEventStatus = 'processing' | 'processed' | 'failed'

type StripeEventRow = {
  status: StripeEventStatus | null
  processing_started_at: string | null
}

type SubscriptionPlan = Exclude<ProviderPlan, 'pay_per_job'>

type ProviderSubscriptionRow = {
  id: string
  plan: ProviderPlan
  jobs_this_month: number | null
  job_credit_balance: number | null
  last_upgrade_bonus_key: string | null
}

type AcceptRpcResult = {
  success: boolean
  reason: string | null
  jobs_this_month: number | null
  ppj_recovery_credits: number | null
}

type PpjProtectionResult = {
  success: boolean
  reason: string | null
  ppj_recovery_credits: number | null
}

// If a webhook event is still marked 'processing' after this window, it is
// considered stale and can be re-claimed. Protects against crashed handlers.
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000

// Maps Stripe price IDs → internal plan names. Built at module load from env
// vars so the mapping is always in sync with the configured price IDs.
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

// Idempotency guard: before processing any event, attempt to claim it by
// writing status='processing' to stripe_events. Returns a NextResponse to
// return immediately (duplicate or concurrent), or null to proceed.
// Pattern: insert on first delivery, update on retry (handles Stripe retries).
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

function planTier(plan: ProviderPlan | null): number {
  if (plan === 'starter') return 1
  if (plan === 'pro') return 2
  if (plan === 'business') return 3
  return 0
}

function monthlyJobAllowance(plan: ProviderPlan | null): number | null {
  const entry = SUBSCRIPTION_PLANS.find((p) => p.id === plan)
  return entry?.monthly_jobs ?? null
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

function handledStripeEventType(type: string): boolean {
  return [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payout.created',
    'payout.paid',
    'checkout.session.completed',
  ].includes(type)
}

async function finalizeAcceptedRequest(
  supabase: SupabaseClient,
  providerId: string,
  requestId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('accept_provider_request_atomic', {
    p_provider_id: providerId,
    p_request_id: requestId,
    p_increment_jobs: true,
    p_consume_ppj_credit: false,
    p_plan_limit: -1,
  })

  if (error) {
    throw new Error(`Failed to accept request atomically: ${error.message}`)
  }

  const result = (data as AcceptRpcResult[] | null)?.[0] ?? null
  return Boolean(result?.success)
}

async function protectCancelledPaidPpjRequest(
  supabase: SupabaseClient,
  providerId: string,
  requestId: string,
  paymentIntentId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('restore_ppj_credit_for_cancelled_paid_request', {
    p_provider_id: providerId,
    p_request_id: requestId,
    p_payment_intent_id: paymentIntentId,
  })

  if (error) {
    throw new Error(`Failed to restore PPJ cancellation protection: ${error.message}`)
  }

  const result = (data as PpjProtectionResult[] | null)?.[0] ?? null
  if (!result?.success) {
    logger.warn({
      event: 'ppj_cancelled_payment_protection_not_applied',
      provider_id: providerId,
      request_id: requestId,
      payment_intent_id: paymentIntentId,
      reason: result?.reason ?? 'not eligible',
    })
    return false
  }

  logger.info({
    event: 'ppj_cancelled_payment_credit_restored',
    provider_id: providerId,
    request_id: requestId,
    payment_intent_id: paymentIntentId,
    credits: result.ppj_recovery_credits,
  })
  return true
}

// Handles payment_intent.succeeded for two fee types, identified by metadata:
//   fee_type='pay_per_job'  — PPJ acceptance fee; finalizes the accept atomically.
//   fee_type='overage'      — Overage fee; marks overage_cleared then finalizes.
// In both cases, if the request was already taken (race condition), the PPJ
// protection credit is restored so the provider is not charged for nothing.
async function processPaymentIntentSucceeded(
  supabase: SupabaseClient,
  stripeEvent: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { fee_type, provider_id, request_id } = paymentIntent.metadata ?? {}
  let handledPaymentIntent = false

  if (fee_type === 'pay_per_job' && provider_id && request_id) {
    handledPaymentIntent = true
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
      await protectCancelledPaidPpjRequest(supabase, provider_id, request_id, paymentIntent.id)
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
    handledPaymentIntent = true
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

  if (!handledPaymentIntent) {
    logger.warn({
      event: 'stripe_payment_intent_succeeded_unhandled',
      stripe_event_id: stripeEvent.id,
      payment_intent_id: paymentIntent.id,
      metadata_fee_type: fee_type ?? null,
      has_provider_id: Boolean(provider_id),
      has_request_id: Boolean(request_id),
    })
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

  // Subscription sync: maps Stripe status → provider status:
  //   active → active, past_due → suspended, anything else → pending.
  // Also handles plan resolution (price ID → 'starter'/'pro'/'business') and
  // upgrade job credit bonuses. See resolveSubscriptionPlan() + planTier().
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

    if (sub.status === 'canceled') {
      const { error } = await supabase
        .from('providers')
        .update({
          status: 'suspended',
          plan: 'pay_per_job',
          stripe_subscription_id: null,
          stripe_current_period_start: null,
          stripe_current_period_end: null,
        })
        .eq('stripe_customer_id', stripeCustomerId)
      throwIfError(error, 'Failed to handle canceled subscription in updated event')
      logger.info({
        event: 'stripe_subscription_canceled_via_updated',
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
      })
      return
    }

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
      job_credit_balance?: number
      last_upgrade_bonus_key?: string
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

    const { data: existingProvider, error: providerLookupError } = await supabase
      .from('providers')
      .select('id, plan, jobs_this_month, job_credit_balance, last_upgrade_bonus_key')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle<ProviderSubscriptionRow>()
    throwIfError(providerLookupError, 'Failed to read provider before subscription update')

    if (existingProvider && resolvedPlan.plan) {
      const oldPlan = existingProvider.plan
      const newPlan = resolvedPlan.plan
      const isUpgrade = planTier(newPlan) > planTier(oldPlan)
      const bonusKey = `${sub.id}:${currentPeriodStart ?? 'no-period'}:${oldPlan}->${newPlan}`
      const bonusAlreadyApplied = existingProvider.last_upgrade_bonus_key === bonusKey
      const oldAllowance = monthlyJobAllowance(oldPlan)

      if (isUpgrade && newPlan !== 'business' && oldAllowance !== null && !bonusAlreadyApplied) {
        updatePayload.job_credit_balance = (existingProvider.job_credit_balance ?? 0) + oldAllowance
        updatePayload.last_upgrade_bonus_key = bonusKey

        logger.info({
          event: 'subscription_upgrade_job_credits_applied',
          provider_id: existingProvider.id,
          stripe_subscription_id: sub.id,
          old_plan: oldPlan,
          new_plan: newPlan,
          credit_added: oldAllowance,
          job_credit_balance: updatePayload.job_credit_balance,
          jobs_this_month: existingProvider.jobs_this_month ?? 0,
        })
      }

      if (newPlan === 'business' || planTier(newPlan) < planTier(oldPlan)) {
        updatePayload.job_credit_balance = 0
      }
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
        plan: 'pay_per_job',
        stripe_subscription_id: null,
        stripe_current_period_start: null,
        stripe_current_period_end: null,
      })
      .eq('stripe_customer_id', sub.customer as string)
    throwIfError(error, 'Failed to delete provider subscription')
    logger.info({
      event: 'stripe_subscription_deleted_synced',
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer,
    })
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    logger.info({
      event: 'stripe_checkout_session_completed_observed',
      stripe_event_id: event.id,
      checkout_session_id: session.id,
      mode: session.mode,
      payment_status: session.payment_status,
    })
  }

  if (!handledStripeEventType(event.type)) {
    logger.info({
      event: 'stripe_webhook_unhandled_event_type',
      stripe_event_id: event.id,
      event_type: event.type,
    })
  }
}

export async function POST(req: NextRequest) {
  // req.text() — must read body as raw text for Stripe signature verification.
  // Any JSON parse before constructEvent would invalidate the signature check.
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    if (!signature) {
      throw new Error('Missing Stripe signature')
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    logger.error({
      event: notificationEvents.webhookFailed,
      error: error instanceof Error ? error.message : 'Invalid signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  logger.info({
    event: 'stripe_webhook_received',
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
  })

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
