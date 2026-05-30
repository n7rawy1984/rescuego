type LogLevel = 'info' | 'warn' | 'error'

interface LogPayload {
  event: string
  [key: string]: unknown
}

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 5

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /service.*role/i,
  /token/i,
  /client_secret/i,
  /^phone$/i,
  /address/i,
  /coordinate/i,
  /^lat$/i,
  /^lng$/i,
  /^payload$/i,
]

const SECRET_VALUE_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]+/g,
  /rk_(live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
]

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (safeValue, pattern) => safeValue.replace(pattern, REDACTED),
    value
  )
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object' || value === null) return value
  if (value instanceof Error) return redactString(value.message)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactValue(nestedValue, depth + 1),
    ])
  )
}

function log(level: LogLevel, payload: LogPayload): void {
  const entry = redactValue({
    level,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...payload,
  }) as Record<string, unknown>

  if (process.env.NODE_ENV === 'production') {
    console[level](JSON.stringify(entry))
  } else {
    const { event, ...rest } = entry
    console[level](`[${level.toUpperCase()}] ${event}`, rest)
  }
}

export const logger = {
  info: (payload: LogPayload) => log('info', payload),
  warn: (payload: LogPayload) => log('warn', payload),
  error: (payload: LogPayload) => log('error', payload),
}
