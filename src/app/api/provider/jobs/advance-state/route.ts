import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const VALID_TRANSITIONS: Record<string, { next: string; timestampField: string | null }> = {
  accepted: { next: 'en_route',    timestampField: 'en_route_at' },
  en_route: { next: 'arrived',     timestampField: 'arrived_at' },
  arrived:  { next: 'in_progress', timestampField: null },
}

const advanceStateSchema = z.object({
  request_id: z.string().uuid(),
})

type RequestRow = {
  id: string
  accepted_by: string | null
  status: string
}

type AdvanceStateRpcResult = {
  success: boolean
  reason: string | null
  next_status: string | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = advanceStateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`advance-state:${user.id}`, 30, 60 * 60 * 1000, 'provider_advance_state')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const [{ data: profile }, { data: request }] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin
      .from('requests')
      .select('id, accepted_by, status')
      .eq('id', parsed.data.request_id)
      .single<RequestRow>(),
  ])

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can advance job state' }, { status: 403 })
  }

  if (!request || request.accepted_by !== user.id) {
    return NextResponse.json({ error: 'Job not found or not assigned to you' }, { status: 404 })
  }

  const transition = VALID_TRANSITIONS[request.status]
  if (!transition) {
    return NextResponse.json({ error: 'Job cannot be advanced from its current state' }, { status: 409 })
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc('advance_provider_job_state', {
    p_provider_id:     user.id,
    p_request_id:      parsed.data.request_id,
    p_from_status:     request.status,
    p_to_status:       transition.next,
    p_timestamp_field: transition.timestampField ?? null,
  })

  const result = (rpcRows as AdvanceStateRpcResult[] | null)?.[0] ?? null

  if (rpcError || !result?.success) {
    const reason = rpcError?.message ?? result?.reason ?? 'unknown'
    logger.error({
      event: 'advance_state_rpc_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      from_status: request.status,
      to_status: transition.next,
      reason,
    })
    if (result?.reason === 'no_matching_request') {
      return NextResponse.json({ error: 'Job state has already changed or is not yours' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to advance job state' }, { status: 500 })
  }

  logger.info({
    event: 'advance_state_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    from_status: request.status,
    to_status: transition.next,
  })

  return NextResponse.json({ success: true, status: result.next_status })
}
