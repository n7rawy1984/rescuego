import 'server-only'
import Stripe from 'stripe'
import { requireEnv } from '@/lib/env'

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  stripeClient ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'))
  return stripeClient
}

export function formatAED(fils: number): string {
  return `${(fils / 100).toFixed(2)} AED`
}

export function toFils(aed: number): number {
  return Math.round(aed * 100)
}
