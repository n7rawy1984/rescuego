import { redirect } from 'next/navigation'
import { MapPin, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import NavbarServer from '@/components/layout/NavbarServer'
import Badge from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getPlanLabel, getProblemLabel, getPayPerJobFee } from '@/lib/utils'
import { isTimestampWithinMinutes, distanceKm, getUaeLocation } from '@/lib/geo'
import { getProviderAllowance } from '@/lib/provider-allowance'
import { getProviderOnboardingState, providerDocumentLabel } from '@/lib/provider-onboarding'
import ProviderRequestList from '@/components/forms/ProviderRequestList'
import CompleteJobForm from '@/components/forms/CompleteJobForm'
import ReleaseJobButton from '@/components/forms/ReleaseJobButton'
import ProviderOnboardingChecklist from '@/components/provider/ProviderOnboardingChecklist'
import ProviderAvailabilityToggle from '@/components/provider/ProviderAvailabilityToggle'
import ProviderDashboardHeader from '@/components/provider/dashboard/ProviderDashboardHeader'
import ProviderStatsGrid from '@/components/provider/dashboard/ProviderStatsGrid'
import ProviderUpgradeNotice from '@/components/provider/dashboard/ProviderUpgradeNotice'
import ProviderRecentActivitySection from '@/components/provider/dashboard/ProviderRecentActivitySection'
import LocationActions from '@/components/provider/LocationActions'
import ProviderRealtimeRefresh from '@/components/provider/ProviderRealtimeRefresh'
import JobStateAdvanceButton from '@/components/forms/JobStateAdvanceButton'
import SlaTimer from '@/components/provider/SlaTimer'
import PpjPaymentPrompt from '@/components/provider/PpjPaymentPrompt'
import { getProviderLocationDisplay } from '@/lib/location-display'
import { logger } from '@/lib/logger'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PAY_PER_JOB_PROMO_FEE_AED, PROVIDER_RADIUS_METERS, PROVIDER_STALE_MINUTES, SUPPORT_EMAIL } from '@/types'
import type { ProblemType, ProviderPlan, ProviderStatus, RequestStatus } from '@/types'

export const metadata: Metadata = {
  title: 'Provider Dashboard',
  robots: { index: false, follow: false },
}

type ProviderDashboardRow = {
  id: string
  plan: ProviderPlan
  status: ProviderStatus
  rating: number
  jobs_this_month: number
  job_credit_balance: number | null
  ppj_recovery_credits: number | null
  verified_badge: boolean
  documents: {
    emirates_id_url?: string
    license_url?: string
    vehicle_photo_url?: string
  } | null
  stripe_subscription_id: string | null
  users: {
    name: string | null
    email: string | null
    phone: string | null
  } | null
}

type DashboardRequestRow = {
  id: string
  customer_id: string
  location: unknown
  location_address: string | null
  problem_type: ProblemType
  note: string | null
  status: RequestStatus
  accepted_by: string | null
  accepted_at: string | null
  price_estimate_min: number | null
  price_estimate_max: number | null
  final_price: number | null
  created_at: string
  distance_to_provider_m: number | null
  destination?: string | null
  destination_area?: string | null
  users?: {
    name: string | null
    phone: string | null
  } | null
}

type PendingPaymentRequestRow = {
  id: string
  problem_type: ProblemType
  payment_window_started_at: string | null
}

type NearbyOpenRequestRow = DashboardRequestRow & {
  distance_meters: number | null
  fuzzy_latitude?: number | null
  fuzzy_longitude?: number | null
  uae_emirate?: string | null
  uae_emirate_ar?: string | null
  uae_area?: string | null
  uae_area_ar?: string | null
}

type RecentJobRow = {
  id: string
  completed_at: string | null
  requests: {
    problem_type: ProblemType | null
    location_address: string | null
    status: RequestStatus | null
    accepted_by: string | null
    final_price: number | null
    cancellation_actor: 'customer' | 'provider' | 'admin' | null
    cancelled_at: string | null
    created_at: string | null
  } | null
}

type ProviderLocationRow = {
  updated_at: string | null
  lat: number | null
  lng: number | null
}

type FallbackOpenRequestRow = Omit<DashboardRequestRow, 'location' | 'location_address' | 'price_estimate_min' | 'price_estimate_max'> & {
  fuzzy_latitude?: number | null
  fuzzy_longitude?: number | null
}
type RequestFeedMode = 'nearby' | 'fallback' | 'offline'

type PaymentProcessingRow = {
  id: string
  request_id: string
  status: string
  created_at: string
  recovery_credit_restored_at: string | null
}

type OveragePaymentProcessingRow = {
  id: string
  request_id: string
  status: string
  created_at: string
}

type CancelledRequestNoticeRow = {
  id: string
  problem_type: ProblemType | null
  cancelled_at: string | null
  accepted_at: string | null
}

function formatApproxDistance(meters: number | null | undefined, t: Awaited<ReturnType<typeof getTranslations>>): string {
  if (meters === null || meters === undefined) return t('distanceUnavailable')
  if (meters < 1000) return t('approxMetersAway', { distance: Math.round(meters) })
  return t('approxKmAway', { distance: (meters / 1000).toFixed(1) })
}

function isRecentPaymentAttempt(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  return Date.now() - new Date(createdAt).getTime() < 15 * 60 * 1000
}

function isRecentOperationalNotice(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000
}

function recentActivityStatus(job: RecentJobRow, t: Awaited<ReturnType<typeof getTranslations>>): {
  label: string
  badge: 'success' | 'warning' | 'danger' | 'info' | 'default'
  detail: string
  date: string | null
} {
  const request = job.requests

  if (job.completed_at || request?.status === 'completed') {
    return {
      label: t('completed'),
      badge: 'success',
      detail: request?.final_price ? `${request.final_price} AED` : t('completedService'),
      date: job.completed_at ?? request?.created_at ?? null,
    }
  }

  if (request?.status === 'cancelled') {
    const customerCancelled = request.cancellation_actor === 'customer'
    return {
      label: customerCancelled ? t('customerCancelled') : t('cancelled'),
      badge: 'default',
      detail: customerCancelled ? t('customerCancelledDetail') : t('requestCancelled'),
      date: request.cancelled_at ?? request.created_at,
    }
  }

  if (request?.status === 'open' && !request.accepted_by) {
    return {
      label: t('releasedByYou'),
      badge: 'warning',
      detail: t('youReleasedRequest'),
      date: request.created_at,
    }
  }

  return {
    label: t('activity'),
    badge: 'info',
    detail: t('requestActivity'),
    date: request?.created_at ?? null,
  }
}

function safeActivityLocation(address: string | null | undefined, t: Awaited<ReturnType<typeof getTranslations>>): string {
  const display = getProviderLocationDisplay({ location_address: address ?? null })
  if (display.label === 'Location details unavailable') return t('locationUnavailable')
  if (display.label === 'GPS location') return t('gpsLocation')
  return display.label
}

export default async function ProviderDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string; payment_intent?: string; redirect_status?: string }>
}) {
  const t = await getTranslations('provider.dashboard')
  const tPpjPrompt = await getTranslations('provider.ppjPaymentPrompt')

  const params = await searchParams
  const returnedFromPayment = params?.payment === 'processing'
    || params?.redirect_status === 'succeeded'
    || Boolean(params?.payment_intent)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/provider/dashboard')

  const { data: provider } = await supabase
    .from('providers')
    .select('*, users(name, email, phone)')
    .eq('id', user.id)
    .single<ProviderDashboardRow>()

  if (!provider) redirect('/provider/register')

  const onboarding = getProviderOnboardingState({
    name: provider.users?.name ?? null,
    email: provider.users?.email ?? null,
    phone: provider.users?.phone ?? null,
    plan: provider.plan,
    status: provider.status,
    documents: provider.documents,
  })
  const operationalReady = onboarding.activeReady
  const availabilityDisabledReason = provider.status === 'active'
    ? undefined
    : provider.status === 'suspended'
      ? t('availabilitySuspended')
      : !onboarding.profileComplete
      ? t('availabilityProfile')
      : !onboarding.documentsComplete
        ? t('availabilityDocuments', { missing: onboarding.missingDocuments.map(providerDocumentLabel).join(', ') })
        : !onboarding.planComplete
          ? t('availabilityPlan')
          : t('availabilityReview')
  const admin = createAdminClient()
  const [
    activeRequestResult,
    pendingPaymentRequestResult,
    providerLocationResult,
    recentJobsResult,
  ] = await Promise.all([
    operationalReady
      ? admin
        .from('requests')
        .select('*')
        .eq('accepted_by', user.id)
        .in('status', ['accepted', 'en_route', 'arrived', 'in_progress'])
        .maybeSingle<DashboardRequestRow>()
      : Promise.resolve({ data: null, error: null }),
    // PPJ: the customer selected this provider's quote; the fee must be paid before
    // contact details are revealed and the job is assigned. accepted_by marks WHO
    // must pay; the job is NOT assigned yet (accepted_at is null).
    operationalReady
      ? admin
        .from('requests')
        .select('id, problem_type, payment_window_started_at')
        .eq('accepted_by', user.id)
        .eq('status', 'selected_pending_payment')
        .order('payment_window_started_at', { ascending: true })
        .limit(1)
        .maybeSingle<PendingPaymentRequestRow>()
      : Promise.resolve({ data: null, error: null }),
    operationalReady
      ? admin
        .from('provider_locations')
        .select('updated_at, lat, lng')
        .eq('provider_id', user.id)
        .maybeSingle<ProviderLocationRow>()
      : Promise.resolve({ data: null }),
    operationalReady
      ? supabase
        .from('jobs')
        .select('id, completed_at, requests(problem_type, location_address, status, accepted_by, final_price, cancellation_actor, cancelled_at, created_at)')
        .eq('provider_id', user.id)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(10)
        .returns<RecentJobRow[]>()
      : Promise.resolve({ data: null }),
  ])

  const { data: activeRequestData, error: activeRequestError } = activeRequestResult

  if (activeRequestError) {
    logger.error({
      event: 'provider_dashboard_active_request_load_failed',
      provider_id: user.id,
      error: activeRequestError.message,
    })
  }

  const pendingPaymentRequest = pendingPaymentRequestResult.data ?? null

  const { data: activeCustomer, error: activeCustomerError } = activeRequestData?.customer_id
    ? await admin
      .from('users')
      .select('name, phone')
      .eq('id', activeRequestData.customer_id)
      .maybeSingle<{ name: string | null; phone: string | null }>()
    : { data: null, error: null }

  if (activeCustomerError) {
    logger.warn({
      event: 'provider_dashboard_active_customer_load_failed',
      provider_id: user.id,
      request_id: activeRequestData?.id ?? null,
      has_customer_id: Boolean(activeRequestData?.customer_id),
      error: activeCustomerError.message,
    })
  }

  const activeRequest = activeRequestData
    ? { ...activeRequestData, users: activeCustomer ?? null }
    : null

  const [
    { data: recentCustomerCancellation },
    { data: recentPpjPayment, error: recentPpjPaymentError },
  ] = await Promise.all([
    operationalReady && !activeRequest
      ? admin
        .from('requests')
        .select('id, problem_type, cancelled_at, accepted_at')
        .eq('accepted_by', user.id)
        .eq('status', 'cancelled')
        .eq('cancellation_actor', 'customer')
        .order('cancelled_at', { ascending: false })
        .limit(1)
        .maybeSingle<CancelledRequestNoticeRow>()
      : Promise.resolve({ data: null }),
    operationalReady && returnedFromPayment && !activeRequest
      ? admin
        .from('ppj_payments')
        .select('id, request_id, status, created_at, recovery_credit_restored_at')
        .eq('provider_id', user.id)
        .in('status', ['pending', 'paid'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<PaymentProcessingRow>()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (recentPpjPaymentError) {
    logger.warn({
      event: 'provider_dashboard_payment_processing_lookup_failed',
      provider_id: user.id,
      error: recentPpjPaymentError.message,
    })
  }

  const { data: recentOveragePayment, error: recentOveragePaymentError } = operationalReady && returnedFromPayment && !activeRequest && !recentPpjPayment
    ? await admin
      .from('overage_payments')
      .select('id, request_id, status, created_at')
      .eq('provider_id', user.id)
      .in('status', ['pending', 'paid'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<OveragePaymentProcessingRow>()
    : { data: null, error: null }

  if (recentOveragePaymentError) {
    logger.warn({
      event: 'provider_dashboard_overage_processing_lookup_failed',
      provider_id: user.id,
      error: recentOveragePaymentError.message,
    })
  }

  const paymentFinalizing = Boolean(
    returnedFromPayment
      && !activeRequest
      && !recentCustomerCancellation
      && (
        (recentPpjPayment && !recentPpjPayment.recovery_credit_restored_at && isRecentPaymentAttempt(recentPpjPayment.created_at))
        || (recentOveragePayment && isRecentPaymentAttempt(recentOveragePayment.created_at))
      )
  )

  const protectedCancelledPayment = Boolean(
    returnedFromPayment
      && !activeRequest
      && recentPpjPayment?.recovery_credit_restored_at
      && isRecentOperationalNotice(recentPpjPayment.recovery_credit_restored_at)
  )

  if (paymentFinalizing) {
    logger.info({
      event: 'provider_dashboard_payment_finalizing_state',
      provider_id: user.id,
      request_id: recentPpjPayment?.request_id ?? recentOveragePayment?.request_id,
      payment_status: recentPpjPayment?.status ?? recentOveragePayment?.status,
      payment_kind: recentPpjPayment ? 'ppj' : 'overage',
    })
  }

  const { data: providerLocation } = providerLocationResult

  const providerLocationUpdatedAt = providerLocation?.updated_at ?? null
  const providerIsOnline = operationalReady && isTimestampWithinMinutes(providerLocationUpdatedAt, PROVIDER_STALE_MINUTES)
  let requestFeedMode: RequestFeedMode = providerIsOnline ? 'nearby' : 'offline'
  let openRequests: NearbyOpenRequestRow[] | FallbackOpenRequestRow[] | null = null

  if (operationalReady && providerIsOnline) {
    const { data: nearbyRequests } = await supabase
      .rpc('get_nearby_open_requests', {
        p_radius: PROVIDER_RADIUS_METERS,
        p_limit: 20,
      })
      .returns<NearbyOpenRequestRow[]>()

    if (Array.isArray(nearbyRequests) && nearbyRequests.length > 0) {
      openRequests = nearbyRequests
    }
  }

  if (operationalReady && (!openRequests || openRequests.length === 0)) {
    const { data: fallbackRequests } = await admin
      .from('requests')
      .select('id, problem_type, status, accepted_by, created_at, destination, destination_area, fuzzy_latitude, fuzzy_longitude')
      .in('status', ['open', 'quoted'])
      .is('accepted_by', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<FallbackOpenRequestRow[]>()

    openRequests = Array.isArray(fallbackRequests) ? fallbackRequests : []
    requestFeedMode = providerIsOnline ? 'fallback' : 'offline'
  }

  if (openRequests && openRequests.length > 0) {
    const requestIds = openRequests.map((r) => r.id)
    const { data: existingQuotes } = await admin
      .from('request_quotes')
      .select('request_id')
      .eq('provider_id', provider.id)
      .in('request_id', requestIds)

    if (existingQuotes && existingQuotes.length > 0) {
      const quotedIds = new Set(existingQuotes.map((q) => q.request_id))
      openRequests = (openRequests as Array<NearbyOpenRequestRow | FallbackOpenRequestRow>).filter((r) => !quotedIds.has(r.id)) as NearbyOpenRequestRow[] | FallbackOpenRequestRow[]
    }
  }

  const { data: recentJobs } = recentJobsResult

  const allowance = getProviderAllowance({
    plan: provider.plan,
    jobsThisMonth: provider.jobs_this_month,
    jobCreditBalance: provider.job_credit_balance,
  })
  const providerCoords = (providerLocation?.lat != null && providerLocation?.lng != null)
    ? { lat: providerLocation.lat, lng: providerLocation.lng }
    : null

  const providerUaeLocation = providerCoords ? getUaeLocation(providerCoords.lat, providerCoords.lng) : null

  const nearbyOpenRequests: NearbyOpenRequestRow[] = Array.isArray(openRequests)
    ? openRequests.map((request) => {
        let computedDistance: number | null = 'distance_meters' in request ? (request as NearbyOpenRequestRow).distance_meters : null
        const row = request as FallbackOpenRequestRow
        if (computedDistance === null && providerCoords && row.fuzzy_latitude != null && row.fuzzy_longitude != null) {
          computedDistance = Math.round(distanceKm(providerCoords, { lat: row.fuzzy_latitude, lng: row.fuzzy_longitude }) * 1000)
        }
        const uaeLocation = (row.fuzzy_latitude != null && row.fuzzy_longitude != null)
          ? getUaeLocation(row.fuzzy_latitude, row.fuzzy_longitude)
          : null
        return {
          ...request,
          location: null,
          location_address: null,
          note: null,
          fuzzy_latitude: row.fuzzy_latitude ?? null,
          fuzzy_longitude: row.fuzzy_longitude ?? null,
          uae_emirate: uaeLocation?.emirate ?? null,
          uae_emirate_ar: uaeLocation?.emirateAr ?? null,
          uae_area: uaeLocation?.area ?? null,
          uae_area_ar: uaeLocation?.areaAr ?? null,
          price_estimate_min: 'price_estimate_min' in request ? (request as NearbyOpenRequestRow).price_estimate_min : null,
          price_estimate_max: 'price_estimate_max' in request ? (request as NearbyOpenRequestRow).price_estimate_max : null,
          distance_meters: computedDistance,
          distance_to_provider_m: 'distance_to_provider_m' in request ? (request as NearbyOpenRequestRow).distance_to_provider_m : null,
        }
      })
    : []
  const activeLocation = activeRequest ? getProviderLocationDisplay(activeRequest) : null
  const totalEarnings = (recentJobs ?? []).reduce((sum, job) => {
    return sum + (job.completed_at || job.requests?.status === 'completed' ? job.requests?.final_price ?? 0 : 0)
  }, 0)
  const upgradePrompt = provider.plan === 'pay_per_job'
    ? {
        title: t('ppjUpgradeTitle', { fee: PAY_PER_JOB_PROMO_FEE_AED }),
        subtitle: t('ppjUpgradeSubtitle'),
        creditNote: (provider.ppj_recovery_credits ?? 0) > 0
          ? provider.ppj_recovery_credits === 1
            ? t('ppjRecoveryCredits', { count: provider.ppj_recovery_credits! })
            : t('ppjRecoveryCreditsPlural', { count: provider.ppj_recovery_credits! })
          : null,
        href: '/provider/subscribe',
        label: t('upgradeMonthlyPlan'),
      }
    : provider.plan === 'starter'
      ? {
          title: t('starterUpgradeTitle'),
          subtitle: t('starterUpgradeSubtitle'),
          creditNote: allowance.creditBalance > 0
            ? t('preservedUpgradeCredits', { count: allowance.creditBalance })
            : null,
          href: '/provider/subscribe?plan=pro',
          label: t('increaseMonthlyCapacity'),
        }
      : provider.plan === 'pro'
        ? {
            title: t('proUpgradeTitle'),
            subtitle: t('proUpgradeSubtitle'),
            creditNote: allowance.creditBalance > 0
              ? t('preservedUpgradeCredits', { count: allowance.creditBalance })
              : null,
            href: '/provider/subscribe?plan=business',
            label: t('upgradeBusiness'),
          }
        : null
  const recentActivityItems = (recentJobs ?? []).map((job) => {
    const activity = recentActivityStatus(job, t)
    return {
      id: job.id,
      problemLabel: job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : t('serviceDefault'),
      badgeLabel: activity.label,
      badgeVariant: activity.badge,
      location: safeActivityLocation(job.requests?.location_address, t),
      amount: job.completed_at || job.requests?.status === 'completed'
        ? job.requests?.final_price ? `${job.requests.final_price} AED` : t('completed')
        : t('dash'),
      date: activity.date ? new Date(activity.date).toLocaleDateString('en-AE') : t('dateUnavailable'),
    }
  })

  return (
    <>
      <NavbarServer />
      <main className="min-h-screen bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <ProviderDashboardHeader
            name={provider.users?.name?.split(' ')[0] ?? t('providerDefault')}
            rating={provider.rating}
            status={provider.status}
            planLabel={getPlanLabel(provider.plan)}
            verified={provider.verified_badge}
            hasRecentJobs={Boolean(recentJobs?.length)}
          />

          {/* REALTIME REFRESH */}
          {operationalReady && (
            <ProviderRealtimeRefresh
              providerId={user.id}
              // During the PPJ payment window there is no active job yet, so the
              // per-request channel subscribes to the held request instead — a
              // customer cancellation then triggers a refresh that unmounts the
              // payment card and surfaces the cancellation notice.
              activeRequestId={activeRequest?.id ?? pendingPaymentRequest?.id ?? null}
            />
          )}

          {/* OPERATIONAL READY NOTICE */}
          {operationalReady && (
            <div className="mb-6 flex max-w-3xl items-center gap-3 rounded-lg border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-sm text-[#0F6E56]">
              <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{t('activeDispatchNotice')}</span>
            </div>
          )}

          {/* ONBOARDING CHECKLIST */}
          <ProviderOnboardingChecklist
            name={provider.users?.name ?? null}
            email={provider.users?.email ?? null}
            phone={provider.users?.phone ?? null}
            plan={provider.plan}
            status={provider.status}
            verifiedBadge={provider.verified_badge}
            documents={provider.documents}
          />

          {/* NOT READY STATE */}
          {!operationalReady && (
            <Card className="mb-6 border-slate-200 bg-white shadow-sm">
              <CardBody>
                <div className="max-w-2xl">
                  <h2 className="text-lg font-semibold text-slate-900">{t('notReadyTitle')}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {t('notReadyDesc')}
                  </p>
                  {provider.status === 'suspended' ? (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                      {t('suspendedSupport')}{' '}
                      <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline hover:text-red-900">
                        {t('emailSupport')}
                      </a>
                    </p>
                  ) : (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {t('dashboardAppearsActive')}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {/* OPERATIONAL DASHBOARD */}
          {operationalReady && (
            <>
              {/* SUSPENDED NOTICE */}
              {provider.status === 'suspended' && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="font-semibold text-red-800">{t('accountSuspended')}</p>
                  <p className="mt-1 text-sm text-red-700">
                    {t('contactSupport')}{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline hover:text-red-900">
                      {t('emailSupport')}
                    </a>
                  </p>
                </div>
              )}

              {/* AVAILABILITY TOGGLE */}
              <div className="mb-6 block w-full clear-both overflow-visible">
                <ProviderAvailabilityToggle
                  providerStatus={provider.status}
                  initialOnline={providerIsOnline}
                  initialUpdatedAt={providerLocationUpdatedAt}
                  disabledReason={availabilityDisabledReason}
                  hasActiveJob={Boolean(activeRequest)}
                  activeRequestId={activeRequest?.id ?? null}
                  providerPlan={provider.plan}
                />
              </div>
              {/* STAT CARDS */}
              <ProviderStatsGrid
                jobsThisMonth={provider.jobs_this_month}
                planLabel={getPlanLabel(provider.plan)}
                isPayPerJob={allowance.isPayPerJob}
                isUnlimited={allowance.isUnlimited}
                remainingJobs={allowance.remaining}
                totalEarnings={totalEarnings}
              />

              {/* UPGRADE BANNER */}
              {upgradePrompt && (
                <ProviderUpgradeNotice
                  title={upgradePrompt.title}
                  subtitle={upgradePrompt.subtitle}
                  creditNote={upgradePrompt.creditNote}
                  href={upgradePrompt.href}
                  label={upgradePrompt.label}
                />
              )}

              {/* BUSINESS PLAN NOTICE */}
              {provider.plan === 'business' && (
                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-semibold text-slate-800">{t('highestPlanTitle')}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{t('highestPlanDesc')}</p>
                </div>
              )}

              {/* PPJ RECOVERY CREDITS */}
              {provider.plan === 'pay_per_job' && (provider.ppj_recovery_credits ?? 0) > 0 && (
                <Card className="mb-6 border-green-200 bg-green-50 shadow-sm">
                  <CardBody>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-green-900">
                          {provider.ppj_recovery_credits === 1
                            ? t('oneRecoveryCredit')
                            : t('multipleRecoveryCredits', { count: provider.ppj_recovery_credits! })}
                        </h2>
                        <p className="mt-1 text-sm text-green-800">
                          {t('recoveryCreditsDesc')}
                        </p>
                        <p className="mt-1 text-xs text-green-700">
                          {t('nextPpjCredit')}
                        </p>
                      </div>
                      <Badge variant="success" className="w-fit">
                        {provider.ppj_recovery_credits === 1
                          ? t('creditCount', { count: provider.ppj_recovery_credits! })
                          : t('creditCountPlural', { count: provider.ppj_recovery_credits! })}
                      </Badge>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* PAYMENT FINALIZING */}
              {paymentFinalizing && (
                <Card className="mb-6 border-amber-200 bg-amber-50 shadow-sm">
                  <CardBody>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-amber-900">{t('paymentFinalizingTitle')}</h2>
                        <p className="mt-1 text-sm text-amber-800">
                          {recentPpjPayment
                            ? t('paymentProtectedDesc')
                            : t('assignmentDesc')}
                        </p>
                      </div>
                      <a
                        href="/provider/dashboard"
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                      >
                        {t('refreshStatus')}
                      </a>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* PROTECTED CANCELLED PAYMENT */}
              {protectedCancelledPayment && (
                <Card className="mb-6 border-green-200 bg-green-50 shadow-sm">
                  <CardBody>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-green-900">{t('protectedCancelledTitle')}</h2>
                        <p className="mt-1 text-sm text-green-800">
                          {t('protectedCancelledDesc')}
                        </p>
                      </div>
                      <Badge variant="success" className="w-fit">{t('creditRestored')}</Badge>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* CUSTOMER CANCELLATION NOTICE */}
              {recentCustomerCancellation && isRecentOperationalNotice(recentCustomerCancellation.cancelled_at) && (
                <Card className="mb-6 border-slate-200 bg-white shadow-sm">
                  <CardBody>
                    <div className="flex flex-col gap-1">
                      <h2 className="font-semibold text-slate-900">{t('customerCancelledRequest')}</h2>
                      <p className="text-sm text-slate-600">
                        {recentCustomerCancellation.problem_type
                          ? t('problemCancelledByCustomer', { problem: getProblemLabel(recentCustomerCancellation.problem_type) })
                          : t('recentRequestCancelledByCustomer')}
                        {' '}
                        {/* accepted_at is null when the cancel happened during the PPJ
                            payment window — nothing was paid, so avoid the misleading
                            "payment protected" / "usage restored" copy. */}
                        {recentCustomerCancellation.accepted_at === null
                          ? tPpjPrompt('cancelledByCustomer')
                          : provider.plan === 'pay_per_job'
                            ? t('ppjPaymentProtected')
                            : t('usageRestored')}
                      </p>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* PPJ: price accepted — pay the fee to reveal details + start the job */}
              {pendingPaymentRequest && !activeRequest && (
                <PpjPaymentPrompt
                  requestId={pendingPaymentRequest.id}
                  feeAed={getPayPerJobFee(0)}
                  paymentWindowStartedAt={pendingPaymentRequest.payment_window_started_at}
                />
              )}

              {/* ACTIVE JOB */}
              {activeRequest && (
                <Card className="mb-6 overflow-hidden rounded-lg border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-slate-200 bg-white">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('assignedNow')}</p>
                      <h2 className="mt-1 text-xl font-medium text-slate-950">{t('activeJob')}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {t('activeJobDesc')}
                      </p>
                    </div>
                  </CardHeader>
                  {activeRequest.accepted_at && (
                    <div className="border-b border-slate-200 px-6 py-3">
                      <SlaTimer acceptedAt={activeRequest.accepted_at} />
                    </div>
                  )}
                  <CardBody>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">{getProblemLabel(activeRequest.problem_type)}</div>
                        {(activeRequest.price_estimate_min != null || activeRequest.price_estimate_max != null) && (
                          <div className="mt-1 text-sm text-slate-500">
                            {t('estimated')}{' '}
                            {activeRequest.price_estimate_min != null && activeRequest.price_estimate_max != null
                              ? t('estimatedRange', { min: activeRequest.price_estimate_min, max: activeRequest.price_estimate_max })
                              : activeRequest.price_estimate_min != null
                              ? t('estimatedFrom', { min: activeRequest.price_estimate_min })
                              : t('estimatedUpTo', { max: activeRequest.price_estimate_max! })}
                          </div>
                        )}
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0F6E56]" aria-hidden="true" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-800">
                                {activeLocation?.label ?? t('locationDetailsUnavailable')}
                              </div>
                              {activeLocation?.detail ? (
                                <div className="mt-0.5 text-xs text-slate-500">{activeLocation.detail}</div>
                              ) : null}
                              <div className="mt-1 text-xs text-slate-500">
                                {formatApproxDistance(activeRequest.distance_to_provider_m, t)}
                              </div>
                            </div>
                          </div>
                          <LocationActions coordinates={activeLocation?.coordinates ?? null} />
                        </div>
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('customerContact')}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-800">
                            {activeRequest.users?.name ?? t('customerDefault')}
                          </div>
                          {activeRequest.users?.phone ? (
                            <a
                              href={`tel:${activeRequest.users.phone}`}
                              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 sm:w-auto"
                            >
                              {t('callCustomer')}
                            </a>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">{t('customerPhoneUnavailable')}</p>
                          )}
                        </div>
                        {activeRequest.note && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('locationNotes')}</div>
                            <p className="mt-1 text-sm text-slate-600">{activeRequest.note}</p>
                          </div>
                        )}
                      </div>
                      <Badge variant="warning" className="w-fit">
                        {activeRequest.status === 'in_progress' ? t('statusInProgress')
                          : activeRequest.status === 'arrived' ? t('statusArrived')
                          : activeRequest.status === 'en_route' ? t('statusEnRoute')
                          : t('statusAccepted')}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {(['accepted', 'en_route', 'arrived'] as const).includes(activeRequest.status as 'accepted' | 'en_route' | 'arrived') && (
                        <JobStateAdvanceButton
                          requestId={activeRequest.id}
                          currentStatus={activeRequest.status}
                        />
                      )}
                      {(activeRequest.status === 'in_progress' || activeRequest.status === 'arrived') && (
                        <CompleteJobForm requestId={activeRequest.id} />
                      )}
                      {activeRequest.status !== 'in_progress' && (
                        <ReleaseJobButton requestId={activeRequest.id} providerPlan={provider.plan} />
                      )}
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* REQUEST LIST */}
              <ProviderRequestList
                key={`${providerIsOnline ? 'nearby' : 'fallback'}-${nearbyOpenRequests.map((request) => request.id).join('-')}`}
                requests={nearbyOpenRequests}
                providerStatus={provider.status}
                providerPlan={provider.plan}
                providerOnline={providerIsOnline}
                locationFallback={requestFeedMode !== 'nearby'}
                requestFeedMode={requestFeedMode}
                ppjRecoveryCredits={provider.ppj_recovery_credits ?? 0}
                providerEmirate={providerUaeLocation?.emirate ?? null}
                providerArea={providerUaeLocation?.area ?? null}
              />

              {/* RECENT ACTIVITY */}
              <ProviderRecentActivitySection items={recentActivityItems} />
            </>
          )}
        </div>
      </main>
    </>
  )
}
