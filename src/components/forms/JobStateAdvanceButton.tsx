'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import type { RequestStatus } from '@/types'

const STATE_CONFIG: Record<string, { label: string; loadingLabel: string; color: string }> = {
  accepted: {
    label: "On My Way",
    loadingLabel: "Updating...",
    color: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  en_route: {
    label: "I've Arrived",
    loadingLabel: "Updating...",
    color: "bg-amber-600 hover:bg-amber-700 text-white",
  },
  arrived: {
    label: "Start Job",
    loadingLabel: "Starting...",
    color: "bg-[#0F6E56] hover:bg-[#0a5240] text-white",
  },
}

interface Props {
  requestId: string
  currentStatus: RequestStatus
}

export default function JobStateAdvanceButton({ requestId, currentStatus }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const config = STATE_CONFIG[currentStatus]
  if (!config) return null

  async function handleAdvance() {
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/advance-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (!res.ok) {
        setError(result?.error ?? 'Unable to update job state. Please try again.')
        setLoading(false)
        return
      }

      router.refresh()
    } catch {
      setError('Connection lost. Please check your internet and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleAdvance}
        disabled={loading}
        className={`inline-flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${config.color}`}
      >
        {loading ? config.loadingLabel : config.label}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
