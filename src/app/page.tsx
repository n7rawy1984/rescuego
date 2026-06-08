import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
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
import NavbarServer from '@/components/layout/NavbarServer'
import Footer from '@/components/layout/Footer'
import Accordion from '@/components/ui/Accordion'
import { createClient } from '@/lib/supabase/server'
import { getProviderOnboardingState } from '@/lib/provider-onboarding'
import type { ProviderPlan, ProviderStatus, UserRole } from '@/types'

export const metadata: Metadata = {
  title: 'Roadside Recovery UAE — Fast & Trusted',
  description:
    'Broken down in the UAE? Find a trusted nearby recovery provider in minutes. Free for drivers, built for urgent roadside recovery across the Emirates.',
  alternates: { canonical: 'https://rescuego.ae' },
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
        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0F6E56]">
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
  providerSetupState: 'incomplete' | 'pending' | 'active' | null
}

type LandingPageTranslate = Awaited<ReturnType<typeof getTranslations<'landing.page'>>>

async function getViewerState(): Promise<ViewerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { role: null, providerStatus: null, providerSubscriptionId: null, providerSetupState: null }
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
      providerSetupState: null,
    }
  }

  const { data: provider } = await supabase
    .from('providers')
    .select('status, plan, documents, stripe_subscription_id, users(name, email, phone)')
    .eq('id', user.id)
    .maybeSingle<{
      status: ProviderStatus | null
      plan: ProviderPlan | null
      documents: {
        emirates_id_url?: string
        license_url?: string
        vehicle_photo_url?: string
      } | null
      stripe_subscription_id: string | null
      users: { name: string | null; email: string | null; phone: string | null } | null
    }>()

  const onboarding = getProviderOnboardingState({
    name: provider?.users?.name ?? null,
    email: provider?.users?.email ?? user.email ?? null,
    phone: provider?.users?.phone ?? null,
    plan: provider?.plan ?? null,
    status: provider?.status ?? null,
    documents: provider?.documents ?? null,
  })

  return {
    role: 'provider',
    providerStatus: provider?.status ?? null,
    providerSubscriptionId: provider?.stripe_subscription_id ?? null,
    providerSetupState: onboarding.activeReady ? 'active' : onboarding.pendingApproval ? 'pending' : 'incomplete',
  }
}

function primaryCtasForViewer(viewer: ViewerState, t: LandingPageTranslate) {
  if (viewer.role === 'admin') {
    return {
      primaryHref: '/admin/dashboard',
      primaryLabel: t('cta.adminDashboard'),
      secondaryHref: null,
      secondaryLabel: null,
      providerHref: '/admin/dashboard',
      providerLabel: t('cta.adminDashboard'),
    }
  }

  if (viewer.role === 'provider') {
    const providerHref = viewer.providerSetupState === 'incomplete'
      ? '/provider/register'
      : '/provider/dashboard'
    const providerLabel = viewer.providerSetupState === 'incomplete'
      ? t('cta.continueSetup')
      : t('cta.providerDashboard')

    return {
      primaryHref: providerHref,
      primaryLabel: providerLabel,
      secondaryHref: null,
      secondaryLabel: null,
      providerHref,
      providerLabel,
    }
  }

  if (viewer.role === 'customer') {
    return {
      primaryHref: '/customer/request',
      primaryLabel: t('cta.requestHelp'),
      secondaryHref: null,
      secondaryLabel: null,
      providerHref: '/customer/request',
      providerLabel: t('cta.requestHelp'),
    }
  }

  return {
    primaryHref: '/customer/request',
    primaryLabel: t('cta.requestRecovery'),
    secondaryHref: '/provider/register',
    secondaryLabel: t('cta.joinAsProvider'),
    providerHref: '/provider/register',
    providerLabel: t('cta.registerProvider'),
  }
}

export default async function HomePage() {
  const t = await getTranslations('landing.page')
  const viewer = await getViewerState()
  const ctas = primaryCtasForViewer(viewer, t)
  const steps = [0, 1, 2].map((i) => ({
    number: ['01', '02', '03'][i],
    title: t(`steps.${i}.title`),
    icon: [MapPin, ShieldCheck, Star][i],
    text: t(`steps.${i}.text`),
  }))
  const services = [0, 1, 2, 3].map((i) => ({
    title: t(`services.${i}.title`),
    icon: [Wrench, BatteryCharging, Truck, Clock3][i],
    descriptor: t(`services.${i}.descriptor`),
  }))
  const providerPlans = [0, 1, 2].map((i) => ({
    name: t(`providers.plans.${i}.name`),
    price: t(`providers.plans.${i}.price`),
    jobs: t(`providers.plans.${i}.jobs`),
    commission: t(`providers.plans.${i}.commission`),
    priority: t(`providers.plans.${i}.priority`),
    badge: i === 1 ? t('providers.plans.1.badge') : null,
  }))
  const trustPoints = [0, 1, 2, 3].map((i) => t(`trustPoints.${i}`))
  const faqs = [0, 1, 2].map((i) => ({
    question: t(`faq.${i}.question`),
    answer: t(`faq.${i}.answer`),
  }))
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

  return (
    <>
      <NavbarServer />
      <main className="overflow-x-hidden bg-white text-slate-950">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />

        <section className="bg-slate-950 text-white">
          <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl grid-cols-1 items-center gap-12 px-5 py-14 sm:px-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-16 lg:px-10 lg:py-16 xl:px-12">
            <div className="min-w-0">
              <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-amber-100">
                <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
                {t('badge')}
              </div>

              <h1 className="max-w-3xl text-4xl font-bold leading-[1.4] text-white sm:text-5xl lg:text-[3.5rem]">
                {t('heroTitle')}
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                {t('heroSubtitle')}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={ctas.primaryHref}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#1D9E75] px-6 text-sm font-semibold text-white shadow-lg shadow-[#1D9E75]/20 transition hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F59E0B]"
                >
                  {ctas.primaryLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                {ctas.secondaryHref ? (
                  <Link
                    href={ctas.secondaryHref}
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-6 text-sm font-semibold text-white transition hover:border-[#9FE1CB] hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F59E0B]"
                  >
                    {ctas.secondaryLabel}
                  </Link>
                ) : null}
              </div>

              <ul className="mt-9 grid max-w-xl grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
                {trustPoints.map((point) => (
                  <li key={point} className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#F59E0B]" aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full max-w-md justify-self-center rounded-2xl border border-white/10 bg-white/10 p-3 shadow-2xl shadow-black/30 lg:max-w-none lg:justify-self-end">
              <div className="rounded-2xl bg-white p-5 text-slate-950 shadow-xl sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#0F6E56]">
                      {t('heroCard.liveRequest')}
                    </p>
                    <p className="mt-1 text-xl font-bold leading-tight sm:text-2xl">
                      {t('heroCard.recoveryDispatch')}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#1D9E75] text-white">
                    <Truck className="h-6 w-6" aria-hidden="true" />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {t('heroCard.location')}
                    </p>
                    <p className="mt-1 font-semibold">{t('heroCard.locationValue')}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {t('heroCard.service')}
                      </p>
                      <p className="mt-1 font-semibold">{t('heroCard.serviceValue')}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {t('heroCard.eta')}
                      </p>
                      <p className="mt-1 font-semibold">{t('heroCard.etaValue')}</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#1D9E75] p-4 text-white">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-100">
                      {t('heroCard.status')}
                    </p>
                    <p className="mt-1 text-base font-semibold">{t('heroCard.statusValue')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20" id="how-it-works">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-8 lg:px-10 xl:px-12">
            <SectionTitle
              eyebrow={t('howItWorks.eyebrow')}
              title={t('howItWorks.title')}
              text={t('howItWorks.subtitle')}
            />
            <div className="grid gap-6 md:grid-cols-3">
              {steps.map((step) => {
                const Icon = step.icon
                return (
                  <article
                    key={step.title}
                    className="flex min-h-[240px] flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56] ring-1 ring-[#DDE7EE]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-bold tracking-wide text-[#1D9E75]">
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
              eyebrow={t('services.eyebrow')}
              title={t('services.title')}
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {services.map((service) => {
                const Icon = service.icon
                return (
                  <article
                    key={service.title}
                    className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56] ring-1 ring-[#DDE7EE]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-5 text-lg font-bold text-slate-950">{service.title}</h3>
                    {service.descriptor ? (
                      <p className="mt-1 text-sm font-semibold text-slate-600">{service.descriptor}</p>
                    ) : null}
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
                eyebrow={t('providers.eyebrow')}
                title={t('providers.title')}
                text={t('providers.subtitle')}
              />
              <Link
                href={ctas.providerHref}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#1D9E75] px-6 text-sm font-semibold text-white transition hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {ctas.providerLabel}
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {providerPlans.map((plan) => (
                <article key={plan.name} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-slate-950">{plan.name}</h3>
                    {plan.badge ? (
                      <span className="rounded-full bg-[#DCFCE7] px-2 py-1 text-xs font-bold text-[#0F6E56]">
                        {plan.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-2xl font-bold text-[#0F6E56]">{plan.price}</p>
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
            <SectionTitle eyebrow={t('faq.eyebrow')} title={t('faq.title')} />
            <Accordion items={faqs} />
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
