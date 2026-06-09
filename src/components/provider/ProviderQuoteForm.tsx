'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Button from '@/components/ui/Button'

interface Props {
  requestId: string
  disabled?: boolean
}

export default function ProviderQuoteForm({ requestId, disabled = false }: Props) {
  const t = useTranslations('components.providerRequestList')
  const router = useRouter()
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const numPrice = Number(price)
    if (!numPrice || numPrice < 1) {
      setError(t('enterValidPrice'))
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, proposed_price: numPrice }),
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result.error ?? t('quoteSubmitFailed'))
        setSubmitting(false)
        return
      }

      setSuccess(true)
      setSubmitting(false)
      router.refresh()
    } catch {
      setError(t('networkConnectionLost'))
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-[#E1F5EE] px-3 py-2 text-sm font-medium text-[#0F6E56]">
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>{t('quoteSent')}</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor={`quote-price-${requestId}`} className="sr-only">
          {t('enterPrice')}
        </label>
        <div className="relative">
          <input
            id={`quote-price-${requestId}`}
            type="number"
            min="1"
            max="50000"
            step="1"
            value={price}
            onChange={(e) => { setPrice(e.target.value); setError('') }}
            placeholder={t('pricePlaceholder')}
            disabled={disabled || submitting}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1D9E75] focus:outline-none focus:ring-1 focus:ring-[#1D9E75] disabled:cursor-not-allowed disabled:opacity-60 sm:w-32"
          />
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            AED
          </span>
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
      <Button
        type="submit"
        size="sm"
        className="bg-[#1D9E75] text-white shadow-sm hover:bg-[#0F6E56] focus:ring-[#1D9E75]"
        loading={submitting}
        disabled={disabled || submitting || !price}
      >
        {t('sendQuote')}
      </Button>
    </form>
  )
}
