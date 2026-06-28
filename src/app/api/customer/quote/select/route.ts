import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { SOFT_LAUNCH_MODE } from '@/types'

const selectQuoteSchema = z.object({
  request_id: z.string().uuid(),
  quote_id: z.string().uuid(),
})

type SelectQuoteResult = {
  success: boolean
  reason: string
  provider_name: string | null
  provider_phone: string | null
  provider_rating: number | null
  payment_required: boolean
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = selectQuoteSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid selection details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-select:${user.id}`, 10, 60 * 1000, 'customer_select_quote')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many selection attempts' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customers can select quotes' }, { status: 403 })
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc('select_quote_atomic', {
    p_customer_id: user.id,
    p_request_id: parsed.data.request_id,
    p_quote_id: parsed.data.quote_id,
  })

  const result = (rpcRows as SelectQuoteResult[] | null)?.[0] ?? null

  if (rpcError || !result?.success) {
    const reason = result?.reason ?? rpcError?.message ?? 'unknown'

    logger.warn({
      event: 'select_quote_failed',
      customer_id: user.id,
      request_id: parsed.data.request_id,
      quote_id: parsed.data.quote_id,
      reason,
    })

    const errorMessages: Record<string, { msg: string; status: number }> = {
      request_not_found: { msg: 'Request not found', status: 404 },
      request_not_in_quoted_status: { msg: 'Request is no longer accepting selections', status: 409 },
      quote_not_found: { msg: 'Quote not found', status: 404 },
      quote_not_pending: { msg: 'Quote is no longer available', status: 409 },
      quote_expired: { msg: 'This quote has expired', status: 410 },
    }

    const mapped = errorMessages[reason]
    if (mapped) {
      return NextResponse.json({ error: mapped.msg, code: reason }, { status: mapped.status })
    }

    return NextResponse.json({ error: 'Unable to select quote' }, { status: 500 })
  }

  logger.info({
    event: 'select_quote_success',
    customer_id: user.id,
    request_id: parsed.data.request_id,
    quote_id: parsed.data.quote_id,
    soft_launch: SOFT_LAUNCH_MODE,
    payment_required: result.payment_required,
  })

  // PPJ providers must pay the per-job fee before contact details are revealed.
  // The selection is held (request -> 'selected_pending_payment'); the provider is
  // prompted to pay, and the customer sees an "awaiting provider payment" state.
  if (result.payment_required) {
    return NextResponse.json({
      success: true,
      payment_required: true,
      provider: null,
    })
  }

  return NextResponse.json({
    success: true,
    payment_required: false,
    provider: {
      name: result.provider_name,
      phone: result.provider_phone,
      rating: result.provider_rating,
    },
  })
}
