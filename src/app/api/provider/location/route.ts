import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { isWithinUaeBounds, roundDispatchCoordinate } from '@/lib/geo'
import { logger } from '@/lib/logger'

const locationSchema = z.object({
  online: z.boolean(),
  coords: z
    .object({
      lng: z.number(),
      lat: z.number(),
    })
    .optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = locationSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid location payload' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`provider-location:${user.id}`, 20, 60 * 60 * 1000, 'provider_location_update')
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many location updates. Please wait before trying again.' }, { status: 429 })
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string | null }>()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can update dispatch availability' }, { status: 403 })
  }

  const { data: provider } = await admin
    .from('providers')
    .select('id, status')
    .eq('id', user.id)
    .single<{ id: string; status: string }>()

  if (!provider) {
    return NextResponse.json({ error: 'Provider profile not found' }, { status: 404 })
  }

  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Only active providers can go online for dispatch' }, { status: 403 })
  }

  if (!parsed.data.online) {
    const { error } = await admin
      .from('provider_locations')
      .delete()
      .eq('provider_id', user.id)

    if (error) {
      logger.error({ event: 'provider_location_offline_failed', provider_id: user.id, error: error.message })
      return NextResponse.json({ error: 'Failed to go offline' }, { status: 500 })
    }

    logger.info({ event: 'provider_dispatch_offline', provider_id: user.id })
    return NextResponse.json({ online: false })
  }

  if (!parsed.data.coords || !isWithinUaeBounds(parsed.data.coords)) {
    return NextResponse.json({ error: 'Location must be inside the UAE service area' }, { status: 400 })
  }

  const lng = roundDispatchCoordinate(parsed.data.coords.lng)
  const lat = roundDispatchCoordinate(parsed.data.coords.lat)
  const updatedAt = new Date().toISOString()
  const point = `POINT(${lng} ${lat})`

  const { error } = await admin
    .from('provider_locations')
    .upsert({
      provider_id: user.id,
      location: point,
      updated_at: updatedAt,
    }, { onConflict: 'provider_id' })

  if (error) {
    logger.error({ event: 'provider_location_update_failed', provider_id: user.id, error: error.message })
    return NextResponse.json({ error: 'Failed to update dispatch location' }, { status: 500 })
  }

  logger.info({ event: 'provider_dispatch_online', provider_id: user.id })
  return NextResponse.json({ online: true, updated_at: updatedAt })
}
