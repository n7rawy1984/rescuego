import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { getProblemLabel } from '@/lib/utils'
import type { Metadata } from 'next'
import type { ProblemType, RequestStatus } from '@/types'

export const metadata: Metadata = {
  title: 'All Requests — Admin',
  robots: { index: false, follow: false },
}

type AdminRequestRow = {
  id: string
  problem_type: ProblemType
  location_address: string | null
  status: RequestStatus
  price_estimate_min: number | null
  price_estimate_max: number | null
  created_at: string
  users: {
    name: string | null
    phone: string | null
  } | null
  providers: {
    users: {
      name: string | null
    } | null
  } | null
}

export default async function AdminRequestsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (userData?.role !== 'admin') redirect('/')

  const { data: requests } = await supabase
    .from('requests')
    .select('*, users(name, phone), providers(users(name))')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<AdminRequestRow[]>()

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold text-slate-900">All Requests</h1>
            <a href="/admin/dashboard" className="text-sm text-orange-500 hover:underline">← Back to Dashboard</a>
          </div>
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-slate-800">Recent Requests ({requests?.length ?? 0})</h2>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Type', 'Customer', 'Location', 'Status', 'Provider', 'Est. Price', 'Time'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests?.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{getProblemLabel(req.problem_type)}</td>
                        <td className="px-4 py-3 text-slate-600">{req.users?.name ?? 'Guest'}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{req.location_address ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={req.status === 'completed' ? 'success' : req.status === 'open' ? 'info' : req.status === 'cancelled' ? 'default' : 'warning'}>
                            {req.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{req.providers?.users?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{req.price_estimate_min && req.price_estimate_max ? `${req.price_estimate_min}–${req.price_estimate_max} AED` : '—'}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{new Date(req.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
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
