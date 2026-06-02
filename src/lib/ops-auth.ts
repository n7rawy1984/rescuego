import { NextRequest, NextResponse } from 'next/server'
import { getOpsCronSecret } from '@/lib/env'
import { logger } from '@/lib/logger'

export function authorizeOpsRequest(req: NextRequest): NextResponse | null {
  const expectedSecret = getOpsCronSecret()

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

  if (bearerToken !== expectedSecret && headerToken !== expectedSecret) {
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
