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

  const [
    { data: profile },
    { data: request },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('requests')
      .select('id, accepted_by, status, price_change_count')
      .eq('id', parsed.data.request_id)
      .single<{ id: string; accepted_by: string | null; status: string; price_change_count: number }>(),
  ])

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can request price changes' }, { status: 403 })
  }

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (request.accepted_by !== user.id) {
    return NextResponse.json({ error: 'This job is not assigned to you' }, { status: 403 })
  }

  if (request.status !== 'in_progress') {
    return NextResponse.json({ error: 'Price changes are only allowed during active work' }, { status: 409 })
  }

  if (request.price_change_count >= 1) {
    return NextResponse.json({ error: 'Maximum one price change per job' }, { status: 409 })
  }

  const { error: updateError } = await admin
    .from('requests')
    .update({
      price_change_requested: parsed.data.new_price,
      price_change_status: 'pending',
      price_change_count: (request.price_change_count ?? 0) + 1,
    })
    .eq('id', parsed.data.request_id)
    .eq('accepted_by', user.id)
    .eq('status', 'in_progress')

  if (updateError) {
    logger.error({
      event: 'price_change_update_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: updateError.message,
    })
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
