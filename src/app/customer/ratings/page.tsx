import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Navbar from '@/components/layout/Navbar'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import RatingForm from '@/components/forms/RatingForm'
import { getProblemLabel } from '@/lib/utils'
import { CheckCircle2, MapPin, Star, UserRound } from 'lucide-react'
import type { Metadata } from 'next'
import type { ProblemType } from '@/types'

export const metadata: Metadata = {
  title: 'Rate Completed Jobs',
  robots: { index: false, follow: false },
}

type CompletedJobRow = {
  id: string
  provider_id: string
  completed_at: string | null
  requests: {
    customer_id: string | null
    problem_type: ProblemType | null
    location_address: string | null
    final_price: number | null
  } | null
  providers: {
    users: {
      name: string | null
    } | null
  } | null
}

export default async function CustomerRatingsPage() {
  const t = await getTranslations('customer.ratings')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/customer/ratings')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') redirect('/')

  const admin = createAdminClient()
  const { data: completedJobs } = await admin
    .from('jobs')
    .select('id, provider_id, completed_at, requests!inner(customer_id, problem_type, location_address, final_price), providers(users(name))')
    .eq('requests.customer_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .returns<CompletedJobRow[]>()

  const jobIds = (completedJobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }

  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))
  const unratedJobs = (completedJobs ?? []).filter((job) => !ratedJobIds.has(job.id))

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('eyebrow')}</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{t('pageTitle')}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  {t('subtitle')}
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <Star className="h-6 w-6" aria-hidden="true" />
              </div>
            </div>
          </div>

          {unratedJobs.length === 0 ? (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center shadow-sm sm:p-10">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-lg font-semibold text-slate-950">{t('noRatingsTitle')}</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {t('noRatingsDesc')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {unratedJobs.map((job) => (
                <div key={job.id} className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                          {t('ratingNeeded')}
                        </div>
                        <h2 className="mt-3 text-lg font-semibold text-slate-950">
                          {job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : t('completedService')}
                        </h2>
                        <div className="mt-3 grid gap-2 text-sm text-slate-500">
                          <p className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            {t('providerLabel', { name: job.providers?.users?.name ?? 'Recovery provider' })}
                          </p>
                          <p className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="break-words">
                              {job.requests?.location_address ?? t('locationUnavailable')}
                              {job.requests?.final_price ? ` - ${job.requests.final_price} AED` : ''}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {job.completed_at
                          ? new Date(job.completed_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
                          : t('completed')}
                      </div>
                    </div>
                  </div>
                  <div className="p-5 sm:p-6">
                    <RatingForm jobId={job.id} providerId={job.provider_id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
