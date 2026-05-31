import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { getProblemLabel } from '@/lib/utils'
import type { Metadata } from 'next'
import type { ProblemType, RequestStatus } from '@/types'

export const metadata: Metadata = {
  title: 'All Requests - Admin',
  robots: { index: false, follow: false },
}

type AdminRequestRow = {
  id: string
  customer_id: string | null
  accepted_by: string | null
  problem_type: ProblemType
  location_address: string | null
  note: string | null
  status: RequestStatus
  price_estimate_min: number | null
  price_estimate_max: number | null
  final_price: number | null
  cancelled_at: string | null
  cancellation_actor: 'customer' | 'provider' | 'admin' | null
  cancellation_compensation_type: 'ppj_recovery_credit' | 'subscription_usage_restore' | 'none' | null
  created_at: string
}

type UserLookupRow = {
  id: string
  name: string | null
  phone: string | null
}

type ProviderLookupRow = {
  id: string
  users: {
    name: string | null
    phone: string | null
  } | null
}

type JobLookupRow = {
  request_id: string
  completed_at: string | null
}

function requestBadgeVariant(status: RequestStatus): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  if (status === 'completed') return 'success'
  if (status === 'open') return 'info'
  if (status === 'cancelled' || status === 'expired') return 'default'
  return 'warning'
}

function lifecycleLabel(request: AdminRequestRow, completedAt: string | null | undefined): string {
  if (request.status === 'cancelled') {
    return request.cancellation_actor
      ? `Cancelled by ${request.cancellation_actor}`
      : 'Cancelled'
  }
  if (request.status === 'completed') {
    return completedAt ? `Completed ${new Date(completedAt).toLocaleDateString('en-AE')}` : 'Completed'
  }
  if (request.status === 'open' && !request.accepted_by) return 'Waiting for provider'
  if (request.accepted_by) return 'Provider assigned'
  return 'Unassigned'
}

export default async function AdminRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (userData?.role !== 'admin') redirect('/')

  const admin = createAdminClient()
  const { data: requests, error: requestsError } = await admin
    .from('requests')
    .select('id, customer_id, accepted_by, problem_type, location_address, note, status, price_estimate_min, price_estimate_max, final_price, cancelled_at, cancellation_actor, cancellation_compensation_type, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<AdminRequestRow[]>()

  const requestRows = requests ?? []
  const customerIds = [...new Set(requestRows.map((request) => request.customer_id).filter((id): id is string => Boolean(id)))]
  const providerIds = [...new Set(requestRows.map((request) => request.accepted_by).filter((id): id is string => Boolean(id)))]
  const requestIds = requestRows.map((request) => request.id)

  const [{ data: customers }, { data: providers }, { data: jobs }] = await Promise.all([
    customerIds.length
      ? admin.from('users').select('id, name, phone').in('id', customerIds).returns<UserLookupRow[]>()
      : { data: [] as UserLookupRow[] },
    providerIds.length
      ? admin.from('providers').select('id, users(name, phone)').in('id', providerIds).returns<ProviderLookupRow[]>()
      : { data: [] as ProviderLookupRow[] },
    requestIds.length
      ? admin.from('jobs').select('request_id, completed_at').in('request_id', requestIds).returns<JobLookupRow[]>()
      : { data: [] as JobLookupRow[] },
  ])

  const customerById = new Map((customers ?? []).map((customer) => [customer.id, customer]))
  const providerById = new Map((providers ?? []).map((provider) => [provider.id, provider]))
  const jobByRequestId = new Map((jobs ?? []).map((job) => [job.request_id, job]))

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Operational requests</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">All Requests</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Monitor customer roadside requests, assignment state, cancellations, and completions.
                </p>
              </div>
              <a href="/admin/dashboard" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">Back to Dashboard</a>
            </div>
          </div>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader>
              <h2 className="font-semibold text-slate-800">Recent Requests ({requestRows.length})</h2>
              {requestsError && (
                <p className="mt-1 text-sm text-red-600">
                  Request data could not be loaded: {requestsError.message}
                </p>
              )}
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Type', 'Customer', 'Location', 'Status', 'Provider', 'Lifecycle', 'Value', 'Time'].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requestRows.map((request) => {
                      const customer = request.customer_id ? customerById.get(request.customer_id) : null
                      const provider = request.accepted_by ? providerById.get(request.accepted_by) : null
                      const job = jobByRequestId.get(request.id)

                      return (
                        <tr key={request.id} className="align-top hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <div className="font-medium text-slate-800">{getProblemLabel(request.problem_type)}</div>
                            <div className="mt-1 font-mono text-xs text-slate-400">{request.id.slice(0, 8)}</div>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <div>{customer?.name ?? 'Customer unavailable'}</div>
                            <div className="text-xs text-slate-400">{customer?.phone ?? 'No phone'}</div>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <div className="max-w-[260px] break-words">{request.location_address ?? '-'}</div>
                            {request.note && <div className="mt-1 max-w-[260px] break-words text-xs text-slate-400">{request.note}</div>}
                          </td>
                          <td className="px-5 py-4">
                            <Badge variant={requestBadgeVariant(request.status)} className="capitalize">
                              {request.status.replace('_', ' ')}
                            </Badge>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <div>{provider?.users?.name ?? 'Not assigned'}</div>
                            <div className="text-xs text-slate-400">
                              {provider?.users?.phone ?? (request.accepted_by ? 'Provider contact unavailable' : 'Open request')}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <div>{lifecycleLabel(request, job?.completed_at)}</div>
                            {request.status === 'cancelled' && request.cancellation_compensation_type && (
                              <div className="mt-1 text-xs text-slate-400">
                                Compensation: {request.cancellation_compensation_type.replaceAll('_', ' ')}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {request.final_price
                              ? `${request.final_price} AED`
                              : request.price_estimate_min && request.price_estimate_max
                                ? `${request.price_estimate_min}-${request.price_estimate_max} AED`
                                : '-'}
                          </td>
                          <td className="px-5 py-4 text-xs text-slate-400">
                            {new Date(request.created_at).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {request.cancelled_at && (
                              <div className="mt-1">Cancelled {new Date(request.cancelled_at).toLocaleDateString('en-AE')}</div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {requestRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-14 text-center">
                          <p className="font-semibold text-slate-700">No customer requests yet.</p>
                          <p className="mt-1 text-sm text-slate-500">Roadside requests will appear here as customers create them.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  )
}
