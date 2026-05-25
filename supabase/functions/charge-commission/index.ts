import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

// DEPRECATED: RescueGo now uses Next.js API routes under src/app/api.
// This function contains stale Pay Per Job percentage logic and should not be deployed.

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-04-30.basil' })
const PREMIUM_THRESHOLD = 400
const COMMISSION_RATES: Record<string, number> = { starter: 0.15, pro: 0.10, business: 0, pay_per_job: 0.28 }

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { job_id, final_price_aed } = await req.json()
  if (!job_id || !final_price_aed) return new Response(JSON.stringify({ error: 'job_id and final_price_aed required' }), { status: 400 })

  const { data: job } = await supabase.from('jobs').select('*, providers(*)').eq('id', job_id).single()
  if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404 })
  if (job.provider_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })

  await supabase.from('requests').update({ final_price: final_price_aed }).eq('id', job.request_id)

  if (final_price_aed <= PREMIUM_THRESHOLD || job.providers.plan === 'business') {
    await supabase.from('jobs').update({ commission_rate: 0, commission_amount: 0, completed_at: new Date().toISOString() }).eq('id', job_id)
    await supabase.from('requests').update({ status: 'completed' }).eq('id', job.request_id)
    return new Response(JSON.stringify({ success: true, commission_aed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  const rate = COMMISSION_RATES[job.providers.plan] ?? 0
  const commissionAed = Math.round(final_price_aed * rate)
  const commissionFils = commissionAed * 100

  if (commissionFils === 0) {
    await supabase.from('jobs').update({ commission_rate: rate * 100, commission_amount: 0, completed_at: new Date().toISOString() }).eq('id', job_id)
    await supabase.from('requests').update({ status: 'completed' }).eq('id', job.request_id)
    return new Response(JSON.stringify({ success: true, commission_aed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  const idempotencyKey = `commission-${job_id}`
  const paymentIntent = await stripe.paymentIntents.create({
    amount: commissionFils,
    currency: 'aed',
    customer: job.providers.stripe_customer_id,
    payment_method: await getDefaultPM(stripe, job.providers.stripe_customer_id),
    confirm: true,
    off_session: true,
    metadata: { type: 'commission', job_id, provider_id: user.id },
  }, { idempotencyKey })

  if (paymentIntent.status !== 'succeeded') {
    return new Response(JSON.stringify({ error: 'Commission payment failed' }), { status: 402 })
  }

  await supabase.from('jobs').update({
    commission_rate: rate * 100,
    commission_amount: commissionFils,
    stripe_payment_intent_id: paymentIntent.id,
    completed_at: new Date().toISOString(),
  }).eq('id', job_id)

  await supabase.from('requests').update({ status: 'completed' }).eq('id', job.request_id)

  return new Response(JSON.stringify({ success: true, commission_aed: commissionAed }), { headers: { 'Content-Type': 'application/json' } })
})

async function getDefaultPM(stripe: Stripe, customerId: string): Promise<string> {
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
  const pm = customer.invoice_settings?.default_payment_method
  if (typeof pm === 'string') return pm
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 })
  return methods.data[0]?.id ?? ''
}
