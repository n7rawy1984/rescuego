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

const buckets = new Map<string, RateLimitEntry>()
let redisFallbackLogged = false

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
  reason: string
): RateLimitResult {
  if (!redisFallbackLogged && process.env.NODE_ENV === 'production') {
    redisFallbackLogged = true
    logger.warn({
      event: 'rate_limit_redis_fallback_used',
      reason,
      limiter: 'memory',
    })
  }

  return checkRateLimit(key, limit, windowMs)
}

async function checkUpstashRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  endpoint: string
): Promise<RateLimitResult> {
  const config = redisConfig()
  if (!config) {
    return fallbackRateLimit(key, limit, windowMs, 'upstash_env_missing')
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
      return fallbackRateLimit(key, limit, windowMs, 'upstash_http_error')
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
    return fallbackRateLimit(key, limit, windowMs, 'upstash_request_failed')
  }
}

export async function checkRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
  endpoint: string
): Promise<RateLimitResult> {
  return checkUpstashRateLimit(key, limit, windowMs, endpoint)
}
