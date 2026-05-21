type EnvName =
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_PRO_PRICE_ID'
  | 'NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID'
  | 'NEXT_PUBLIC_APP_URL'

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
