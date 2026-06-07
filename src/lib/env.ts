type EnvName =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'STRIPE_PUBLISHABLE_KEY'
  | 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
  | 'NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_PRO_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID'
  | 'NEXT_PUBLIC_APP_URL'
  | 'NEXT_PUBLIC_SITE_URL'
  | 'OPS_CRON_SECRET'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'

export function requireEnv(name: EnvName): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://rescuego.ae'
}

export function getOpsCronSecret(): string | null {
  return process.env.OPS_CRON_SECRET || null
}

const SERVER_REQUIRED_ENVS: EnvName[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID',
  'NEXT_PUBLIC_STRIPE_PRO_PRICE_ID',
  'NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID',
]

const RUNTIME_REQUIRED_ENVS: EnvName[] = [
  'OPS_CRON_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
]

let runtimeWarningLogged = false

export function validateEnv(): void {
  const missing: string[] = []
  for (const key of SERVER_REQUIRED_ENVS) {
    if (!process.env[key]) missing.push(key)
  }
  if (missing.length > 0) {
    throw new Error(
      `[RescueGo] Missing required environment variables:\n  ${missing.join('\n  ')}\n\nCheck your .env.local file.`
    )
  }

  const opsSecret = process.env.OPS_CRON_SECRET
  if (opsSecret && opsSecret.length < 32) {
    throw new Error(
      '[RescueGo] OPS_CRON_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32'
    )
  }

  if (process.env.NODE_ENV === 'production' && !runtimeWarningLogged) {
    runtimeWarningLogged = true

    const missingRuntime = RUNTIME_REQUIRED_ENVS.filter((key) => !process.env[key])
    if (missingRuntime.length > 0) {
      console.error(
        `[RescueGo] Missing runtime environment variables (set in Vercel):\n  ${missingRuntime.join('\n  ')}`
      )
    }

    if (!process.env.NEXT_PUBLIC_SITE_URL) {
      console.warn('[RescueGo] NEXT_PUBLIC_SITE_URL is not set. Password reset emails will use window.location.origin as fallback.')
    }
  }
}
