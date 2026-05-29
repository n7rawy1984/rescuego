'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BatteryCharging, HelpCircle, Search, Truck, Wrench } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { getProblemLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  LAUNCH_PROMO,
  OVERAGE_FEE_AED,
  PAY_PER_JOB_DISTANCE_THRESHOLD_M,
  PAY_PER_JOB_FEE_FAR_AED,
  PAY_PER_JOB_FEE_NEAR_AED,
  PAY_PER_JOB_PROMO_FEE_AED,
} from '@/types'
import type { ProblemType, ProviderPlan, ProviderStatus, RequestStatus } from '@/types'

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
  distance_meters: number | null
}

interface Props {
  requests: ProviderRequestCard[]
  providerStatus: ProviderStatus
  providerPlan: ProviderPlan
  providerOnline: boolean
  locationFallback?: boolean
  requestFeedMode?: 'nearby' | 'fallback' | 'offline'
}

function formatDistance(meters: number | null): string {
  if (meters === null) return 'Distance unavailable'
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function storePaymentHandoff(kind: 'ppj' | 'overage', requestId: string, clientSecret: string, feeAed: number): boolean {
  try {
    window.sessionStorage.setItem(
      `rescuego:${kind}-payment:${requestId}`,
      JSON.stringify({ client_secret: clientSecret, fee_aed: feeAed })
    )
    return true
  } catch {
    return false
  }
}

export default function ProviderRequestList({
  requests,
  providerStatus,
  providerPlan,
  providerOnline,
  locationFallback = false,
  requestFeedMode = locationFallback ? 'fallback' : 'nearby',
}: Props) {
  const router = useRouter()
  const [requestItems, setRequestItems] = useState<ProviderRequestCard[]>(requests)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showOverageModal, setShowOverageModal] = useState<string | null>(null)
  const [overageLoading, setOverageLoading] = useState(false)

  const refreshRequests = useCallback(async () => {
    router.refresh()
  }, [router])

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
    if (accepting || overageLoading) return
    if (providerStatus !== 'active') {
      setError('Your account must be active to accept requests.')
      return
    }
    if (!providerOnline) {
      setError('Go online before accepting requests.')
      return
    }
    setAccepting(requestId)
    setError('')

    if (providerPlan === 'pay_per_job') {
      try {
        const res = await fetch('/api/provider/ppj-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId }),
        })
        const result = await res.json()

        if (res.status === 401) {
          setError('Your session expired. Please sign in again.')
          setAccepting(null)
          return
        }

        if (!res.ok) {
          setError(result.error ?? 'Unable to start billing session right now.')
          setAccepting(null)
          return
        }

        if (!result.client_secret || !storePaymentHandoff('ppj', requestId, result.client_secret, result.fee_aed)) {
          setError('Unable to open payment securely. Please try again.')
          setAccepting(null)
          return
        }

        router.push(`/provider/ppj-pay?request_id=${requestId}&fee=${result.fee_aed}`)
      } catch {
        setError('Network connection lost. Please try again.')
        setAccepting(null)
      }
      return
    }

    try {
      const res = await fetch('/api/provider/requests/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json()

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setAccepting(null)
        return
      }

      if (res.status === 402 && result.code === 'OVERAGE_REQUIRED') {
        setAccepting(null)
        setShowOverageModal(requestId)
        return
      }

      if (!res.ok) {
        setError(result.error ?? 'Failed to accept request')
        setAccepting(null)
        return
      }
      setRequestItems((current) => current.filter((request) => request.id !== requestId))
      router.refresh()
      setAccepting(null)
    } catch {
      setError('Network connection lost. Please try again.')
      setAccepting(null)
    }
  }

  async function handleOverageConfirm(requestId: string) {
    if (overageLoading || accepting) return
    setOverageLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/overage-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json()

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      if (!res.ok) {
        setError(result.error ?? 'Unable to start billing session right now.')
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      if (!result.client_secret || !storePaymentHandoff('overage', requestId, result.client_secret, result.fee_aed)) {
        setError('Unable to open payment securely. Please try again.')
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      router.push(`/provider/overage-pay?request_id=${requestId}&fee=${result.fee_aed}`)
    } catch {
      setError('Network connection lost. Please try again.')
      setOverageLoading(false)
      setShowOverageModal(null)
    }
  }

  const problemIcons = {
    flat_tire: Wrench,
    battery: BatteryCharging,
    tow: Truck,
    other: HelpCircle,
  }

  return (
    <Card className="overflow-hidden shadow-sm shadow-slate-200/70">
      <CardHeader className="border-slate-100 bg-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Nearby Roadside Requests</h2>
            <p className="mt-1 text-sm text-slate-500">
              {requestItems.length > 0
                ? requestFeedMode === 'fallback'
                  ? `Showing ${requestItems.length} available open request${requestItems.length === 1 ? '' : 's'} while nearby location matching refreshes.`
                  : requestFeedMode === 'offline'
                    ? `${requestItems.length} open request${requestItems.length === 1 ? '' : 's'} available. Go online to sort by distance.`
                  : `${requestItems.length} open request${requestItems.length === 1 ? '' : 's'} near your dispatch area.`
                : 'Open requests will appear here as customers submit them.'}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            <span className={`h-2 w-2 rounded-full ${providerOnline ? 'bg-green-500' : 'bg-slate-400'}`} />
            Auto updates
          </span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {!providerOnline && requestItems.length > 0 && (
          <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
            Go online to accept requests. Available requests are shown for awareness only while you are offline.
          </div>
        )}
        {requestItems.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-semibold text-slate-800">
              {requestFeedMode === 'nearby' ? 'No nearby roadside requests right now.' : 'No open requests right now.'}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {requestFeedMode === 'nearby'
                ? 'Your request list is live. New nearby customer requests will appear here automatically.'
                : requestFeedMode === 'fallback'
                  ? 'Nearby matching refreshed, and no open requests are currently available.'
                : 'Go online to share your dispatch location and sort new requests by distance.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requestItems.map((req) => {
              const Icon = problemIcons[req.problem_type] ?? HelpCircle
              return (
              <div key={req.id} className="px-5 py-5 flex flex-col gap-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800">{getProblemLabel(req.problem_type)}</div>
                    <div className="text-sm text-slate-500 mt-0.5 max-w-full truncate sm:max-w-[360px]">{req.location_address ?? 'Location not specified'}</div>
                    {req.note && <div className="text-xs text-slate-400 mt-0.5 max-w-full truncate sm:max-w-[360px]">Note: {req.note}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDistance(req.distance_meters)}{' \u00b7 '}{new Date(req.created_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {providerPlan === 'pay_per_job' && (
                      <div className="mt-1 inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                        {LAUNCH_PROMO
                          ? `${PAY_PER_JOB_PROMO_FEE_AED} AED to accept (promo)`
                          : req.distance_meters !== null && req.distance_meters >= PAY_PER_JOB_DISTANCE_THRESHOLD_M
                            ? `${PAY_PER_JOB_FEE_FAR_AED} AED to accept`
                            : `${PAY_PER_JOB_FEE_NEAR_AED} AED to accept`
                        }
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  loading={accepting === req.id}
                  onClick={() => handleAccept(req.id)}
                  disabled={providerStatus !== 'active' || !providerOnline || accepting !== null || overageLoading}
                >
                  {!providerOnline ? 'Go online first' : providerPlan === 'pay_per_job' ? 'Pay & Accept' : 'Accept'}
                </Button>
              </div>
            )})}
          </div>
        )}
        {error && <div className="px-6 pb-5 text-sm text-red-500">{error}</div>}
      </CardBody>
      {showOverageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Monthly Limit Reached</h3>
            <p className="text-sm text-slate-600 mb-4">
              You&apos;ve used all your jobs this month. Accept this request for a one-time overage fee of{' '}
              <strong className="text-orange-600">{OVERAGE_FEE_AED} AED</strong>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowOverageModal(null)}
                disabled={overageLoading}
                className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleOverageConfirm(showOverageModal)}
                disabled={overageLoading}
                className="flex-1 h-10 rounded-lg bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60 transition-colors"
              >
                {overageLoading ? 'Setting up...' : `Pay ${OVERAGE_FEE_AED} AED`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
