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
  distance_meters: number
}

interface Props {
  requests: ProviderRequestCard[]
  providerStatus: ProviderStatus
  providerPlan: ProviderPlan
  providerOnline: boolean
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

export default function ProviderRequestList({ requests, providerStatus, providerPlan, providerOnline }: Props) {
  const router = useRouter()
  const [requestItems, setRequestItems] = useState<ProviderRequestCard[]>(requests)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showOverageModal, setShowOverageModal] = useState<string | null>(null)
  const [overageLoading, setOverageLoading] = useState(false)

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

    if (providerPlan === 'pay_per_job') {
      const res = await fetch('/api/provider/ppj-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result.error ?? 'Pay Per Job payment setup failed')
        setAccepting(null)
        return
      }

      router.push(`/provider/ppj-pay?client_secret=${result.client_secret}&request_id=${requestId}&fee=${result.fee_aed}`)
      return
    }

    const res = await fetch('/api/provider/requests/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    })
    const result = await res.json()

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
  }

  async function handleOverageConfirm(requestId: string) {
    setOverageLoading(true)
    setError('')

    const res = await fetch('/api/provider/overage-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    })
    const result = await res.json()

    if (!res.ok) {
      setError(result.error ?? 'Overage payment setup failed')
      setOverageLoading(false)
      setShowOverageModal(null)
      return
    }

    router.push(`/provider/overage-pay?client_secret=${result.client_secret}&request_id=${requestId}&fee=${result.fee_aed}`)
  }

  const problemIcons = {
    flat_tire: Wrench,
    battery: BatteryCharging,
    tow: Truck,
    other: HelpCircle,
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-800">Nearby Roadside Requests ({requestItems.length})</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Auto updates
          </span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {requestItems.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-medium text-slate-700">
              {providerOnline ? 'No nearby roadside requests right now.' : 'Go online to see nearby roadside requests.'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {providerOnline
                ? 'New customer requests near your dispatch location will appear here automatically.'
                : 'Share your dispatch location above when you are available for jobs.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requestItems.map((req) => {
              const Icon = problemIcons[req.problem_type] ?? HelpCircle
              return (
              <div key={req.id} className="px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{getProblemLabel(req.problem_type)}</div>
                    <div className="text-sm text-slate-500 mt-0.5 max-w-[300px] truncate">{req.location_address ?? 'Location not specified'}</div>
                    {req.note && <div className="text-xs text-slate-400 mt-0.5 max-w-[300px] truncate">Note: {req.note}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDistance(req.distance_meters)}{' \u00b7 '}{new Date(req.created_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {providerPlan === 'pay_per_job' && (
                      <div className="mt-1 inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                        {LAUNCH_PROMO
                          ? `${PAY_PER_JOB_PROMO_FEE_AED} AED to accept (promo)`
                          : req.distance_meters >= PAY_PER_JOB_DISTANCE_THRESHOLD_M
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
                  disabled={providerStatus !== 'active'}
                >
                  {providerPlan === 'pay_per_job' ? 'Pay & Accept' : 'Accept'}
                </Button>
              </div>
            )})}
          </div>
        )}
        {error && <div className="px-6 pb-4 text-sm text-red-500">{error}</div>}
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
