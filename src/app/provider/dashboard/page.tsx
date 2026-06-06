import { redirect } from 'next/navigation'
import { MapPin, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import Badge from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getPlanLabel, getProblemLabel } from '@/lib/utils'
import { isTimestampWithinMinutes } from '@/lib/geo'
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
import { getProviderLocationDisplay } from '@/lib/location-display'
import { logger } from '@/lib/logger'
import type { Metadata } from 'next'
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
  price_estimate_min: number | null
  price_estimate_max: number | null
  final_price: number | null
  created_at: string
  distance_to_provider_m: number | null
  users?: {
    name: string | null
    phone: string | null
  } | null
}

type NearbyOpenRequestRow = DashboardRequestRow & {
  distance_meters: number | null
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
}

type FallbackOpenRequestRow = Omit<DashboardRequestRow, 'location' | 'location_address' | 'price_estimate_min' | 'price_estimate_max'>
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
}

function formatApproxDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return 'Distance unavailable'
  if (meters < 1000) return `Approx. ${Math.round(meters)} m away`
  return `Approx. ${(meters / 1000).toFixed(1)} km away`
}

function isRecentPaymentAttempt(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  return Date.now() - new Date(createdAt).getTime() < 15 * 60 * 1000
}

function isRecentOperationalNotice(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000
}

function recentActivityStatus(job: RecentJobRow): {
  label: string
  badge: 'success' | 'warning' | 'danger' | 'info' | 'default'
  detail: string
  date: string | null
} {
  const request = job.requests

  if (job.completed_at || request?.status === 'completed') {
    return {
      label: 'Completed',
      badge: 'success',
      detail: request?.final_price ? `${request.final_price} AED` : 'Completed service',
      date: job.completed_at ?? request?.created_at ?? null,
    }
  }

  if (request?.status === 'cancelled') {
    const customerCancelled = request.cancellation_actor === 'customer'
    return {
      label: customerCancelled ? 'Customer cancelled' : 'Cancelled',
      badge: 'default',
      detail: customerCancelled ? 'Customer cancelled this request' : 'Request was cancelled',
      date: request.cancelled_at ?? request.created_at,
    }
  }

  if (request?.status === 'open' && !request.accepted_by) {
    return {
      label: 'Released by you',
      badge: 'warning',
      detail: 'You released this request',
      date: request.created_at,
    }
  }

  return {
    label: 'Activity',
    badge: 'info',
    detail: 'Request activity',
    date: request?.created_at ?? null,
  }
}

function safeActivityLocation(address: string | null | undefined): string {
  const display = getProviderLocationDisplay({ location_address: address ?? null })
  if (display.label === 'Location details unavailable') return 'Location unavailable'
  if (display.label === 'GPS location') return 'GPS location'
  return display.label
}

export default async function ProviderDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string; payment_intent?: string; redirect_status?: string }>
}) {
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
      ? 'Your account is suspended. Contact support to resolve your account status before going online.'
      : !onboarding.profileComplete
      ? 'Complete your provider profile before going online for dispatch.'
      : !onboarding.documentsComplete
        ? `Upload required documents before going online. Missing: ${onboarding.missingDocuments.map(providerDocumentLabel).join(', ')}.`
        : !onboarding.planComplete
          ? 'Choose your access plan before going online for dispatch.'
          : 'Your documents are under review. RescueGo will activate your account after verification.'
  const admin = createAdminClient()
  const [
    activeRequestResult,
    providerLocationResult,
    recentJobsResult,
  ] = await Promise.all([
    operationalReady
      ? admin
        .from('requests')
        .select('*')
        .eq('accepted_by', user.id)
        .in('status', ['accepted', 'in_progress'])
        .maybeSingle<DashboardRequestRow>()
      : Promise.resolve({ data: null, error: null }),
    operationalReady
      ? supabase
        .from('provider_locations')
        .select('updated_at')
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
        .select('id, problem_type, cancelled_at')
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
      .select('id, problem_type, status, accepted_by, created_at')
      .eq('status', 'open')
      .is('accepted_by', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<FallbackOpenRequestRow[]>()

    openRequests = Array.isArray(fallbackRequests) ? fallbackRequests : []
    requestFeedMode = providerIsOnline ? 'fallback' : 'offline'
  }

  const { data: recentJobs } = recentJobsResult

  const allowance = getProviderAllowance({
    plan: provider.plan,
    jobsThisMonth: provider.jobs_this_month,
    jobCreditBalance: provider.job_credit_balance,
  })
  const nearbyOpenRequests: NearbyOpenRequestRow[] = Array.isArray(openRequests)
    ? openRequests.map((request) => ({
        ...request,
        location: null,
        location_address: null,
        note: null,
        price_estimate_min: 'price_estimate_min' in request ? request.price_estimate_min : null,
        price_estimate_max: 'price_estimate_max' in request ? request.price_estimate_max : null,
        distance_meters: 'distance_meters' in request ? request.distance_meters : null,
        distance_to_provider_m: 'distance_to_provider_m' in request ? request.distance_to_provider_m : null,
      }))
    : []
  const activeLocation = activeRequest ? getProviderLocationDisplay(activeRequest) : null
  const totalEarnings = (recentJobs ?? []).reduce((sum, job) => {
    return sum + (job.completed_at || job.requests?.status === 'completed' ? job.requests?.final_price ?? 0 : 0)
  }, 0)
  const upgradePrompt = provider.plan === 'pay_per_job'
    ? {
        title: `You're on Pay Per Job - ${PAY_PER_JOB_PROMO_FEE_AED} AED flat fee per accepted job`,
        subtitle: 'Upgrade to a monthly plan when you want predictable capacity and stronger queue priority.',
        creditNote: (provider.ppj_recovery_credits ?? 0) > 0
          ? `${provider.ppj_recovery_credits} PPJ recovery credit${provider.ppj_recovery_credits === 1 ? '' : 's'} available for future accepted requests.`
          : null,
        href: '/provider/subscribe',
        label: 'Upgrade to a monthly plan',
      }
    : provider.plan === 'starter'
      ? {
          title: 'Starter includes 15 monthly jobs.',
          subtitle: 'Upgrade to Pro for 35 monthly jobs and high queue priority.',
          creditNote: allowance.creditBalance > 0
            ? `${allowance.creditBalance} preserved upgrade credits are available this billing cycle.`
            : null,
          href: '/provider/subscribe?plan=pro',
          label: 'Increase monthly capacity',
        }
      : provider.plan === 'pro'
        ? {
            title: 'Pro includes 35 monthly jobs.',
            subtitle: 'Upgrade to Business for unlimited jobs and no premium commission.',
            creditNote: allowance.creditBalance > 0
              ? `${allowance.creditBalance} preserved upgrade credits are available this billing cycle.`
              : null,
            href: '/provider/subscribe?plan=business',
            label: 'Upgrade to Business',
          }
        : null
  const recentActivityItems = (recentJobs ?? []).map((job) => {
    const activity = recentActivityStatus(job)
    return {
      id: job.id,
      problemLabel: job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : 'Service',
      badgeLabel: activity.label,
      badgeVariant: activity.badge,
      location: safeActivityLocation(job.requests?.location_address),
      amount: job.completed_at || job.requests?.status === 'completed'
        ? job.requests?.final_price ? `${job.requests.final_price} AED` : 'Completed'
        : '-',
      date: activity.date ? new Date(activity.date).toLocaleDateString('en-AE') : 'Date unavailable',
    }
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC]">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <ProviderDashboardHeader
            name={provider.users?.name?.split(' ')[0] ?? 'Provider'}
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
              activeRequestId={activeRequest?.id ?? null}
            />
          )}

          {/* OPERATIONAL READY NOTICE */}
          {operationalReady && (
            <div className="mb-6 flex max-w-3xl items-center gap-3 rounded-lg border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-sm text-[#0F6E56]">
              <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Your provider account is active for RescueGo dispatch operations.</span>
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
                  <h2 className="text-lg font-semibold text-slate-900">Operations unlock after onboarding is complete</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Finish the required provider setup and admin approval before accessing dispatch tools, request queues,
                    earnings, and live availability controls.
                  </p>
                  {provider.status === 'suspended' ? (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                      Your account is suspended. Contact support to resolve your account status.{' '}
                      <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline hover:text-red-900">
                        Email support
                      </a>
                    </p>
                  ) : (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Your operational dashboard will appear here automatically once your account is active.
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
                  <p className="font-semibold text-red-800">Account Suspended</p>
                  <p className="mt-1 text-sm text-red-700">
                    Contact support to resolve your account status.{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline hover:text-red-900">
                      Email support
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
                  <p className="text-sm font-semibold text-slate-800">You are on the highest plan.</p>
                  <p className="mt-0.5 text-xs text-slate-500">Business includes unlimited jobs, highest priority, and no premium commission.</p>
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
                            ? 'You have 1 recovery credit from a customer cancellation.'
                            : `You have ${provider.ppj_recovery_credits} recovery credits available.`}
                        </h2>
                        <p className="mt-1 text-sm text-green-800">
                          These credits automatically replace future PPJ acceptance payments.
                        </p>
                        <p className="mt-1 text-xs text-green-700">
                          Your next PPJ acceptance will use an available credit automatically.
                        </p>
                      </div>
                      <Badge variant="success" className="w-fit">
                        {provider.ppj_recovery_credits} credit{provider.ppj_recovery_credits === 1 ? '' : 's'}
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
                        <h2 className="font-semibold text-amber-900">Payment received. Finalizing job assignment...</h2>
                        <p className="mt-1 text-sm text-amber-800">
                          {recentPpjPayment
                            ? 'This payment is protected. If the customer cancels before assignment finishes, a recovery credit will be added automatically. Exact customer location and contact details appear only after assignment.'
                            : 'RescueGo is assigning this request now. Exact customer location and contact details appear only after assignment.'}
                        </p>
                      </div>
                      <a
                        href="/provider/dashboard"
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                      >
                        Refresh status
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
                        <h2 className="font-semibold text-green-900">Customer cancelled. Your payment was protected.</h2>
                        <p className="mt-1 text-sm text-green-800">
                          A PPJ recovery credit was restored automatically and will replace your next eligible acceptance payment.
                        </p>
                      </div>
                      <Badge variant="success" className="w-fit">Credit restored</Badge>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* CUSTOMER CANCELLATION NOTICE */}
              {recentCustomerCancellation && isRecentOperationalNotice(recentCustomerCancellation.cancelled_at) && (
                <Card className="mb-6 border-slate-200 bg-white shadow-sm">
                  <CardBody>
                    <div className="flex flex-col gap-1">
                      <h2 className="font-semibold text-slate-900">Customer cancelled this request.</h2>
                      <p className="text-sm text-slate-600">
                        {recentCustomerCancellation.problem_type
                          ? `${getProblemLabel(recentCustomerCancellation.problem_type)} was cancelled by the customer.`
                          : 'A recently assigned request was cancelled by the customer.'}
                        {' '}
                        {provider.plan === 'pay_per_job'
                          ? 'Your payment was protected, and any eligible recovery credit is handled automatically.'
                          : 'Any eligible usage restoration is handled automatically.'}
                      </p>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* ACTIVE JOB */}
              {activeRequest && (
                <Card className="mb-6 overflow-hidden rounded-lg border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-slate-200 bg-white">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Assigned now</p>
                      <h2 className="mt-1 text-xl font-medium text-slate-950">Active Job</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Customer contact and exact location are visible because this job is assigned to you.
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">{getProblemLabel(activeRequest.problem_type)}</div>
                        {(activeRequest.price_estimate_min != null || activeRequest.price_estimate_max != null) && (
                          <div className="mt-1 text-sm text-slate-500">
                            Estimated:{' '}
                            {activeRequest.price_estimate_min != null && activeRequest.price_estimate_max != null
                              ? `${activeRequest.price_estimate_min}–${activeRequest.price_estimate_max} AED`
                              : activeRequest.price_estimate_min != null
                              ? `from ${activeRequest.price_estimate_min} AED`
                              : `up to ${activeRequest.price_estimate_max} AED`}
                          </div>
                        )}
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0F6E56]" aria-hidden="true" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-800">
                                {activeLocation?.label ?? 'Location details unavailable'}
                              </div>
                              {activeLocation?.detail ? (
                                <div className="mt-0.5 text-xs text-slate-500">{activeLocation.detail}</div>
                              ) : null}
                              <div className="mt-1 text-xs text-slate-500">
                                {formatApproxDistance(activeRequest.distance_to_provider_m)}
                              </div>
                            </div>
                          </div>
                          <LocationActions coordinates={activeLocation?.coordinates ?? null} />
                        </div>
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer contact</div>
                          <div className="mt-1 text-sm font-semibold text-slate-800">
                            {activeRequest.users?.name ?? 'Customer'}
                          </div>
                          {activeRequest.users?.phone ? (
                            <a
                              href={`tel:${activeRequest.users.phone}`}
                              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 sm:w-auto"
                            >
                              Call customer
                            </a>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">Customer phone unavailable. Contact support.</p>
                          )}
                        </div>
                        {activeRequest.note && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Location notes</div>
                            <p className="mt-1 text-sm text-slate-600">{activeRequest.note}</p>
                          </div>
                        )}
                      </div>
                      <Badge variant="warning" className="w-fit">
                        {activeRequest.status === 'in_progress' ? 'In Progress' : 'Accepted'}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                      <CompleteJobForm requestId={activeRequest.id} />
                      <ReleaseJobButton requestId={activeRequest.id} providerPlan={provider.plan} />
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
