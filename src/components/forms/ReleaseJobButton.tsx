'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { PAY_PER_JOB_PROMO_FEE_AED } from '@/types'
import type { ProviderPlan } from '@/types'

type ReleaseJobButtonProps = {
  requestId: string
  providerPlan: ProviderPlan
}

export default function ReleaseJobButton({ requestId, providerPlan }: ReleaseJobButtonProps) {
  const router = useRouter()
  const t = useTranslations('components.releaseJobButton')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [released, setReleased] = useState(false)
  const [error, setError] = useState('')

  async function releaseJob() {
    if (loading || released) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (res.status === 401) {
        setError(t('sessionExpired'))
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(result?.error ?? t('unableToRelease'))
        setLoading(false)
        return
      }

      setReleased(true)
      setOpen(false)
      router.refresh()
    } catch {
      setError(t('connectionLost'))
      setLoading(false)
    }
  }

  if (released) {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-green-800">{t('jobReleased')}</p>
        <p className="mt-1 text-xs text-green-700">{t('jobReleasedDescription')}</p>
      </div>
    )
  }

  return (
    <div className="mt-3 flex justify-start">
      <button type="button" onClick={() => setOpen(true)} disabled={loading} className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">
        {t('releaseUnableToComplete')}
      </button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="release-active-job-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="release-active-job-title" className="text-lg font-bold text-slate-900">{t('releaseJobTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {providerPlan === 'pay_per_job'
                ? t('payPerJobReleaseWarning', { fee: PAY_PER_JOB_PROMO_FEE_AED })
                : providerPlan === 'starter' || providerPlan === 'pro'
                  ? t('monthlyPlanReleaseWarning')
                  : t('defaultReleaseWarning')}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('keepJob')}
              </button>
              <button
                type="button"
                onClick={releaseJob}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? t('releasing') : t('releaseJob')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
