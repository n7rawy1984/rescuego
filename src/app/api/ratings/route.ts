import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const ratingSchema = z.object({
  job_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
})

type RatingJobRow = {
  id: string
  provider_id: string
  completed_at: string | null
  requests: {
    customer_id: string | null
    status: string | null
  } | null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = ratingSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid rating details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customers can submit ratings' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: job } = await admin
    .from('jobs')
    .select('id, provider_id, completed_at, requests(customer_id, status)')
    .eq('id', parsed.data.job_id)
    .single<RatingJobRow>()

  if (!job || job.provider_id !== parsed.data.provider_id || job.requests?.customer_id !== user.id || job.requests?.status !== 'completed' || !job.completed_at) {
    return NextResponse.json({ error: 'This completed job cannot be rated' }, { status: 403 })
  }

  const { data: existing } = await admin
    .from('ratings')
    .select('id')
    .eq('job_id', parsed.data.job_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'This job has already been rated' }, { status: 409 })
  }

  const { error } = await admin
    .from('ratings')
    .insert({
      job_id: parsed.data.job_id,
      provider_id: parsed.data.provider_id,
      stars: parsed.data.stars,
      comment: parsed.data.comment || null,
    })

  if (error) {
    return NextResponse.json({ error: 'Failed to submit rating' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
