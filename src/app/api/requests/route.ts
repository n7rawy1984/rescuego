import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { roundDispatchCoordinate, UAE_BOUNDS } from '@/lib/geo'

const requestSchema = z.object({
  problem_type: z.enum(['flat_tire', 'battery', 'tow', 'other']),
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

  const rateLimit = checkRateLimit(`customer-request:${user.id}`, 10, 60 * 60 * 1000)
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
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can submit recovery requests' }, { status: 403 })
  }

  const { problem_type, location_address, note, coords } = parsed.data
  const point = coords
    ? `POINT(${roundDispatchCoordinate(coords.lng)} ${roundDispatchCoordinate(coords.lat)})`
    : 'POINT(55.2708 25.2048)'

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
