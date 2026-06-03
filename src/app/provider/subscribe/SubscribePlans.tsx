'use client'
import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { SUBSCRIPTION_PLANS } from '@/types'
import type { ProviderPlan } from '@/types'

type SubscribePlansProps = {
  providerId: string
  selectedPlan: ProviderPlan | null
  currentPlan: ProviderPlan | null
  hasSubscription: boolean
  returnedFromBillingPortal: boolean
  planWasAlreadyCurrent: boolean
}

type CheckoutResponse = {
  url?: string
  error?: string
}

const subscriptionPlans = SUBSCRIPTION_PLANS.filter((plan) => plan.id !== 'pay_per_job')

function planPriorityLabel(priority: number): string {
  if (priority === 1) return 'Always first'
  if (priority === 2) return 'High priority'
  return 'Normal priority'
}

function selectedPlanCopy(plan: ProviderPlan): string {
  if (plan === 'starter') return 'A practical first step for building steady monthly jobs.'
  if (plan === 'pro') return 'A strong growth plan for providers ready to win more jobs.'
  return 'The best fit for operators who want maximum volume and zero premium commission.'
}

function planName(plan: ProviderPlan | null): string {
  if (plan === 'starter') return 'Starter'
  if (plan === 'pro') return 'Pro'
  if (plan === 'business') return 'Business'
  if (plan === 'pay_per_job') return 'Pay Per Job'
  return 'no active subscription'
}

function planValueCopy(plan: ProviderPlan): string[] {
  if (plan === 'starter') {
    return [
      '15 monthly jobs included',
      'Normal queue priority',
      '12 AED overage per extra job',
      '15% premium commission only over 400 AED',
      'A simple way to start building steady monthly volume',
    ]
  }

  if (plan === 'pro') {
    return [
      '35 monthly jobs included',
      'High queue priority',
      '12 AED overage per extra job',
      '10% premium commission only over 400 AED',
      'Designed for providers ready to grow faster',
    ]
  }

  return [
    'Unlimited monthly jobs',
    'Highest queue priority',
    'No overage fees',
    'No premium commission',
    'Built for serious operators who want maximum scale',
  ]
}

export default function SubscribePlans({
  providerId,
  selectedPlan,
  currentPlan,
  hasSubscription,
  returnedFromBillingPortal,
  planWasAlreadyCurrent,
}: SubscribePlansProps) {
  const [loadingPlan, setLoadingPlan] = useState<ProviderPlan | null>(null)
  const [error, setError] = useState('')

  async function handleSubscribe(plan: ProviderPlan) {
    if (loadingPlan !== null || currentPlan === plan) return
    setLoadingPlan(plan)
    setError('')

    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, provider_id: providerId }),
      })
      const result = await res.json().catch(() => null) as CheckoutResponse | null

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoadingPlan(null)
        return
      }

      if (!res.ok || !result?.url) {
        setError(result?.error ?? 'Unable to start billing session right now.')
        setLoadingPlan(null)
        return
      }

      window.location.assign(result.url)
    } catch {
      setError('Network connection lost. Please try again.')
      setLoadingPlan(null)
    }
  }

  return (
    <div>
      {(hasSubscription || selectedPlan || returnedFromBillingPortal || planWasAlreadyCurrent) && (
        <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            You are currently on {planName(currentPlan)}.
          </p>
          {selectedPlan && selectedPlan !== currentPlan && (
            <p className="mt-1 text-sm text-slate-600">
              You selected {planName(selectedPlan)} as your upgrade option. Complete the change in Stripe Billing to activate {planName(selectedPlan)}.
            </p>
          )}
          {hasSubscription && (
            <p className="mt-1 text-xs text-slate-500">
              Subscription upgrades are securely managed through Stripe. Plan switching must be enabled in Stripe Billing Portal settings.
            </p>
          )}
          {returnedFromBillingPortal && selectedPlan && selectedPlan !== currentPlan && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              If you just changed plans in Stripe, it may take a moment for the webhook to update your RescueGo account.
            </p>
          )}
          {planWasAlreadyCurrent && (
            <p className="mt-3 rounded-xl border border-[#9FE1CB] bg-[#E1F5EE] px-3 py-2 text-xs text-[#0F6E56]">
              Your subscription page has been refreshed to remove a stale upgrade target.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {subscriptionPlans.map((plan) => {
          const isSelected = selectedPlan === plan.id
          const isCurrent = currentPlan === plan.id

          return (
            <article key={plan.id} className={`relative overflow-hidden rounded-3xl border bg-white p-6 shadow-sm ${isCurrent ? 'border-[#1D9E75] ring-2 ring-[#DCFCE7]' : isSelected ? 'border-amber-300 ring-2 ring-amber-100' : 'border-[#DDE7EE]'}`}>
            {plan.id === 'pro' && !isCurrent && (
              <div className="absolute right-5 top-5 rounded-full bg-[#1D9E75] px-3 py-1 text-xs font-bold text-white shadow-sm">
                Popular
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-950">{plan.name}</h2>
              <div className="flex flex-wrap justify-end gap-2">
                {isCurrent && (
                  <span className="rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">Current Plan</span>
                )}
                {isSelected && !isCurrent && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Upgrade Target</span>
                )}
              </div>
            </div>
            {isSelected && !isCurrent && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {selectedPlanCopy(plan.id)}
              </p>
            )}
            <div className="mt-5 flex items-end gap-2">
              <span className="text-4xl font-semibold text-slate-950">{plan.price_aed}</span>
              <span className="pb-1 text-sm text-slate-500">AED/mo</span>
            </div>

            <dl className="mt-6 space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Monthly jobs</dt>
                <dd className="font-semibold text-slate-800">{plan.monthly_jobs ?? 'Unlimited'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Overage fee</dt>
                <dd className="font-semibold text-slate-800">{plan.overage_aed ? `${plan.overage_aed} AED/job` : 'None'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Commission</dt>
                <dd className="font-semibold text-slate-800">{plan.premium_commission_pct}% over 400 AED</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Priority</dt>
                <dd className="font-semibold text-slate-800">{planPriorityLabel(plan.priority)}</dd>
              </div>
            </dl>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-950">What you get</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {planValueCopy(plan.id).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {hasSubscription && !isCurrent && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                Your current plan is {planName(currentPlan)}. To upgrade, open Stripe Billing and choose a new plan if available.
              </div>
            )}

            <button
              type="button"
              onClick={() => handleSubscribe(plan.id)}
              disabled={loadingPlan !== null || isCurrent}
              className={`mt-6 flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${isCurrent ? 'bg-slate-100 text-slate-500' : 'bg-[#1D9E75] text-white shadow-md shadow-[#DCFCE7] hover:bg-[#0F6E56]'}`}
            >
              {isCurrent
                ? 'Current Plan'
                : loadingPlan === plan.id
                  ? 'Opening Stripe...'
                  : hasSubscription
                    ? `Manage ${plan.name} in Stripe`
                    : `Subscribe to ${plan.name}`}
            </button>
          </article>
        )})}
      </div>
    </div>
  )
}
