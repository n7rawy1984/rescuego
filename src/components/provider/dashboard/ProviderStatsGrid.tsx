import { BriefcaseBusiness, CreditCard, TrendingUp, WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('components.providerStatsGrid')

  return (
    <div className="mb-6 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('jobsThisMonth')}
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
                ? t('noMonthlyAllowance')
                : isUnlimited
                  ? t('unlimitedMonthlyJobs')
                  : t('jobsRemaining', { count: remainingJobs ?? 0 })}
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
              {t('currentAccess')}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {isPayPerJob ? t('ppj') : isUnlimited ? t('unlimited') : t('monthly')}
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
              {t('earningsFromLastTenJobs')}
            </p>
            <p className="mt-2 text-2xl font-semibold text-[#0F6E56]">
              {totalEarnings > 0 ? `${totalEarnings.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} AED` : '—'}
            </p>
            {totalEarnings === 0 ? (
              <p className="mt-1 text-xs text-[#0F6E56]/70">
                {t('completedJobsBuildTotal')}
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
