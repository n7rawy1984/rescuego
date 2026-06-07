import { ShieldCheck, Star } from 'lucide-react'
import Link from 'next/link'
import type { ProviderStatus } from '@/types'

type Props = {
  name: string
  rating: number
  status: ProviderStatus
  planLabel: string
  verified: boolean
  hasRecentJobs: boolean
}

export default function ProviderDashboardHeader({
  name,
  rating,
  status,
  planLabel,
  verified,
  hasRecentJobs,
}: Props) {
  const roundedRating = Math.round(rating)

  return (
    <section className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0F6E56]">
            Provider Operations
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 text-balance sm:text-4xl">
            Welcome, {name}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
            Manage availability, active jobs, request intake, and recent activity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${
              status === 'active'
                ? 'bg-[#E1F5EE] text-[#0F6E56]'
                : status === 'suspended'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-[#FAEEDA] text-amber-800'
            }`}
          >
            {status}
          </span>
          <Link
            href="/provider/plan"
            className="inline-flex items-center rounded-full bg-[#E6F1FB] px-3 py-1 text-xs font-medium text-[#185FA5] hover:bg-[#d0e6f9] transition-colors"
          >
            {planLabel}
          </Link>
          {verified && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-medium text-[#0F6E56]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Trusted Partner
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <div className="rounded-xl border border-amber-200 bg-[#FAEEDA] px-5 py-4">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-5 w-5 ${
                  star <= roundedRating ? 'fill-amber-500 text-amber-500' : 'text-amber-200'
                }`}
                aria-hidden="true"
              />
            ))}
            <span className="ms-2 text-2xl font-semibold text-amber-950">
              {rating.toFixed(1)}
            </span>
          </div>
          <p className="mt-1 text-sm text-amber-800">Your rating</p>
          {!hasRecentJobs ? (
            <p className="mt-1 text-xs text-amber-700">
              Your first reviews will appear after completed jobs.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
