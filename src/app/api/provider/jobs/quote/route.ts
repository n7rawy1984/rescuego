import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { distanceKm, type Coordinates } from '@/lib/geo'
import { SOFT_LAUNCH_MODE } from '@/types'
import type { ProviderPlan, ProviderStatus } from '@/types'

const QUOTE_STALE_MINUTES = 15

const quoteSchema = z.object({
  request_id: z.string().uuid(),
  proposed_price: z.number().min(1).max(50000),
})

type ProviderRow = {
  id: string
  status: ProviderStatus
  plan: ProviderPlan
}

type RequestRow = {
  id: string
  status: string
  problem_type: string
  location: { type: string; coordinates: [number, number] }
  destination_latitude: number | null
  destination_longitude: number | null
}

type SubmitQuoteResult = {
  success: boolean
  reason: string
  quote_id: string | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = quoteSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid quote details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`provider-quote:${user.id}`, 30, 60 * 1000, 'provider_submit_quote')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many quote attempts. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const onlineSince = new Date(Date.now() - QUOTE_STALE_MINUTES * 60 * 1000).toISOString()

  const [
    { data: profile },
    { data: provider },
    { data: providerLocation },
    { data: request },
  ] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).single(),
    admin.from('providers').select('id, status, plan').eq('id', user.id).single<ProviderRow>(),
    admin.from('provider_locations').select('latitude, longitude').eq('provider_id', user.id).gte('updated_at', onlineSince).maybeSingle<{ latitude: number; longitude: number }>(),
    admin.from('requests').select('id, status, problem_type, location, destination_latitude, destination_longitude').eq('id', parsed.data.request_id).single<RequestRow>(),
  ])

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can submit quotes' }, { status: 403 })
  }

  if (!provider || provider.status !== 'active') {
    return NextResponse.json({ error: 'Provider account must be active' }, { status: 403 })
  }

  if (!providerLocation) {
    return NextResponse.json({ error: 'Go online before submitting quotes' }, { status: 403 })
  }

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (!['open', 'quoted'].includes(request.status)) {
    return NextResponse.json({ error: 'Request is no longer accepting quotes' }, { status: 409 })
  }

  let computedDistanceKm = 0
  if (request.destination_latitude && request.destination_longitude) {
    const customerCoords: Coordinates = {
      lat: request.location.coordinates[1],
      lng: request.location.coordinates[0],
    }
    const destinationCoords: Coordinates = {
      lat: request.destination_latitude,
      lng: request.destination_longitude,
    }
    computedDistanceKm = Number(distanceKm(customerCoords, destinationCoords).toFixed(2))
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc('submit_quote_atomic', {
    p_provider_id: user.id,
    p_request_id: parsed.data.request_id,
    p_proposed_price: parsed.data.proposed_price,
    p_distance_km: computedDistanceKm,
    p_is_soft_launch: SOFT_LAUNCH_MODE,
  })

  const result = (rpcRows as SubmitQuoteResult[] | null)?.[0] ?? null

  if (rpcError || !result?.success) {
    const reason = result?.reason ?? rpcError?.message ?? 'unknown'

    logger.warn({
      event: 'submit_quote_failed',
      provider_id: user.id,
      request_id: parsed.data.request_id,
      reason,
    })

    const errorMessages: Record<string, { msg: string; status: number }> = {
      request_not_found: { msg: 'Request not found', status: 404 },
      request_not_quotable: { msg: 'Request is no longer accepting quotes', status: 409 },
      provider_not_active: { msg: 'Provider account must be active', status: 403 },
      already_quoted: { msg: 'You already submitted a quote for this request', status: 409 },
      capacity_full: { msg: 'Complete your active job before quoting', status: 409 },
      daily_limit_reached: { msg: 'Daily quote limit reached', status: 429 },
      price_too_low: { msg: 'Price is too low for this service', status: 422 },
      price_too_high: { msg: 'Price exceeds the acceptable range', status: 422 },
    }

    const mapped = errorMessages[reason]
    if (mapped) {
      return NextResponse.json({ error: mapped.msg, code: reason }, { status: mapped.status })
    }

    return NextResponse.json({ error: 'Unable to submit quote' }, { status: 500 })
  }

  logger.info({
    event: 'submit_quote_success',
    provider_id: user.id,
    request_id: parsed.data.request_id,
    quote_id: result.quote_id,
    proposed_price: parsed.data.proposed_price,
    distance_km: computedDistanceKm,
  })

  return NextResponse.json({
    success: true,
    quote_id: result.quote_id,
  })
}
