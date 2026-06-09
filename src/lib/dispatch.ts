import 'server-only'
import type { ProviderPlan } from '@/types'
import { DISPATCH_RINGS_M, DAILY_VISIBILITY_LIMITS, MAX_ACTIVE_JOBS } from '@/types'
import { distanceMeters, type Coordinates, type DispatchRing, getDispatchRing } from '@/lib/geo'

export type DispatchCandidate = {
  providerId: string
  plan: ProviderPlan
  distanceMeters: number
  distanceKm: number
  ring: DispatchRing
  isOnline: boolean
  activeJobCount: number
  dailyQuoteCount: number
  slaFailureCount: number
  visibilityReduced: boolean
}

export type DispatchFilterResult = {
  eligible: DispatchCandidate[]
  excluded: { providerId: string; reason: string }[]
}

export function getDispatchPriority(plan: ProviderPlan): number {
  switch (plan) {
    case 'business': return 1
    case 'pro': return 2
    case 'starter': return 3
    case 'pay_per_job': return 4
  }
}

export function isProviderEligibleForRing(
  candidate: DispatchCandidate,
  currentRing: DispatchRing
): boolean {
  if (candidate.plan === 'pay_per_job' && currentRing === 1) {
    return false
  }
  return candidate.ring <= currentRing
}

export function filterDispatchCandidates(
  candidates: DispatchCandidate[],
  currentRing: DispatchRing
): DispatchFilterResult {
  const eligible: DispatchCandidate[] = []
  const excluded: { providerId: string; reason: string }[] = []

  for (const candidate of candidates) {
    if (!candidate.isOnline) {
      excluded.push({ providerId: candidate.providerId, reason: 'offline' })
      continue
    }

    if (!isProviderEligibleForRing(candidate, currentRing)) {
      excluded.push({ providerId: candidate.providerId, reason: 'outside_ring' })
      continue
    }

    const maxActive = MAX_ACTIVE_JOBS[candidate.plan]
    if (candidate.activeJobCount >= maxActive) {
      excluded.push({ providerId: candidate.providerId, reason: 'capacity_full' })
      continue
    }

    const dailyLimit = DAILY_VISIBILITY_LIMITS[candidate.plan]
    if (candidate.dailyQuoteCount >= dailyLimit) {
      excluded.push({ providerId: candidate.providerId, reason: 'daily_limit_reached' })
      continue
    }

    if (candidate.visibilityReduced) {
      excluded.push({ providerId: candidate.providerId, reason: 'visibility_reduced' })
      continue
    }

    eligible.push(candidate)
  }

  eligible.sort((a, b) => {
    const priorityDiff = getDispatchPriority(a.plan) - getDispatchPriority(b.plan)
    if (priorityDiff !== 0) return priorityDiff
    return a.distanceMeters - b.distanceMeters
  })

  return { eligible, excluded }
}

export function computeCurrentRing(requestCreatedAt: string): DispatchRing {
  const elapsedMs = Date.now() - new Date(requestCreatedAt).getTime()
  const ringDurationMs = 5 * 60 * 1000

  if (elapsedMs < ringDurationMs) return 1
  if (elapsedMs < ringDurationMs * 2) return 2
  if (elapsedMs < ringDurationMs * 3) return 3
  return 4
}

export function computeProviderDistance(
  providerLocation: Coordinates,
  requestLocation: Coordinates
): { distanceM: number; distanceKm: number; ring: DispatchRing } {
  const distanceM = distanceMeters(providerLocation, requestLocation)
  return {
    distanceM,
    distanceKm: distanceM / 1000,
    ring: getDispatchRing(distanceM),
  }
}

export function getRingRadiusMeters(ring: DispatchRing): number {
  return DISPATCH_RINGS_M[ring - 1]
}
