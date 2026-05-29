import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

const statusColors: Record<RequestStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  accepted: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-slate-100 text-slate-500',
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

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Your Request History</h1>
            <p className="mt-1 text-slate-500">All your past roadside recovery requests.</p>
          </div>

          {!requests || requests.length === 0 ? (
            <Card>
              <CardBody>
                <div className="py-12 text-center">
                  <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">History</div>
                  <p className="font-medium text-slate-700">No requests yet</p>
                  <p className="text-sm text-slate-500 mt-1">Your roadside requests will appear here.</p>
                  <a
                    href="/customer/request"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                  >
                    Request Help Now
                  </a>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-slate-800">{requests.length} request{requests.length !== 1 ? 's' : ''}</h2>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-slate-100">
                  {requests.map((req) => (
                    <div key={req.id} className="px-6 py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">{getProblemLabel(req.problem_type)}</div>
                        <div className="text-sm text-slate-500 mt-0.5 truncate max-w-xs">{req.location_address ?? 'Location not recorded'}</div>
                        <div className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${statusColors[req.status]}`}>
                          {req.status.replace('_', ' ')}
                        </span>
                        {req.final_price && (
                          <div className="text-sm font-semibold text-slate-700 mt-1">{req.final_price} AED</div>
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
