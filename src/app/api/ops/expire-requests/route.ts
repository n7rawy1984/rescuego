import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { notificationEvents } from '@/lib/notifications'
import { authorizeOpsRequest } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const REQUEST_EXPIRY_HOURS = 2

async function handleExpireRequests(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const cutoff = new Date(Date.now() - REQUEST_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('expire_stale_open_requests', {
    p_cutoff: cutoff,
  })

  if (error) {
    logger.error({
      event: 'request_expiry_failed',
      error: error.message,
    })
    return NextResponse.json({ error: 'Failed to expire stale requests' }, { status: 500 })
  }

  const expiredCount = typeof data === 'number' ? data : 0

  logger.info({
    event: notificationEvents.requestExpired,
    expired_count: expiredCount,
    cutoff,
    expiry_hours: REQUEST_EXPIRY_HOURS,
  })

  return NextResponse.json({
    success: true,
    expired_count: expiredCount,
    cutoff,
    expiry_hours: REQUEST_EXPIRY_HOURS,
  })
}

export async function GET(req: NextRequest) {
  return handleExpireRequests(req)
}

export async function POST(req: NextRequest) {
  return handleExpireRequests(req)
}
