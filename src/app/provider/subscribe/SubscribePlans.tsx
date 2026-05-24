'use client'
import { useState } from 'react'
import { SUBSCRIPTION_PLANS } from '@/types'
import type { ProviderPlan } from '@/types'

type SubscribePlansProps = {
  providerId: string
  selectedPlan: ProviderPlan | null
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
  if (plan === 'starter') return 'Best for new providers starting with steady monthly jobs.'
  if (plan === 'pro') return 'Best for growing providers who want more jobs and higher priority.'
  return 'Best for serious operators who want unlimited jobs and no commission.'
}

export default function SubscribePlans({ providerId, selectedPlan }: SubscribePlansProps) {
  const [loadingPlan, setLoadingPlan] = useState<ProviderPlan | null>(null)
  const [error, setError] = useState('')

  async function handleSubscribe(plan: ProviderPlan) {
    setLoadingPlan(plan)
    setError('')

    const res = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, provider_id: providerId }),
    })
    const result = await res.json().catch(() => null) as CheckoutResponse | null

    if (!res.ok || !result?.url) {
      setError(result?.error ?? 'Failed to start Stripe Checkout. Please try again.')
      setLoadingPlan(null)
      return
    }

    window.location.assign(result.url)
  }

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {subscriptionPlans.map((plan) => (
          <article key={plan.id} className={`rounded-2xl border bg-white p-6 shadow-sm ${selectedPlan === plan.id ? 'border-orange-500 ring-2 ring-orange-100' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
              {selectedPlan === plan.id && (
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">Selected</span>
              )}
            </div>
            {selectedPlan === plan.id && (
              <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-800">
                {selectedPlanCopy(plan.id)}
              </p>
            )}
            <div className="mt-3 flex items-end gap-2">
              <span className="text-3xl font-bold text-slate-950">{plan.price_aed}</span>
              <span className="pb-1 text-sm text-slate-500">AED/mo</span>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
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

            <button
              type="button"
              onClick={() => handleSubscribe(plan.id)}
              disabled={loadingPlan !== null}
              className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingPlan === plan.id ? 'Starting checkout...' : 'Subscribe'}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}
