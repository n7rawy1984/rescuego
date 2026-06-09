import {
  SCORE_WEIGHT_RATING,
  SCORE_WEIGHT_PROXIMITY,
  SCORE_WEIGHT_PRICE,
  SCORE_WEIGHT_ACCEPTANCE,
  NEW_PROVIDER_BOOST_THRESHOLD,
  NEW_PROVIDER_RATING_BOOST,
} from '@/types'

export type ProviderScoreInput = {
  rating: number
  completedJobs: number
  distanceKm: number
  maxRingDistanceKm: number
  proposedPrice: number
  minFairPrice: number
  maxFairPrice: number
  acceptanceRate: number
}

export type ProviderScoreResult = {
  totalScore: number
  ratingScore: number
  proximityScore: number
  priceScore: number
  acceptanceScore: number
  boosted: boolean
}

export function computeProviderScore(input: ProviderScoreInput): ProviderScoreResult {
  const boosted = input.completedJobs < NEW_PROVIDER_BOOST_THRESHOLD
  const effectiveRating = boosted
    ? Math.min(5, input.rating + NEW_PROVIDER_RATING_BOOST)
    : input.rating

  const ratingScore = effectiveRating / 5.0

  const proximityScore = input.maxRingDistanceKm > 0
    ? Math.max(0, 1 - input.distanceKm / input.maxRingDistanceKm)
    : 0

  const priceRange = input.maxFairPrice - input.minFairPrice
  const priceScore = priceRange > 0
    ? Math.max(0, Math.min(1, 1 - (input.proposedPrice - input.minFairPrice) / priceRange))
    : 0.5

  const acceptanceScore = Math.max(0, Math.min(1, input.acceptanceRate))

  const totalScore =
    ratingScore * SCORE_WEIGHT_RATING +
    proximityScore * SCORE_WEIGHT_PROXIMITY +
    priceScore * SCORE_WEIGHT_PRICE +
    acceptanceScore * SCORE_WEIGHT_ACCEPTANCE

  return {
    totalScore: Number(totalScore.toFixed(4)),
    ratingScore: Number(ratingScore.toFixed(4)),
    proximityScore: Number(proximityScore.toFixed(4)),
    priceScore: Number(priceScore.toFixed(4)),
    acceptanceScore: Number(acceptanceScore.toFixed(4)),
    boosted,
  }
}

export function computeAcceptanceRate(
  completedJobs: number,
  totalAcceptedJobs: number
): number {
  if (totalAcceptedJobs <= 0) return 1.0
  return Math.min(1, completedJobs / totalAcceptedJobs)
}

export function getMaxRingDistanceKm(ring: 1 | 2 | 3 | 4): number {
  switch (ring) {
    case 1: return 5
    case 2: return 10
    case 3: return 20
    case 4: return 50
  }
}
