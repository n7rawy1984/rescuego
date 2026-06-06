import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-user'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const providerPlanSchema = z.object({
  plan: z.literal('pay_per_job'),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = providerPlanSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider plan' }, { status: 400 })
  }

  const { user, authError } = await getRequestUser(req)

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`plan-update:${user.id}`, 10, 60 * 60 * 1000, 'provider_plan_update')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many plan update attempts. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only providers can update plan selection' }, { status: 403 })
  }

  const { error } = await admin
    .from('providers')
    .update({ plan: parsed.data.plan })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to update provider plan' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
