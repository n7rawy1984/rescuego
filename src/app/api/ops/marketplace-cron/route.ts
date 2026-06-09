import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { authorizeOpsRequest } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function handleMarketplaceCron(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()
  const now = new Date()

  const results = {
    expired_quotes: 0,
    expired_requests: 0,
    sla_warnings_sent: 0,
    sla_releases: 0,
    errors: [] as string[],
  }

  const [expireQuotesResult, expireRequestsResult, slaResult] = await Promise.all([
    expireStaleQuotes(supabase),
    expireUnselectedRequests(supabase, now),
    enforceSla(supabase, now),
  ])

  results.expired_quotes = expireQuotesResult.count
  if (expireQuotesResult.error) results.errors.push(expireQuotesResult.error)

  results.expired_requests = expireRequestsResult.count
  if (expireRequestsResult.error) results.errors.push(expireRequestsResult.error)

  results.sla_warnings_sent = slaResult.warnings
  results.sla_releases = slaResult.releases
  if (slaResult.error) results.errors.push(slaResult.error)

  logger.info({
    event: 'marketplace_cron_complete',
    ...results,
  })

  return NextResponse.json({ success: true, ...results })
}

async function expireStaleQuotes(supabase: ReturnType<typeof createAdminClient>) {
  try {
    const { data, error } = await supabase
      .from('request_quotes')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select('id')

    if (error) {
      logger.error({ event: 'expire_quotes_failed', error: error.message })
      return { count: 0, error: `expire_quotes: ${error.message}` }
    }

    const count = data?.length ?? 0
    if (count > 0) {
      logger.info({ event: 'quotes_expired', count })
    }
    return { count, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { count: 0, error: `expire_quotes_exception: ${msg}` }
  }
}

async function expireUnselectedRequests(
  supabase: ReturnType<typeof createAdminClient>,
  now: Date
) {
  const cutoffMs = 20 * 60 * 1000
  const cutoff = new Date(now.getTime() - cutoffMs).toISOString()

  try {
    const { data, error } = await supabase
      .from('requests')
      .update({ status: 'expired' })
      .eq('status', 'quoted')
      .lt('quoted_at', cutoff)
      .select('id')

    if (error) {
      logger.error({ event: 'expire_unselected_requests_failed', error: error.message })
      return { count: 0, error: `expire_requests: ${error.message}` }
    }

    const count = data?.length ?? 0
    if (count > 0) {
      logger.info({ event: 'unselected_requests_expired', count, cutoff })
    }
    return { count, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { count: 0, error: `expire_requests_exception: ${msg}` }
  }
}

async function enforceSla(
  supabase: ReturnType<typeof createAdminClient>,
  now: Date
) {
  const slaDeadlineMs = 20 * 60 * 1000
  const slaDeadlineCutoff = new Date(now.getTime() - slaDeadlineMs).toISOString()

  const warnings = 0
  let releases = 0

  try {
    const { data: breachedRequests, error: fetchError } = await supabase
      .from('requests')
      .select('id, accepted_at')
      .eq('status', 'accepted')
      .not('accepted_at', 'is', null)
      .lt('accepted_at', slaDeadlineCutoff)
      .limit(50)

    if (fetchError) {
      logger.error({ event: 'sla_fetch_breached_failed', error: fetchError.message })
      return { warnings: 0, releases: 0, error: `sla_fetch: ${fetchError.message}` }
    }

    if (!breachedRequests || breachedRequests.length === 0) {
      return { warnings: 0, releases: 0, error: null }
    }

    for (const request of breachedRequests) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('sla_check_and_release', {
        p_request_id: request.id,
      })

      if (rpcError) {
        logger.error({ event: 'sla_release_rpc_error', request_id: request.id, error: rpcError.message })
        continue
      }

      const rows = rpcResult as { success: boolean; reason: string; released_provider_id: string | null; needs_refund: boolean }[] | null
      const result = rows?.[0]

      if (result?.success) {
        releases++
        logger.warn({
          event: 'sla_auto_release',
          request_id: request.id,
          provider_id: result.released_provider_id,
          needs_refund: result.needs_refund,
        })
      }
    }

    return { warnings, releases, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { warnings: 0, releases: 0, error: `sla_exception: ${msg}` }
  }
}

export async function GET(req: NextRequest) {
  return handleMarketplaceCron(req)
}

export async function POST(req: NextRequest) {
  return handleMarketplaceCron(req)
}
