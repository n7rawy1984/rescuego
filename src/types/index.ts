export * from './database'

export interface SubscriptionPlan {
  id: ProviderPlan
  name: string
  price_aed: number
  promo_price_aed?: number
  monthly_jobs: number | null
  overage_aed: number | null
  premium_commission_pct: number
  priority: number
  stripe_price_id: string
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price_aed: 249,
    promo_price_aed: 149,
    monthly_jobs: 15,
    overage_aed: 12,
    premium_commission_pct: 15,
    priority: 3,
    stripe_price_id: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? '',
  },
  {
    id: 'pro',
    name: 'Pro',
    price_aed: 449,
    monthly_jobs: 35,
    overage_aed: 12,
    premium_commission_pct: 10,
    priority: 2,
    stripe_price_id: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? '',
  },
  {
    id: 'business',
    name: 'Business',
    price_aed: 849,
    monthly_jobs: null,
    overage_aed: null,
    premium_commission_pct: 0,
    priority: 1,
    stripe_price_id: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID ?? '',
  },
]

// Pay Per Job - flat acceptance fee (not percentage)
export const PAY_PER_JOB_FEE_NEAR_AED = 30
export const PAY_PER_JOB_FEE_FAR_AED = 70
export const PAY_PER_JOB_DISTANCE_THRESHOLD_M = 10_000

// Launch promo - controlled by NEXT_PUBLIC_LAUNCH_PROMO env var
// Set to 'true' in Vercel to enable, remove or set to 'false' to disable
export const LAUNCH_PROMO = process.env.NEXT_PUBLIC_LAUNCH_PROMO === 'true'
export const PAY_PER_JOB_PROMO_FEE_AED = 15

// Overage and platform fees
export const OVERAGE_FEE_AED = 12
export const PREMIUM_JOB_THRESHOLD_AED = 400
export const REQUEST_LOCK_SECONDS = 60
export const PROVIDER_RADIUS_METERS = 5000
export const PROVIDER_STALE_MINUTES = 5

import type { ProviderPlan } from './database'
