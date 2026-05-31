'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import { PAY_PER_JOB_PROMO_FEE_AED } from '@/types'
import type { ProviderPlan } from '@/types'

type ReleaseJobButtonProps = {
  requestId: string
  providerPlan: ProviderPlan
}

export default function ReleaseJobButton({ requestId, providerPlan }: ReleaseJobButtonProps) {
  const router = useRouter()
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
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(result?.error ?? 'Unable to release this job right now.')
        setLoading(false)
        return
      }

      setReleased(true)
      setOpen(false)
      router.refresh()
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  if (released) {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-green-800">Job released. Refreshing dashboard...</p>
        <p className="mt-1 text-xs text-green-700">The request is available for other providers, and exact customer details are no longer accessible.</p>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
      <p className="mb-3 text-sm text-slate-600">Unable to complete this job? Release it so another eligible provider can help the customer.</p>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={loading} className="w-full sm:w-auto">
        Release / Unable to complete
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="release-active-job-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="release-active-job-title" className="text-lg font-bold text-slate-900">Release this job?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {providerPlan === 'pay_per_job'
                ? `Your PPJ acceptance usage will not be restored if you release this job. The ${PAY_PER_JOB_PROMO_FEE_AED} AED acceptance fee is non-refundable, and the request will become available to other providers.`
                : providerPlan === 'starter' || providerPlan === 'pro'
                  ? 'This request will still count toward your monthly usage if you release it. The request will become available to other providers.'
                  : 'The request will become available to other providers, and you will lose access to the exact customer location.'}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Keep job
              </button>
              <button
                type="button"
                onClick={releaseJob}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Releasing...' : 'Release job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
