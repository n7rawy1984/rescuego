import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-04-30.basil' })

const PLAN_LIMITS: Record<string, number | null> = {
  starter: 15,
  pro: 35,
  business: null,
  pay_per_job: null,
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { request_id } = await req.json()
  if (!request_id) return new Response(JSON.stringify({ error: 'request_id required' }), { status: 400 })

  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('*')
    .eq('id', user.id)
    .single()

  if (providerError || !provider) return new Response(JSON.stringify({ error: 'Provider not found' }), { status: 404 })
  if (provider.status !== 'active') return new Response(JSON.stringify({ error: 'Provider not active' }), { status: 403 })

  const { data: request, error: requestError } = await supabase
    .from('requests')
    .select('*')
    .eq('id', request_id)
    .single()

  if (requestError || !request) return new Response(JSON.stringify({ error: 'Request not found' }), { status: 404 })
  if (request.status !== 'open') return new Response(JSON.stringify({ error: 'Request no longer available' }), { status: 409 })

  if (provider.plan === 'pay_per_job') {
    const { data: existingLock } = await supabase
      .from('request_locks')
      .select('*')
      .eq('request_id', request_id)
      .gt('locked_until', new Date().toISOString())
      .single()

    if (existingLock) return new Response(JSON.stringify({ error: 'Request locked by another provider' }), { status: 409 })

    const lockedUntil = new Date(Date.now() + 60000).toISOString()
    await supabase.from('request_locks').upsert({ request_id, provider_id: user.id, locked_until: lockedUntil })

    const commissionAed = Math.round((request.price_estimate_max ?? 300) * 0.28)
    return new Response(JSON.stringify({ type: 'pay_per_job', commission_aed: commissionAed, locked_until: lockedUntil }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const limit = PLAN_LIMITS[provider.plan]
  if (limit !== null && provider.jobs_this_month >= limit) {
    if (!provider.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'Stripe customer not found for overage charge' }), { status: 402 })
    }
    const idempotencyKey = `overage-${user.id}-${request_id}`
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1200,
      currency: 'aed',
      customer: provider.stripe_customer_id,
      payment_method: await getDefaultPaymentMethod(stripe, provider.stripe_customer_id),
      confirm: true,
      off_session: true,
      metadata: { type: 'overage', provider_id: user.id, request_id },
    }, { idempotencyKey })

    if (paymentIntent.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'Overage payment failed' }), { status: 402 })
    }
  }

  const { error: updateError } = await supabase
    .from('requests')
    .update({ status: 'accepted', accepted_by: user.id })
    .eq('id', request_id)
    .eq('status', 'open')

  if (updateError) return new Response(JSON.stringify({ error: 'Failed to accept request' }), { status: 500 })

  await supabase
    .from('providers')
    .update({ jobs_this_month: provider.jobs_this_month + 1 })
    .eq('id', user.id)

  return new Response(JSON.stringify({ type: 'subscribed', success: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

async function getDefaultPaymentMethod(stripe: Stripe, customerId: string): Promise<string> {
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
  const defaultPM = customer.invoice_settings?.default_payment_method
  if (typeof defaultPM === 'string') return defaultPM
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 })
  return methods.data[0]?.id ?? ''
}
