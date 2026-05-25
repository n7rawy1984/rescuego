import { NextRequest, NextResponse } from 'next/server'
import { getOpsCronSecret } from '@/lib/env'

export function authorizeOpsRequest(req: NextRequest): NextResponse | null {
  const expectedSecret = getOpsCronSecret()

  if (!expectedSecret) {
    return NextResponse.json({ error: 'Operations secret is not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  const headerToken = req.headers.get('x-ops-secret')

  if (bearerToken !== expectedSecret && headerToken !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
