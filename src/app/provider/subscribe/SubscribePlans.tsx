'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
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

function planPriorityLabelKey(priority: number): string {
  if (priority === 1) return 'priority.alwaysFirst'
  if (priority === 2) return 'priority.high'
  return 'priority.normal'
}

function selectedPlanCopyKey(plan: ProviderPlan): string {
  if (plan === 'starter') return 'selectedPlanCopy.starter'
  if (plan === 'pro') return 'selectedPlanCopy.pro'
  return 'selectedPlanCopy.business'
}

function planNameKey(plan: ProviderPlan | null): string {
  if (plan === 'starter') return 'planNames.starter'
  if (plan === 'pro') return 'planNames.pro'
  if (plan === 'business') return 'planNames.business'
  if (plan === 'pay_per_job') return 'planNames.payPerJob'
  return 'planNames.noActiveSubscription'
}

function planValueCopyKeys(plan: ProviderPlan): string[] {
  if (plan === 'starter') {
    return [
      'planValueCopy.starter.0',
      'planValueCopy.starter.1',
      'planValueCopy.starter.2',
      'planValueCopy.starter.3',
      'planValueCopy.starter.4',
    ]
  }

  if (plan === 'pro') {
    return [
      'planValueCopy.pro.0',
      'planValueCopy.pro.1',
      'planValueCopy.pro.2',
      'planValueCopy.pro.3',
      'planValueCopy.pro.4',
    ]
  }

  return [
    'planValueCopy.business.0',
    'planValueCopy.business.1',
    'planValueCopy.business.2',
    'planValueCopy.business.3',
    'planValueCopy.business.4',
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
  const t = useTranslations('components.subscribePlans')
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
        setError(t('sessionExpired'))
        setLoadingPlan(null)
        return
      }

      if (!res.ok || !result?.url) {
        setError(result?.error ?? t('unableToStartBilling'))
        setLoadingPlan(null)
        return
      }

      window.location.assign(result.url)
    } catch {
      setError(t('connectionLost'))
      setLoadingPlan(null)
    }
  }

  return (
    <div>
      {(hasSubscription || selectedPlan || returnedFromBillingPortal || planWasAlreadyCurrent) && (
        <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            {t('currentlyOn', { plan: t(planNameKey(currentPlan)) })}
          </p>
          {selectedPlan && selectedPlan !== currentPlan && (
            <p className="mt-1 text-sm text-slate-600">
              {t('selectedUpgradeOption', { plan: t(planNameKey(selectedPlan)) })}
            </p>
          )}
          {hasSubscription && (
            <p className="mt-1 text-xs text-slate-500">
              {t('stripeManagedNotice')}
            </p>
          )}
          {returnedFromBillingPortal && selectedPlan && selectedPlan !== currentPlan && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('webhookUpdateNotice')}
            </p>
          )}
          {planWasAlreadyCurrent && (
            <p className="mt-3 rounded-xl border border-[#9FE1CB] bg-[#E1F5EE] px-3 py-2 text-xs text-[#0F6E56]">
              {t('staleUpgradeTargetRemoved')}
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
              <div className="absolute end-5 top-5 rounded-full bg-[#1D9E75] px-3 py-1 text-xs font-bold text-white shadow-sm">
                {t('popular')}
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-950">{plan.name}</h2>
              <div className="flex flex-wrap justify-end gap-2">
                {isCurrent && (
                  <span className="rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">{t('currentPlan')}</span>
                )}
                {isSelected && !isCurrent && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">{t('upgradeTarget')}</span>
                )}
              </div>
            </div>
            {isSelected && !isCurrent && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t(selectedPlanCopyKey(plan.id))}
              </p>
            )}
            <div className="mt-5 flex items-end gap-2">
              <span className="text-4xl font-semibold text-slate-950">{plan.price_aed}</span>
              <span className="pb-1 text-sm text-slate-500">{t('aedPerMonth')}</span>
            </div>

            <dl className="mt-6 space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t('monthlyJobs')}</dt>
                <dd className="font-semibold text-slate-800">{plan.monthly_jobs ?? t('unlimited')}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t('overageFee')}</dt>
                <dd className="font-semibold text-slate-800">{plan.overage_aed ? t('aedPerJob', { amount: plan.overage_aed }) : t('none')}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t('commission')}</dt>
                <dd className="font-semibold text-slate-800">{t('commissionOverAmount', { percent: plan.premium_commission_pct })}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">{t('priorityLabel')}</dt>
                <dd className="font-semibold text-slate-800">{t(planPriorityLabelKey(plan.priority))}</dd>
              </div>
            </dl>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-950">{t('whatYouGet')}</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {planValueCopyKeys(plan.id).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                    <span>{t(item)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {hasSubscription && !isCurrent && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {t('currentPlanUpgradeNotice', { plan: t(planNameKey(currentPlan)) })}
              </div>
            )}

            <button
              type="button"
              onClick={() => handleSubscribe(plan.id)}
              disabled={loadingPlan !== null || isCurrent}
              className={`mt-6 flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${isCurrent ? 'bg-slate-100 text-slate-500' : 'bg-[#1D9E75] text-white shadow-md shadow-[#DCFCE7] hover:bg-[#0F6E56]'}`}
            >
              {isCurrent
                ? t('currentPlan')
                : loadingPlan === plan.id
                  ? t('openingStripe')
                  : hasSubscription
                    ? t('manageInStripe', { plan: plan.name })
                    : t('subscribeTo', { plan: plan.name })}
            </button>
          </article>
        )})}
      </div>
    </div>
  )
}
