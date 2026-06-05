import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { getProblemLabel } from '@/lib/utils'
import { CheckCircle2, Clock3, History, MapPin, ReceiptText, Star, XCircle, ArrowRight } from 'lucide-react'
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
  open: 'border-blue-100 bg-blue-50 text-blue-700',
  accepted: 'border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56]',
  in_progress: 'border-amber-100 bg-amber-50 text-amber-700',
  completed: 'border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56]',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
  expired: 'border-slate-200 bg-slate-100 text-slate-600',
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
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Customer history</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Your request history</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Review past roadside recovery requests, completion details, prices, and rating status.
                </p>
              </div>
              <Link
                href="/customer/request"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
              >
                Request help
              </Link>
            </div>
          </div>

          {!requests || requests.length === 0 ? (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center shadow-sm sm:p-10">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <History className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-lg font-semibold text-slate-950">No requests yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Your roadside requests will appear here after you submit your first recovery request.
              </p>
              <Link
                href="/customer/request"
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                Request help now
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{requests.length} request{requests.length !== 1 ? 's' : ''}</h2>
                    <p className="mt-1 text-sm text-slate-500">Most recent activity appears first.</p>
                  </div>
                  <div className="hidden rounded-2xl bg-slate-50 p-3 text-slate-500 sm:block">
                    <ReceiptText className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                  {requests.map((req) => (
                    <div key={req.id} className="flex flex-col gap-4 px-5 py-5 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E1F5EE] text-[#0F6E56]">
                            {req.status === 'cancelled' || req.status === 'expired' ? (
                              <XCircle className="h-5 w-5" aria-hidden="true" />
                            ) : req.status === 'completed' ? (
                              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                            ) : (
                              <Clock3 className="h-5 w-5" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-950">{getProblemLabel(req.problem_type)}</div>
                            <div className="mt-1 flex items-start gap-2 text-sm text-slate-500">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="break-words">{req.location_address ?? 'Location not recorded'}</span>
                            </div>
                            <div className="mt-2 text-xs text-slate-400">
                              {new Date(req.created_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                          </div>
                        </div>
                        {req.status === 'completed' && (
                          <div className="ml-0 mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600 sm:ml-[52px]">
                            {req.final_price ? `Completed at ${req.final_price} AED, paid directly to provider.` : 'Completed service.'}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColors[req.status]}`}>
                          {statusLabels[req.status]}
                        </span>
                        {(req.status === 'open' || req.status === 'accepted' || req.status === 'in_progress') && (
                          <Link
                            href="/customer/request"
                            className="inline-flex items-center gap-1 rounded-full border border-[#9FE1CB] bg-[#E1F5EE] px-2.5 py-1 text-xs font-semibold text-[#0F6E56] hover:bg-[#c8f0e2] transition-colors"
                          >
                            View active
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                        {req.status === 'completed' && jobByRequestId.get(req.id) && (
                          ratedJobIds.has(jobByRequestId.get(req.id)!.id) ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#9FE1CB] bg-[#E1F5EE] px-2.5 py-1 text-xs font-semibold text-[#0F6E56]">
                              <Star className="h-3.5 w-3.5" aria-hidden="true" />
                              Rated
                            </span>
                          ) : (
                            <Link
                              href="/customer/ratings"
                              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                            >
                              <Star className="h-3.5 w-3.5" aria-hidden="true" />
                              Rate now
                            </Link>
                          )
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
