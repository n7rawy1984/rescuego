import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { createClient } from '@/lib/supabase/server'
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

  return (
    <>
      <Navbar />
      <main className="pt-16">
        {LAUNCH_PROMO && (
          <div className="bg-orange-500 text-white text-center py-3 px-4 text-sm font-semibold">
            🎉 Launch Offer: Pay Per Job at just {PAY_PER_JOB_PROMO_FEE_AED} AED flat - Limited time only!
          </div>
        )}
        <section className="bg-slate-950 text-white px-4 py-16 text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-8">
            For recovery providers. Customers always use RescueGo for free.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="/provider/register?plan=pay_per_job"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-6 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              Join as Provider
            </a>
            <a
              href="/customer/request"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Request Recovery (Free)
            </a>
          </div>
        </section>

        <section className="py-16 px-4 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="mb-12 rounded-2xl border border-orange-200 bg-orange-50 p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-2xl font-bold text-slate-900">Start free with Pay Per Job</h2>
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
                        <span className="font-bold text-green-600">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={payPerJobHref(viewer)}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  {payPerJobLabel(viewer)}
                </Link>
              </div>
            </div>

            <div className="mb-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h2 className="text-2xl font-bold text-slate-900">Ready to grow faster?</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Our subscription plans are built for recovery providers who want more visibility, more monthly jobs, and a clearer path to predictable revenue.
              </p>
              <ul className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  'Get monthly jobs included',
                  'Improve queue priority',
                  'Reduce costs as you scale',
                  'Unlock better growth potential',
                ].map((item) => (
                  <li key={item} className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">{item}</li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {PLANS.map((plan) => {
                const isCurrentPlan = viewer.currentPlan === plan.id
                return (
                  <div key={plan.id} className={`rounded-2xl border-2 p-8 relative ${isCurrentPlan ? 'border-green-500 shadow-xl shadow-green-100' : plan.highlight ? 'border-orange-500 shadow-xl shadow-orange-100' : 'border-slate-200'}`}>
                    {isCurrentPlan ? (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white text-sm font-bold px-4 py-1 rounded-full">Active Plan</div>
                    ) : plan.highlight ? (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-sm font-bold px-4 py-1 rounded-full">Most Popular</div>
                    ) : null}
                    <div className="font-bold text-xl text-slate-900 mb-2">{plan.name}</div>
                    <p className="mb-4 text-sm leading-6 text-slate-600">{plan.positioning}</p>
                    <div className="flex items-end gap-1 mb-6">
                      <span className="text-4xl font-bold text-slate-900">{plan.price}</span>
                      <span className="text-slate-500 mb-1">AED{plan.period}</span>
                    </div>
                    <ul className="flex flex-col gap-2.5 mb-8">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className="text-green-500 font-bold mt-0.5">✓</span>{feature}
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
                      <Link href={subscriptionPlanHref(viewer, plan.id)} className={`block text-center py-3 rounded-xl font-semibold transition-colors ${plan.highlight ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'border-2 border-orange-500 text-orange-500 hover:bg-orange-50'}`}>
                        {planButtonLabel(plan.id)}
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="py-12 px-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Subscription Plan Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden bg-white">
                <thead className="bg-slate-800 text-white">
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
