import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

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
    features: ['15 job requests per month', '12 AED overage per extra job', '15% commission on premium jobs', 'Normal queue priority', 'Provider dashboard access', 'Customer ratings and reviews'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 449,
    period: '/month',
    highlight: true,
    cta: 'Start Pro',
    features: ['35 job requests per month', '12 AED overage per extra job', '10% commission on premium jobs', 'High queue priority', 'Provider dashboard access', 'Customer ratings and reviews'],
  },
  {
    id: 'business',
    name: 'Business',
    price: 849,
    period: '/month',
    highlight: false,
    cta: 'Go Business',
    features: ['Unlimited job requests', 'No overage fees', '0% commission on all jobs', 'Always shown first to customers', 'Provider dashboard access', 'Verified badge eligibility'],
  },
]

type PricingViewer = {
  role: UserRole | null
  providerStatus: string | null
  providerSubscriptionId: string | null
}

async function getPricingViewer(): Promise<PricingViewer> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { role: null, providerStatus: null, providerSubscriptionId: null }
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
    }
  }

  const { data: provider } = await supabase
    .from('providers')
    .select('status, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle<{ status: string | null; stripe_subscription_id: string | null }>()

  return {
    role: 'provider',
    providerStatus: provider?.status ?? null,
    providerSubscriptionId: provider?.stripe_subscription_id ?? null,
  }
}

function pricingCtaForViewer(viewer: PricingViewer, planId: string) {
  if (viewer.role === 'admin') {
    return { href: '/admin/dashboard', label: 'Admin Dashboard' }
  }

  if (viewer.role === 'customer') {
    return { href: '/customer/request', label: 'Request Help' }
  }

  if (viewer.role === 'provider') {
    if (viewer.providerStatus === 'active' || viewer.providerSubscriptionId) {
      return { href: '/provider/dashboard', label: 'Provider Dashboard' }
    }

    return { href: '/provider/subscribe', label: 'Choose Subscription' }
  }

  return { href: `/provider/register?plan=${planId}`, label: null }
}

export default async function PricingPage() {
  const viewer = await getPricingViewer()

  return (
    <>
      <Navbar />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-16 text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-8">
            For recovery providers. Customers always use RescueGo for free.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="/provider/register"
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {PLANS.map((plan) => (
                <div key={plan.id} className={`rounded-2xl border-2 p-8 relative ${plan.highlight ? 'border-orange-500 shadow-xl shadow-orange-100' : 'border-slate-200'}`}>
                  {plan.highlight && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-sm font-bold px-4 py-1 rounded-full">Most Popular</div>
                  )}
                  <div className="font-bold text-xl text-slate-900 mb-2">{plan.name}</div>
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
                  <Link href={pricingCtaForViewer(viewer, plan.id).href} className={`block text-center py-3 rounded-xl font-semibold transition-colors ${plan.highlight ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'border-2 border-orange-500 text-orange-500 hover:bg-orange-50'}`}>
                    {pricingCtaForViewer(viewer, plan.id).label ?? plan.cta}
                  </Link>
                </div>
              ))}
            </div>

            <div className="mb-8 rounded-xl bg-slate-50 border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-800 mb-2">Quick math: when does Starter pay off?</p>
              <p className="text-sm text-slate-600">
                At an average job value of <strong>250 AED</strong>, Pay Per Job costs you <strong>70 AED/job</strong> in commission.
                With Starter at 249 AED/month, you break even after just <strong>4 jobs</strong>.
                Everything beyond that is pure savings - and you get normal queue priority.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Pay Per Job</h2>
                  <p className="text-slate-600 mt-1">No monthly fee. Pay 28% commission per job you accept.</p>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {['Free to register', '28% commission per accepted job', 'Lowest queue priority', 'No monthly commitment'].map(feature => (
                      <li key={feature} className="text-sm text-slate-600 flex items-center gap-2"><span className="text-green-500">✓</span>{feature}</li>
                    ))}
                  </ul>
                </div>
                <Link href={pricingCtaForViewer(viewer, 'pay_per_job').href} className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors whitespace-nowrap">
                  {pricingCtaForViewer(viewer, 'pay_per_job').label ?? 'Start Free'}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 px-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Plan Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden bg-white">
                <thead className="bg-slate-800 text-white">
                  <tr>
                    {['Feature', 'Pay Per Job', 'Starter', 'Pro', 'Business'].map(heading => (
                      <th key={heading} className="px-4 py-3 text-left font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['Monthly Fee', 'Free', '249 AED', '449 AED', '849 AED'],
                    ['Jobs/Month', 'Unlimited', '15', '35', 'Unlimited'],
                    ['Overage Fee', '-', '12 AED/job', '12 AED/job', 'None'],
                    ['Commission', '28% all jobs', '15% over 400 AED', '10% over 400 AED', '0%'],
                    ['Queue Priority', 'Lowest', 'Normal', 'High', 'Always First'],
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
