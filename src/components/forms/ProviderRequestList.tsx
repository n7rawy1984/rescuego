'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { getProblemLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { ProblemType, ProviderStatus, RequestStatus } from '@/types'

type ProviderRequestCard = {
  id: string
  customer_id: string
  location_address: string | null
  problem_type: ProblemType
  note: string | null
  status: RequestStatus
  accepted_by: string | null
  final_price: number | null
  created_at: string
  distance_meters: number
}

interface Props {
  requests: ProviderRequestCard[]
  providerStatus: ProviderStatus
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

export default function ProviderRequestList({ requests, providerStatus }: Props) {
  const router = useRouter()
  const [requestItems, setRequestItems] = useState<ProviderRequestCard[]>(requests)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refreshRequests = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .rpc('get_nearby_open_requests', {
        p_radius: 5000,
        p_limit: 20,
      })
      .returns<ProviderRequestCard[]>()

    if (Array.isArray(data)) {
      setRequestItems(data)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('provider-open-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requests' },
        () => {
          refreshRequests()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refreshRequests])

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
    setRequestItems((current) => current.filter((request) => request.id !== requestId))
    router.refresh()
    setAccepting(null)
  }

  const problemIcons: Record<string, string> = { flat_tire: '🔧', battery: '⚡', tow: '🚛', other: '🔍' }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-800">Open Requests Near You ({requestItems.length})</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Live
          </span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {requestItems.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-slate-500">No open requests right now. Check back soon.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requestItems.map((req) => (
              <div key={req.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{problemIcons[req.problem_type] ?? '🔍'}</div>
                  <div>
                    <div className="font-semibold text-slate-800">{getProblemLabel(req.problem_type)}</div>
                    <div className="text-sm text-slate-500 mt-0.5 max-w-[300px] truncate">{req.location_address ?? 'Location not specified'}</div>
                    {req.note && <div className="text-xs text-slate-400 mt-0.5 max-w-[300px] truncate">Note: {req.note}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDistance(req.distance_meters)}{' \u00b7 '}{new Date(req.created_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
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
