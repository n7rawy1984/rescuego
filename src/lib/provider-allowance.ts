import type { ProviderPlan } from '@/types'

export type ProviderAllowance = {
  planLimit: number | null
  creditBalance: number
  effectiveLimit: number | null
  remaining: number | null
  hasMonthlyAllowance: boolean
  isUnlimited: boolean
  isPayPerJob: boolean
}

export function getProviderAllowance(input: {
  plan: ProviderPlan
  jobsThisMonth: number | null
  jobCreditBalance: number | null
}): ProviderAllowance {
  const planLimit = input.plan === 'starter' ? 15 : input.plan === 'pro' ? 35 : null
  const creditBalance = Math.max(0, input.jobCreditBalance ?? 0)
  const jobsThisMonth = Math.max(0, input.jobsThisMonth ?? 0)
  const effectiveLimit = planLimit !== null ? planLimit + creditBalance : null

  return {
    planLimit,
    creditBalance,
    effectiveLimit,
    remaining: effectiveLimit !== null ? Math.max(0, effectiveLimit - jobsThisMonth) : null,
    hasMonthlyAllowance: planLimit !== null,
    isUnlimited: input.plan === 'business',
    isPayPerJob: input.plan === 'pay_per_job',
  }
}
