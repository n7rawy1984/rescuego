'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

type PpjPaymentPromptProps = {
  requestId: string
  feeAed: number
  /** ISO timestamp when the 10-minute payment window started (requests.payment_window_started_at). */
  paymentWindowStartedAt: string | null
}

// Payment window: 10 minutes total; a warning is shown in the last 5 minutes.
// This countdown is provider-UI-only — the authoritative release happens server-side
// in expire_ppj_payment_selection_atomic (driven by the marketplace cron).
const WINDOW_SECONDS = 10 * 60
const WARNING_THRESHOLD_SECONDS = 5 * 60

function storePaymentHandoff(requestId: string, clientSecret: string, feeAed: number): boolean {
  try {
    window.sessionStorage.setItem(
      `rescuego:ppj-payment:${requestId}`,
      JSON.stringify({ client_secret: clientSecret, fee_aed: feeAed })
    )
    return true
  } catch {
    return false
  }
}

export default function PpjPaymentPrompt({ requestId, feeAed, paymentWindowStartedAt }: PpjPaymentPromptProps) {
  const t = useTranslations('provider.ppjPaymentPrompt')
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const windowStartMs = useMemo(() => {
    if (!paymentWindowStartedAt) return null
    const parsed = Date.parse(paymentWindowStartedAt)
    return Number.isNaN(parsed) ? null : parsed
  }, [paymentWindowStartedAt])

  const computeRemaining = useMemo(
    () => () => {
      if (windowStartMs == null) return WINDOW_SECONDS
      const elapsed = Math.floor((Date.now() - windowStartMs) / 1000)
      return Math.max(0, WINDOW_SECONDS - elapsed)
    },
    [windowStartMs]
  )

  const [remaining, setRemaining] = useState<number>(computeRemaining)

  useEffect(() => {
    setRemaining(computeRemaining())
    const interval = setInterval(() => {
      const next = computeRemaining()
      setRemaining(next)
      // When the window elapses, refresh so the server view (released/quoted) takes over.
      if (next <= 0) {
        clearInterval(interval)
        router.refresh()
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [computeRemaining, router])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`
  const showWarning = remaining > 0 && remaining <= WARNING_THRESHOLD_SECONDS

  async function handlePay() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/provider/ppj-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result?.error || t('genericError'))
        setSubmitting(false)
        return
      }

      // Recovery credit waived the fee and finalized the job server-side.
      if (result?.credit_applied) {
        router.refresh()
        return
      }

      if (!result?.client_secret || !storePaymentHandoff(requestId, result.client_secret, result.fee_aed)) {
        setError(t('genericError'))
        setSubmitting(false)
        return
      }

      router.push(`/provider/ppj-pay?request_id=${requestId}&fee=${result.fee_aed}`)
    } catch {
      setError(t('genericError'))
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-[#9FE1CB] bg-[#E1F5EE] p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('badge')}</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">{t('title')}</h2>
      <p className="mt-1 text-sm text-slate-700">{t('description', { fee: feeAed })}</p>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-slate-600">{t('timeRemaining')}</span>
        <span className="font-mono font-semibold text-slate-900" aria-live="polite">{timeLabel}</span>
      </div>

      {showWarning && (
        <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900" role="alert">
          {t('warningSoon')}
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm font-medium text-red-700" role="alert">{error}</p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={submitting || remaining <= 0}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-[#1D9E75] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#168561] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('processing') : t('payButton', { fee: feeAed })}
      </button>
    </div>
  )
}
