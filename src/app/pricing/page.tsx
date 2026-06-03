import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { createClient } from '@/lib/supabase/server'
import { CheckCircle2, CreditCard, ShieldCheck, Sparkles } from 'lucide-react'
import {
  LAUNCH_PROMO,
  PAY_PER_JOB_PROMO_FEE_AED,
} from '@/types'
import type { ProviderPlan, UserRole } from '@/types'

export const metadata: Metadata = {
  title: 'Pricing - Recovery Provider Plans',
  description: 'Join RescueGo as a recovery provider. Choose Starter, Pro, Business, or Pay Per Job plans and start receiving UAE roadside recovery requests.',
  alternates: { canonical: 'https://rescuego.ae/pricing' },
  openGraph: {
    title: 'RescueGo Pricing - Recovery Provider Plans',
    description: 'Provider subscriptions and pay-per-job access for UAE roadside recovery businesses.',
    url: 'https://rescuego.ae/pricing',
  },
}

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 249,
    period: '/month',
    highlight: false,
    cta: 'Get Started',
    positioning: 'Best for new providers starting with steady monthly jobs.',
    features: ['15 jobs/month included', '12 AED overage per extra job', '15% premium commission only over 400 AED', 'Normal queue priority', 'Provider dashboard access', 'Customer ratings and reviews'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 449,
    period: '/month',
    highlight: true,
    cta: 'Start Pro',
    positioning: 'Best for growing providers who want more jobs and higher priority.',
    features: ['35 jobs/month included', '12 AED overage per extra job', '10% premium commission only over 400 AED', 'High queue priority', 'Provider dashboard access', 'Customer ratings and reviews'],
  },
  {
    id: 'business',
    name: 'Business',
    price: 849,
    period: '/month',
    highlight: false,
    cta: 'Go Business',
    positioning: 'Best for serious operators who want unlimited jobs and no premium commission.',
    features: ['Unlimited jobs', 'No overage fees', 'No premium commission', 'Highest priority', 'Provider dashboard access', 'Verified badge eligibility'],
  },
]

type PricingViewer = {
  role: UserRole | null
  providerStatus: string | null
  providerSubscriptionId: string | null
  providerPlan: ProviderPlan | null
  currentPlan: ProviderPlan | null
}

async function getPricingViewer(): Promise<PricingViewer> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { role: null, providerStatus: null, providerSubscriptionId: null, providerPlan: null, currentPlan: null }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: UserRole | null }>()

  if (profile?.role !== 'provider') {
    return {
      role: profile?.role ?? 'customer',
      providerStatus: null,
      providerSubscriptionId: null,
      providerPlan: null,
      currentPlan: null,
    }
  }

  const { data: provider } = await supabase
    .from('providers')
    .select('plan, status, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle<{ plan: ProviderPlan | null; status: string | null; stripe_subscription_id: string | null }>()

  return {
    role: 'provider',
    providerStatus: provider?.status ?? null,
    providerSubscriptionId: provider?.stripe_subscription_id ?? null,
    providerPlan: provider?.plan ?? null,
    currentPlan: provider?.stripe_subscription_id ? provider.plan ?? null : null,
  }
}

function subscriptionPlanHref(viewer: PricingViewer, planId: string): string {
  if (viewer.role === 'provider') {
    return `/provider/subscribe?plan=${planId}`
  }

  return `/provider/register?plan=${planId}`
}

function planButtonLabel(planId: string): string {
  if (planId === 'starter') return 'Choose Starter'
  if (planId === 'pro') return 'Upgrade to Pro'
  return 'Upgrade to Business'
}

function payPerJobHref(viewer: PricingViewer): string {
  if (viewer.role === 'provider') return '/provider/dashboard'
  return '/provider/register?plan=pay_per_job'
}

function payPerJobLabel(viewer: PricingViewer): string {
  if (viewer.role === 'provider' && viewer.providerPlan === 'pay_per_job') {
    return 'Continue with Pay Per Job'
  }

  if (viewer.role === 'provider') return 'Use Pay Per Job'
  return 'Start Free'
}

export default async function PricingPage() {
  const viewer = await getPricingViewer()
  const isSubscribedProvider = viewer.role === 'provider' && Boolean(viewer.currentPlan)

  return (
    <>
      <Navbar />
      <main className="bg-[#F8FAFC] pt-16">
        {LAUNCH_PROMO && (
          <div className="mx-auto mt-5 max-w-6xl rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-center text-sm font-semibold text-[#0F6E56] shadow-sm">
            Launch Offer: Pay Per Job at just {PAY_PER_JOB_PROMO_FEE_AED} AED flat. Limited time only.
          </div>
        )}

        <section className="px-4 py-14 text-center sm:py-16">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[#9FE1CB] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#0F6E56] shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Provider pricing
            </div>
            <h1 className="mb-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">Simple, transparent pricing</h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg leading-8 text-slate-600">
              For recovery providers. Customers always use RescueGo for free.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/provider/register?plan=pay_per_job"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#1D9E75] px-6 text-sm font-semibold text-white shadow-md shadow-[#DCFCE7] transition hover:bg-[#0F6E56] sm:w-auto"
              >
                Join as Provider
              </a>
              <a
                href="/customer/request"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[#DDE7EE] bg-white px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              >
                Request Recovery (Free)
              </a>
            </div>
          </div>
        </section>

        <section className="px-4 pb-16">
          <div className="mx-auto max-w-6xl">
            {isSubscribedProvider ? (
              <div className="mb-8 rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-sm md:p-8">
                <div className="max-w-3xl">
                  <h2 className="text-2xl font-semibold text-slate-950">Manage or upgrade your subscription</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    You are already subscribed to RescueGo. Compare the subscription plans below, then open Stripe Billing to manage upgrades securely without creating a duplicate subscription.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-8 rounded-3xl border border-[#9FE1CB] bg-white p-6 shadow-xl shadow-slate-200/50 md:p-8">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div className="max-w-2xl">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                      <CreditCard className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h2 className="text-2xl font-semibold text-slate-950">Start free with Pay Per Job</h2>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      Accept roadside assistance requests without a monthly commitment. Pay only a flat acceptance fee when you take a job.
                    </p>
                    <ul className="mt-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                      {[
                        'No monthly subscription',
                        'No percentage commission',
                        `Launch promo: ${PAY_PER_JOB_PROMO_FEE_AED} AED per accepted request`,
                        'Upgrade anytime when you are ready for more predictable monthly growth',
                      ].map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Link
                    href={payPerJobHref(viewer)}
                    className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#1D9E75] px-6 text-sm font-semibold text-white shadow-md shadow-[#DCFCE7] transition-colors hover:bg-[#0F6E56]"
                  >
                    {payPerJobLabel(viewer)}
                  </Link>
                </div>
              </div>
            )}

            <div className="mb-8 rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-sm md:p-8">
              <h2 className="text-2xl font-semibold text-slate-950">Ready to grow faster?</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Our subscription plans are built for recovery providers who want more visibility, more monthly jobs, and a clearer path to predictable revenue.
              </p>
              <ul className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  'Get monthly jobs included',
                  'Improve queue priority',
                  'Reduce costs as you scale',
                  'Unlock better growth potential',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                    <Sparkles className="h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {PLANS.map((plan) => {
                const isCurrentPlan = viewer.currentPlan === plan.id
                return (
                  <div key={plan.id} className={`relative rounded-3xl border bg-white p-6 shadow-sm md:p-8 ${isCurrentPlan ? 'border-[#1D9E75] ring-2 ring-[#DCFCE7]' : plan.highlight ? 'border-[#1D9E75] shadow-xl shadow-[#DCFCE7]' : 'border-[#DDE7EE]'}`}>
                    {isCurrentPlan ? (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-[#1D9E75] px-4 py-1 text-sm font-bold text-white">Active Plan</div>
                    ) : plan.highlight ? (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-[#1D9E75] px-4 py-1 text-sm font-bold text-white">Most Popular</div>
                    ) : null}
                    <div className="mb-2 text-xl font-semibold text-slate-950">{plan.name}</div>
                    <p className="mb-4 text-sm leading-6 text-slate-600">{plan.positioning}</p>
                    <div className="mb-6 flex items-end gap-1">
                      <span className="text-4xl font-semibold text-slate-950">{plan.price}</span>
                      <span className="mb-1 text-slate-500">AED{plan.period}</span>
                    </div>
                    <ul className="mb-8 flex flex-col gap-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {isCurrentPlan ? (
                      <button
                        type="button"
                        disabled
                        className="block w-full cursor-not-allowed rounded-xl bg-slate-100 py-3 text-center font-semibold text-slate-500"
                      >
                        Current Plan
                      </button>
                    ) : (
                      <Link href={subscriptionPlanHref(viewer, plan.id)} className={`block rounded-xl py-3 text-center font-semibold transition-colors ${plan.highlight ? 'bg-[#1D9E75] text-white shadow-md shadow-[#DCFCE7] hover:bg-[#0F6E56]' : 'border border-[#1D9E75] text-[#1D9E75] hover:bg-[#E1F5EE]'}`}>
                        {planButtonLabel(plan.id)}
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-center text-2xl font-semibold text-slate-950">Subscription plan comparison</h2>
            <div className="overflow-x-auto rounded-3xl border border-[#DDE7EE] bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 text-white">
                  <tr>
                    {['Feature', 'Starter', 'Pro', 'Business'].map(heading => (
                      <th key={heading} className="px-4 py-3 text-left font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['Monthly Fee', '249 AED', '449 AED', '849 AED'],
                    ['Jobs/Month', '15', '35', 'Unlimited'],
                    ['Overage Fee', '12 AED/job', '12 AED/job', 'None'],
                    ['Commission', '15% only on premium jobs over 400 AED', '10% only on premium jobs over 400 AED', '0%'],
                    ['Queue Priority', 'Normal', 'High', 'Always First'],
                    ['Verified Badge', 'No', 'No', 'Yes'],
                  ].map(([feature, ...values]) => (
                    <tr key={feature} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{feature}</td>
                      {values.map((value, index) => (
                        <td key={`${feature}-${index}`} className="px-4 py-3 text-slate-600">{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
