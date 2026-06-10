'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { RequestStatus } from '@/types'

const STATE_CONFIG: Record<string, { labelKey: string; loadingLabelKey: string; color: string }> = {
  accepted: {
    labelKey: 'onMyWay',
    loadingLabelKey: 'updating',
    color: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  en_route: {
    labelKey: 'arrived',
    loadingLabelKey: 'updating',
    color: "bg-amber-600 hover:bg-amber-700 text-white",
  },
  arrived: {
    labelKey: 'startJob',
    loadingLabelKey: 'starting',
    color: "bg-[#0F6E56] hover:bg-[#0a5240] text-white",
  },
}

interface Props {
  requestId: string
  currentStatus: RequestStatus
}

export default function JobStateAdvanceButton({ requestId, currentStatus }: Props) {
  const router = useRouter()
  const t = useTranslations('components.jobStateAdvance')
  const [loading, setLoading] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAdvanced(false)
    setLoading(false)
  }, [currentStatus])

  const config = STATE_CONFIG[currentStatus]
  if (!config) return null

  async function handleAdvance() {
    if (loading || advanced) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/advance-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (res.status === 409) {
        setAdvanced(true)
        router.refresh()
        return
      }

      if (!res.ok) {
        setError(result?.error ?? t('errors.updateFailed'))
        setLoading(false)
        return
      }

      setAdvanced(true)
      router.refresh()
    } catch {
      setError(t('errors.connectionLost'))
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleAdvance}
        disabled={loading || advanced}
        className={`inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${config.color}`}
      >
        {loading || advanced ? t(config.loadingLabelKey) : t(config.labelKey)}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
