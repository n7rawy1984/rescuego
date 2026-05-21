import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ProblemType } from '@/types'

const PRICE_ESTIMATES: Record<ProblemType, { min: number; max: number }> = {
  flat_tire: { min: 80, max: 200 },
  battery: { min: 100, max: 250 },
  tow: { min: 200, max: 800 },
  other: { min: 150, max: 500 },
}

const requestSchema = z.object({
  problem_type: z.enum(['flat_tire', 'battery', 'tow', 'other']),
  location_address: z.string().trim().min(3).max(300),
  note: z.string().trim().max(500).optional().nullable(),
  coords: z
    .object({
      lng: z.number().min(51).max(57),
      lat: z.number().min(22).max(27),
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

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can submit recovery requests' }, { status: 403 })
  }

  const { problem_type, location_address, note, coords } = parsed.data
  const estimates = PRICE_ESTIMATES[problem_type]
  const point = coords ? `POINT(${coords.lng} ${coords.lat})` : 'POINT(55.2708 25.2048)'

  const { data, error } = await supabase
    .from('requests')
    .insert({
      customer_id: user.id,
      location: point,
      location_address,
      problem_type,
      note: note || null,
      price_estimate_min: estimates.min,
      price_estimate_max: estimates.max,
      status: 'open',
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
