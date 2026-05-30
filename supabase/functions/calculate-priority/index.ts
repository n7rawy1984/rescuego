import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// DEPRECATED: RescueGo now uses Next.js App Router APIs and dashboard logic.
// This function uses the service role key and should not be deployed until it
// has a fresh auth/authorization review.

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { lng, lat } = await req.json()
  if (!lng || !lat) return new Response(JSON.stringify({ error: 'lng and lat required' }), { status: 400 })

  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: providers, error } = await supabase.rpc('get_nearby_providers', {
    p_lng: lng,
    p_lat: lat,
    p_radius: 5000,
    p_stale_threshold: staleThreshold,
  })

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify({ providers: providers ?? [] }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
