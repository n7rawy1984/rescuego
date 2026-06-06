import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const VALID_TRANSITIONS: Record<string, string> = {
  accepted: 'en_route',
  en_route: 'arrived',
  arrived: 'in_progress',
}

const advanceStateSchema = z.object({
  request_id: z.string().uuid(),
})

type RequestRow = {
  id: string
  accepted_by: string | null
  status: string
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

  const nextStatus = VALID_TRANSITIONS[request.status]
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Cannot advance from status: ${request.status}` },
      { status: 409 }
    )
  }

  const timestampField = nextStatus === 'en_route'
    ? 'en_route_at'
    : nextStatus === 'arrived'
      ? 'arrived_at'
      : null

  const now = new Date().toISOString()

  const { error: requestError } = await admin
    .from('requests')
    .update({ status: nextStatus })
    .eq('id', parsed.data.request_id)
    .eq('accepted_by', user.id)
    .eq('status', request.status)

  if (requestError) {
    logger.error({
      event: 'advance_state_request_update_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      from_status: request.status,
      to_status: nextStatus,
      error: requestError.message,
    })
    return NextResponse.json({ error: 'Failed to advance job state' }, { status: 500 })
  }

  if (timestampField) {
    const { error: jobError } = await admin
      .from('jobs')
      .update({ [timestampField]: now })
      .eq('request_id', parsed.data.request_id)
      .eq('provider_id', user.id)

    if (jobError) {
      logger.warn({
        event: 'advance_state_job_timestamp_failed',
        provider_id: user.id,
        request_id: parsed.data.request_id,
        timestamp_field: timestampField,
        error: jobError.message,
      })
    }
  }

  logger.info({
    event: 'advance_state_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    from_status: request.status,
    to_status: nextStatus,
  })

  return NextResponse.json({ success: true, status: nextStatus })
}
