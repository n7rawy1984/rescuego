import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const priceChangeSchema = z.object({
  request_id: z.string().uuid(),
  new_price: z.number().min(1).max(50000),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = priceChangeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid price change details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`price-change:${user.id}`, 5, 60 * 1000, 'provider_price_change')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many price change attempts' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can request price changes' }, { status: 403 })
  }

  // CRIT-01: count-check + update happen atomically inside the RPC.
  // The route keeps no separate count/update logic that could race.
  const { data: rpcRows, error: rpcError } = await admin.rpc('request_price_change_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
    p_new_price: parsed.data.new_price,
  })

  const result = (rpcRows as { success: boolean; reason: string }[] | null)?.[0] ?? null

  if (rpcError || !result?.success) {
    const reason = result?.reason ?? rpcError?.message ?? 'unknown'

    logger.warn({
      event: 'price_change_update_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      reason,
    })

    if (result?.reason === 'price_change_not_allowed') {
      // Job not in progress, not assigned to this provider, or a price change was already used.
      return NextResponse.json(
        { error: 'Price change is not allowed for this job', code: reason },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Failed to submit price change' }, { status: 500 })
  }

  logger.info({
    event: 'price_change_requested',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    new_price: parsed.data.new_price,
  })

  return NextResponse.json({ success: true })
}
