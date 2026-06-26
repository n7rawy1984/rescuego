import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { KycAction, ProviderStatus } from '@/types'

const KYC_STATUS_TO_ACTION: Partial<Record<ProviderStatus, KycAction>> = {
  active: 'approved',
  rejected: 'rejected',
  suspended: 'suspended',
  under_review: 'under_review',
  pending: 'under_review',
}

const updateProviderSchema = z.object({
  provider_id: z.string().uuid(),
  status: z.enum(['pending', 'under_review', 'active', 'rejected', 'suspended']).optional(),
  verified_badge: z.boolean().optional(),
  review_notes: z.string().max(1000).optional(),
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

  // M1: rate-limit this admin route (30 requests / 60s per admin) to bound abuse and
  // accidental tight loops. Keyed by admin id so one admin cannot exhaust another's budget.
  const rateLimit = await checkRateLimitAsync(`admin-provider-update:${user.id}`, 30, 60_000, 'admin_provider_update')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const updates: { status?: string; verified_badge?: boolean } = {}
  if (parsed.data.status) updates.status = parsed.data.status
  if (typeof parsed.data.verified_badge === 'boolean') updates.verified_badge = parsed.data.verified_badge

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: targetProvider, error: targetProviderError } = await admin
    .from('providers')
    .select('id, status, users(role)')
    .eq('id', parsed.data.provider_id)
    .maybeSingle<{ id: string; status: ProviderStatus; users: { role: string | null } | null }>()

  if (targetProviderError) {
    logger.error({
      event: 'admin_provider_update_target_lookup_failed',
      admin_id: user.id,
      provider_id: parsed.data.provider_id,
      error: targetProviderError.message,
    })
    return NextResponse.json({ error: 'Failed to verify provider account' }, { status: 500 })
  }

  if (!targetProvider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  if (targetProvider.users?.role !== 'provider') {
    logger.warn({
      event: 'admin_provider_update_role_mismatch_blocked',
      admin_id: user.id,
      provider_id: parsed.data.provider_id,
      user_role: targetProvider.users?.role ?? null,
    })
    return NextResponse.json({ error: 'Provider account role mismatch' }, { status: 409 })
  }

  // H5: the status/verified_badge change AND the audit-log insert happen atomically
  // inside admin_update_provider_status_atomic (migration 041). Either both commit or both
  // roll back — the status can never change without its audit trail. The RPC is narrow:
  // it writes ONLY status/verified_badge (each applied only when non-null) plus the log row.
  const action: KycAction = parsed.data.status
    ? (KYC_STATUS_TO_ACTION[parsed.data.status as ProviderStatus] ?? 'under_review')
    : 'under_review'

  const { data: rpcRows, error } = await admin.rpc('admin_update_provider_status_atomic', {
    p_admin_id: user.id,
    p_provider_id: parsed.data.provider_id,
    p_new_status: parsed.data.status ?? null,
    p_verified_badge: typeof parsed.data.verified_badge === 'boolean' ? parsed.data.verified_badge : null,
    p_review_notes: parsed.data.review_notes ?? null,
    p_previous_status: targetProvider.status,
    p_action: action,
  })

  const result = (rpcRows as { success: boolean; reason: string }[] | null)?.[0] ?? null

  if (error || !result?.success) {
    logger.error({
      event: 'admin_provider_update_failed',
      admin_id: user.id,
      provider_id: parsed.data.provider_id,
      attempted_status: parsed.data.status,
      attempted_verified_badge: parsed.data.verified_badge,
      reason: result?.reason ?? error?.message ?? 'unknown',
    })

    if (result?.reason === 'provider_not_found') {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 })
  }

  logger.info({
    event: 'admin_provider_updated',
    admin_id: user.id,
    provider_id: parsed.data.provider_id,
    previous_status: targetProvider.status,
    new_status: parsed.data.status,
    verified_badge: parsed.data.verified_badge,
  })

  return NextResponse.json({ success: true })
}
