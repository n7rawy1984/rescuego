import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import Badge from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getPlanLabel, getProblemLabel } from '@/lib/utils'
import ProviderRequestList from '@/components/forms/ProviderRequestList'
import CompleteJobForm from '@/components/forms/CompleteJobForm'
import type { Metadata } from 'next'
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
  verified_badge: boolean
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

type RecentJobRow = {
  id: string
  completed_at: string | null
  requests: {
    problem_type: ProblemType | null
    location_address: string | null
    final_price: number | null
  } | null
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
    .from('requests')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: activeRequest } = await supabase
    .from('requests')
    .select('*')
    .eq('accepted_by', user.id)
    .in('status', ['accepted', 'in_progress'])
    .maybeSingle<DashboardRequestRow>()

  const { data: recentJobs } = await supabase
    .from('jobs')
    .select('*, requests(problem_type, location_address, final_price)')
    .eq('provider_id', user.id)
    .order('completed_at', { ascending: false })
    .limit(10)
    .returns<RecentJobRow[]>()

  const planLimit = provider.plan === 'starter' ? 15 : provider.plan === 'pro' ? 35 : null
  const remaining = planLimit !== null ? Math.max(0, planLimit - provider.jobs_this_month) : null

  const statusVariant = provider.status === 'active' ? 'success' : provider.status === 'suspended' ? 'danger' : 'warning'

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Welcome, {provider.users?.name?.split(' ')[0] ?? 'Provider'}</h1>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={statusVariant}>{provider.status}</Badge>
                <Badge variant="info">{getPlanLabel(provider.plan)}</Badge>
                {provider.verified_badge && <Badge variant="success">Verified</Badge>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-slate-900">{'⭐'.repeat(Math.round(provider.rating))} {provider.rating.toFixed(1)}</div>
              <div className="text-sm text-slate-500">Your rating</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-slate-900">{provider.jobs_this_month}</div>
                <div className="text-sm text-slate-500">Jobs This Month</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-slate-900">{remaining !== null ? remaining : '∞'}</div>
                <div className="text-sm text-slate-500">Jobs Remaining</div>
              </CardBody>
            </Card>
            <Card className="col-span-2 sm:col-span-1">
              <CardBody>
                <div className="text-2xl font-bold text-orange-500">{getPlanLabel(provider.plan)}</div>
                <div className="text-sm text-slate-500">Current Plan</div>
              </CardBody>
            </Card>
          </div>

          {provider.status === 'pending' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
              <p className="text-yellow-800 font-semibold">Account Under Review</p>
              <p className="text-yellow-700 text-sm mt-1">Our team is reviewing your documents. You&apos;ll be activated within 24 hours.</p>
            </div>
          )}

          {provider.status === 'suspended' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-red-800 font-semibold">Account Suspended</p>
              <p className="text-red-700 text-sm mt-1">Contact support to resolve your account status.</p>
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
            requests={openRequests ?? []}
            providerStatus={provider.status}
          />

          {recentJobs && recentJobs.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <h2 className="font-semibold text-slate-800">Recent Completed Jobs</h2>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-slate-100">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="px-6 py-4 flex justify-between items-center">
                      <div>
                        <div className="font-medium text-slate-800">{job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : 'Service'}</div>
                        <div className="text-sm text-slate-500">{job.requests?.location_address}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-800">{job.requests?.final_price ? `${job.requests.final_price} AED` : '—'}</div>
                        <div className="text-xs text-slate-400">{job.completed_at ? new Date(job.completed_at).toLocaleDateString() : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}
