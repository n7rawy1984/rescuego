import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

type CompletedJobRow = {
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
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can view pending ratings' }, { status: 403 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-unrated-jobs:${user.id}`, 30, 60 * 1000, 'customer_unrated_jobs', 'soft')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()
  const { data: completedJobs } = await admin
    .from('jobs')
    .select('id, requests!inner(customer_id)')
    .eq('requests.customer_id', user.id)
    .not('completed_at', 'is', null)
    .returns<CompletedJobRow[]>()

  const jobIds = (completedJobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }

  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))
  const count = jobIds.filter((jobId) => !ratedJobIds.has(jobId)).length

  return NextResponse.json({ count })
}
