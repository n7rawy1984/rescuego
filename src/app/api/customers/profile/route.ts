import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const customerProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(160),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = customerProfileSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid customer profile details' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`customer-register:${user.id}`, 5, 60 * 60 * 1000, 'customer_profile_create')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  if (user.email && user.email.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return NextResponse.json({ error: 'Email does not match the authenticated account' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: existingUser, error: existingUserError } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (existingUserError) {
    return NextResponse.json({ error: 'Failed to check account status' }, { status: 500 })
  }

  if (existingUser?.role && existingUser.role !== 'customer') {
    return NextResponse.json({ error: 'This account is already registered with a different role.' }, { status: 409 })
  }

  const { error } = await admin
    .from('users')
    .upsert({
      id: user.id,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      role: 'customer',
    })

  if (error) {
    return NextResponse.json({ error: 'Failed to save customer account' }, { status: 500 })
  }

  return NextResponse.json({ id: user.id })
}
