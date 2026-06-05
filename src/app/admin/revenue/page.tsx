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

type OveragePaymentRow = {
  id: string
  fee_aed: number
  status: string
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

  const [{ data: payouts }, { data: jobs }, { data: ppjPayments }, { data: failedOverages }] = await Promise.all([
    supabase.from('payout_log').select('id, stripe_payout_id, amount, currency, arrival_date, status').order('created_at', { ascending: false }).limit(100).returns<PayoutRow[]>(),
    supabase.from('jobs').select('id, commission_rate, commission_amount, completed_at, providers(plan, users(name)), requests(problem_type)').not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(50).returns<RevenueJobRow[]>(),
    supabase.from('ppj_payments').select('*, providers(users(name, phone))').eq('status', 'paid').order('created_at', { ascending: false }).limit(100).returns<PPJPaymentRow[]>(),
    supabase.from('overage_payments').select('*, providers(users(name, phone))').eq('status', 'failed').order('created_at', { ascending: false }).limit(50).returns<OveragePaymentRow[]>(),
  ])

  const totalPaid = payouts?.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.amount ?? 0), 0) ?? 0
  const totalCommissions = jobs?.reduce((sum, j) => sum + (j.commission_amount ?? 0), 0) ?? 0
  const totalPPJRevenue = ppjPayments?.reduce((sum, p) => sum + p.fee_aed, 0) ?? 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Revenue operations</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">Revenue Log</h1>
                <p className="mt-1 text-sm text-slate-500">Review payouts, commission charges, PPJ payments, and failed overage events.</p>
              </div>
              <a href="/admin/dashboard" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">Back to Dashboard</a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="border-slate-200 shadow-sm">
              <CardBody className="min-h-28">
                <div className="text-2xl font-bold text-green-600">{(totalPaid / 100).toFixed(2)} AED</div>
                <div className="text-sm text-slate-500">Total Paid Out</div>
              </CardBody>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardBody className="min-h-28">
                <div className="text-2xl font-bold text-[#0F6E56]">{(totalCommissions / 100).toFixed(2)} AED</div>
                <div className="text-sm text-slate-500">Total Commissions Charged</div>
              </CardBody>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardBody className="min-h-28">
                <div className="text-2xl font-bold text-slate-700">{jobs?.length ?? 0}</div>
                <div className="text-sm text-slate-500">Total Jobs</div>
              </CardBody>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardBody className="min-h-28">
                <div className="text-2xl font-bold text-green-600">{totalPPJRevenue} AED</div>
                <div className="text-sm text-slate-500">PPJ Revenue (paid)</div>
                <div className="text-xs text-slate-400 mt-1">{ppjPayments?.length ?? 0} payments</div>
              </CardBody>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardBody className="min-h-28">
                <div className="text-2xl font-bold text-red-600">{failedOverages?.length ?? 0}</div>
                <div className="text-sm text-slate-500">Failed Overage Payments</div>
                <div className="text-xs text-slate-400 mt-1">Needs provider follow-up</div>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader><h2 className="font-semibold text-slate-800">Stripe Payouts</h2></CardHeader>
              <CardBody className="p-0">
                {!payouts?.length ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm font-semibold text-slate-700">No payouts yet</p>
                    <p className="mt-1 text-xs text-slate-500">Stripe payout records will appear here after payout activity.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {payouts.map(payout => (
                      <div key={payout.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">{((payout.amount ?? 0) / 100).toFixed(2)} {payout.currency}</div>
                          <div className="mt-1 break-all text-xs text-slate-400">{payout.arrival_date} · {payout.stripe_payout_id}</div>
                        </div>
                        <div className="shrink-0">
                          <Badge variant={payout.status === 'paid' ? 'success' : 'warning'}>{payout.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader><h2 className="font-semibold text-slate-800">Recent Commission Charges</h2></CardHeader>
              <CardBody className="p-0">
                {!jobs?.length ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm font-semibold text-slate-700">No commission jobs yet</p>
                    <p className="mt-1 text-xs text-slate-500">Completed commission activity will appear here.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {jobs.filter((job) => (job.commission_amount ?? 0) > 0).slice(0, 20).map((job) => (
                      <div key={job.id} className="flex items-center justify-between gap-4 px-6 py-4">
                        <div>
                          <div className="font-medium text-slate-800">{job.providers?.users?.name ?? '-'}</div>
                          <div className="text-xs text-slate-400">{job.requests?.problem_type} · {job.commission_rate}% rate</div>
                        </div>
                        <div className="shrink-0 font-semibold text-[#0F6E56]">{((job.commission_amount ?? 0) / 100).toFixed(2)} AED</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {ppjPayments && ppjPayments.length > 0 && (
            <Card className="mt-6 overflow-hidden border-slate-200 shadow-sm">
              <CardHeader>
                <h2 className="font-semibold text-slate-800">Pay Per Job Payments</h2>
              </CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Provider', 'Fee', 'Distance', 'Promo?', 'Date', 'Stripe PI'].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {ppjPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-medium text-slate-800">{payment.providers?.users?.name ?? '-'}</td>
                        <td className="px-5 py-4 text-slate-700">{payment.fee_aed} AED</td>
                        <td className="px-5 py-4 text-slate-500">{(payment.distance_meters / 1000).toFixed(1)} km</td>
                        <td className="px-5 py-4">
                          {payment.promo_applied
                            ? <span className="text-[#0F6E56] font-semibold text-xs">Yes</span>
                            : <span className="text-slate-400 text-xs">No</span>
                          }
                        </td>
                        <td className="px-5 py-4 text-slate-500">{new Date(payment.created_at).toLocaleDateString('en-AE')}</td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-400">
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

          {failedOverages && failedOverages.length > 0 && (
            <Card className="mt-6 overflow-hidden border-slate-200 shadow-sm">
              <CardHeader>
                <h2 className="font-semibold text-slate-800">Failed Overage Payments</h2>
              </CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Provider', 'Fee', 'Date', 'Stripe PI'].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {failedOverages.map((payment) => (
                      <tr key={payment.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-medium text-slate-800">{payment.providers?.users?.name ?? '-'}</td>
                        <td className="px-5 py-4 text-slate-700">{payment.fee_aed} AED</td>
                        <td className="px-5 py-4 text-slate-500">{new Date(payment.created_at).toLocaleDateString('en-AE')}</td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-400">
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
