'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

interface Props {
  requestId: string
}

export default function CompleteJobForm({ requestId }: Props) {
  const router = useRouter()
  const t = useTranslations('components.completeJobForm')
  const [finalPrice, setFinalPrice] = useState('')
  const [loading, setLoading] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || completed) return
    const amount = Number(finalPrice)

    if (!Number.isInteger(amount) || amount <= 0) {
      setError(t('errors.invalidFinalPrice'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, final_price: amount }),
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (res.status === 401) {
        setError(t('errors.sessionExpired'))
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(result?.error ?? t('errors.completeFailed'))
        setLoading(false)
        return
      }

      setCompleted(true)
      router.refresh()
    } catch {
      setError(t('errors.connectionLost'))
      setLoading(false)
    }
  }

  if (completed) {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-green-800">{t('completedTitle')}</p>
        <p className="mt-1 text-xs text-green-700">
          {t('completedDescription')}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-2xl border border-[#DDE7EE] bg-white/80 p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <Input
        id={`final-price-${requestId}`}
        type="number"
        min={1}
        max={10000}
        label={t('finalPriceLabel')}
        value={finalPrice}
        onChange={(event) => setFinalPrice(event.target.value)}
        placeholder="250"
        disabled={loading}
      />
      <Button type="submit" loading={loading}>
        {loading ? t('completingJob') : t('completeJob')}
      </Button>
      </div>
      {error && <p className="text-sm text-red-500 sm:pb-2">{error}</p>}
    </form>
  )
}
