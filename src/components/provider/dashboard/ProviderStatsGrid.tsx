import { BriefcaseBusiness, CreditCard, TrendingUp, WalletCards } from 'lucide-react'

type Props = {
  jobsThisMonth: number
  planLabel: string
  isPayPerJob: boolean
  isUnlimited: boolean
  remainingJobs: number | null
  totalEarnings: number
}

export default function ProviderStatsGrid({
  jobsThisMonth,
  planLabel,
  isPayPerJob,
  isUnlimited,
  remainingJobs,
  totalEarnings,
}: Props) {
  return (
    <div className="mb-6 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Jobs this month
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {jobsThisMonth}
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56]">
            <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {planLabel}
            </p>
            <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">
              {isPayPerJob
                ? 'No monthly allowance. Pay only when you accept a request.'
                : isUnlimited
                  ? 'Unlimited monthly jobs'
                  : `${remainingJobs ?? 0} jobs remaining`}
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Current access
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {isPayPerJob ? 'PPJ' : isUnlimited ? 'Unlimited' : 'Monthly'}
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56]">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#9FE1CB] bg-[#E1F5EE] p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[#0F6E56]/80">
              Earnings from last 10 jobs
            </p>
            <p className="mt-2 text-2xl font-semibold text-[#0F6E56]">
              {totalEarnings > 0 ? `${totalEarnings.toLocaleString()} AED` : '—'}
            </p>
            {totalEarnings === 0 ? (
              <p className="mt-1 text-xs text-[#0F6E56]/70">
                Completed jobs will build this total.
              </p>
            ) : null}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0F6E56]">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}
