import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { roundDispatchCoordinate, UAE_BOUNDS } from '@/lib/geo'

const requestSchema = z.object({
  problem_type: z.enum(['flat_tire', 'battery', 'tow', 'other']),
  phone: z.string().trim().min(8).max(30).regex(/^[+\d\s().-]+$/),
  location_address: z.string().trim().min(3).max(300),
  note: z.string().trim().max(500).optional().nullable(),
  coords: z
    .object({
      lng: z.number().min(UAE_BOUNDS.minLng).max(UAE_BOUNDS.maxLng),
      lat: z.number().min(UAE_BOUNDS.minLat).max(UAE_BOUNDS.maxLat),
    })
    .optional()
    .nullable(),
})

type CompletedJobRow = {
  id: string
  provider_id: string
  completed_at: string | null
  requests: {
    id: string
    customer_id: string | null
    problem_type: string | null
    location_address: string | null
    final_price: number | null
    status: string | null
    created_at: string | null
  } | null
  providers: {
    users: {
      name: string | null
    } | null
  } | null
}

type LateCancellationRow = {
  id: string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, phone')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can view recovery requests' }, { status: 403 })
  }

  const admin = createAdminClient()
  const activeRequestPromise = supabase
    .from('requests')
    .select('id, problem_type, location_address, note, status, accepted_by, final_price, created_at')
    .eq('customer_id', user.id)
    .in('status', ['open', 'accepted', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const completedJobsPromise = admin
    .from('jobs')
    .select('id, provider_id, completed_at, requests!inner(id, customer_id, problem_type, location_address, final_price, status, created_at), providers(users(name))')
    .eq('requests.customer_id', user.id)
    .eq('requests.status', 'completed')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(10)
    .returns<CompletedJobRow[]>()

  const lateCancellationWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const lateCancellationsPromise = admin
    .from('requests')
    .select('id')
    .eq('customer_id', user.id)
    .eq('status', 'cancelled')
    .eq('cancellation_actor', 'customer')
    .not('accepted_by', 'is', null)
    .gte('cancelled_at', lateCancellationWindowStart)
    .returns<LateCancellationRow[]>()

  const [
    { data: activeRequest, error },
    { data: completedJobs, error: completedJobsError },
    { data: lateCancellations, error: lateCancellationsError },
  ] = await Promise.all([
    activeRequestPromise,
    completedJobsPromise,
    lateCancellationsPromise,
  ])

  if (lateCancellationsError) {
    logger.warn({
      event: 'customer_late_cancellation_count_failed',
      customer_id: user.id,
      error: lateCancellationsError.message,
    })
  }

  if (completedJobsError) {
    logger.error({
      event: 'unrated_completed_request_lookup_failed',
      customer_id: user.id,
      error: completedJobsError.message,
    })
    return NextResponse.json({ error: 'Unable to load completed request' }, { status: 500 })
  }

  if (error) {
    logger.error({
      event: 'active_request_lookup_failed',
      customer_id: user.id,
      error: error.message,
    })
    return NextResponse.json({ error: 'Unable to load active request' }, { status: 500 })
  }

  const jobIds = (completedJobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }

  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))
  const unratedJob = (completedJobs ?? [])
    .filter((job) => !ratedJobIds.has(job.id))
    .sort((a, b) => {
      const aCreated = a.requests?.created_at ? new Date(a.requests.created_at).getTime() : 0
      const bCreated = b.requests?.created_at ? new Date(b.requests.created_at).getTime() : 0
      return bCreated - aCreated
    })[0]

  if (unratedJob?.requests) {
    return NextResponse.json({
      completed_unrated_request: {
        job_id: unratedJob.id,
        provider_id: unratedJob.provider_id,
        provider_name: unratedJob.providers?.users?.name ?? null,
        completed_at: unratedJob.completed_at,
        request: {
          id: unratedJob.requests.id,
          problem_type: unratedJob.requests.problem_type,
          location_address: unratedJob.requests.location_address,
          final_price: unratedJob.requests.final_price,
          status: unratedJob.requests.status,
          created_at: unratedJob.requests.created_at,
        },
      },
      active_request: null,
      customer_phone: profile.phone ?? null,
      late_cancellations_24h: lateCancellations?.length ?? 0,
    })
  }

  let activeRequestWithProvider: (NonNullable<typeof activeRequest> & {
    provider_name?: string | null
    provider_phone?: string | null
  }) | null = activeRequest ?? null

  if (activeRequest?.accepted_by) {
    const { data: assignedProvider, error: assignedProviderError } = await admin
      .from('providers')
      .select('users(name, phone)')
      .eq('id', activeRequest.accepted_by)
      .maybeSingle<{ users: { name: string | null; phone: string | null } | null }>()

    if (assignedProviderError) {
      logger.warn({
        event: 'customer_assigned_provider_lookup_failed',
        customer_id: user.id,
        request_id: activeRequest.id,
        provider_id: activeRequest.accepted_by,
        error: assignedProviderError.message,
      })
    }

    activeRequestWithProvider = {
      ...activeRequest,
      provider_name: assignedProvider?.users?.name ?? null,
      provider_phone: assignedProvider?.users?.phone ?? null,
    }
  }

  return NextResponse.json({
    active_request: activeRequestWithProvider ?? null,
    customer_phone: profile.phone ?? null,
    late_cancellations_24h: lateCancellations?.length ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-request:${user.id}`, 10, 60 * 60 * 1000, 'customer_request_create')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many recovery requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, phone')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can submit recovery requests' }, { status: 403 })
  }

  const { data: existingActiveRequest, error: activeLookupError } = await supabase
    .from('requests')
    .select('id, status')
    .eq('customer_id', user.id)
    .in('status', ['open', 'accepted', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeLookupError) {
    logger.error({
      event: 'request_duplicate_guard_failed',
      customer_id: user.id,
      error: activeLookupError.message,
    })
    return NextResponse.json({ error: 'Unable to verify active requests' }, { status: 500 })
  }

  if (existingActiveRequest) {
    return NextResponse.json(
      {
        error: 'You already have an active recovery request.',
        id: existingActiveRequest.id,
        status: existingActiveRequest.status,
      },
      { status: 409 }
    )
  }

  const { problem_type, phone, location_address, note, coords } = parsed.data
  const point = coords
    ? `POINT(${roundDispatchCoordinate(coords.lng)} ${roundDispatchCoordinate(coords.lat)})`
    : 'POINT(55.2708 25.2048)'

  if (profile.phone !== phone) {
    const { error: phoneError } = await supabase
      .from('users')
      .update({ phone })
      .eq('id', user.id)

    if (phoneError) {
      logger.error({
        event: 'request_customer_phone_update_failed',
        customer_id: user.id,
        error: phoneError.message,
      })
      return NextResponse.json({ error: 'Failed to update customer contact number' }, { status: 500 })
    }
  }

  const { data, error } = await supabase
    .from('requests')
    .insert({
      customer_id: user.id,
      location: point,
      location_address,
      problem_type,
      note: note || null,
      status: 'open',
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.error({
      event: 'request_create_failed',
      customer_id: user.id,
      problem_type,
      has_coords: Boolean(coords),
      error: error?.message ?? 'No request data returned',
    })
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }

  logger.info({
    event: 'request_created',
    request_id: data.id,
    customer_id: user.id,
    problem_type,
    has_coords: Boolean(coords),
  })

  return NextResponse.json({ id: data.id })
}
