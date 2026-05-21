import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ProviderPlan, ProviderStatus } from '@/types'

const acceptSchema = z.object({
  request_id: z.string().uuid(),
})

type ProviderRow = {
  id: string
  status: ProviderStatus
  plan: ProviderPlan
  jobs_this_month: number
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = acceptSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
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

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can accept requests' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: provider, error: providerError } = await admin
    .from('providers')
    .select('id, status, plan, jobs_this_month')
    .eq('id', user.id)
    .single<ProviderRow>()

  if (providerError || !provider) {
    return NextResponse.json({ error: 'Provider profile not found' }, { status: 404 })
  }

  if (provider.status !== 'active') {
    return NextResponse.json({ error: 'Your provider account must be active before accepting requests' }, { status: 403 })
  }

  const { data: activeJob } = await admin
    .from('requests')
    .select('id')
    .eq('accepted_by', user.id)
    .in('status', ['accepted', 'in_progress'])
    .limit(1)
    .maybeSingle()

  if (activeJob) {
    return NextResponse.json({ error: 'Complete your active job before accepting another request' }, { status: 409 })
  }

  const { data: updatedRequest, error: requestError } = await admin
    .from('requests')
    .update({ status: 'accepted', accepted_by: user.id })
    .eq('id', parsed.data.request_id)
    .eq('status', 'open')
    .select('id')
    .single()

  if (requestError || !updatedRequest) {
    return NextResponse.json({ error: 'Request is no longer available' }, { status: 409 })
  }

  await Promise.all([
    admin
      .from('providers')
      .update({ jobs_this_month: provider.jobs_this_month + 1 })
      .eq('id', user.id),
    admin
      .from('jobs')
      .upsert({
        request_id: parsed.data.request_id,
        provider_id: user.id,
      }, { onConflict: 'request_id' }),
  ])

  return NextResponse.json({ success: true, request_id: parsed.data.request_id })
}
