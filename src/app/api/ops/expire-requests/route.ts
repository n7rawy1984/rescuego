import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { notificationEvents } from '@/lib/notifications'
import { authorizeOpsRequest } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const REQUEST_EXPIRY_HOURS = Number(process.env.OPS_REQUEST_EXPIRY_HOURS) || 2
const STUCK_JOB_HOURS = Number(process.env.OPS_STUCK_JOB_HOURS) || 3
const WEBHOOK_STUCK_PROCESSING_MS = 10 * 60 * 1000

async function handleExpireRequests(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const cutoff = new Date(Date.now() - REQUEST_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
  const stuckCutoff = new Date(Date.now() - STUCK_JOB_HOURS * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()

  const [
    { data: expireData, error: expireError },
    { data: stuckJobsData, error: stuckJobsError },
    { data: stuckData, error: stuckError },
  ] = await Promise.all([
    supabase.rpc('expire_stale_open_requests', { p_cutoff: cutoff }),
    supabase.rpc('expire_stuck_active_requests', { p_stuck_cutoff: stuckCutoff }),
    supabase
      .from('stripe_events')
      .update({ status: 'failed', error_message: 'Stuck in processing — cleared by ops cron', updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .lt('processing_started_at', new Date(Date.now() - WEBHOOK_STUCK_PROCESSING_MS).toISOString())
      .select('id'),
  ])

  if (expireError) {
    logger.error({ event: 'request_expiry_failed', error: expireError.message })
    return NextResponse.json({ error: 'Failed to expire stale requests' }, { status: 500 })
  }

  if (stuckJobsError) {
    logger.warn({ event: 'stuck_job_auto_release_failed', error: stuckJobsError.message })
  }

  if (stuckError) {
    logger.warn({ event: 'stripe_stuck_webhook_cleanup_failed', error: stuckError.message })
  }

  const expiredCount = typeof expireData === 'number' ? expireData : 0
  const stuckJobsReleased = typeof stuckJobsData === 'number' ? stuckJobsData : 0
  const stuckCleared = Array.isArray(stuckData) ? stuckData.length : 0

  if (stuckJobsReleased > 0) {
    logger.warn({
      event: 'stuck_jobs_auto_released',
      released_count: stuckJobsReleased,
      stuck_hours: STUCK_JOB_HOURS,
    })
  }

  if (stuckCleared > 0) {
    logger.warn({
      event: 'stripe_stuck_webhooks_cleared',
      cleared_count: stuckCleared,
      ids: stuckData?.map((r: { id: string }) => r.id),
    })
  }

  logger.info({
    event: notificationEvents.requestExpired,
    expired_count: expiredCount,
    cutoff,
    expiry_hours: REQUEST_EXPIRY_HOURS,
    stuck_jobs_released: stuckJobsReleased,
    stuck_webhooks_cleared: stuckCleared,
  })

  return NextResponse.json({
    success: true,
    expired_count: expiredCount,
    cutoff,
    expiry_hours: REQUEST_EXPIRY_HOURS,
    stuck_jobs_released: stuckJobsReleased,
    stuck_job_hours: STUCK_JOB_HOURS,
    stuck_webhooks_cleared: stuckCleared,
  })
}

export async function GET(req: NextRequest) {
  return handleExpireRequests(req)
}

export async function POST(req: NextRequest) {
  return handleExpireRequests(req)
}
