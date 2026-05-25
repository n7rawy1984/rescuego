'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import type { ProviderStatus } from '@/types'

interface Props {
  providerId: string
  currentStatus: ProviderStatus
  verifiedBadge: boolean
}

export default function AdminProviderActions({ providerId, currentStatus, verifiedBadge }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function updateProvider(payload: { status?: ProviderStatus; verified_badge?: boolean }) {
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/providers/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: providerId, ...payload }),
    })

    if (!res.ok) {
      const result = await res.json().catch(() => null) as { error?: string } | null
      setError(result?.error ?? 'Failed to update provider')
      setLoading(false)
      return
    }

    router.refresh()
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {currentStatus !== 'active' && (
          <Button size="sm" variant="primary" loading={loading} onClick={() => updateProvider({ status: 'active' })}>
            Activate
          </Button>
        )}
        {currentStatus !== 'suspended' && (
          <Button size="sm" variant="destructive" loading={loading} onClick={() => updateProvider({ status: 'suspended' })}>
            Suspend
          </Button>
        )}
        <Button size="sm" variant="outline" loading={loading} onClick={() => updateProvider({ verified_badge: !verifiedBadge })}>
          {verifiedBadge ? 'Remove verified badge' : 'Mark verified'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
