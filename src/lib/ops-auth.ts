import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getOpsCronSecret } from '@/lib/env'
import { logger } from '@/lib/logger'

// P4-M6: any secret used to authenticate an ops/cron route must be at least this long.
// OPS_CRON_SECRET is already enforced to >=32 chars in env.ts; the Vercel-managed CRON_SECRET
// was previously trusted with no length check, so a short/predictable value could authenticate.
const MIN_OPS_SECRET_LENGTH = 32

// Constant-time comparison so a wrong secret cannot be discovered via response-timing analysis.
function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function authorizeOpsRequest(req: NextRequest): NextResponse | null {
  const expectedSecret = getOpsCronSecret()

  // Fail-closed: a missing/empty ops secret can never authenticate.
  if (!expectedSecret) {
    logger.error({
      event: 'ops_route_secret_missing',
      path: req.nextUrl.pathname,
    })
    return NextResponse.json({ error: 'Operations secret is not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  const headerToken = req.headers.get('x-ops-secret')

  // P4-M6: only honor Vercel's CRON_SECRET if it meets the same minimum strength as OPS_CRON_SECRET.
  // A short/predictable CRON_SECRET is treated as not configured (fail-closed) and logged.
  const rawVercelCronSecret = process.env.CRON_SECRET ?? null
  let vercelCronSecret: string | null = rawVercelCronSecret
  if (rawVercelCronSecret && rawVercelCronSecret.length < MIN_OPS_SECRET_LENGTH) {
    logger.warn({
      event: 'ops_route_weak_cron_secret',
      path: req.nextUrl.pathname,
      length: rawVercelCronSecret.length,
    })
    vercelCronSecret = null
  }

  const isVercelCron = vercelCronSecret !== null && secretsMatch(bearerToken, vercelCronSecret)
  const isOpsSecret = secretsMatch(bearerToken, expectedSecret) || secretsMatch(headerToken, expectedSecret)

  if (!isVercelCron && !isOpsSecret) {
    logger.warn({
      event: 'ops_route_unauthorized',
      path: req.nextUrl.pathname,
      has_bearer: Boolean(bearerToken),
      has_ops_header: Boolean(headerToken),
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
