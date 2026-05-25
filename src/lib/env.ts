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

export function getOpsCronSecret(): string | null {
  return process.env.OPS_CRON_SECRET || null
}

const SERVER_REQUIRED_ENVS: EnvName[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]

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
}
