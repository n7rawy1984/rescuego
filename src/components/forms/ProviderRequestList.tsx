'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { getProblemLabel } from '@/lib/utils'
import type { Request, ProviderStatus } from '@/types'

interface Props {
  requests: Request[]
  providerStatus: ProviderStatus
}

export default function ProviderRequestList({ requests, providerStatus }: Props) {
  const router = useRouter()
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleAccept(requestId: string) {
    if (providerStatus !== 'active') {
      setError('Your account must be active to accept requests.')
      return
    }
    setAccepting(requestId)
    setError('')
    const res = await fetch('/api/provider/requests/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    })
    const result = await res.json()
    if (!res.ok) {
      setError(result.error ?? 'Failed to accept request')
      setAccepting(null)
      return
    }
    router.refresh()
    setAccepting(null)
  }

  const problemIcons: Record<string, string> = { flat_tire: '🔧', battery: '⚡', tow: '🚛', other: '🔍' }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-slate-800">Open Requests Near You ({requests.length})</h2>
      </CardHeader>
      <CardBody className="p-0">
        {requests.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-slate-500">No open requests right now. Check back soon.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((req) => (
              <div key={req.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{problemIcons[req.problem_type] ?? '🔍'}</div>
                  <div>
                    <div className="font-semibold text-slate-800">{getProblemLabel(req.problem_type)}</div>
                    <div className="text-sm text-slate-500 mt-0.5 max-w-[300px] truncate">{req.location_address ?? 'Location not specified'}</div>
                    {req.note && <div className="text-xs text-slate-400 mt-0.5 max-w-[300px] truncate">Note: {req.note}</div>}
                    <div className="text-sm text-orange-600 font-medium mt-1">
                      Est. {req.price_estimate_min}–{req.price_estimate_max} AED
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{new Date(req.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  loading={accepting === req.id}
                  onClick={() => handleAccept(req.id)}
                  disabled={providerStatus !== 'active'}
                >
                  Accept
                </Button>
              </div>
            ))}
          </div>
        )}
        {error && <div className="px-6 pb-4 text-sm text-red-500">{error}</div>}
      </CardBody>
    </Card>
  )
}
