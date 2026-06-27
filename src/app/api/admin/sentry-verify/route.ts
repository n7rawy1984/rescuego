import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const VERIFICATION_MESSAGE = 'RescueGo Sentry verification event'

export async function POST() {
  if (process.env.SENTRY_VERIFICATION_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Sentry verification is disabled' }, { status: 404 })
  }

  if (!process.env.SENTRY_DSN) {
    return NextResponse.json({ error: 'Sentry DSN is not configured' }, { status: 503 })
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

  // M1 follow-up (closes the last admin route without rate limiting). SOFT mode, admin key —
  // matches the pattern added to admin/providers/update in Batch 3.
  const rateLimit = await checkRateLimitAsync(`admin-sentry-verify:${user.id}`, 30, 60 * 1000, 'admin_sentry_verify')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const eventId = Sentry.captureMessage(VERIFICATION_MESSAGE, {
    level: 'info',
    tags: {
      verification: 'sentry',
      app: 'rescuego',
    },
    extra: {
      source: 'admin_sentry_verify_route',
    },
  })

  await Sentry.flush(2000)

  logger.info({
    event: 'sentry_verification_event_sent',
    admin_id: user.id,
    sentry_event_id: eventId,
  })

  return NextResponse.json({
    success: true,
    message: VERIFICATION_MESSAGE,
    event_id: eventId,
  })
}
