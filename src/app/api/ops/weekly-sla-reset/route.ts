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
    const { data, error: rpcError } = await supabase
      .rpc('weekly_sla_reset_atomic')

    if (rpcError) {
      logger.error({
        event: 'weekly_sla_reset_fetch_failed',
        error: rpcError.message,
      })
      return NextResponse.json(
        { error: 'Failed to reset SLA counters' },
        { status: 500 }
      )
    }

    const row = (data as { providers_reset: number
      visibility_reduced_count: number }[] | null)?.[0]

    results.providers_reset = row?.providers_reset ?? 0
    results.visibility_reduced_count =
      row?.visibility_reduced_count ?? 0

    logger.info({ event: 'weekly_sla_reset_complete', ...results })
    return NextResponse.json({ success: true, ...results })

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logger.error({ event: 'weekly_sla_reset_exception', error: msg })
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return handleWeeklySlaReset(req)
}

export async function POST(req: NextRequest) {
  return handleWeeklySlaReset(req)
}
