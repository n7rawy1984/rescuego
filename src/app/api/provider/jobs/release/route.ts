import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const releaseJobSchema = z.object({
  request_id: z.string().uuid(),
})

type ReleaseRpcResult = {
  success: boolean
  reason: string | null
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

  const rateLimit = await checkRateLimitAsync(`provider-release-job:${user.id}`, 10, 60 * 1000, 'provider_release_job', 'soft')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const { data: releaseRows, error: releaseError } = await admin.rpc('release_job_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
  })

  const result = (releaseRows as ReleaseRpcResult[] | null)?.[0] ?? null

  if (releaseError || !result?.success) {
    const reason = releaseError?.message ?? result?.reason ?? 'unknown'
    logger.warn({
      event: 'provider_release_job_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: reason,
    })
    return NextResponse.json({ error: 'This job is no longer available to release' }, { status: 409 })
  }

  // Best-effort: take the provider offline after release.
  // Not included in the RPC — offline status is a convenience signal, not a
  // correctness requirement. Failure here does not affect the released request.
  const { error: locationError } = await admin
    .from('provider_locations')
    .delete()
    .eq('provider_id', user.id)

  if (locationError) {
    logger.warn({
      event: 'provider_release_location_cleanup_warning',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      error: locationError.message,
    })
  }

  logger.info({
    event: 'provider_release_job_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
  })

  return NextResponse.json({ success: true, request_id: parsed.data.request_id, online: false })
}
