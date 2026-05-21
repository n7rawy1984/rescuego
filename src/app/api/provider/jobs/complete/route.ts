import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const completeJobSchema = z.object({
  request_id: z.string().uuid(),
  final_price: z.number().int().min(1).max(10000),
})

type JobRow = {
  id: string
  request_id: string
  provider_id: string
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

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can complete jobs' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: request } = await admin
    .from('requests')
    .select('id, accepted_by, status')
    .eq('id', parsed.data.request_id)
    .single()

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

  const completedAt = new Date().toISOString()

  await Promise.all([
    admin
      .from('requests')
      .update({ status: 'completed', final_price: parsed.data.final_price })
      .eq('id', parsed.data.request_id),
    admin
      .from('jobs')
      .update({
        commission_rate: 0,
        commission_amount: 0,
        completed_at: completedAt,
      })
      .eq('id', job.id),
  ])

  return NextResponse.json({ success: true, job_id: job.id })
}
