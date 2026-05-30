import type { ErrorEvent, TransactionEvent } from '@sentry/core'

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
  /location/i,
  /^note$/i,
  /operational.*note/i,
  /^payload$/i,
  /^body$/i,
  /^data$/i,
]

const SECRET_VALUE_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9]+/g,
  /rk_(live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  /(pi|seti|cs)_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+/g,
  /client_secret=[^&\s]+/gi,
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

function scrubRequest(event: ErrorEvent | TransactionEvent): void {
  if (!event.request) return

  event.request.headers = redactValue(event.request.headers) as Record<string, string>
  event.request.cookies = undefined
  event.request.data = REDACTED
  event.request.query_string =
    typeof event.request.query_string === 'string'
      ? redactString(event.request.query_string)
      : (redactValue(event.request.query_string) as typeof event.request.query_string)
}

export function scrubSentryErrorEvent(event: ErrorEvent): ErrorEvent | null {
  const scrubbed = redactValue(event) as ErrorEvent
  scrubRequest(scrubbed)
  return scrubbed
}

export function scrubSentryTransactionEvent(
  event: TransactionEvent
): TransactionEvent | null {
  const scrubbed = redactValue(event) as TransactionEvent
  scrubRequest(scrubbed)
  return scrubbed
}
