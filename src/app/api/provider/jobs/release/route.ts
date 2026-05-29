import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

const releaseJobSchema = z.object({
  request_id: z.string().uuid(),
})

type ActiveRequestRow = {
  id: string
  accepted_by: string | null
  status: string | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = releaseJobSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can release active jobs' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: request } = await admin
    .from('requests')
    .select('id, accepted_by, status')
    .eq('id', parsed.data.request_id)
    .single<ActiveRequestRow>()

  if (!request || request.accepted_by !== user.id || !['accepted', 'in_progress'].includes(request.status ?? '')) {
    return NextResponse.json({ error: 'This job is no longer available to release' }, { status: 409 })
  }

  const { data: releasedRequest, error: releaseError } = await admin
    .from('requests')
    .update({
      status: 'open',
      accepted_by: null,
    })
    .eq('id', parsed.data.request_id)
    .eq('accepted_by', user.id)
    .in('status', ['accepted', 'in_progress'])
    .select('id')
    .single()

  if (releaseError || !releasedRequest) {
    logger.warn({
      event: 'provider_release_job_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: releaseError?.message ?? 'Request was already changed',
    })
    return NextResponse.json({ error: 'This job is no longer available to release' }, { status: 409 })
  }

  const [{ error: jobError }, { error: locationError }, { error: lockError }] = await Promise.all([
    admin
      .from('jobs')
      .update({
        provider_id: null,
        commission_rate: null,
        commission_amount: null,
        stripe_payment_intent_id: null,
      })
      .eq('request_id', parsed.data.request_id)
      .eq('provider_id', user.id)
      .is('completed_at', null),
    admin
      .from('provider_locations')
      .delete()
      .eq('provider_id', user.id),
    admin
      .from('request_locks')
      .delete()
      .eq('request_id', parsed.data.request_id),
  ])

  if (jobError || locationError || lockError) {
    logger.warn({
      event: 'provider_release_job_cleanup_warning',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      job_error: jobError?.message,
      location_error: locationError?.message,
      lock_error: lockError?.message,
    })
  }

  logger.info({
    event: 'provider_release_job_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
  })

  return NextResponse.json({ success: true, request_id: parsed.data.request_id, online: false })
}
