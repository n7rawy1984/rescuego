import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { authorizeOpsRequest } from '@/lib/ops-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function handleWeeklySlaReset(req: NextRequest) {
  const unauthorized = authorizeOpsRequest(req)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()

  const results = {
    providers_reset: 0,
    visibility_reduced_count: 0,
    errors: [] as string[],
  }

  try {
    const { data: failingProviders, error: fetchError } = await supabase
      .from('providers')
      .select('id, sla_failure_count')
      .gt('sla_failure_count', 0)

    if (fetchError) {
      logger.error({ event: 'weekly_sla_reset_fetch_failed', error: fetchError.message })
      return NextResponse.json({ error: 'Failed to fetch providers' }, { status: 500 })
    }

    if (!failingProviders || failingProviders.length === 0) {
      logger.info({ event: 'weekly_sla_reset_complete', providers_reset: 0 })
      return NextResponse.json({ success: true, ...results })
    }

    const highFailureIds = failingProviders
      .filter((p) => p.sla_failure_count >= 3)
      .map((p) => p.id)

    if (highFailureIds.length > 0) {
      const { error: reduceError } = await supabase
        .from('providers')
        .update({ visibility_reduced: true })
        .in('id', highFailureIds)

      if (reduceError) {
        logger.error({ event: 'visibility_reduction_failed', error: reduceError.message })
        results.errors.push(`visibility_reduce: ${reduceError.message}`)
      } else {
        results.visibility_reduced_count = highFailureIds.length
      }
    }

    const { error: resetError } = await supabase
      .from('providers')
      .update({ sla_failure_count: 0 })
      .gt('sla_failure_count', 0)

    if (resetError) {
      logger.error({ event: 'sla_counter_reset_failed', error: resetError.message })
      results.errors.push(`counter_reset: ${resetError.message}`)
    } else {
      results.providers_reset = failingProviders.length
    }

    logger.info({
      event: 'weekly_sla_reset_complete',
      ...results,
    })

    return NextResponse.json({ success: true, ...results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logger.error({ event: 'weekly_sla_reset_exception', error: msg })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handleWeeklySlaReset(req)
}

export async function POST(req: NextRequest) {
  return handleWeeklySlaReset(req)
}
