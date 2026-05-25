import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

// DEPRECATED: RescueGo now uses the Next.js webhook at src/app/api/stripe/webhook/route.ts.
// Do not deploy this Edge Function alongside the active Next.js webhook.

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-04-30.basil' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

serve(async (req) => {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    return new Response(`Webhook signature invalid: ${err}`, { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: existing } = await supabase.from('stripe_events').select('id').eq('id', event.id).single()
  if (existing) return new Response('Already processed', { status: 200 })

  await supabase.from('stripe_events').insert({ id: event.id, type: event.type, payload: event })

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'suspended' : 'pending'
      const plan = (sub.metadata?.plan ?? 'starter') as string
      await supabase
        .from('providers')
        .update({ status, plan, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer as string)
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await supabase
        .from('providers')
        .update({ status: 'suspended', stripe_subscription_id: null })
        .eq('stripe_customer_id', sub.customer as string)
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      await supabase
        .from('providers')
        .update({ status: 'suspended' })
        .eq('stripe_customer_id', invoice.customer as string)
      break
    }
    case 'payout.created':
    case 'payout.paid': {
      const payout = event.data.object as Stripe.Payout
      await supabase.from('payout_log').upsert({
        stripe_payout_id: payout.id,
        amount: payout.amount,
        currency: payout.currency.toUpperCase(),
        arrival_date: new Date(payout.arrival_date * 1000).toISOString().split('T')[0],
        status: payout.status,
      })
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})
