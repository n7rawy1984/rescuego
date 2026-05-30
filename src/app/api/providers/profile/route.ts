import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-user'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const providerProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(160),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = providerProfileSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider profile details' }, { status: 400 })
  }

  const { user, authError } = await getRequestUser(req)

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(`provider-register:${user.id}`, 5, 60 * 60 * 1000, 'provider_profile_create')
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

  if (existingUser?.role && existingUser.role !== 'provider') {
    return NextResponse.json({ error: 'This account is already registered with a different role.' }, { status: 409 })
  }

  const { error: userError } = await admin
    .from('users')
    .upsert({
      id: user.id,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      role: 'provider',
    })

  if (userError) {
    return NextResponse.json({ error: 'Failed to save provider account' }, { status: 500 })
  }

  const { data: existingProvider, error: existingProviderError } = await admin
    .from('providers')
    .select('id')
    .eq('id', user.id)
    .maybeSingle<{ id: string }>()

  if (existingProviderError) {
    return NextResponse.json({ error: 'Failed to check provider profile' }, { status: 500 })
  }

  if (!existingProvider) {
    const { error: providerError } = await admin
      .from('providers')
      .insert({
      id: user.id,
      plan: 'pay_per_job',
      status: 'pending',
      })

    if (providerError) {
      return NextResponse.json({ error: 'Failed to create provider profile' }, { status: 500 })
    }
  }

  return NextResponse.json({ id: user.id })
}
