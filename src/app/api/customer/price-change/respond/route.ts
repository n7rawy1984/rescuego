import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const respondSchema = z.object({
  request_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = respondSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid response details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`price-respond:${user.id}`, 10, 60 * 1000, 'customer_price_change_respond')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts' },
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
      .select('id, customer_id, status, price_change_status, price_change_requested')
      .eq('id', parsed.data.request_id)
      .single<{ id: string; customer_id: string; status: string; price_change_status: string | null; price_change_requested: number | null }>(),
  ])

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customers can respond to price changes' }, { status: 403 })
  }

  if (!request || request.customer_id !== user.id) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (request.price_change_status !== 'pending') {
    return NextResponse.json({ error: 'No pending price change to respond to' }, { status: 409 })
  }

  if (request.status !== 'in_progress') {
    return NextResponse.json({ error: 'Job is not in progress' }, { status: 409 })
  }

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected'

  const { error: updateError } = await admin
    .from('requests')
    .update({ price_change_status: newStatus })
    .eq('id', parsed.data.request_id)
    .eq('customer_id', user.id)
    .eq('price_change_status', 'pending')

  if (updateError) {
    logger.error({
      event: 'price_change_respond_failed',
      customer_id: user.id,
      request_id: parsed.data.request_id,
      action: parsed.data.action,
      error: updateError.message,
    })
    return NextResponse.json({ error: 'Failed to update price change' }, { status: 500 })
  }

  logger.info({
    event: 'price_change_responded',
    customer_id: user.id,
    request_id: parsed.data.request_id,
    action: parsed.data.action,
    new_price: parsed.data.action === 'approve' ? request.price_change_requested : null,
  })

  return NextResponse.json({
    success: true,
    action: parsed.data.action,
    final_price: parsed.data.action === 'approve' ? request.price_change_requested : null,
  })
}
