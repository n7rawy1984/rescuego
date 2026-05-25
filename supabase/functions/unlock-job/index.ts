import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

// DEPRECATED: RescueGo now finalizes PPJ acceptance from the Next.js Stripe webhook.
// Do not deploy this Edge Function alongside the active webhook flow.

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-04-30.basil' })

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { request_id, payment_intent_id } = await req.json()
  if (!request_id || !payment_intent_id) return new Response(JSON.stringify({ error: 'request_id and payment_intent_id required' }), { status: 400 })

  const { data: lock } = await supabase
    .from('request_locks')
    .select('*')
    .eq('request_id', request_id)
    .eq('provider_id', user.id)
    .gt('locked_until', new Date().toISOString())
    .single()

  if (!lock) return new Response(JSON.stringify({ error: 'Lock expired or not found' }), { status: 409 })

  const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id)
  if (paymentIntent.status !== 'succeeded') {
    return new Response(JSON.stringify({ error: 'Payment not confirmed' }), { status: 402 })
  }
  if (paymentIntent.metadata?.provider_id !== user.id || paymentIntent.metadata?.request_id !== request_id) {
    return new Response(JSON.stringify({ error: 'Payment metadata mismatch' }), { status: 400 })
  }

  const { data: request } = await supabase.from('requests').select('*').eq('id', request_id).single()
  if (!request || request.status !== 'open') {
    return new Response(JSON.stringify({ error: 'Request no longer available' }), { status: 409 })
  }

  await supabase.from('requests').update({ status: 'accepted', accepted_by: user.id }).eq('id', request_id)
  await supabase.from('request_locks').delete().eq('request_id', request_id)

  const { data: customer } = await supabase.from('users').select('name, phone').eq('id', request.customer_id).single()

  return new Response(JSON.stringify({ success: true, customer }), { headers: { 'Content-Type': 'application/json' } })
})
