import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import Badge from '@/components/ui/Badge'
import { getProblemLabel } from '@/lib/utils'
import { BriefcaseBusiness, MapPin, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import type { ProblemType, RequestStatus } from '@/types'

export const metadata: Metadata = {
  title: 'Job History — RescueGo',
  robots: { index: false, follow: false },
}

type HistoryJobRow = {
  id: string
  completed_at: string | null
  requests: {
    problem_type: ProblemType | null
    location_address: string | null
    status: RequestStatus | null
    final_price: number | null
    cancellation_actor: 'customer' | 'provider' | 'admin' | null
    cancelled_at: string | null
    created_at: string | null
  } | null
}

type JobDisplayItem = {
  id: string
  problemLabel: string
  badgeLabel: string
  badgeVariant: 'success' | 'warning' | 'danger' | 'info' | 'default'
  location: string
  amount: string | null
  date: string
}

function getJobDisplay(job: HistoryJobRow, t: Awaited<ReturnType<typeof getTranslations>>): JobDisplayItem {
  const req = job.requests
  const location = req?.location_address ?? t('locationUnavailable')
  const date = job.completed_at ?? req?.cancelled_at ?? req?.created_at ?? null
  const dateStr = date
    ? new Date(date).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : t('dateUnavailable')

  if (job.completed_at || req?.status === 'completed') {
    return {
      id: job.id,
      problemLabel: req?.problem_type ? getProblemLabel(req.problem_type) : t('serviceDefault'),
      badgeLabel: t('completed'),
      badgeVariant: 'success',
      location,
      amount: req?.final_price != null ? `${req.final_price} AED` : t('completed'),
      date: dateStr,
    }
  }

  if (req?.status === 'cancelled') {
    const byCustomer = req.cancellation_actor === 'customer'
    return {
      id: job.id,
      problemLabel: req?.problem_type ? getProblemLabel(req.problem_type) : t('serviceDefault'),
      badgeLabel: byCustomer ? t('customerCancelled') : t('cancelled'),
      badgeVariant: 'default',
      location,
      amount: null,
      date: dateStr,
    }
  }

  return {
    id: job.id,
    problemLabel: req?.problem_type ? getProblemLabel(req.problem_type) : t('serviceDefault'),
    badgeLabel: t('released'),
    badgeVariant: 'warning',
    location,
    amount: null,
    date: dateStr,
  }
}

export default async function ProviderHistoryPage() {
  const t = await getTranslations('provider.history')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/provider/history')

  const admin = createAdminClient()

  const { data: provider } = await admin
    .from('providers')
    .select('id, plan, status')
    .eq('id', user.id)
    .single<{ id: string; plan: string; status: string }>()

  if (!provider) redirect('/provider/register')
  if (provider.status !== 'active') redirect('/provider/pending')

  const { data: jobs } = await admin
    .from('jobs')
    .select('id, completed_at, requests(problem_type, location_address, status, final_price, cancellation_actor, cancelled_at, created_at)')
    .eq('provider_id', user.id)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(50)
    .returns<HistoryJobRow[]>()

  const allJobs = jobs ?? []
  const items = allJobs.map((job) => getJobDisplay(job, t))

  const completedJobs = allJobs.filter((j) => j.completed_at || j.requests?.status === 'completed')
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.requests?.final_price ?? 0), 0)
  const cancelledByCustomer = allJobs.filter((j) => j.requests?.cancellation_actor === 'customer').length

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">

        <div className="mb-6">
          <Link
            href="/provider/dashboard"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('backToDashboard')}
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('subtitle', { count: allJobs.length })}</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completed</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{completedJobs.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Earnings</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {totalEarnings > 0 ? `${totalEarnings} AED` : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer Cancellations</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{cancelledByCustomer}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {items.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{item.problemLabel}</span>
                      <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                    </div>
                    <p className="flex items-center gap-1 text-sm text-slate-500">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{item.location}</span>
                    </p>
                  </div>
                  <div className="text-start sm:text-end shrink-0">
                    {item.amount && (
                      <p className="font-semibold text-slate-900">{item.amount}</p>
                    )}
                    <p className="text-xs text-slate-500">{item.date}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <BriefcaseBusiness className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="font-semibold text-slate-800">No job history yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Completed jobs, customer cancellations, and released requests will appear here.
              </p>
            </div>
          )}
        </div>

        {allJobs.length === 50 && (
          <p className="mt-4 text-center text-xs text-slate-400">Showing the 50 most recent jobs.</p>
        )}

      </main>
    </div>
  )
}
