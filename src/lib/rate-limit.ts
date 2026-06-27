import 'server-only'
import { logger } from '@/lib/logger'

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  allowed: boolean
  retryAfter: number
}

/**
 * Fallback behavior when Upstash/Redis is unavailable:
 *   - 'soft'  (default): degrade to per-instance in-memory limiting and ALLOW the request.
 *             Correct for GET/polling/admin routes — a brief loss of global limiting is
 *             preferable to denying legitimate traffic.
 *   - 'hard'  : fail-closed (DENY) when Redis is unavailable. Reserved for payment-critical
 *             routes where the cost of an unmetered request is high. Capability only — not
 *             wired into any payment route yet (deferred to a dedicated payment pass).
 */
export type RateLimitMode = 'soft' | 'hard'

const buckets = new Map<string, RateLimitEntry>()

// P4-M4 / H4: the previous boolean silenced the Redis-unavailable warning for the entire
// lifetime of an instance, so a degraded fleet became invisible after the first log. Replace
// it with a time-throttled timestamp so the warning re-fires periodically (per instance) while
// Redis stays down, restoring operational visibility without log-flooding.
const FALLBACK_LOG_THROTTLE_MS = 60_000
let lastFallbackLogAt = 0

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfter: 0 }
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  buckets.set(key, existing)

  return { allowed: true, retryAfter: 0 }
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

function fallbackRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  reason: string,
  mode: RateLimitMode
): RateLimitResult {
  const now = Date.now()
  if (now - lastFallbackLogAt >= FALLBACK_LOG_THROTTLE_MS) {
    lastFallbackLogAt = now
    logger.warn({
      event:
        mode === 'hard'
          ? 'rate_limit_redis_unavailable_hard_fail'
          : 'rate_limit_redis_unavailable_in_memory_fallback',
      reason,
      mode,
      environment: process.env.NODE_ENV,
    })
  }

  // HARD mode: fail-closed for payment-critical routes — deny when Redis is unavailable.
  if (mode === 'hard') {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) }
  }

  // SOFT mode (default): per-instance in-memory limiting so legitimate traffic is not blocked.
  return checkRateLimit(key, limit, windowMs)
}

async function checkUpstashRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  endpoint: string,
  mode: RateLimitMode
): Promise<RateLimitResult> {
  const config = redisConfig()
  if (!config) {
    return fallbackRateLimit(key, limit, windowMs, 'upstash_env_missing', mode)
  }

  const redisKey = `rescuego:rate-limit:${key}`

  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, windowMs, 'NX'],
        ['PTTL', redisKey],
      ]),
      cache: 'no-store',
    })

    if (!response.ok) {
      logger.warn({
        event: 'rate_limit_redis_unavailable',
        endpoint,
        status: response.status,
      })
      return fallbackRateLimit(key, limit, windowMs, 'upstash_http_error', mode)
    }

    const results = await response.json() as Array<{ result?: unknown; error?: string }>
    const count = Number(results[0]?.result ?? 0)
    const ttlMs = Number(results[2]?.result ?? windowMs)
    const retryAfter = Math.max(1, Math.ceil(Math.max(ttlMs, 0) / 1000))
    const allowed = count <= limit

    if (!allowed) {
      logger.warn({
        event: 'rate_limit_exceeded',
        endpoint,
        limit,
        window_ms: windowMs,
        retry_after: retryAfter,
      })
    }

    return { allowed, retryAfter }
  } catch (error) {
    logger.warn({
      event: 'rate_limit_redis_unavailable',
      endpoint,
      error: error instanceof Error ? error.message : 'Upstash Redis request failed',
    })
    return fallbackRateLimit(key, limit, windowMs, 'upstash_request_failed', mode)
  }
}

export async function checkRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
  endpoint: string,
  mode: RateLimitMode = 'soft'
): Promise<RateLimitResult> {
  return checkUpstashRateLimit(key, limit, windowMs, endpoint, mode)
}
