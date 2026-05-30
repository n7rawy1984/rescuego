import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-user'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import type { ProviderPlan } from '@/types'

const PLAN_PRICE_IDS: Record<Exclude<ProviderPlan, 'pay_per_job'>, string | undefined> = {
  starter: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? '',
  pro: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? '',
  business: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID ?? '',
}

const SUBSCRIPTION_PLANS = ['starter', 'pro', 'business'] as const
type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number]

type CheckoutRequestBody = {
  plan?: unknown
  provider_id?: unknown
}

type ProviderBillingRow = {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  users: {
    email: string | null
    name: string | null
  } | null
}

function isSubscriptionPlan(plan: unknown): plan is SubscriptionPlan {
  return typeof plan === 'string' && SUBSCRIPTION_PLANS.includes(plan as SubscriptionPlan)
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CheckoutRequestBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 })
  }

  const { plan, provider_id } = body

  if (!isSubscriptionPlan(plan) || typeof provider_id !== 'string') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const priceId = PLAN_PRICE_IDS[plan]
  if (!priceId) {
    logger.error({
      event: 'subscription_checkout_price_missing',
      provider_id,
      plan,
    })
    return NextResponse.json({ error: 'Stripe price is not configured for this plan' }, { status: 500 })
  }

  const { user, authError } = await getRequestUser(req)
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.id !== provider_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createAdminClient()
  const { data: userRole } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userRole?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can create checkout sessions' }, { status: 403 })
  }

  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('stripe_customer_id, stripe_subscription_id, users(email, name)')
    .eq('id', provider_id)
    .single<ProviderBillingRow>()

  if (providerError || !provider) {
    return NextResponse.json({ error: 'Provider profile not found' }, { status: 404 })
  }

  const stripe = getStripe()

  let customerId = provider?.stripe_customer_id
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: provider.users?.email ?? user.email ?? undefined,
        name: provider.users?.name ?? undefined,
        metadata: { provider_id },
      })
      customerId = customer.id
      const { error: customerUpdateError } = await supabase
        .from('providers')
        .update({ stripe_customer_id: customerId })
        .eq('id', provider_id)

      if (customerUpdateError) {
        logger.error({
          event: 'subscription_checkout_customer_save_failed',
          provider_id,
          stripe_customer_id: customerId,
          error: customerUpdateError.message,
        })
        return NextResponse.json({ error: 'Unable to prepare billing session' }, { status: 500 })
      }
    } catch (error) {
      logger.error({
        event: 'subscription_checkout_customer_create_failed',
        provider_id,
        plan,
        error: error instanceof Error ? error.message : 'Stripe customer creation failed',
      })
      return NextResponse.json({ error: 'Unable to prepare billing session' }, { status: 500 })
    }
  }

  if (provider.stripe_subscription_id) {
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${getAppUrl()}/provider/subscribe?plan=${plan}&portal_return=1`,
      })

      logger.info({
        event: 'subscription_billing_portal_created',
        provider_id,
        plan,
        stripe_customer_id: customerId,
      })

      return NextResponse.json({ url: portalSession.url })
    } catch (error) {
      logger.error({
        event: 'subscription_billing_portal_create_failed',
        provider_id,
        plan,
        stripe_customer_id: customerId,
        error: error instanceof Error ? error.message : 'Stripe billing portal creation failed',
      })
      return NextResponse.json({ error: 'Unable to start billing session right now.' }, { status: 500 })
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { plan, provider_id } },
      success_url: `${getAppUrl()}/provider/dashboard?success=1`,
      cancel_url: `${getAppUrl()}/provider/register`,
      metadata: { plan, provider_id },
    })

    logger.info({
      event: 'subscription_checkout_session_created',
      provider_id,
      plan,
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    logger.error({
      event: 'subscription_checkout_session_create_failed',
      provider_id,
      plan,
      stripe_customer_id: customerId,
      error: error instanceof Error ? error.message : 'Stripe checkout session creation failed',
    })
    return NextResponse.json({ error: 'Unable to start billing session right now.' }, { status: 500 })
  }
}
