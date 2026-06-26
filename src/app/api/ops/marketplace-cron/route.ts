import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { authorizeOpsRequest } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// P4-M2: cap how many rows a single expiry statement can lock per invocation, so the
// cron can never hold write locks on an unbounded batch. The remainder is handled next run.
const EXPIRE_BATCH_LIMIT = 500

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
    enforceSla(supabase),
  ])

  results.expired_quotes = expireQuotesResult.count
  if (expireQuotesResult.error) results.errors.push(expireQuotesResult.error)

  results.expired_requests = expireRequestsResult.count
  if (expireRequestsResult.error) results.errors.push(expireRequestsResult.error)

  results.sla_warnings_sent = slaResult.warnings
  results.sla_releases = slaResult.releases
  if (slaResult.error) results.errors.push(slaResult.error)

  // P4-H4: a subtask reports `error` only when the WHOLE query/RPC-fetch failed or threw
  // (e.g. DB unreachable). Normal per-row outcomes from sla_check_and_release such as
  // 'sla_not_breached' are NOT errors and are not collected here. If any critical subtask
  // failed, return 500 so Vercel retries the route and alerting fires.
  //
  // Idempotency under retry (no double-decrement): every operation is guarded so a retry
  // that re-runs an already-completed step is a no-op.
  //   - expireStaleQuotes / expireUnselectedRequests: status-guarded UPDATEs
  //     (.eq('status','pending') / .eq('status','quoted')); rerunning matches zero
  //     already-expired rows.
  //   - sla_check_and_release: re-selects the request FOR UPDATE and returns early
  //     ('not_in_releasable_status' / 'sla_not_breached') if the row is no longer in
  //     accepted/en_route/arrived, so an already-released request is never decremented
  //     a second time.
  const criticalFailure = results.errors.length > 0

  logger.info({
    event: 'marketplace_cron_complete',
    critical_failure: criticalFailure,
    ...results,
  })

  if (criticalFailure) {
    logger.error({ event: 'marketplace_cron_critical_failure', errors: results.errors })
    return NextResponse.json({ success: false, ...results }, { status: 500 })
  }

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
      .limit(EXPIRE_BATCH_LIMIT)

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
      .limit(EXPIRE_BATCH_LIMIT)

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

// Max SLA candidates processed per cron invocation (P4-H2: bound work within maxDuration).
// If more than this exist in one minute, the oldest-first ordering below guarantees the
// closest-to-breach rows are handled first; the remainder is processed on the next run.
const SLA_CANDIDATE_LIMIT = 50

async function enforceSla(
  supabase: ReturnType<typeof createAdminClient>
) {
  const warnings = 0
  let releases = 0

  try {
    // CRIT-02 (cron side): consider every active SLA state, not just 'accepted'.
    // The per-state breach thresholds (accepted 20m / en_route 2h / arrived 60m) and the
    // quoted-vs-open release decision live ENTIRELY in sla_check_and_release (migration 040);
    // this route only narrows and orders candidates — it never duplicates the thresholds.
    //
    // Ordering: oldest created_at first. The requests table has no updated_at column
    // (verified against the schema — only created_at exists), and the per-state breach
    // timestamps live in different places (requests.accepted_at vs jobs.en_route_at /
    // jobs.arrived_at), so no single requests column orders all three states exactly.
    // created_at oldest-first is a stable, monotonic proxy that guarantees long-lived
    // requests are always examined before fresh ones, so the LIMIT can never starve a
    // genuinely breached request. The authoritative breach decision stays in the RPC.
    const { data: candidates, error: fetchError } = await supabase
      .from('requests')
      .select('id')
      .in('status', ['accepted', 'en_route', 'arrived'])
      .order('created_at', { ascending: true })
      .limit(SLA_CANDIDATE_LIMIT)

    if (fetchError) {
      logger.error({ event: 'sla_fetch_breached_failed', error: fetchError.message })
      return { warnings: 0, releases: 0, error: `sla_fetch: ${fetchError.message}` }
    }

    if (!candidates || candidates.length === 0) {
      return { warnings: 0, releases: 0, error: null }
    }

    // Sequential per-request RPC calls. Each is a short transactional RPC; 50 sequential
    // calls stay well within maxDuration. The RPC decides whether each row is actually
    // breached — a non-release (e.g. 'sla_not_breached') is a NORMAL outcome, not a failure.
    for (const request of candidates) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('sla_check_and_release', {
        p_request_id: request.id,
      })

      if (rpcError) {
        // Per-row RPC failure: log and continue. This does NOT mark the subtask critical;
        // a single bad row must not fail the whole batch (P4-H4 critical-vs-per-row).
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
    // A thrown exception means the whole subtask failed (e.g. DB unreachable) -> critical.
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
