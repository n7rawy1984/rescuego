import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { getProviderAllowance } from '@/lib/provider-allowance'
import { getPlanLabel } from '@/lib/utils'
import { SUBSCRIPTION_PLANS, LAUNCH_PROMO, PAY_PER_JOB_PROMO_FEE_AED, PAY_PER_JOB_FEE_NEAR_AED, PAY_PER_JOB_FEE_FAR_AED, SUPPORT_EMAIL } from '@/types'
import { ChevronLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { ProviderPlan } from '@/types'

export const metadata: Metadata = {
  title: 'My Plan — RescueGo',
  robots: { index: false, follow: false },
}

type PlanProviderRow = {
  id: string
  plan: ProviderPlan
  status: string
  jobs_this_month: number
  job_credit_balance: number | null
  ppj_recovery_credits: number | null
  stripe_subscription_id: string | null
}

export default async function ProviderPlanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/provider/plan')

  const admin = createAdminClient()

  const { data: provider } = await admin
    .from('providers')
    .select('id, plan, status, jobs_this_month, job_credit_balance, ppj_recovery_credits, stripe_subscription_id')
    .eq('id', user.id)
    .single<PlanProviderRow>()

  if (!provider) redirect('/provider/register')
  if (provider.status !== 'active') redirect('/provider/pending')

  const allowance = getProviderAllowance({
    plan: provider.plan,
    jobsThisMonth: provider.jobs_this_month,
    jobCreditBalance: provider.job_credit_balance,
  })

  const planDetails = SUBSCRIPTION_PLANS.find((p) => p.id === provider.plan) ?? null
  const isPayPerJob = provider.plan === 'pay_per_job'
  const hasStripeSubscription = Boolean(provider.stripe_subscription_id)

  const usagePct =
    allowance.effectiveLimit && allowance.effectiveLimit > 0
      ? Math.min(100, Math.round(((allowance.effectiveLimit - (allowance.remaining ?? 0)) / allowance.effectiveLimit) * 100))
      : null

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">

        <div className="mb-6">
          <Link
            href="/provider/dashboard"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">My Plan</h1>
          <p className="mt-1 text-sm text-slate-500">Your current plan and monthly usage.</p>
        </div>

        <div className="space-y-4">

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current plan</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{getPlanLabel(provider.plan)}</p>
                {isPayPerJob ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {LAUNCH_PROMO
                      ? `${PAY_PER_JOB_PROMO_FEE_AED} AED flat fee per accepted job (launch promo)`
                      : `${PAY_PER_JOB_FEE_NEAR_AED}–${PAY_PER_JOB_FEE_FAR_AED} AED acceptance fee per job`}
                  </p>
                ) : planDetails ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {planDetails.promo_price_aed && LAUNCH_PROMO
                      ? `${planDetails.promo_price_aed} AED/month (launch promo)`
                      : `${planDetails.price_aed} AED/month`}
                  </p>
                ) : null}
              </div>
              {hasStripeSubscription && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Active subscription
                </span>
              )}
            </div>

            {planDetails && (
              <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                <li className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {planDetails.monthly_jobs !== null
                    ? `${planDetails.monthly_jobs} jobs per month`
                    : 'Unlimited jobs per month'}
                </li>
                {planDetails.overage_aed !== null && (
                  <li className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    {planDetails.overage_aed} AED overage fee per job over limit
                  </li>
                )}
                <li className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {planDetails.premium_commission_pct > 0
                    ? `${planDetails.premium_commission_pct}% commission on premium jobs`
                    : 'No premium commission'}
                </li>
                <li className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  Priority {planDetails.priority === 1 ? 'highest' : planDetails.priority === 2 ? 'high' : 'standard'} in dispatch queue
                </li>
              </ul>
            )}
          </div>

          {!isPayPerJob && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">This month</p>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <p className="text-2xl font-bold text-slate-900">{provider.jobs_this_month}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    jobs used
                    {allowance.effectiveLimit !== null ? ` of ${allowance.effectiveLimit}` : ''}
                    {allowance.creditBalance > 0 ? ` (includes ${allowance.creditBalance} credit${allowance.creditBalance !== 1 ? 's' : ''})` : ''}
                  </p>
                </div>
                {allowance.remaining !== null && (
                  <p className="text-sm font-semibold text-slate-700">
                    {allowance.remaining} remaining
                  </p>
                )}
              </div>
              {usagePct !== null && (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-400' : usagePct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{usagePct}% of monthly allowance used</p>
                </div>
              )}
              {allowance.remaining === 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>You have reached your monthly job limit. Each additional job incurs an overage fee.</span>
                </div>
              )}
            </div>
          )}

          {isPayPerJob && (provider.ppj_recovery_credits ?? 0) > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Recovery credits</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{provider.ppj_recovery_credits}</p>
              <p className="mt-1 text-sm text-emerald-800">
                credit{provider.ppj_recovery_credits === 1 ? '' : 's'} from customer cancellations. Applied automatically to future acceptance payments.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan actions</p>

            {isPayPerJob ? (
              <Link
                href="/provider/subscribe"
                className="flex w-full items-center justify-center rounded-lg bg-[#0F6E56] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0a5240]"
              >
                Upgrade to a monthly plan
              </Link>
            ) : (
              <>
                {provider.plan !== 'business' && (
                  <Link
                    href={`/provider/subscribe?plan=${provider.plan === 'starter' ? 'pro' : 'business'}`}
                    className="flex w-full items-center justify-center rounded-lg bg-[#0F6E56] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0a5240]"
                  >
                    Upgrade plan
                  </Link>
                )}
                {hasStripeSubscription && (
                  <Link
                    href="/provider/subscribe?portal_return=1"
                    className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Manage billing
                  </Link>
                )}
              </>
            )}

            <p className="text-center text-xs text-slate-400">
              Questions about billing?{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#0F6E56] hover:underline">
                Contact support
              </a>
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
