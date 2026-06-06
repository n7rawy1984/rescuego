import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const completeJobSchema = z.object({
  request_id: z.string().uuid(),
  final_price: z.number().int().min(1).max(10000),
})

type JobRow = {
  id: string
  request_id: string
  provider_id: string
}

type CompleteJobResult = {
  success: boolean
  reason: string | null
  job_id: string | null
  completed_at: string | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = completeJobSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid completion details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`job-complete:${user.id}`, 20, 60 * 60 * 1000, 'provider_job_complete')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many completion attempts. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const [
    { data: profile },
    { data: request },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('requests').select('id, accepted_by, status').eq('id', parsed.data.request_id).single(),
  ])

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can complete jobs' }, { status: 403 })
  }

  if (!request || request.accepted_by !== user.id || !['accepted', 'in_progress'].includes(request.status)) {
    return NextResponse.json({ error: 'Job is not available for completion' }, { status: 409 })
  }

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id, request_id, provider_id')
    .eq('request_id', parsed.data.request_id)
    .eq('provider_id', user.id)
    .single<JobRow>()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job record not found' }, { status: 404 })
  }

  const { data: completedRows, error: completionError } = await admin.rpc('complete_provider_job_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
    p_final_price: parsed.data.final_price,
  })

  const completed = (completedRows as CompleteJobResult[] | null)?.[0] ?? null

  if (completionError || !completed?.success) {
    logger.warn({
      event: 'complete_job_rejected',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      job_id: job.id,
      error: completionError?.message ?? completed?.reason ?? 'Request was cancelled, released, or already completed',
    })
    return NextResponse.json({ error: 'Job is not available for completion' }, { status: 409 })
  }

  logger.info({
    event: 'complete_job_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    job_id: completed.job_id ?? job.id,
    final_price_aed: parsed.data.final_price,
  })

  return NextResponse.json({ success: true, job_id: completed.job_id ?? job.id })
}
