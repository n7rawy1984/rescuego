import type { ProviderPlan } from '@/types'

export type ProviderAllowance = {
  planLimit: number | null
  creditBalance: number
  remaining: number | null
  hasMonthlyAllowance: boolean
  isUnlimited: boolean
  isPayPerJob: boolean
}

// Migration 057 (Phase 3 Step 3): corrected remaining-capacity semantic.
// The previous formula (effectiveLimit = planLimit + creditBalance,
// remaining = effectiveLimit - jobsThisMonth) double-counted every
// credit-funded selection once job_credit_balance became consumable at
// selection time: jobs_this_month increments AND creditBalance decrements
// for the same event, so `remaining` dropped by 2 per credit instead of 1.
// `effectiveLimit` is dropped entirely (not retained as display-only) --
// it also misrepresents the plan's real limit once a request is funded by
// PAID overage (jobsThisMonth can exceed planLimit with zero credits left,
// e.g. planLimit=15, jobsThisMonth=18, creditBalance=0 would derive
// effectiveLimit=18 and display "18 of 18", hiding the real 15-job plan
// limit). Base allowance and credit balance are now tracked as two
// separate, non-overlapping buckets: base usage is capped at planLimit
// (never shrinks as credits are consumed), credits are a separate
// remaining bucket consumed only after the base is exhausted.
export function getProviderAllowance(input: {
  plan: ProviderPlan
  jobsThisMonth: number | null
  jobCreditBalance: number | null
}): ProviderAllowance {
  const planLimit = input.plan === 'starter' ? 15 : input.plan === 'pro' ? 35 : null
  const creditBalance = Math.max(0, input.jobCreditBalance ?? 0)
  const jobsThisMonth = Math.max(0, input.jobsThisMonth ?? 0)
  const baseRemaining = planLimit !== null ? Math.max(0, planLimit - jobsThisMonth) : null
  const remaining = baseRemaining !== null ? baseRemaining + creditBalance : null

  return {
    planLimit,
    creditBalance,
    remaining,
    hasMonthlyAllowance: planLimit !== null,
    isUnlimited: input.plan === 'business',
    isPayPerJob: input.plan === 'pay_per_job',
  }
}

export function getMaxActiveJobs(plan: ProviderPlan): number {
  switch (plan) {
    case 'starter': return 1
    case 'pro': return 2
    case 'business': return 5
    case 'pay_per_job': return 1
  }
}

export function getDailyVisibilityLimit(plan: ProviderPlan): number {
  switch (plan) {
    case 'pay_per_job': return 3
    case 'starter': return 5
    case 'pro': return 10
    case 'business': return 20
  }
}
