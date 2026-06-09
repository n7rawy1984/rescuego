'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Button from '@/components/ui/Button'

interface Props {
  requestId: string
}

export default function CompleteJobForm({ requestId }: Props) {
  const router = useRouter()
  const t = useTranslations('components.completeJobForm')
  const [loading, setLoading] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || completed) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, final_price: 1 }),
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
    <form onSubmit={handleSubmit} className="mt-4">
      <Button type="submit" loading={loading} className="w-full bg-[#1D9E75] text-white hover:bg-[#0F6E56]">
        {loading ? t('completingJob') : t('markComplete')}
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </form>
  )
}
