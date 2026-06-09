import type { FairPriceConfig } from '@/types'

export type PriceRange = {
  minFairPrice: number
  maxFairPrice: number
  baseFee: number
  distanceKm: number
  quoteValidityMinutes: number
}

export type PriceValidationResult =
  | { valid: true; range: PriceRange }
  | { valid: false; reason: 'price_too_low' | 'price_too_high'; range: PriceRange }

export function computePriceRange(config: FairPriceConfig, distanceKm: number): PriceRange {
  const minFairPrice = config.base_fee + distanceKm * config.min_price_per_km
  const maxFairPrice = config.base_fee + distanceKm * config.max_price_per_km
  return {
    minFairPrice: Number(minFairPrice.toFixed(2)),
    maxFairPrice: Number(maxFairPrice.toFixed(2)),
    baseFee: config.base_fee,
    distanceKm,
    quoteValidityMinutes: config.quote_validity_minutes,
  }
}

export function validateProposedPrice(
  proposedPrice: number,
  config: FairPriceConfig,
  distanceKm: number
): PriceValidationResult {
  const range = computePriceRange(config, distanceKm)

  if (proposedPrice < range.minFairPrice) {
    return { valid: false, reason: 'price_too_low', range }
  }

  if (proposedPrice > range.maxFairPrice) {
    return { valid: false, reason: 'price_too_high', range }
  }

  return { valid: true, range }
}

export function computePricePerKm(
  proposedPrice: number,
  baseFee: number,
  distanceKm: number
): number | null {
  if (distanceKm <= 0) return null
  return Number(((proposedPrice - baseFee) / distanceKm).toFixed(2))
}

export function computePriceScore(
  proposedPrice: number,
  minFairPrice: number,
  maxFairPrice: number
): number {
  const range = maxFairPrice - minFairPrice
  if (range <= 0) return 0.5
  const score = 1 - (proposedPrice - minFairPrice) / range
  return Math.max(0, Math.min(1, score))
}
