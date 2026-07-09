import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { roundDispatchCoordinate, UAE_BOUNDS, generateFuzzyCoordinates, distanceMeters } from '@/lib/geo'

// R6 (tiered dispatch API phase): GPS coordinates are mandatory. location_address
// is now an optional descriptive note only — it can no longer substitute for a
// real location fix, and the fixed Dubai-center fallback has been removed entirely.
const requestSchema = z.object({
  problem_type: z.enum(['flat_tire', 'battery', 'tow', 'other']),
  phone: z.string().trim().min(8).max(30).regex(/^[+\d\s().-]+$/),
  location_address: z.string().trim().max(300).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  coords: z.object({
    lng: z.number().min(UAE_BOUNDS.minLng).max(UAE_BOUNDS.maxLng),
    lat: z.number().min(UAE_BOUNDS.minLat).max(UAE_BOUNDS.maxLat),
  }),
  // Recorded for analytics only — never gated on. Low-accuracy coordinates are
  // still better than rejecting a stranded customer's request.
  accuracy: z.number().nonnegative().optional().nullable(),
  destination: z.string().trim().max(300).optional().nullable(),
  destination_area: z.string().trim().max(150).optional().nullable(),
})

type NearbyProviderRow = {
  lat: number | null
  lng: number | null
  providers: { plan: string; status: string } | { plan: string; status: string }[] | null
}

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

  // P4-H1: this is a high-frequency polling / realtime-fallback endpoint. 60/min (1/s) per customer
  // is safe for normal UI refresh while blocking a 2,000 req/s polling-abuse vector. SOFT mode so a
  // Redis outage degrades to per-instance limiting rather than denying legitimate polling.
  const rateLimit = await checkRateLimitAsync(`customer-active-request:${user.id}`, 60, 60 * 1000, 'customer_get_active_request')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
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
    .select('id, problem_type, location_address, note, status, accepted_by, final_price, created_at, price_change_requested, price_change_status, selected_quote_id, quoted_at, last_release_reason')
    .eq('customer_id', user.id)
    .in('status', ['open', 'quoted', 'selected_pending_payment', 'accepted', 'en_route', 'arrived', 'in_progress'])
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
    { data: rawActiveRequest, error },
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

  let activeRequest = rawActiveRequest

  // HIGH-02: GET is read-only. A 'quoted' request older than 20 minutes is treated as expired in
  // the RESPONSE only — we do NOT write to the database here. The marketplace-cron owns request/quote
  // expiry (typically within ~1 minute). This is safe because every write action is server-authoritative:
  // e.g. select_quote_atomic re-validates live DB state and rejects with request_not_in_quoted_status /
  // quote_expired, so a brief read-display vs DB mismatch cannot cause an inconsistent write.
  if (activeRequest?.status === 'quoted') {
    const quotedAt = activeRequest.quoted_at
    const quotedAge = quotedAt
      ? Date.now() - new Date(quotedAt).getTime()
      : Infinity
    if (quotedAge > 20 * 60 * 1000) {
      activeRequest = null
    }
  }

  const jobIds = (completedJobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }

  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))
  const unratedJobs = (completedJobs ?? []).filter((job) => !ratedJobIds.has(job.id))
  const unratedJobsCount = unratedJobs.length
  const unratedJob = unratedJobs.sort((a, b) => {
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
      unrated_jobs_count: unratedJobsCount,
    })
  }

  let activeRequestWithProvider: (NonNullable<typeof activeRequest> & {
    provider_name?: string | null
    provider_phone?: string | null
  }) | null = activeRequest ?? null

  // Reveal the assigned provider's contact ONLY once the job is actually assigned.
  // For a PPJ 'selected_pending_payment' request, accepted_by marks WHO must pay but the
  // job is NOT assigned yet — contact details must stay hidden until the fee is paid.
  if (activeRequest?.accepted_by && activeRequest.status !== 'selected_pending_payment') {
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
    unrated_jobs_count: unratedJobsCount,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    const missingCoords = parsed.error.issues.some((issue) => issue.path[0] === 'coords')
    if (missingCoords) {
      return NextResponse.json(
        { error: 'GPS location is required to submit a recovery request.', code: 'coordinates_required' },
        { status: 422 }
      )
    }
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

  // Duplicate-request guard. This list MUST stay in sync with the active-request
  // status list in GET (above): a request the customer can still see as "active"
  // must also block creating a second one. 'selected_pending_payment' is a PPJ
  // request whose fee is not yet paid — it is held for the selected provider and
  // is auto-released by the marketplace cron if unpaid, so it counts as active.
  const { data: existingActiveRequest, error: activeLookupError } = await supabase
    .from('requests')
    .select('id, status')
    .eq('customer_id', user.id)
    .in('status', ['open', 'quoted', 'selected_pending_payment', 'accepted', 'en_route', 'arrived', 'in_progress'])
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

  const { problem_type, phone, location_address, note, coords, destination, destination_area, accuracy } = parsed.data
  const point = `POINT(${roundDispatchCoordinate(coords.lng)} ${roundDispatchCoordinate(coords.lat)})`
  const fuzzy = generateFuzzyCoordinates({ lat: coords.lat, lng: coords.lng })

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

  // Tiered Dispatch API phase: snapshot the current provider-visibility counts at
  // creation time. Both counts are derived from ONE query (not two separate SELECTs)
  // per the binding SNAPSHOT CONSISTENCY CONSTRAINT (TIERED_DISPATCH_051_ANALYSIS.md
  // §5). Runs via the admin (service-role) client — a customer session cannot and
  // should not read other providers' rows under RLS. If this query fails, request
  // creation MUST NOT fail: both snapshot values fall back to NULL, which
  // get_nearby_open_requests (migration 053) treats as the legacy "visible to all
  // immediately" behavior. This NULL fallback is intentional, not a bug.
  const admin = createAdminClient()
  const gpsFreshnessThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let providersInRangeAtCreation: number | null = null
  let subscribersInRangeAtCreation: number | null = null

  const { data: nearbyProviderRows, error: countError } = await admin
    .from('provider_locations')
    .select('lat, lng, providers!inner(plan, status)')
    .eq('providers.status', 'active')
    .gte('updated_at', gpsFreshnessThreshold)
    .returns<NearbyProviderRow[]>()

  if (countError || !nearbyProviderRows) {
    logger.warn({
      event: 'snapshot_count_failed',
      customer_id: user.id,
      error: countError?.message ?? 'No provider rows returned',
    })
  } else {
    const withinRange = nearbyProviderRows.filter((row) =>
      row.lat != null &&
      row.lng != null &&
      distanceMeters({ lat: coords.lat, lng: coords.lng }, { lat: row.lat, lng: row.lng }) <= 150000
    )
    providersInRangeAtCreation = withinRange.length
    subscribersInRangeAtCreation = withinRange.filter((row) => {
      const provider = Array.isArray(row.providers) ? row.providers[0] : row.providers
      return provider?.plan !== 'pay_per_job'
    }).length
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
      fuzzy_latitude: fuzzy.lat,
      fuzzy_longitude: fuzzy.lng,
      providers_in_range_at_creation: providersInRangeAtCreation,
      subscribers_in_range_at_creation: subscribersInRangeAtCreation,
      ...(destination && { destination }),
      ...(destination_area && { destination_area }),
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.error({
      event: 'request_create_failed',
      customer_id: user.id,
      problem_type,
      error: error?.message ?? 'No request data returned',
    })
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }

  logger.info({
    event: 'request_created',
    request_id: data.id,
    customer_id: user.id,
    problem_type,
    gps_accuracy_meters: accuracy ?? null,
    providers_in_range_at_creation: providersInRangeAtCreation,
  })

  return NextResponse.json({ id: data.id })
}
