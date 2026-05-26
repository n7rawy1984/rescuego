import { redirect } from 'next/navigation'
import { ShieldCheck, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import Badge from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getPlanLabel, getProblemLabel } from '@/lib/utils'
import { isTimestampWithinMinutes } from '@/lib/geo'
import ProviderRequestList from '@/components/forms/ProviderRequestList'
import CompleteJobForm from '@/components/forms/CompleteJobForm'
import ProviderOnboardingChecklist from '@/components/provider/ProviderOnboardingChecklist'
import ProviderAvailabilityToggle from '@/components/provider/ProviderAvailabilityToggle'
import type { Metadata } from 'next'
import { PAY_PER_JOB_PROMO_FEE_AED, PROVIDER_STALE_MINUTES } from '@/types'
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
  location: { type: 'Point'; coordinates: [number, number] }
  location_address: string | null
  problem_type: ProblemType
  note: string | null
  status: RequestStatus
  accepted_by: string | null
  price_estimate_min: number | null
  price_estimate_max: number | null
  final_price: number | null
  created_at: string
}

type NearbyOpenRequestRow = Omit<DashboardRequestRow, 'location'> & {
  distance_meters: number
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

  const { data: openRequests } = await supabase
    .rpc('get_nearby_open_requests', {
      p_radius: 5000,
      p_limit: 20,
    })
    .returns<NearbyOpenRequestRow[]>()

  const { data: activeRequest } = await supabase
    .from('requests')
    .select('*')
    .eq('accepted_by', user.id)
    .in('status', ['accepted', 'in_progress'])
    .maybeSingle<DashboardRequestRow>()

  const { data: providerLocation } = await supabase
    .from('provider_locations')
    .select('updated_at')
    .eq('provider_id', user.id)
    .maybeSingle<ProviderLocationRow>()

  const { data: recentJobs } = await supabase
    .from('jobs')
    .select('*, requests(problem_type, location_address, final_price)')
    .eq('provider_id', user.id)
    .order('completed_at', { ascending: false })
    .limit(10)
    .returns<RecentJobRow[]>()

  const planLimit = provider.plan === 'starter' ? 15 : provider.plan === 'pro' ? 35 : null
  const jobCreditBalance = provider.job_credit_balance ?? 0
  const remaining = planLimit !== null ? Math.max(0, planLimit + jobCreditBalance - provider.jobs_this_month) : null
  const nearbyOpenRequests: NearbyOpenRequestRow[] = Array.isArray(openRequests) ? openRequests : []
  const providerLocationUpdatedAt = providerLocation?.updated_at ?? null
  const providerIsOnline = isTimestampWithinMinutes(providerLocationUpdatedAt, PROVIDER_STALE_MINUTES)
  const totalEarnings = (recentJobs ?? []).reduce((sum, job) => {
    return sum + (job.requests?.final_price ?? 0)
  }, 0)

  const statusVariant = provider.status === 'active' ? 'success' : provider.status === 'suspended' ? 'danger' : 'warning'
  const roundedRating = Math.round(provider.rating)

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Welcome, {provider.users?.name?.split(' ')[0] ?? 'Provider'}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant={statusVariant}>{provider.status}</Badge>
                <Badge variant="info">{getPlanLabel(provider.plan)}</Badge>
                {provider.verified_badge && (
                  <Badge variant="success" className="gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Trusted Recovery Partner
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-5 w-5 ${star <= roundedRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                    aria-hidden="true"
                  />
                ))}
                <span className="ml-2 text-3xl font-bold text-slate-900">{provider.rating.toFixed(1)}</span>
              </div>
                <div className="text-sm text-slate-500">Your rating</div>
                {!recentJobs?.length ? (
                  <div className="text-xs text-slate-400">Your first reviews will appear after completed jobs.</div>
                ) : null}
            </div>
          </div>

          <ProviderAvailabilityToggle
            providerStatus={provider.status}
            initialOnline={providerIsOnline}
            initialUpdatedAt={providerLocationUpdatedAt}
          />

          <ProviderOnboardingChecklist
            name={provider.users?.name ?? null}
            email={provider.users?.email ?? null}
            phone={provider.users?.phone ?? null}
            plan={provider.plan}
            status={provider.status}
            verifiedBadge={provider.verified_badge}
            documents={provider.documents}
          />

          <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4 sm:gap-4">
            <Card className="min-h-[80px]">
              <CardBody className="flex flex-col justify-center">
                <div className="text-2xl font-bold text-slate-900">{provider.jobs_this_month}</div>
                <div className="text-sm text-slate-500">Monthly jobs used</div>
              </CardBody>
            </Card>
            <Card className="min-h-[80px]">
              <CardBody className="flex flex-col justify-center">
                <div className="text-2xl font-bold text-slate-900">{remaining !== null ? remaining : '∞'}</div>
                <div className="text-sm text-slate-500">Included jobs left</div>
                {jobCreditBalance > 0 ? (
                  <div className="text-xs text-green-600 mt-1">Includes preserved upgrade credits.</div>
                ) : null}
              </CardBody>
            </Card>
            <Card className="col-span-2 min-h-[80px] sm:col-span-1">
              <CardBody className="flex flex-col justify-center">
                <div className="text-2xl font-bold text-orange-500">{getPlanLabel(provider.plan)}</div>
                <div className="text-sm text-slate-500">Current access</div>
              </CardBody>
            </Card>
            <Card className="min-h-[80px]">
              <CardBody className="flex flex-col justify-center">
                <div className="text-2xl font-bold text-green-600">{totalEarnings > 0 ? `${totalEarnings} AED` : '-'}</div>
                <div className="text-sm text-slate-500">Earnings from last 10 jobs</div>
                {totalEarnings === 0 ? (
                  <div className="text-xs text-slate-400 mt-1">Completed jobs will build this total.</div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {(provider.plan === 'pay_per_job' || provider.plan === 'starter') && (
            <div className="mb-6 rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-orange-900 text-sm">
                  {provider.plan === 'pay_per_job'
                    ? `You're on Pay Per Job - ${PAY_PER_JOB_PROMO_FEE_AED} AED flat fee per accepted job`
                    : 'You\'re on Starter — 15 jobs/month, normal queue priority'}
                </p>
                <p className="text-xs text-orange-700 mt-0.5">
                  {provider.plan === 'pay_per_job'
                    ? 'Upgrade to Pro for unlimited jobs with high queue priority.'
                    : 'Upgrade to Pro for 35 jobs/month and high queue priority.'}
                </p>
              </div>
              <a
                href="/provider/subscribe"
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                Increase monthly capacity
              </a>
            </div>
          )}

          {provider.status === 'pending' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
              <p className="text-yellow-800 font-semibold">Account Under Review</p>
              <p className="text-yellow-700 text-sm mt-1">Our team is reviewing your documents. You&apos;ll be activated after verification is complete.</p>
            </div>
          )}

          {provider.status === 'suspended' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-red-800 font-semibold">Account Suspended</p>
              <p className="text-red-700 text-sm mt-1">
                Contact support to resolve your account status.{' '}
                <a href="mailto:n7rawy19840@gmail.com" className="underline font-semibold hover:text-red-900">
                  Email support →
                </a>
              </p>
            </div>
          )}

          {activeRequest && (
            <Card className="mb-6 border-orange-200 bg-orange-50">
              <CardHeader className="bg-orange-100 border-orange-200">
                <h2 className="font-bold text-orange-900">Active Job</h2>
              </CardHeader>
              <CardBody>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-slate-800">{getProblemLabel(activeRequest.problem_type)}</div>
                    <div className="text-sm text-slate-600 mt-1">{activeRequest.location_address}</div>
                    {activeRequest.note && <div className="text-sm text-slate-500 mt-1">Note: {activeRequest.note}</div>}
                  </div>
                  <Badge variant="warning">{activeRequest.status}</Badge>
                </div>
                <CompleteJobForm requestId={activeRequest.id} />
              </CardBody>
            </Card>
          )}

          <ProviderRequestList
            requests={nearbyOpenRequests}
            providerStatus={provider.status}
            providerPlan={provider.plan}
            providerOnline={providerIsOnline}
          />

          <Card className="mt-6">
            <CardHeader>
              <h2 className="font-semibold text-slate-800">Recent Completed Jobs</h2>
            </CardHeader>
            <CardBody className="p-0">
              {recentJobs && recentJobs.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="px-6 py-4 flex justify-between items-center">
                      <div>
                        <div className="font-medium text-slate-800">{job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : 'Service'}</div>
                        <div className="text-sm text-slate-500">{job.requests?.location_address}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-800">{job.requests?.final_price ? `${job.requests.final_price} AED` : '-'}</div>
                        <div className="text-xs text-slate-400">{job.completed_at ? new Date(job.completed_at).toLocaleDateString() : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-12 text-center">
                  <div className="text-4xl mb-3">🚗</div>
                  <p className="font-medium text-slate-700">No completed jobs yet</p>
                  <p className="text-sm text-slate-500 mt-1">Your first completed jobs, prices, and earning history will appear here.</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  )
}
