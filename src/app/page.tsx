import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BatteryCharging,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
  Wrench,
} from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

export const metadata: Metadata = {
  title: 'RescueGo - Roadside Recovery UAE | Fast & Trusted',
  description:
    'Broken down in the UAE? Find a trusted nearby recovery provider in minutes. Free for drivers, built for urgent roadside recovery across the Emirates.',
  alternates: { canonical: 'https://rescuego.ae' },
}

const steps = [
  {
    number: '01',
    title: 'Pin your location',
    icon: MapPin,
    text: 'Share the breakdown location, choose the issue, and see a clear estimated service range before submitting.',
  },
  {
    number: '02',
    title: 'Provider accepts',
    icon: ShieldCheck,
    text: 'A vetted recovery provider accepts the request from their dashboard and confirms they are on the way.',
  },
  {
    number: '03',
    title: 'Complete and rate',
    icon: Star,
    text: 'Pay the provider directly after service, then leave a rating to keep the marketplace trustworthy.',
  },
]

const services = [
  { title: 'Flat tire', icon: Wrench, price: '80-200 AED' },
  { title: 'Battery issue', icon: BatteryCharging, price: '100-250 AED' },
  { title: 'Tow truck', icon: Truck, price: '200-800 AED' },
  { title: 'Urgent support', icon: Clock3, price: '24/7 request flow' },
]

const providerPlans = [
  {
    name: 'Starter',
    price: '249 AED/mo',
    jobs: '15 jobs/month',
    commission: '15% premium commission',
    priority: 'Normal priority',
  },
  {
    name: 'Pro',
    price: '449 AED/mo',
    jobs: '35 jobs/month',
    commission: '10% premium commission',
    priority: 'High priority',
    badge: 'Most Popular',
  },
  {
    name: 'Business',
    price: '849 AED/mo',
    jobs: 'Unlimited jobs',
    commission: '0% commission',
    priority: 'Always shown first',
  },
]

const trustPoints = [
  'Free for drivers',
  'Vetted providers',
  'Direct provider payment',
  'Built for UAE roads',
]

const faqs = [
  {
    question: 'Is RescueGo free for drivers?',
    answer:
      'Yes. Drivers do not pay RescueGo. The customer pays the recovery provider directly after the service.',
  },
  {
    question: 'How do providers join?',
    answer:
      'Providers register, upload required documents, select a plan, and wait for admin review before activation.',
  },
  {
    question: 'Does RescueGo handle customer payments?',
    answer:
      'No. Customers pay providers directly. Stripe is only used for provider subscriptions and platform charges.',
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
}

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow?: string
  title: string
  text?: string
}) {
  return (
    <div className="mb-10 max-w-2xl">
      {eyebrow ? (
        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-600">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-bold leading-tight text-slate-950 sm:text-4xl">
        {title}
      </h2>
      {text ? <p className="mt-3 text-base leading-7 text-slate-600">{text}</p> : null}
    </div>
  )
}

type ViewerState = {
  role: UserRole | null
  providerStatus: string | null
  providerSubscriptionId: string | null
}

async function getViewerState(): Promise<ViewerState> {
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

function primaryCtasForViewer(viewer: ViewerState) {
  if (viewer.role === 'admin') {
    return {
      primaryHref: '/admin/dashboard',
      primaryLabel: 'Admin Dashboard',
      secondaryHref: null,
      secondaryLabel: null,
      providerHref: '/admin/dashboard',
      providerLabel: 'Admin Dashboard',
    }
  }

  if (viewer.role === 'provider') {
    const providerHref = viewer.providerStatus === 'active' || viewer.providerSubscriptionId
      ? '/provider/dashboard'
      : '/provider/subscribe'

    return {
      primaryHref: providerHref,
      primaryLabel: providerHref === '/provider/dashboard' ? 'Provider Dashboard' : 'Choose Subscription',
      secondaryHref: null,
      secondaryLabel: null,
      providerHref,
      providerLabel: providerHref === '/provider/dashboard' ? 'Provider Dashboard' : 'Choose Subscription',
    }
  }

  if (viewer.role === 'customer') {
    return {
      primaryHref: '/customer/request',
      primaryLabel: 'Request Help',
      secondaryHref: null,
      secondaryLabel: null,
      providerHref: '/customer/request',
      providerLabel: 'Request Help',
    }
  }

  return {
    primaryHref: '/customer/request',
    primaryLabel: 'Request Recovery Now',
    secondaryHref: '/provider/register',
    secondaryLabel: 'Join as Provider',
    providerHref: '/provider/register',
    providerLabel: 'Register Provider Account',
  }
}

export default async function HomePage() {
  const viewer = await getViewerState()
  const ctas = primaryCtasForViewer(viewer)

  return (
    <>
      <Navbar />
      <main className="overflow-x-hidden bg-white text-slate-950">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <section className="bg-slate-950 text-white">
          <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl grid-cols-1 items-center gap-12 px-5 py-14 sm:px-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-16 lg:px-10 lg:py-16 xl:px-12">
            <div className="min-w-0">
              <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-orange-100">
                <span className="h-2 w-2 rounded-full bg-orange-400" />
                UAE roadside recovery marketplace
              </div>

              <h1 className="max-w-3xl text-4xl font-bold leading-[1.12] text-white sm:text-5xl lg:text-[3.5rem]">
                Broken down in the UAE? Help is minutes away.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Fast access to trusted nearby recovery providers across the Emirates.
                Free for drivers, built for urgent roadside moments.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={ctas.primaryHref}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-orange-500 px-6 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600"
                >
                  {ctas.primaryLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                {ctas.secondaryHref ? (
                  <Link
                    href={ctas.secondaryHref}
                    className="inline-flex h-12 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white transition hover:border-orange-300 hover:bg-white/15"
                  >
                    {ctas.secondaryLabel}
                  </Link>
                ) : null}
              </div>

              <ul className="mt-9 grid max-w-xl grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
                {trustPoints.map((point) => (
                  <li key={point} className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full max-w-md justify-self-center rounded-2xl border border-white/10 bg-white/10 p-3 shadow-2xl shadow-black/30 lg:max-w-none lg:justify-self-end">
              <div className="rounded-xl bg-white p-5 text-slate-950 shadow-xl sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
                      Live request
                    </p>
                    <h2 className="mt-1 text-xl font-bold leading-tight sm:text-2xl">
                      Recovery dispatch
                    </h2>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white">
                    <Truck className="h-6 w-6" aria-hidden="true" />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Location
                    </p>
                    <p className="mt-1 font-semibold">Sheikh Zayed Road, Dubai</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Service
                      </p>
                      <p className="mt-1 font-semibold">Tow Truck</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        ETA
                      </p>
                      <p className="mt-1 font-semibold">18 min</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-orange-500 p-4 text-white">
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-100">
                      Status
                    </p>
                    <p className="mt-1 text-base font-semibold">Provider en route</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20" id="how-it-works">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-8 lg:px-10 xl:px-12">
            <SectionTitle
              eyebrow="How it works"
              title="A simple request flow"
              text="Drivers can ask for help quickly, while providers get a focused path to accept and complete work."
            />
            <div className="grid gap-6 md:grid-cols-3">
              {steps.map((step) => {
                const Icon = step.icon
                return (
                  <article
                    key={step.title}
                    className="flex min-h-[240px] flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-bold tracking-wide text-orange-500">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="mt-6 text-xl font-bold text-slate-950">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{step.text}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-8 lg:px-10 xl:px-12">
            <SectionTitle
              eyebrow="Roadside services"
              title="Built around common UAE breakdowns"
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {services.map((service) => {
                const Icon = service.icon
                return (
                  <article
                    key={service.title}
                    className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-5 text-lg font-bold text-slate-950">{service.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-600">{service.price}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 md:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 xl:px-12">
            <div>
              <SectionTitle
                eyebrow="For providers"
                title="A cleaner way to receive recovery jobs"
                text="Providers can register, upload documents, subscribe or use pay-per-job access, then manage open requests from the dashboard."
              />
              <Link
                href={ctas.providerHref}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {ctas.providerLabel}
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {providerPlans.map((plan) => (
                <article key={plan.name} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-slate-950">{plan.name}</h3>
                    {plan.badge ? (
                      <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-700">
                        {plan.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-2xl font-bold text-orange-600">{plan.price}</p>
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    <li>{plan.jobs}</li>
                    <li>{plan.commission}</li>
                    <li>{plan.priority}</li>
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-5 sm:px-6 md:px-8">
            <SectionTitle eyebrow="FAQ" title="Common questions" />
            <div className="space-y-4">
              {faqs.map((faq) => (
                <details key={faq.question} className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <summary className="cursor-pointer text-base font-semibold text-slate-950">
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
