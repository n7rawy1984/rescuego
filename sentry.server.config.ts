import * as Sentry from '@sentry/nextjs'
import { scrubSentryErrorEvent, scrubSentryTransactionEvent } from './src/lib/sentry-redaction'

const sentryDsn = process.env.SENTRY_DSN

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  beforeSend: scrubSentryErrorEvent,
  beforeSendTransaction: scrubSentryTransactionEvent,
})
