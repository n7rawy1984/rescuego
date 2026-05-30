import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

function originFromUrl(value: string | undefined): string | null {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const supabaseOrigin = originFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
const supabaseRealtimeOrigin = supabaseOrigin?.replace(/^https:/, 'wss:') ?? null
const hasSentrySourceMapEnv = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
)

const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  [
    "script-src",
    "'self'",
    // Next.js and Stripe Elements require inline script/style compatibility.
    // Keep this report-only until nonce/hash rollout is tested.
    "'unsafe-inline'",
    'https://js.stripe.com',
  ].join(' '),
  [
    "style-src",
    "'self'",
    "'unsafe-inline'",
  ].join(' '),
  [
    "img-src",
    "'self'",
    'data:',
    'blob:',
    supabaseOrigin,
    'https://*.stripe.com',
  ].filter(Boolean).join(' '),
  [
    "font-src",
    "'self'",
    'data:',
  ].join(' '),
  [
    "connect-src",
    "'self'",
    supabaseOrigin,
    supabaseRealtimeOrigin,
    'https://api.stripe.com',
    'https://r.stripe.com',
    'https://q.stripe.com',
    'https://m.stripe.network',
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
  ].filter(Boolean).join(' '),
  [
    "frame-src",
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://checkout.stripe.com',
  ].join(' '),
  "form-action 'self' https://checkout.stripe.com",
  "worker-src 'self' blob:",
].join('; ')

const nextConfig: NextConfig = {
  bundlePagesRouterDependencies: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self)',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: contentSecurityPolicyReportOnly,
          },
        ],
      },
    ]
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      removeTracing: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
      excludeReplayCompressionWorker: true,
    },
  },
  sourcemaps: {
    disable: !hasSentrySourceMapEnv,
  },
  release: {
    create: hasSentrySourceMapEnv,
    finalize: hasSentrySourceMapEnv,
  },
  errorHandler: (error) => {
    console.warn('[Sentry] Source map upload skipped or failed without blocking build.', error.message)
  },
});
