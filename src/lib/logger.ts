type LogLevel = 'info' | 'warn' | 'error'

interface LogPayload {
  event: string
  [key: string]: unknown
}

function log(level: LogLevel, payload: LogPayload): void {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    ...payload,
  }

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
