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
  status: string
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

type FinalizePpjResult = {
  success: boolean
  reason: string | null
  provider_name: string | null
  provider_phone: string | null
  provider_rating: number | null
}

type PpjProtectionResult = {
  success: boolean
  reason: string | null
  ppj_recovery_credits: number | null
}

// If a webhook event is still marked 'processing' after this window, it is
// considered stale and can be re-claimed. Protects against crashed handlers.
// Kept small (3m) to shrink the double-processing window (L4).
const PROCESSING_TIMEOUT_MS = 3 * 60 * 1000

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

// Idempotency guard: before processing any event, atomically claim it by
// writing status='processing' to stripe_events. Returns a NextResponse to
// return immediately (duplicate or concurrent), or null to proceed.
//
// Atomicity (F3-M2/M4): the previous read-then-write had a TOCTOU window where
// two concurrent deliveries could both pass the read and both claim the event.
// We now rely on the primary-key conflict and a status-guarded conditional
// UPDATE so exactly one caller can transition the row into 'processing':
//   1. Try INSERT. If it inserts a row, we are the first delivery -> claimed.
//   2. On PK conflict, run a conditional UPDATE that only matches when the row
//      is reclaimable (not 'processed', and not a fresh 'processing'). The
//      database evaluates the predicate atomically; whoever's UPDATE returns a
//      row wins the claim. A loser sees zero rows updated -> duplicate/concurrent.
async function claimStripeEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<NextResponse | null> {
  const now = new Date().toISOString()

  // Step 1 — first-delivery insert. ignoreDuplicates makes a PK conflict a
  // no-op (no error, no returned row) so it falls through to the conditional
  // re-claim path below instead of throwing.
  const { data: inserted, error: insertError } = await supabase
    .from('stripe_events')
    .upsert(
      {
        id: event.id,
        type: event.type,
        payload: event,
        status: 'processing',
        processing_started_at: now,
        updated_at: now,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    .select('id')

  if (insertError) {
    logger.error({
      event: 'stripe_webhook_failed',
      stripe_event_id: event.id,
      event_type: event.type,
      error: insertError.message,
    })
    return NextResponse.json({ error: 'Failed to claim webhook event' }, { status: 500 })
  }

  if (inserted && inserted.length > 0) {
    // We inserted the row — claim won.
    return null
  }

  // Step 2 — row already exists. Inspect current state.
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

  // Reclaimable: status is 'failed' or a stale 'processing'. The status guard in
  // the UPDATE predicate makes the re-claim atomic across concurrent callers —
  // only one update matches and returns a row.
  const reclaimQuery = supabase
    .from('stripe_events')
    .update({
      status: 'processing',
      processing_started_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq('id', event.id)

  const guarded =
    existing?.status === 'processing'
      ? reclaimQuery
          .eq('status', 'processing')
          .lt('processing_started_at', new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString())
      : reclaimQuery.eq('status', 'failed')

  const { data: reclaimed, error: reclaimError } = await guarded.select('id')

  if (reclaimError) {
    logger.error({
      event: 'stripe_webhook_failed',
      stripe_event_id: event.id,
      event_type: event.type,
      error: reclaimError.message,
    })
    return NextResponse.json({ error: 'Failed to claim webhook event' }, { status: 500 })
  }

  if (!reclaimed || reclaimed.length === 0) {
    // Another delivery won the re-claim between our read and update.
    logger.warn({
      event: 'stripe_webhook_already_processing',
      stripe_event_id: event.id,
      event_type: event.type,
    })
    return NextResponse.json({ error: 'Webhook event is already processing' }, { status: 409 })
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

// Phase 2 billing-period fix (root cause): Stripe's SDK/API (v22 / 2025+)
// moved current_period_start/current_period_end off the top-level
// Subscription object onto each subscription item (verified against
// node_modules/stripe's type definitions -- Stripe.Subscription no longer
// declares these fields; Stripe.SubscriptionItem does). Reading them off
// `subscription` therefore always resolved to undefined, so
// stripe_current_period_start/end were silently written NULL on every
// activation and renewal. This resolver reads the period off the single
// subscription item whose price matches PLAN_BY_PRICE_ID -- the same
// authoritative price-ID source already used for plan resolution above.
// Zero or multiple matches is an anomaly: callers must not silently write a
// billing date in that case.
function resolveSubscriptionPeriod(subscription: Stripe.Subscription): {
  periodStart: string | null
  periodEnd: string | null
  matchedItemCount: number
} {
  const items = subscription.items?.data ?? []
  const matched = items.filter((item) => {
    const price = item.price
    const priceId = typeof price === 'string' ? price : price?.id
    return Boolean(priceId && PLAN_BY_PRICE_ID.has(priceId))
  })

  if (matched.length !== 1) {
    return { periodStart: null, periodEnd: null, matchedItemCount: matched.length }
  }

  const item = matched[0] as Stripe.SubscriptionItem & {
    current_period_start: number
    current_period_end: number
  }
  return {
    periodStart: stripeUnixToIso(item.current_period_start),
    periodEnd: stripeUnixToIso(item.current_period_end),
    matchedItemCount: 1,
  }
}

function handledStripeEventType(type: string): boolean {
  return [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.canceled',
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

// New PPJ model: the fee is paid AFTER the customer selects this provider's quote.
// On payment the request transitions selected_pending_payment -> accepted (assignment),
// accepted_at is set (SLA starts now), held competitors are rejected, and contact
// details are revealed. Returns true if the request was finalized to this provider.
async function finalizePpjSelection(
  supabase: SupabaseClient,
  providerId: string,
  requestId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('finalize_ppj_selection_atomic', {
    p_provider_id: providerId,
    p_request_id: requestId,
  })

  if (error) {
    throw new Error(`Failed to finalize PPJ selection atomically: ${error.message}`)
  }

  const result = (data as FinalizePpjResult[] | null)?.[0] ?? null
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

    const accepted = await finalizePpjSelection(supabase, provider_id, request_id)

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

    const accepted = await finalizeAcceptedRequest(supabase, provider_id, request_id)

    if (accepted) {
      // Only clear the overage flag once the job is actually assigned. Doing it
      // before the accept (the previous order) could leave overage_cleared=true
      // for a request the provider never got.
      const { error: overageError } = await supabase
        .from('requests')
        .update({ overage_cleared: true })
        .eq('id', request_id)
      throwIfError(overageError, 'Failed to mark overage as cleared')

      logger.info({
        event: 'overage_payment_accepted_request',
        provider_id,
        request_id,
        payment_intent_id: paymentIntent.id,
      })
    } else {
      // F3-H1: provider was charged the overage fee but the request was already
      // taken (race). We do NOT auto-refund in this batch. Flag the payment for
      // manual admin review so the charge is not silently lost, and log clearly.
      const { error: flagError } = await supabase
        .from('overage_payments')
        .update({ accept_failed: true, updated_at: new Date().toISOString() })
        .eq('stripe_payment_intent_id', paymentIntent.id)
      if (flagError) {
        logger.error({
          event: 'overage_payment_accept_failed_flag_error',
          provider_id,
          request_id,
          payment_intent_id: paymentIntent.id,
          error: flagError.message,
        })
      }

      logger.warn({
        event: 'overage_payment_request_already_taken',
        provider_id,
        request_id,
        payment_intent_id: paymentIntent.id,
        stripe_event_id: stripeEvent.id,
        needs_manual_review: true,
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

// F3-L1: payment_intent.canceled — a PPJ/overage intent that was canceled (e.g.
// abandoned, expired, or canceled in the dashboard) would otherwise stay
// 'pending' forever. Move ONLY currently-pending rows to 'failed' so we never
// touch already-paid/succeeded rows or the accept_failed manual-review flag.
async function processPaymentIntentCanceled(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { error: ppjError } = await supabase
    .from('ppj_payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('status', 'pending')
  throwIfError(ppjError, 'Failed to mark canceled PPJ payment as failed')

  const { error: overageError } = await supabase
    .from('overage_payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('status', 'pending')
  throwIfError(overageError, 'Failed to mark canceled overage payment as failed')

  logger.info({
    event: 'stripe_payment_intent_canceled',
    payment_intent_id: paymentIntent.id,
    metadata_fee_type: paymentIntent.metadata?.fee_type ?? null,
  })
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

    // C4 / F3-C1 (D1): a pending/under_review provider MAY pay and subscribe,
    // but payment must NOT auto-activate them — activation waits for admin
    // approval. 'suspended' likewise must not be silently revived by a payment.
    // So if the provider is in a KYC-protected status, preserve it; the
    // subscription details (plan, stripe ids, billing period) are still recorded
    // below. Only a genuine active subscription on a non-protected provider
    // moves the status to 'active'.
    const KYC_PROTECTED: string[] = ['pending', 'under_review', 'rejected', 'suspended']
    const resolveStripeStatus = (currentDbStatus: string | undefined) => {
      if (currentDbStatus && KYC_PROTECTED.includes(currentDbStatus)) return currentDbStatus
      if (sub.status === 'active') return 'active'
      if (sub.status === 'past_due') return 'suspended'
      return 'pending'
    }
    const resolvedPlan = resolveSubscriptionPlan(sub)
    const resolvedPeriod = resolveSubscriptionPeriod(sub)

    if (resolvedPeriod.matchedItemCount !== 1) {
      // Phase 2: zero or multiple matched items means the price-ID mapping
      // (PLAN_BY_PRICE_ID) cannot deterministically identify this
      // subscription's billing period. No silent billing-date write -- fail
      // loudly so the event is recorded as failed (Stripe retries) and an
      // admin can fix the price-ID env vars.
      logger.error({
        event: 'stripe_subscription_period_unresolved',
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
        matched_item_count: resolvedPeriod.matchedItemCount,
        price_ids: resolvedPlan.priceIds,
      })
      throw new Error(
        `Unable to resolve billing period for subscription ${sub.id} ` +
          `(matched ${resolvedPeriod.matchedItemCount} item(s) against configured price IDs, expected exactly 1).`
      )
    }

    const currentPeriodStart = resolvedPeriod.periodStart
    const currentPeriodEnd = resolvedPeriod.periodEnd
    const updatePayload: {
      status: string
      stripe_subscription_id: string
      stripe_current_period_start: string | null
      stripe_current_period_end: string | null
      plan?: SubscriptionPlan
      job_credit_balance?: number
      last_upgrade_bonus_key?: string
    } = {
      status: 'pending',
      stripe_subscription_id: sub.id,
      stripe_current_period_start: currentPeriodStart,
      stripe_current_period_end: currentPeriodEnd,
    }

    if (resolvedPlan.plan) {
      updatePayload.plan = resolvedPlan.plan
    } else if (sub.status === 'active') {
      // F3-M1: an active subscription whose plan cannot be resolved usually
      // means a price ID env var is missing or a new price was added without
      // mapping. Silently leaving the plan unresolved would let an active
      // subscriber sit with a stale/unknown plan. Fail loudly so the event is
      // recorded as failed (Stripe will retry) and an admin can fix the mapping.
      logger.error({
        event: 'stripe_subscription_plan_unresolved',
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
        price_ids: resolvedPlan.priceIds,
        metadata_plan: sub.metadata?.plan ?? null,
        price_mapping_configured: PLAN_BY_PRICE_ID.size,
      })
      throw new Error(
        `Unable to resolve plan for active subscription ${sub.id} ` +
          `(price ids: ${resolvedPlan.priceIds.join(',') || 'none'}). ` +
          'Check STRIPE_*_PRICE_ID env vars.'
      )
    } else {
      logger.warn({
        event: 'stripe_subscription_plan_unresolved',
        stripe_subscription_id: sub.id,
        stripe_customer_id: stripeCustomerId,
        price_ids: resolvedPlan.priceIds,
        metadata_plan: sub.metadata?.plan ?? null,
        price_mapping_configured: PLAN_BY_PRICE_ID.size,
        subscription_status: sub.status,
      })
    }

    const { data: existingProvider, error: providerLookupError } = await supabase
      .from('providers')
      .select('id, status, plan, jobs_this_month, job_credit_balance, last_upgrade_bonus_key')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle<ProviderSubscriptionRow>()
    throwIfError(providerLookupError, 'Failed to read provider before subscription update')

    updatePayload.status = resolveStripeStatus(existingProvider?.status)

    if (existingProvider && resolvedPlan.plan) {
      const oldPlan = existingProvider.plan
      const newPlan = resolvedPlan.plan
      const isUpgrade = planTier(newPlan) > planTier(oldPlan)
      // Phase 2: currentPeriodStart is guaranteed non-null here -- the function
      // already throws above when the billing period cannot be resolved. The
      // previous 'no-period' fallback produced a degraded key that could never
      // distinguish two different real periods.
      const bonusKey = `${sub.id}:${currentPeriodStart}:${oldPlan}->${newPlan}`
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

    // Phase 2 (Q3): first-subscription initialization. This is the ONLY place
    // that ever zeroes jobs_this_month / sets jobs_reset_at for a brand-new
    // subscriber -- it runs once per provider, ever. The RPC re-validates
    // status = 'active' (the app's one authoritative activated status) and
    // first_activation_at IS NULL against the just-committed row, so a
    // duplicate/retried webhook delivery for the same event is a safe no-op.
    // CRITICAL: the ordinary renewal path above (an already-initialized
    // provider) never reaches this branch a second time with effect --
    // job_credit_balance is never touched here, and jobs_reset_at is never
    // advanced by this webhook for a renewal (only by this one-time RPC or
    // by the monthly reset cron), so a renewal can never make the cron think
    // the new period was already reset.
    if (updatePayload.status === 'active' && existingProvider) {
      const { data: initRows, error: initError } = await supabase.rpc(
        'initialize_first_subscription_atomic',
        {
          p_provider_id: existingProvider.id,
          p_period_start: currentPeriodStart,
          p_period_end: currentPeriodEnd,
        }
      )

      if (initError) {
        throw new Error(`Failed to run first-subscription initialization: ${initError.message}`)
      }

      const initResult =
        (initRows as { success: boolean; initialized: boolean; reason: string }[] | null)?.[0] ?? null

      if (initResult?.initialized) {
        logger.info({
          event: 'subscription_first_activation_initialized',
          provider_id: existingProvider.id,
          stripe_subscription_id: sub.id,
          period_start: currentPeriodStart,
          period_end: currentPeriodEnd,
        })
      }
    }

    if (updatePayload.status === 'suspended') {
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

  if (event.type === 'payment_intent.canceled') {
    await processPaymentIntentCanceled(supabase, event.data.object as Stripe.PaymentIntent)
  }

  if (event.type === 'payout.created' || event.type === 'payout.paid') {
    const payout = event.data.object as Stripe.Payout
    const { error } = await supabase.from('payout_log').upsert({
      stripe_payout_id: payout.id,
      amount: payout.amount,
      currency: payout.currency.toUpperCase(),
      arrival_date: new Date(payout.arrival_date * 1000).toISOString().split('T')[0],
      status: payout.status,
    }, { onConflict: 'stripe_payout_id' })
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
