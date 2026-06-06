import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { Metadata } from 'next'

type StuckJobRow = {
  request_id: string
  en_route_at: string | null
  arrived_at: string | null
  requests: {
    id: string
    status: string
    problem_type: string
    location_address: string | null
  } | null
}

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

  const admin = createAdminClient()
  const now = new Date()
  const stuckCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalCustomers },
    { count: totalProviders },
    { count: activeProvidersCount },
    { count: pendingProvidersCount },
    { count: suspendedProvidersCount },
    { count: openRequestsCount },
    { count: acceptedRequestsCount },
    { count: enRouteRequestsCount },
    { count: arrivedRequestsCount },
    { count: inProgressRequestsCount },
    { count: completedRequestsCount },
    { count: expiredRequestsCount },
    { count: totalRequestsCount },
    { data: recentEvents },
    { data: recentPayouts },
    { count: activeSubscriptions },
    { count: failedStripeEvents },
    { count: failedOveragePayments },
    { data: stuckJobs },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'provider'),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'suspended'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'accepted'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'en_route'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'arrived'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
    supabase.from('requests').select('*', { count: 'exact', head: true }),
    supabase.from('stripe_events').select('id, type, status, processed_at, error_message').order('updated_at', { ascending: false }).limit(10),
    supabase.from('payout_log').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'active').not('stripe_subscription_id', 'is', null),
    supabase.from('stripe_events').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase.from('overage_payments').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    admin
      .from('jobs')
      .select('request_id, en_route_at, arrived_at, requests!inner(id, status, problem_type, location_address)')
      .lt('en_route_at', stuckCutoff)
      .in('requests.status', ['en_route', 'arrived'])
      .is('completed_at', null)
      .returns<StuckJobRow[]>(),
  ])

  const activeProviders = activeProvidersCount ?? 0
  const pendingProviders = pendingProvidersCount ?? 0
  const suspendedProviders = suspendedProvidersCount ?? 0
  const openRequests = openRequestsCount ?? 0
  const acceptedRequests = acceptedRequestsCount ?? 0
  const enRouteRequests = enRouteRequestsCount ?? 0
  const arrivedRequests = arrivedRequestsCount ?? 0
  const inProgressRequests = inProgressRequestsCount ?? 0
  const completedRequests = completedRequestsCount ?? 0
  const expiredRequests = expiredRequestsCount ?? 0
  const totalRequests = totalRequestsCount ?? 0

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Marketplace operations</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Admin Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">
                Monitor provider readiness, request flow, billing events, and operational exceptions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/admin/providers?filter=pending" className="inline-flex h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56]">
                Review pending
              </a>
              <a href="/admin/requests" className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                View requests
              </a>
            </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-3">
            <a href="/admin/providers?filter=pending" className="min-h-32 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
              <div className="text-2xl font-bold text-amber-700">{pendingProviders}</div>
              <div className="mt-1 text-sm font-semibold text-amber-900">Pending provider approvals</div>
              <div className="mt-1 text-xs text-amber-800">Review documents and activate eligible providers.</div>
            </a>
            <a href="/admin/providers?filter=missing-documents" className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">
              <div className="text-2xl font-bold text-slate-800">{totalProviders ?? 0}</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">Provider moderation</div>
              <div className="mt-1 text-xs text-slate-500">Check missing documents, status, and trust badges.</div>
            </a>
            <a href="/admin/revenue" className="min-h-32 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm transition-colors hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">
              <div className="text-2xl font-bold text-red-700">{(failedStripeEvents ?? 0) + (failedOveragePayments ?? 0)}</div>
              <div className="mt-1 text-sm font-semibold text-red-900">Payment exceptions</div>
              <div className="mt-1 text-xs text-red-800">Watch failed Stripe events and overage payments.</div>
            </a>
          </div>

          {stuckJobs && stuckJobs.length > 0 && (
            <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-red-900">
                    Stuck Jobs Alert — {stuckJobs.length} job{stuckJobs.length !== 1 ? 's' : ''} stalled for over 2 hours
                  </h2>
                  <p className="mt-1 text-xs text-red-700">
                    These jobs have been in En Route or Arrived status for more than 2 hours without progressing to completion. Manual review may be required.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {stuckJobs.map((job) => {
                      const req = job.requests
                      const staleSince = job.arrived_at ?? job.en_route_at
                      const staleHours = staleSince
                        ? Math.floor((now.getTime() - new Date(staleSince).getTime()) / (1000 * 60 * 60))
                        : null
                      return (
                        <a
                          key={job.request_id}
                          href={`/admin/requests?filter=${req?.status ?? 'en_route'}`}
                          className="flex items-center justify-between gap-4 rounded-xl bg-white px-3 py-2 text-sm shadow-sm hover:bg-red-50"
                        >
                          <div>
                            <span className="font-semibold text-slate-800 capitalize">{req?.problem_type?.replaceAll('_', ' ') ?? 'Unknown'}</span>
                            {req?.location_address && (
                              <span className="ml-2 text-xs text-slate-500">{req.location_address}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant={req?.status === 'arrived' ? 'warning' : 'info'}>
                              {req?.status === 'arrived' ? 'Arrived' : 'En Route'}
                            </Badge>
                            {staleHours !== null && (
                              <span className="text-xs font-semibold text-red-700">{staleHours}h stalled</span>
                            )}
                          </div>
                        </a>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Customers', value: totalCustomers ?? 0, color: 'text-blue-600' },
              { label: 'Total Providers', value: totalProviders ?? 0, color: 'text-purple-600' },
              { label: 'Total Requests', value: totalRequests, color: 'text-[#0F6E56]' },
              { label: 'Completed Jobs', value: completedRequests, color: 'text-green-600' },
              { label: 'Active Subscriptions', value: activeSubscriptions ?? 0, color: 'text-green-600' },
              { label: 'Expired Requests', value: expiredRequests, color: 'text-slate-600' },
              { label: 'Failed Stripe Events', value: failedStripeEvents ?? 0, color: 'text-red-600' },
              { label: 'Failed Overages', value: failedOveragePayments ?? 0, color: 'text-red-600' },
            ].map(stat => (
              <Card key={stat.label} className="border-slate-200 shadow-sm">
                <CardBody className="min-h-28">
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
                    <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
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
                    { label: 'Accepted', count: acceptedRequests, variant: 'warning' as const },
                    { label: 'En Route', count: enRouteRequests, variant: 'warning' as const },
                    { label: 'Arrived', count: arrivedRequests, variant: 'warning' as const },
                    { label: 'In Progress', count: inProgressRequests, variant: 'warning' as const },
                    { label: 'Completed', count: completedRequests, variant: 'success' as const },
                    { label: 'Expired', count: expiredRequests, variant: 'default' as const },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
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
                      <div key={event.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 break-all font-mono text-sm text-slate-700">{event.type}</span>
                        <div className="shrink-0 sm:text-right">
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
                      <div key={payout.id} className="flex items-center justify-between gap-4 px-6 py-4">
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
            <a href="/admin/providers" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">Manage Providers</a>
            <a href="/admin/requests" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">View All Requests</a>
            <a href="/admin/revenue" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">Revenue Log</a>
            <a href="/admin/performance" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">Provider Performance</a>
          </div>
        </div>
      </main>
    </>
  )
}
