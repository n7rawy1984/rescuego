import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { getProblemLabel } from '@/lib/utils'
import { Star, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { ProblemType } from '@/types'

export const metadata: Metadata = {
  title: 'My Ratings — RescueGo',
  robots: { index: false, follow: false },
}

type RatingRow = {
  id: string
  stars: number
  comment: string | null
  created_at: string
  jobs: {
    requests: {
      problem_type: ProblemType | null
    } | null
  } | null
}

function StarDisplay({ stars, size = 'sm' }: { stars: number; size?: 'sm' | 'lg' }) {
  const sz = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${sz} ${n <= stars ? 'fill-amber-400 text-amber-400' : 'fill-slate-100 text-slate-300'}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

export default async function ProviderRatingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/provider/ratings')

  const admin = createAdminClient()

  const { data: provider } = await admin
    .from('providers')
    .select('id, status')
    .eq('id', user.id)
    .single<{ id: string; status: string }>()

  if (!provider) redirect('/provider/register')
  if (provider.status !== 'active') redirect('/provider/pending')

  const { data: ratings } = await admin
    .from('ratings')
    .select('id, stars, comment, created_at, jobs(requests(problem_type))')
    .eq('provider_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<RatingRow[]>()

  const allRatings = ratings ?? []

  const average =
    allRatings.length > 0
      ? allRatings.reduce((sum, r) => sum + r.stars, 0) / allRatings.length
      : null

  const breakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: allRatings.filter((r) => r.stars === star).length,
  }))

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
            Back to dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">My Ratings</h1>
          <p className="mt-1 text-sm text-slate-500">
            {allRatings.length > 0
              ? `${allRatings.length} review${allRatings.length !== 1 ? 's' : ''} from customers.`
              : 'No reviews yet.'}
          </p>
        </div>

        {allRatings.length > 0 && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <div className="text-center sm:text-start">
                <p className="text-4xl font-bold text-slate-900">{average!.toFixed(1)}</p>
                <StarDisplay stars={Math.round(average!)} size="lg" />
                <p className="mt-1 text-xs text-slate-500">{allRatings.length} review{allRatings.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex-1 space-y-1.5">
                {breakdown.map(({ star, count }) => (
                  <div key={star} className="flex items-center gap-2">
                    <span className="w-4 text-end text-xs text-slate-500">{star}</span>
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" aria-hidden="true" />
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="absolute inset-y-0 start-0 rounded-full bg-amber-400"
                        style={{ width: allRatings.length > 0 ? `${(count / allRatings.length) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="w-5 text-start text-xs text-slate-500">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {allRatings.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {allRatings.map((rating) => {
                const problemType = rating.jobs?.requests?.problem_type ?? null
                const label = problemType ? getProblemLabel(problemType) : 'Service'
                const dateStr = new Date(rating.created_at).toLocaleString('en-AE', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
                return (
                  <div key={rating.id} className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="font-medium text-slate-900">{label}</p>
                        <StarDisplay stars={rating.stars} />
                      </div>
                      <p className="shrink-0 text-xs text-slate-400">{dateStr}</p>
                    </div>
                    {rating.comment && (
                      <p className="text-sm text-slate-600">{rating.comment}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Star className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="font-semibold text-slate-800">No ratings yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Customer ratings will appear here after you complete jobs.
              </p>
            </div>
          )}
        </div>

        {allRatings.length === 50 && (
          <p className="mt-4 text-center text-xs text-slate-400">Showing the 50 most recent ratings.</p>
        )}

      </main>
    </div>
  )
}
