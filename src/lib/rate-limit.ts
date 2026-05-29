type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  allowed: boolean
  retryAfter: number
}

const buckets = new Map<string, RateLimitEntry>()

// TODO(Phase 1): replace this in-memory limiter with Redis/Upstash or another
// shared store before multi-instance production scaling. Current buckets are
// process-local and reset on deploy/serverless cold starts.
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
