import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  LAUNCH_PROMO,
  PAY_PER_JOB_DISTANCE_THRESHOLD_M,
  PAY_PER_JOB_FEE_FAR_AED,
  PAY_PER_JOB_FEE_NEAR_AED,
  PAY_PER_JOB_PROMO_FEE_AED,
  PREMIUM_JOB_THRESHOLD_AED,
} from '@/types'
import type { ProblemType, ProviderPlan, ProviderStatus, RequestStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProblemLabel(type: ProblemType): string {
  const labels: Record<ProblemType, string> = {
    flat_tire: 'Flat Tire',
    battery: 'Battery Issue',
    tow: 'Tow Required',
    other: 'Other',
  }
  return labels[type]
}

export function getPlanLabel(plan: ProviderPlan): string {
  const labels: Record<ProviderPlan, string> = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
    pay_per_job: 'Pay Per Job',
  }
  return labels[plan]
}

export function getStatusColor(status: RequestStatus | ProviderStatus): string {
  const colors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    accepted: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-orange-100 text-orange-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-gray-100 text-gray-800',
    pending: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-red-100 text-red-800',
  }
  return colors[status] ?? 'bg-gray-100 text-gray-800'
}

export function calculateCommission(jobValueAed: number, plan: ProviderPlan): number {
  if (jobValueAed <= PREMIUM_JOB_THRESHOLD_AED) return 0
  const rates: Partial<Record<ProviderPlan, number>> = {
    starter: 0.15,
    pro: 0.10,
    business: 0,
  }
  const rate = rates[plan] ?? 0
  return Math.round(jobValueAed * rate)
}

export function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function getPayPerJobFee(distanceMeters: number): number {
  if (LAUNCH_PROMO) return PAY_PER_JOB_PROMO_FEE_AED
  return distanceMeters >= PAY_PER_JOB_DISTANCE_THRESHOLD_M
    ? PAY_PER_JOB_FEE_FAR_AED
    : PAY_PER_JOB_FEE_NEAR_AED
}
