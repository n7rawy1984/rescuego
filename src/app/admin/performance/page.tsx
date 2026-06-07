import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
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

const SORT_OPTIONS: { id: SortKey; labelKey: string }[] = [
  { id: 'completed', labelKey: 'sortCompletedJobs' },
  { id: 'rating', labelKey: 'sortRating' },
  { id: 'revenue', labelKey: 'sortRevenue' },
  { id: 'this_month', labelKey: 'sortJobsThisMonth' },
]

export default async function AdminPerformancePage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>
}) {
  const t = await getTranslations('admin.performance')
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

  const providerStatusLabel = (status: string) => {
    if (status === 'active') return t('statusActive')
    if (status === 'pending') return t('statusPending')
    if (status === 'suspended') return t('statusSuspended')
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  const providerPlanLabel = (plan: string) => {
    if (plan === 'pay_per_job') return t('planPayPerJob')
    if (plan === 'business') return t('planBusiness')
    if (plan === 'pro') return t('planPro')
    if (plan === 'starter') return t('planStarter')
    return plan.charAt(0).toUpperCase() + plan.slice(1)
  }

  const tableHeadings = [
    t('rankColumn'),
    t('providerColumn'),
    t('statusColumn'),
    t('planColumn'),
    t('ratingColumn'),
    t('reviewsColumn'),
    t('completedColumn'),
    t('thisMonthColumn'),
    t('revenueColumn'),
  ]

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{t('eyebrow')}</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">{t('title')}</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {t('description')}
                </p>
              </div>
              <a href="/admin/dashboard" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                {t('backToDashboard')}
              </a>
            </div>
          </div>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-semibold text-slate-800">
                    {t('leaderboardTitle', { count: sorted.length })}
                  </h2>
                  {providersError && (
                    <p className="text-sm text-red-600">{t('providerDataLoadError', { message: providersError.message })}</p>
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
                      {t(opt.labelKey)}
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
                      {tableHeadings.map((heading) => (
                        <th key={heading} className="px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                            {provider.users?.name ?? t('unnamedProvider')}
                            {provider.verified_badge && (
                              <span className="ms-1.5 inline-block rounded bg-[#0F6E56] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                {t('verifiedBadge')}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400">{provider.users?.phone ?? t('noPhone')}</div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={statusVariant(provider.status)}>
                            {providerStatusLabel(provider.status)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={planVariant(provider.plan)}>
                            {providerPlanLabel(provider.plan)}
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
                          {provider.totalRevenue > 0 ? t('revenueValue', { amount: provider.totalRevenue }) : '—'}
                        </td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-5 py-14 text-center">
                          <p className="font-semibold text-slate-700">{t('emptyTitle')}</p>
                          <p className="mt-1 text-sm text-slate-500">{t('emptyDescription')}</p>
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
