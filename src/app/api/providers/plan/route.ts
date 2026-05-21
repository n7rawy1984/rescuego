import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const providerPlanSchema = z.object({
  plan: z.literal('pay_per_job'),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = providerPlanSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider plan' }, { status: 400 })
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
    return NextResponse.json({ error: 'Only providers can update plan selection' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('providers')
    .update({ plan: parsed.data.plan })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to update provider plan' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
