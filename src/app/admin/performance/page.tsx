import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Provider Performance - Admin',
  robots: { index: false, follow: false },
}

type ProviderRow = {
  id: string
  plan: string
  status: string
  rating: number | null
  jobs_this_month: number
  verified_badge: boolean
  users: { name: string | null; phone: string | null } | null
}

type JobAggRow = {
  provider_id: string
  commission_amount: number
}

type RatingCountRow = {
  provider_id: string
}

type SortKey = 'completed' | 'rating' | 'revenue' | 'this_month'

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'completed', label: 'Completed Jobs' },
  { id: 'rating', label: 'Rating' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'this_month', label: 'Jobs This Month' },
]

export default async function AdminPerformancePage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>
}) {
  const params = await searchParams
  const activeSort: SortKey = SORT_OPTIONS.some((s) => s.id === params?.sort)
    ? (params!.sort as SortKey)
    : 'completed'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!userData || userData.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const [
    { data: providers, error: providersError },
    { data: completedJobs },
    { data: ratingCounts },
  ] = await Promise.all([
    admin
      .from('providers')
      .select('id, plan, status, rating, jobs_this_month, verified_badge, users(name, phone)')
      .order('rating', { ascending: false })
      .returns<ProviderRow[]>(),
    admin
      .from('jobs')
      .select('provider_id, commission_amount')
      .not('completed_at', 'is', null)
      .returns<JobAggRow[]>(),
    admin
      .from('ratings')
      .select('provider_id')
      .returns<RatingCountRow[]>(),
  ])

  const completedByProvider = new Map<string, { count: number; revenue: number }>()
  for (const job of completedJobs ?? []) {
    const existing = completedByProvider.get(job.provider_id) ?? { count: 0, revenue: 0 }
    completedByProvider.set(job.provider_id, {
      count: existing.count + 1,
      revenue: existing.revenue + (job.commission_amount ?? 0),
    })
  }

  const ratingCountByProvider = new Map<string, number>()
  for (const rating of ratingCounts ?? []) {
    ratingCountByProvider.set(rating.provider_id, (ratingCountByProvider.get(rating.provider_id) ?? 0) + 1)
  }

  const enriched = (providers ?? []).map((p) => {
    const agg = completedByProvider.get(p.id) ?? { count: 0, revenue: 0 }
    return {
      ...p,
      completedJobs: agg.count,
      totalRevenue: agg.revenue,
      ratingCount: ratingCountByProvider.get(p.id) ?? 0,
    }
  })

  const sorted = [...enriched].sort((a, b) => {
    if (activeSort === 'completed') return b.completedJobs - a.completedJobs
    if (activeSort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0)
    if (activeSort === 'revenue') return b.totalRevenue - a.totalRevenue
    if (activeSort === 'this_month') return b.jobs_this_month - a.jobs_this_month
    return 0
  })

  const planVariant = (plan: string): 'success' | 'warning' | 'info' | 'default' => {
    if (plan === 'business') return 'success'
    if (plan === 'pro') return 'info'
    if (plan === 'starter') return 'warning'
    return 'default'
  }

  const statusVariant = (status: string): 'success' | 'warning' | 'danger' | 'default' => {
    if (status === 'active') return 'success'
    if (status === 'pending') return 'warning'
    if (status === 'suspended') return 'danger'
    return 'default'
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Provider analytics</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">Provider Performance</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Leaderboard of all providers ranked by completed jobs, rating, revenue, or current-month activity.
                </p>
              </div>
              <a href="/admin/dashboard" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                Back to Dashboard
              </a>
            </div>
          </div>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-semibold text-slate-800">
                    Leaderboard ({sorted.length} providers)
                  </h2>
                  {providersError && (
                    <p className="text-sm text-red-600">Provider data could not be loaded: {providersError.message}</p>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {SORT_OPTIONS.map((opt) => (
                    <a
                      key={opt.id}
                      href={`/admin/performance?sort=${opt.id}`}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        activeSort === opt.id
                          ? 'bg-[#1D9E75] text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]`}
                    >
                      {opt.label}
                    </a>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {['#', 'Provider', 'Status', 'Plan', 'Rating', 'Reviews', 'Completed', 'This Month', 'Revenue'].map((heading) => (
                        <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sorted.map((provider, index) => (
                      <tr key={provider.id} className="align-middle hover:bg-slate-50">
                        <td className="px-5 py-4 text-slate-400 font-mono text-xs">
                          {index + 1}
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-800">
                            {provider.users?.name ?? 'Unnamed'}
                            {provider.verified_badge && (
                              <span className="ml-1.5 inline-block rounded bg-[#0F6E56] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                Verified
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400">{provider.users?.phone ?? 'No phone'}</div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={statusVariant(provider.status)}>
                            {provider.status.charAt(0).toUpperCase() + provider.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={planVariant(provider.plan)}>
                            {provider.plan === 'pay_per_job' ? 'PPJ' : provider.plan.charAt(0).toUpperCase() + provider.plan.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {provider.rating !== null ? provider.rating.toFixed(2) : '—'}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {provider.ratingCount}
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {provider.completedJobs}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {provider.jobs_this_month}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {provider.totalRevenue > 0 ? `${provider.totalRevenue} AED` : '—'}
                        </td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-5 py-14 text-center">
                          <p className="font-semibold text-slate-700">No providers found.</p>
                          <p className="mt-1 text-sm text-slate-500">Provider performance data will appear once providers are registered.</p>
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
