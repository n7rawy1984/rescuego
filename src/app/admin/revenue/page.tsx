import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { Metadata } from 'next'
import type { ProblemType, ProviderPlan } from '@/types'

export const metadata: Metadata = {
  title: 'Revenue Log — Admin',
  robots: { index: false, follow: false },
}

type PayoutRow = {
  id: string
  stripe_payout_id: string | null
  amount: number | null
  currency: string | null
  arrival_date: string | null
  status: string | null
}

type RevenueJobRow = {
  id: string
  commission_amount: number | null
  commission_rate: number | null
  providers: {
    plan: ProviderPlan | null
    users: {
      name: string | null
    } | null
  } | null
  requests: {
    problem_type: ProblemType | null
  } | null
}

type PPJPaymentRow = {
  id: string
  fee_aed: number
  distance_meters: number
  status: string
  promo_applied: boolean
  stripe_payment_intent_id: string | null
  created_at: string
  providers: {
    users: { name: string | null; phone: string | null } | null
  } | null
}

export default async function AdminRevenuePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (userData?.role !== 'admin') redirect('/')

  const [{ data: payouts }, { data: jobs }, { data: ppjPayments }] = await Promise.all([
    supabase.from('payout_log').select('*').order('created_at', { ascending: false }).returns<PayoutRow[]>(),
    supabase.from('jobs').select('*, providers(plan, users(name)), requests(problem_type)').order('completed_at', { ascending: false }).limit(50).returns<RevenueJobRow[]>(),
    supabase.from('ppj_payments').select('*, providers(users(name, phone))').eq('status', 'paid').order('created_at', { ascending: false }).limit(100).returns<PPJPaymentRow[]>(),
  ])

  const totalPaid = payouts?.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.amount ?? 0), 0) ?? 0
  const totalCommissions = jobs?.reduce((sum, j) => sum + (j.commission_amount ?? 0), 0) ?? 0
  const totalPPJRevenue = ppjPayments?.reduce((sum, p) => sum + p.fee_aed, 0) ?? 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Revenue Log</h1>
            <a href="/admin/dashboard" className="text-sm text-orange-500 hover:underline">← Back to Dashboard</a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-green-600">{(totalPaid / 100).toFixed(2)} AED</div>
                <div className="text-sm text-slate-500">Total Paid Out</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-orange-600">{(totalCommissions / 100).toFixed(2)} AED</div>
                <div className="text-sm text-slate-500">Total Commissions Charged</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-slate-700">{jobs?.length ?? 0}</div>
                <div className="text-sm text-slate-500">Total Jobs</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-2xl font-bold text-green-600">{totalPPJRevenue} AED</div>
                <div className="text-sm text-slate-500">PPJ Revenue (paid)</div>
                <div className="text-xs text-slate-400 mt-1">{ppjPayments?.length ?? 0} payments</div>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Stripe Payouts</h2></CardHeader>
              <CardBody className="p-0">
                {!payouts?.length ? (
                  <div className="px-6 py-8 text-center text-slate-500 text-sm">No payouts yet</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {payouts.map(payout => (
                      <div key={payout.id} className="px-6 py-3 flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-slate-800">{((payout.amount ?? 0) / 100).toFixed(2)} {payout.currency}</div>
                          <div className="text-xs text-slate-400">{payout.arrival_date} · {payout.stripe_payout_id}</div>
                        </div>
                        <Badge variant={payout.status === 'paid' ? 'success' : 'warning'}>{payout.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Recent Commission Charges</h2></CardHeader>
              <CardBody className="p-0">
                {!jobs?.length ? (
                  <div className="px-6 py-8 text-center text-slate-500 text-sm">No commission jobs yet</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {jobs.filter((job) => (job.commission_amount ?? 0) > 0).slice(0, 20).map((job) => (
                      <div key={job.id} className="px-6 py-3 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-slate-800">{job.providers?.users?.name ?? '—'}</div>
                          <div className="text-xs text-slate-400">{job.requests?.problem_type} · {job.commission_rate}% rate</div>
                        </div>
                        <div className="font-semibold text-orange-600">{((job.commission_amount ?? 0) / 100).toFixed(2)} AED</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {ppjPayments && ppjPayments.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <h2 className="font-semibold text-slate-800">Pay Per Job Payments</h2>
              </CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Provider', 'Fee', 'Distance', 'Promo?', 'Date', 'Stripe PI'].map((heading) => (
                        <th key={heading} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {ppjPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{payment.providers?.users?.name ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{payment.fee_aed} AED</td>
                        <td className="px-4 py-3 text-slate-500">{(payment.distance_meters / 1000).toFixed(1)} km</td>
                        <td className="px-4 py-3">
                          {payment.promo_applied
                            ? <span className="text-orange-600 font-semibold text-xs">Yes</span>
                            : <span className="text-slate-400 text-xs">No</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-slate-500">{new Date(payment.created_at).toLocaleDateString('en-AE')}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {payment.stripe_payment_intent_id
                            ? <span title={payment.stripe_payment_intent_id}>{payment.stripe_payment_intent_id.slice(0, 16)}...</span>
                            : '-'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}
