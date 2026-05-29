import { redirect } from 'next/navigation'
import { BriefcaseBusiness, CreditCard, MapPin, ShieldCheck, Star, TrendingUp, WalletCards } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import Badge from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getPlanLabel, getProblemLabel } from '@/lib/utils'
import { isTimestampWithinMinutes } from '@/lib/geo'
import { getProviderAllowance } from '@/lib/provider-allowance'
import { getProviderOnboardingState, providerDocumentLabel } from '@/lib/provider-onboarding'
import ProviderRequestList from '@/components/forms/ProviderRequestList'
import CompleteJobForm from '@/components/forms/CompleteJobForm'
import ProviderOnboardingChecklist from '@/components/provider/ProviderOnboardingChecklist'
import ProviderAvailabilityToggle from '@/components/provider/ProviderAvailabilityToggle'
import LocationActions from '@/components/provider/LocationActions'
import { getProviderLocationDisplay } from '@/lib/location-display'
import type { Metadata } from 'next'
import { PAY_PER_JOB_PROMO_FEE_AED, PROVIDER_RADIUS_METERS, PROVIDER_STALE_MINUTES } from '@/types'
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
    final_price: number | null
  } | null
}

type ProviderLocationRow = {
  updated_at: string | null
}

type FallbackOpenRequestRow = Omit<DashboardRequestRow, 'location' | 'location_address' | 'price_estimate_min' | 'price_estimate_max'>
type RequestFeedMode = 'nearby' | 'fallback' | 'offline'

function formatApproxDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return 'Distance unavailable'
  if (meters < 1000) return `Approx. ${Math.round(meters)} m away`
  return `Approx. ${(meters / 1000).toFixed(1)} km away`
}

export default async function ProviderDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/provider/dashboard')

  const { data: provider } = await supabase
    .from('providers')
    .select('*, users(name, email, phone)')
    .eq('id', user.id)
    .single<ProviderDashboardRow>()

  if (!provider) redirect('/provider/register')

  const statusVariant = provider.status === 'active' ? 'success' : provider.status === 'suspended' ? 'danger' : 'warning'
  const roundedRating = Math.round(provider.rating)
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
  const { data: activeRequest } = operationalReady
    ? await supabase
      .from('requests')
      .select('*')
      .eq('accepted_by', user.id)
      .in('status', ['accepted', 'in_progress'])
      .maybeSingle<DashboardRequestRow>()
    : { data: null }

  const { data: providerLocation } = operationalReady
    ? await supabase
      .from('provider_locations')
      .select('updated_at')
      .eq('provider_id', user.id)
      .maybeSingle<ProviderLocationRow>()
    : { data: null }

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
    const { data: fallbackRequests } = await supabase
      .from('requests')
      .select('id, customer_id, problem_type, note, status, accepted_by, final_price, created_at, distance_to_provider_m')
      .eq('status', 'open')
      .is('accepted_by', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<FallbackOpenRequestRow[]>()

    openRequests = Array.isArray(fallbackRequests) ? fallbackRequests : []
    requestFeedMode = providerIsOnline ? 'fallback' : 'offline'
  }

  const { data: recentJobs } = operationalReady
    ? await supabase
      .from('jobs')
      .select('*, requests(problem_type, location_address, final_price)')
      .eq('provider_id', user.id)
      .order('completed_at', { ascending: false })
      .limit(10)
      .returns<RecentJobRow[]>()
    : { data: null }

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
        price_estimate_min: 'price_estimate_min' in request ? request.price_estimate_min : null,
        price_estimate_max: 'price_estimate_max' in request ? request.price_estimate_max : null,
        distance_meters: 'distance_meters' in request ? request.distance_meters : null,
        distance_to_provider_m: 'distance_to_provider_m' in request ? request.distance_to_provider_m : null,
      }))
    : []
  const activeLocation = activeRequest ? getProviderLocationDisplay(activeRequest) : null
  const totalEarnings = (recentJobs ?? []).reduce((sum, job) => {
    return sum + (job.requests?.final_price ?? 0)
  }, 0)
  const upgradePrompt = provider.plan === 'pay_per_job'
    ? {
        title: `You're on Pay Per Job - ${PAY_PER_JOB_PROMO_FEE_AED} AED flat fee per accepted job`,
        subtitle: 'Upgrade to a monthly plan when you want predictable capacity and stronger queue priority.',
        creditNote: null,
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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Provider dashboard</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Welcome, {provider.users?.name?.split(' ')[0] ?? 'Provider'}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant} className="capitalize">{provider.status}</Badge>
                <Badge variant="info">{getPlanLabel(provider.plan)}</Badge>
                {provider.verified_badge && (
                  <Badge variant="success" className="gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Trusted Recovery Partner
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-left sm:text-right">
              <div className="flex items-center gap-1 sm:justify-end">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-5 w-5 ${star <= roundedRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                    aria-hidden="true"
                  />
                ))}
                <span className="ml-2 text-3xl font-bold text-slate-900">{provider.rating.toFixed(1)}</span>
              </div>
                <div className="mt-1 text-sm text-slate-500">Your rating</div>
                {!recentJobs?.length ? (
                  <div className="text-xs text-slate-400">Your first reviews will appear after completed jobs.</div>
                ) : null}
            </div>
          </div>
          </section>

          <ProviderOnboardingChecklist
            name={provider.users?.name ?? null}
            email={provider.users?.email ?? null}
            phone={provider.users?.phone ?? null}
            plan={provider.plan}
            status={provider.status}
            verifiedBadge={provider.verified_badge}
            documents={provider.documents}
          />

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
                      <a href="mailto:n7rawy19840@gmail.com" className="font-semibold underline hover:text-red-900">
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

          {operationalReady && (
          <>
          <ProviderAvailabilityToggle
            providerStatus={provider.status}
            initialOnline={providerIsOnline}
            initialUpdatedAt={providerLocationUpdatedAt}
            disabledReason={availabilityDisabledReason}
            hasActiveJob={Boolean(activeRequest)}
            activeRequestId={activeRequest?.id ?? null}
            providerPlan={provider.plan}
          />

          <div className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
            <Card className="min-h-[112px] border-slate-200 shadow-sm shadow-slate-200/60">
              <CardBody className="flex h-full flex-col justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-2xl font-bold text-slate-950">{provider.jobs_this_month}</div>
                <div className="text-sm text-slate-500">
                  {allowance.isPayPerJob ? 'Accepted jobs this month' : 'Monthly jobs used'}
                </div>
              </CardBody>
            </Card>
            <Card className="min-h-[112px] border-slate-200 shadow-sm shadow-slate-200/60">
              <CardBody className="flex h-full flex-col justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-2xl font-bold text-slate-950">
                  {allowance.isPayPerJob ? 'PPJ' : allowance.isUnlimited ? 'Unlimited' : allowance.remaining}
                </div>
                <div className="text-sm text-slate-500">
                  {allowance.isPayPerJob ? 'No monthly allowance' : 'Available jobs remaining'}
                </div>
                {allowance.creditBalance > 0 && allowance.hasMonthlyAllowance ? (
                  <div className="text-xs text-green-600 mt-1">Includes preserved upgrade credits.</div>
                ) : null}
                {allowance.isPayPerJob ? (
                  <div className="text-xs text-slate-400 mt-1">Pay only when you accept a request.</div>
                ) : null}
              </CardBody>
            </Card>
            <Card className="min-h-[112px] border-slate-200 shadow-sm shadow-slate-200/60">
              <CardBody className="flex h-full flex-col justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-2xl font-bold text-orange-500">{getPlanLabel(provider.plan)}</div>
                <div className="text-sm text-slate-500">Current access</div>
              </CardBody>
            </Card>
            <Card className="min-h-[112px] border-slate-200 shadow-sm shadow-slate-200/60">
              <CardBody className="flex h-full flex-col justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-600">
                  <WalletCards className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="text-2xl font-bold text-green-600">{totalEarnings > 0 ? `${totalEarnings} AED` : '-'}</div>
                <div className="text-sm text-slate-500">Earnings from last 10 jobs</div>
                {totalEarnings === 0 ? (
                  <div className="text-xs text-slate-400 mt-1">Completed jobs will build this total.</div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {upgradePrompt && (
            <div className="mb-6 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-orange-900 text-sm">
                  {upgradePrompt.title}
                </p>
                <p className="text-xs text-orange-700 mt-0.5">
                  {upgradePrompt.subtitle}
                </p>
                {upgradePrompt.creditNote ? (
                  <p className="mt-1 text-xs text-orange-700/80">
                    {upgradePrompt.creditNote}
                  </p>
                ) : null}
              </div>
              <a
                href={upgradePrompt.href}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                {upgradePrompt.label}
              </a>
            </div>
          )}

          {provider.plan === 'business' && (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="font-semibold text-slate-800 text-sm">You are on the highest plan.</p>
              <p className="text-xs text-slate-500 mt-0.5">Business includes unlimited jobs, highest priority, and no premium commission.</p>
            </div>
          )}

          {provider.status === 'suspended' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-red-800 font-semibold">Account Suspended</p>
              <p className="text-red-700 text-sm mt-1">
                Contact support to resolve your account status.{' '}
                <a href="mailto:n7rawy19840@gmail.com" className="underline font-semibold hover:text-red-900">
                  Email support
                </a>
              </p>
            </div>
          )}

          {activeRequest && (
            <Card className="mb-6 overflow-hidden border-orange-200 bg-orange-50 shadow-sm shadow-orange-100/70">
              <CardHeader className="bg-orange-100 border-orange-200">
                <h2 className="font-bold text-orange-900">Active Job</h2>
              </CardHeader>
              <CardBody>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800">{getProblemLabel(activeRequest.problem_type)}</div>
                    <div className="mt-3 rounded-xl border border-orange-100 bg-white/80 p-4">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
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
                    {activeRequest.note && <div className="text-sm text-slate-500 mt-1">Note: {activeRequest.note}</div>}
                  </div>
                  <Badge variant="warning" className="w-fit capitalize">{activeRequest.status}</Badge>
                </div>
                <CompleteJobForm requestId={activeRequest.id} />
              </CardBody>
            </Card>
          )}

          <ProviderRequestList
            key={`${providerIsOnline ? 'nearby' : 'fallback'}-${nearbyOpenRequests.map((request) => request.id).join('-')}`}
            requests={nearbyOpenRequests}
            providerStatus={provider.status}
            providerPlan={provider.plan}
            providerOnline={providerIsOnline}
            locationFallback={requestFeedMode !== 'nearby'}
            requestFeedMode={requestFeedMode}
          />

          <Card className="mt-6 overflow-hidden shadow-sm shadow-slate-200/70">
            <CardHeader className="border-slate-100 bg-white">
              <h2 className="font-semibold text-slate-900">Recent Completed Jobs</h2>
              <p className="mt-1 text-sm text-slate-500">Your latest completed work and recent earnings history.</p>
            </CardHeader>
            <CardBody className="p-0">
              {recentJobs && recentJobs.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center sm:px-6">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">{job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : 'Service'}</div>
                        <div className="text-sm text-slate-500 truncate">{job.requests?.location_address}</div>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="font-semibold text-slate-800">{job.requests?.final_price ? `${job.requests.final_price} AED` : '-'}</div>
                        <div className="text-xs text-slate-400">{job.completed_at ? new Date(job.completed_at).toLocaleDateString() : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-14 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><BriefcaseBusiness className="h-5 w-5" aria-hidden="true" /></div>
                  <p className="font-semibold text-slate-800">No completed jobs yet</p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Your first completed jobs, prices, and earning history will appear here.</p>
                </div>
              )}
            </CardBody>
          </Card>
          </>
          )}
        </div>
      </main>
    </>
  )
}

