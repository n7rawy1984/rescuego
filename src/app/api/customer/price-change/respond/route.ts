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

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customers can respond to price changes' }, { status: 403 })
  }

  // HIGH-06: the status='in_progress' guard and the pending-state check live INSIDE
  // the RPC, so the approve/reject response is atomic and cannot race.
  const { data: rpcRows, error: rpcError } = await admin.rpc('respond_price_change_atomic', {
    p_customer_id: user.id,
    p_request_id: parsed.data.request_id,
    p_action: parsed.data.action,
  })

  const result = (rpcRows as { success: boolean; reason: string; final_price: number | null }[] | null)?.[0] ?? null

  if (rpcError || !result?.success) {
    const reason = result?.reason ?? rpcError?.message ?? 'unknown'

    logger.warn({
      event: 'price_change_respond_failed',
      customer_id: user.id,
      request_id: parsed.data.request_id,
      action: parsed.data.action,
      reason,
    })

    if (result?.reason === 'no_pending_price_change') {
      return NextResponse.json(
        { error: 'No pending price change to respond to, or the job is no longer in progress', code: reason },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Failed to update price change' }, { status: 500 })
  }

  logger.info({
    event: 'price_change_responded',
    customer_id: user.id,
    request_id: parsed.data.request_id,
    action: parsed.data.action,
    new_price: result.final_price,
  })

  return NextResponse.json({
    success: true,
    action: parsed.data.action,
    final_price: result.final_price,
  })
}
