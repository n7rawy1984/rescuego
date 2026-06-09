import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { distanceKm, type Coordinates } from '@/lib/geo'
import { computeProviderScore, computeAcceptanceRate, getMaxRingDistanceKm } from '@/lib/provider-score'
import { computePriceRange } from '@/lib/range-estimator'
import type { FairPriceConfig } from '@/types'

type QuoteRow = {
  id: string
  provider_id: string
  proposed_price: number
  status: string
  sent_at: string
  expires_at: string
}

type ProviderData = {
  id: string
  rating: number
  plan: string
  verified_badge: boolean
  jobs_this_month: number
}

type ProviderLocationRow = {
  provider_id: string
  latitude: number
  longitude: number
}

type ScoredQuote = {
  id: string
  proposed_price: number
  expires_at: string
  provider_anonymous_id: string
  provider_rating: number
  provider_verified: boolean
  distance_km: number
  score: number
  sent_at: string
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('request_id')

  if (!requestId) {
    return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-quotes:${user.id}`, 60, 60 * 1000, 'customer_get_quotes')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const { data: request } = await admin
    .from('requests')
    .select('id, customer_id, status, problem_type, location, destination_latitude, destination_longitude, quoted_at')
    .eq('id', requestId)
    .single<{
      id: string
      customer_id: string
      status: string
      problem_type: string
      location: { type: string; coordinates: [number, number] }
      destination_latitude: number | null
      destination_longitude: number | null
      quoted_at: string | null
    }>()

  if (!request || request.customer_id !== user.id) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (request.status !== 'quoted') {
    return NextResponse.json({ data: [], count: 0 })
  }

  const { data: quotes } = await admin
    .from('request_quotes')
    .select('id, provider_id, proposed_price, status, sent_at, expires_at')
    .eq('request_id', requestId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('sent_at', { ascending: true })
    .limit(20)

  if (!quotes || quotes.length === 0) {
    return NextResponse.json({ data: [], count: 0 })
  }

  const providerIds = quotes.map((q: QuoteRow) => q.provider_id)

  const [
    { data: providers },
    { data: providerLocations },
    { data: fairPriceConfig },
  ] = await Promise.all([
    admin.from('providers').select('id, rating, plan, verified_badge, jobs_this_month').in('id', providerIds),
    admin.from('provider_locations').select('provider_id, latitude, longitude').in('provider_id', providerIds),
    admin.from('fair_price_config').select('*').eq('service_type', request.problem_type).single<FairPriceConfig>(),
  ])

  const providerMap = new Map<string, ProviderData>()
  if (providers) {
    for (const p of providers as ProviderData[]) {
      providerMap.set(p.id, p)
    }
  }

  const locationMap = new Map<string, ProviderLocationRow>()
  if (providerLocations) {
    for (const loc of providerLocations as ProviderLocationRow[]) {
      locationMap.set(loc.provider_id, loc)
    }
  }

  const requestCoords: Coordinates = {
    lat: request.location.coordinates[1],
    lng: request.location.coordinates[0],
  }

  let serviceDistanceKm = 0
  if (request.destination_latitude && request.destination_longitude) {
    serviceDistanceKm = distanceKm(requestCoords, {
      lat: request.destination_latitude,
      lng: request.destination_longitude,
    })
  }

  const fallbackConfig: FairPriceConfig = fairPriceConfig ?? {
    id: '',
    service_type: 'other',
    min_price_per_km: 2,
    max_price_per_km: 6,
    base_fee: 80,
    quote_validity_minutes: 10,
    created_at: '',
    updated_at: '',
  }

  const priceRange = computePriceRange(fallbackConfig, serviceDistanceKm)

  const scoredQuotes: ScoredQuote[] = []

  for (const quote of quotes as QuoteRow[]) {
    const provider = providerMap.get(quote.provider_id)
    const location = locationMap.get(quote.provider_id)

    if (!provider) continue

    let providerDistanceKm = 20
    if (location) {
      providerDistanceKm = distanceKm(requestCoords, { lat: location.latitude, lng: location.longitude })
    }

    const scoreResult = computeProviderScore({
      rating: provider.rating ?? 4.0,
      completedJobs: provider.jobs_this_month ?? 0,
      distanceKm: providerDistanceKm,
      maxRingDistanceKm: getMaxRingDistanceKm(4),
      proposedPrice: quote.proposed_price,
      minFairPrice: priceRange.minFairPrice,
      maxFairPrice: priceRange.maxFairPrice,
      acceptanceRate: computeAcceptanceRate(provider.jobs_this_month ?? 0, (provider.jobs_this_month ?? 0) + 1),
    })

    const anonymousId = quote.provider_id.slice(0, 4).toUpperCase()

    scoredQuotes.push({
      id: quote.id,
      proposed_price: quote.proposed_price,
      expires_at: quote.expires_at,
      provider_anonymous_id: anonymousId,
      provider_rating: provider.rating ?? 4.0,
      provider_verified: provider.verified_badge ?? false,
      distance_km: Number(providerDistanceKm.toFixed(1)),
      score: scoreResult.totalScore,
      sent_at: quote.sent_at,
    })
  }

  scoredQuotes.sort((a, b) => b.score - a.score)

  const top5 = scoredQuotes.slice(0, 5)

  return NextResponse.json({
    data: top5,
    count: top5.length,
    price_range: {
      min: priceRange.minFairPrice,
      max: priceRange.maxFairPrice,
    },
    quoted_at: request.quoted_at,
  })
}
