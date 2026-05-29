import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Dashboard - RescueGo',
  robots: { index: false, follow: false },
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!userData || userData.role !== 'admin') redirect('/')

  const [
    { count: totalCustomers },
    { count: totalProviders },
    { data: providersByStatus },
    { data: requestsByStatus },
    { data: recentEvents },
    { data: recentPayouts },
    { count: activeSubscriptions },
    { count: failedStripeEvents },
    { count: failedOveragePayments },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'provider'),
    supabase.from('providers').select('status'),
    supabase.from('requests').select('status'),
    supabase.from('stripe_events').select('id, type, status, processed_at, error_message').order('updated_at', { ascending: false }).limit(10),
    supabase.from('payout_log').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'active').not('stripe_subscription_id', 'is', null),
    supabase.from('stripe_events').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase.from('overage_payments').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
  ])

  const activeProviders = providersByStatus?.filter(p => p.status === 'active').length ?? 0
  const pendingProviders = providersByStatus?.filter(p => p.status === 'pending').length ?? 0
  const suspendedProviders = providersByStatus?.filter(p => p.status === 'suspended').length ?? 0

  const openRequests = requestsByStatus?.filter(r => r.status === 'open').length ?? 0
  const completedRequests = requestsByStatus?.filter(r => r.status === 'completed').length ?? 0
  const expiredRequests = requestsByStatus?.filter(r => r.status === 'expired').length ?? 0
  const totalRequests = requestsByStatus?.length ?? 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Marketplace operations</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Admin Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">
                Monitor provider readiness, request flow, billing events, and operational exceptions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/admin/providers?filter=pending" className="inline-flex h-10 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-600">
                Review pending
              </a>
              <a href="/admin/requests" className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                View requests
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-3">
            <a href="/admin/providers?filter=pending" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100">
              <div className="text-2xl font-bold text-amber-700">{pendingProviders}</div>
              <div className="mt-1 text-sm font-semibold text-amber-900">Pending provider approvals</div>
              <div className="mt-1 text-xs text-amber-800">Review documents and activate eligible providers.</div>
            </a>
            <a href="/admin/providers?filter=missing-documents" className="rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50">
              <div className="text-2xl font-bold text-slate-800">{totalProviders ?? 0}</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">Provider moderation</div>
              <div className="mt-1 text-xs text-slate-500">Check missing documents, status, and trust badges.</div>
            </a>
            <a href="/admin/revenue" className="rounded-2xl border border-red-200 bg-red-50 p-4 transition-colors hover:bg-red-100">
              <div className="text-2xl font-bold text-red-700">{(failedStripeEvents ?? 0) + (failedOveragePayments ?? 0)}</div>
              <div className="mt-1 text-sm font-semibold text-red-900">Payment exceptions</div>
              <div className="mt-1 text-xs text-red-800">Watch failed Stripe events and overage payments.</div>
            </a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Customers', value: totalCustomers ?? 0, color: 'text-blue-600' },
              { label: 'Total Providers', value: totalProviders ?? 0, color: 'text-purple-600' },
              { label: 'Total Requests', value: totalRequests, color: 'text-orange-600' },
              { label: 'Completed Jobs', value: completedRequests, color: 'text-green-600' },
              { label: 'Active Subscriptions', value: activeSubscriptions ?? 0, color: 'text-green-600' },
              { label: 'Expired Requests', value: expiredRequests, color: 'text-slate-600' },
              { label: 'Failed Stripe Events', value: failedStripeEvents ?? 0, color: 'text-red-600' },
              { label: 'Failed Overages', value: failedOveragePayments ?? 0, color: 'text-red-600' },
            ].map(stat => (
              <Card key={stat.label}>
                <CardBody>
                  <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Provider Status</h2></CardHeader>
              <CardBody>
                <div className="flex flex-col gap-3">
                  {[
                    { label: 'Active', count: activeProviders, variant: 'success' as const },
                    { label: 'Pending Review', count: pendingProviders, variant: 'warning' as const },
                    { label: 'Suspended', count: suspendedProviders, variant: 'danger' as const },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-center">
                      <Badge variant={item.variant}>{item.label}</Badge>
                      <span className="font-semibold text-slate-700">{item.count}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Request Status</h2></CardHeader>
              <CardBody>
                <div className="flex flex-col gap-3">
                  {[
                    { label: 'Open', count: openRequests, variant: 'info' as const },
                    { label: 'Completed', count: completedRequests, variant: 'success' as const },
                    { label: 'Expired', count: expiredRequests, variant: 'default' as const },
                    { label: 'Other', count: totalRequests - openRequests - completedRequests - expiredRequests, variant: 'default' as const },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-center">
                      <Badge variant={item.variant}>{item.label}</Badge>
                      <span className="font-semibold text-slate-700">{item.count}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Recent Stripe Events</h2></CardHeader>
              <CardBody className="p-0">
                {!recentEvents?.length ? (
                  <div className="px-6 py-8 text-center">
                    <p className="text-sm font-semibold text-slate-700">No Stripe events yet</p>
                    <p className="mt-1 text-xs text-slate-500">Webhook activity will appear here after billing events are received.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recentEvents.map(event => (
                      <div key={event.id} className="px-6 py-3 flex justify-between items-center">
                        <span className="text-sm font-mono text-slate-700">{event.type}</span>
                        <div className="text-right">
                          <Badge variant={event.status === 'failed' ? 'danger' : event.status === 'processing' ? 'warning' : 'success'}>
                            {event.status ?? 'processed'}
                          </Badge>
                          <div className="mt-1 text-xs text-slate-400">
                            {event.processed_at ? new Date(event.processed_at).toLocaleDateString() : 'Not processed'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold text-slate-800">Recent Payouts</h2></CardHeader>
              <CardBody className="p-0">
                {!recentPayouts?.length ? (
                  <div className="px-6 py-8 text-center">
                    <p className="text-sm font-semibold text-slate-700">No payouts yet</p>
                    <p className="mt-1 text-xs text-slate-500">Provider payout records will appear after completed payout activity.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recentPayouts.map(payout => (
                      <div key={payout.id} className="px-6 py-3 flex justify-between items-center">
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{(payout.amount / 100).toFixed(2)} {payout.currency}</div>
                          <div className="text-xs text-slate-400">{payout.arrival_date}</div>
                        </div>
                        <Badge variant={payout.status === 'paid' ? 'success' : 'warning'}>{payout.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/admin/providers" className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Manage Providers</a>
            <a href="/admin/requests" className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">View All Requests</a>
            <a href="/admin/revenue" className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Revenue Log</a>
          </div>
        </div>
      </main>
    </>
  )
}
