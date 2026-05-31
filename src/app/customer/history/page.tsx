import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getProblemLabel } from '@/lib/utils'
import type { Metadata } from 'next'
import type { ProblemType, RequestStatus } from '@/types'

export const metadata: Metadata = {
  title: 'Your Request History',
  robots: { index: false, follow: false },
}

type RequestHistoryRow = {
  id: string
  problem_type: ProblemType
  location_address: string | null
  status: RequestStatus
  final_price: number | null
  created_at: string
}

type HistoryJobRow = {
  id: string
  request_id: string
  completed_at: string | null
}

const statusColors: Record<RequestStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  accepted: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-slate-100 text-slate-500',
}

const statusLabels: Record<RequestStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export default async function CustomerHistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/customer/history')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') redirect('/')

  const { data: requests } = await supabase
    .from('requests')
    .select('id, problem_type, location_address, status, final_price, created_at')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<RequestHistoryRow[]>()

  const requestIds = (requests ?? []).map((request) => request.id)
  const admin = createAdminClient()
  const { data: jobs } = requestIds.length
    ? await admin
      .from('jobs')
      .select('id, request_id, completed_at')
      .in('request_id', requestIds)
      .returns<HistoryJobRow[]>()
    : { data: [] }
  const jobIds = (jobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }
  const jobByRequestId = new Map((jobs ?? []).map((job) => [job.request_id, job]))
  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-medium text-slate-500">Customer history</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Your Request History</h1>
            <p className="mt-1 text-sm text-slate-500">Review past roadside recovery requests, prices, and rating status.</p>
          </div>

          {!requests || requests.length === 0 ? (
            <Card className="border-slate-200 shadow-sm">
              <CardBody>
                <div className="py-14 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-400">0</div>
                  <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">History</div>
                  <p className="font-medium text-slate-700">No requests yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Your roadside requests will appear here after you submit your first recovery request.</p>
                  <a
                    href="/customer/request"
                    className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
                  >
                    Request Help Now
                  </a>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader>
                <h2 className="font-semibold text-slate-800">{requests.length} request{requests.length !== 1 ? 's' : ''}</h2>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-slate-100">
                  {requests.map((req) => (
                    <div key={req.id} className="flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">{getProblemLabel(req.problem_type)}</div>
                        <div className="text-sm text-slate-500 mt-0.5 break-words">{req.location_address ?? 'Location not recorded'}</div>
                        <div className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                        {req.status === 'completed' && (
                          <div className="mt-2 text-xs text-slate-500">
                            {req.final_price ? `Completed at ${req.final_price} AED, paid directly to provider.` : 'Completed service.'}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${statusColors[req.status]}`}>
                          {statusLabels[req.status]}
                        </span>
                        {req.status === 'completed' && jobByRequestId.get(req.id) && (
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${ratedJobIds.has(jobByRequestId.get(req.id)!.id) ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                            {ratedJobIds.has(jobByRequestId.get(req.id)!.id) ? 'Rated' : 'Needs rating'}
                          </span>
                        )}
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
