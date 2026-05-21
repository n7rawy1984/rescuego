import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const updateProviderSchema = z.object({
  provider_id: z.string().uuid(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  verified_badge: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = updateProviderSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider update' }, { status: 400 })
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

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: { status?: string; verified_badge?: boolean } = {}
  if (parsed.data.status) updates.status = parsed.data.status
  if (typeof parsed.data.verified_badge === 'boolean') updates.verified_badge = parsed.data.verified_badge

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('providers')
    .update(updates)
    .eq('id', parsed.data.provider_id)

  if (error) {
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
