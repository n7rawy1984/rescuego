'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BatteryCharging, HelpCircle, MapPin, Search, Truck, Wrench } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { getProblemLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  LAUNCH_PROMO,
  OVERAGE_FEE_AED,
  PAY_PER_JOB_PROMO_FEE_AED,
  PAY_PER_JOB_DISTANCE_THRESHOLD_M,
  PAY_PER_JOB_FEE_FAR_AED,
  PAY_PER_JOB_FEE_NEAR_AED,
} from '@/types'
import type { ProblemType, ProviderPlan, ProviderStatus, RequestStatus } from '@/types'

type ProviderRequestCard = {
  id: string
  customer_id: string
  location?: unknown
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
  ppjRecoveryCredits?: number
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
  ppjRecoveryCredits = 0,
}: Props) {
  const router = useRouter()
  const [requestItems, setRequestItems] = useState<ProviderRequestCard[]>(requests)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showOverageModal, setShowOverageModal] = useState<string | null>(null)
  const [overageLoading, setOverageLoading] = useState(false)
  const [confirmRequestId, setConfirmRequestId] = useState<string | null>(null)

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

  function requestAcceptConfirmation(requestId: string) {
    if (accepting || overageLoading) return
    if (providerStatus !== 'active') {
      setError('Your account must be active to accept requests.')
      return
    }
    if (!providerOnline) {
      setError('Go online before accepting requests.')
      return
    }
    setError('')
    setNotice('')
    setConfirmRequestId(requestId)
  }

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
    const selectedRequest = requestItems.find((request) => request.id === requestId)
    if (!selectedRequest) {
      setError('This request is no longer available.')
      setConfirmRequestId(null)
      return
    }

    setAccepting(requestId)
    setError('')
    setNotice('')

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
        setConfirmRequestId(null)
        return
      }

      if (!res.ok) {
        setError(result.error ?? 'Unable to start billing session right now.')
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

      if (result.credit_applied) {
        setNotice(result.message ?? 'One PPJ recovery credit was applied to this request.')
        setRequestItems((current) => current.filter((request) => request.id !== requestId))
        router.refresh()
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

      if (!result.client_secret || !storePaymentHandoff('ppj', requestId, result.client_secret, result.fee_aed)) {
        setError('Unable to open payment securely. Please try again.')
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

        router.push(`/provider/ppj-pay?request_id=${requestId}&fee=${result.fee_aed}`)
      } catch {
        setError('Network connection lost. Please try again.')
        setAccepting(null)
        setConfirmRequestId(null)
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
        setConfirmRequestId(null)
        return
      }

      if (res.status === 402 && result.code === 'OVERAGE_REQUIRED') {
        setAccepting(null)
        setShowOverageModal(requestId)
        setConfirmRequestId(null)
        return
      }

      if (!res.ok) {
        setError(result.error ?? 'Failed to accept request')
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }
      setRequestItems((current) => current.filter((request) => request.id !== requestId))
      router.refresh()
      setAccepting(null)
      setConfirmRequestId(null)
    } catch {
      setError('Network connection lost. Please try again.')
      setAccepting(null)
      setConfirmRequestId(null)
    }
  }

  async function handleOverageConfirm(requestId: string) {
    if (overageLoading || accepting) return
    setOverageLoading(true)
    setError('')
    setNotice('')

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
  const confirmRequest = requestItems.find((request) => request.id === confirmRequestId)
  const confirmPpjFee = LAUNCH_PROMO
    ? PAY_PER_JOB_PROMO_FEE_AED
    : confirmRequest?.distance_meters !== null
      && (confirmRequest?.distance_meters ?? 0) >= PAY_PER_JOB_DISTANCE_THRESHOLD_M
        ? PAY_PER_JOB_FEE_FAR_AED
        : PAY_PER_JOB_FEE_NEAR_AED

  return (
    <Card className="overflow-hidden rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-slate-100 bg-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4 text-[#0F6E56]" aria-hidden="true" />
              <h2 className="text-xl font-medium text-slate-950">Nearby Roadside Requests</h2>
              <span className="rounded-full bg-[#E1F5EE] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[#0F6E56]">
                Request intake
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {requestItems.length > 0
                ? requestFeedMode === 'fallback'
                  ? `Showing ${requestItems.length} available open request${requestItems.length === 1 ? '' : 's'} while nearby location matching refreshes.`
                  : requestFeedMode === 'offline'
                    ? `${requestItems.length} open request${requestItems.length === 1 ? '' : 's'} available. Go online to sort by distance.`
                  : `${requestItems.length} open request${requestItems.length === 1 ? '' : 's'} near your dispatch area.`
                : 'Open requests will appear here as customers submit them.'}
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            <span className={`h-2 w-2 rounded-full ${providerOnline ? 'bg-[#1D9E75]' : 'bg-slate-400'}`} />
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
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-semibold text-slate-800">
              No open requests right now
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
          <div className="space-y-3 p-4 sm:p-5">
            {requestItems.map((req) => {
              const Icon = problemIcons[req.problem_type] ?? HelpCircle
              return (
              <div key={req.id} className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-[#9FE1CB] sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56] ring-1 ring-[#9FE1CB]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-medium text-slate-950">{getProblemLabel(req.problem_type)}</div>
                    <div className="mt-2 flex min-w-0 items-start gap-1.5 text-sm text-slate-600">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="break-words">Location hidden until accepted</div>
                        <div className="text-xs text-slate-400">Exact customer location is shared after assignment.</div>
                      </div>
                    </div>
                    <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {formatDistance(req.distance_meters)}{' \u00b7 '}{new Date(req.created_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {providerPlan === 'pay_per_job' && (
                      <div className="mt-2 inline-flex items-center rounded-full bg-[#FAEEDA] px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        {ppjRecoveryCredits > 0
                          ? 'Recovery credit available'
                          : LAUNCH_PROMO
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
                  className="w-full bg-[#1D9E75] text-white shadow-sm hover:bg-[#0F6E56] focus:ring-[#1D9E75] sm:w-auto"
                  loading={accepting === req.id}
                  onClick={() => requestAcceptConfirmation(req.id)}
                  disabled={providerStatus !== 'active' || !providerOnline || accepting !== null || overageLoading}
                >
                  {!providerOnline
                    ? 'Go online first'
                    : providerPlan === 'pay_per_job'
                      ? ppjRecoveryCredits > 0 ? 'Accept with credit' : 'Pay & Accept'
                      : 'Accept'}
                </Button>
              </div>
            )})}
          </div>
        )}
        {notice && <div className="px-6 pb-5 text-sm font-medium text-green-700">{notice}</div>}
        {error && <div className="px-6 pb-5 text-sm text-red-500">{error}</div>}
      </CardBody>
      {confirmRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="accept-request-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="accept-request-title" className="text-lg font-bold text-slate-900">Accept this recovery request?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {providerPlan === 'pay_per_job'
                ? ppjRecoveryCredits > 0
                  ? 'One PPJ recovery credit will be applied to this assignment. No Stripe payment is required for this accepted request. Exact customer location is shown only after assignment.'
                  : `You will be charged the ${confirmPpjFee} AED Pay Per Job acceptance fee before this request is assigned to you. This fee is non-refundable if you release or abandon the job. Exact customer location is shown only after payment and assignment.`
                : 'You are about to accept this customer request and become responsible for completing it. Exact customer location is shown after you accept.'}
            </p>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">{getProblemLabel(confirmRequest.problem_type)}</div>
              <div className="mt-0.5 break-words text-xs text-slate-500">Location hidden until accepted</div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmRequestId(null)}
                disabled={accepting !== null}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleAccept(confirmRequest.id)}
                disabled={accepting !== null}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {accepting === confirmRequest.id
                  ? 'Accepting...'
                  : providerPlan === 'pay_per_job' && ppjRecoveryCredits > 0
                    ? 'Accept with credit'
                    : 'Accept request'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOverageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Monthly Limit Reached</h3>
            <p className="text-sm text-slate-600 mb-4">
              You&apos;ve used all your jobs this month. Accept this request for a one-time overage fee of{' '}
              <strong className="text-[#0F6E56]">{OVERAGE_FEE_AED} AED</strong>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowOverageModal(null)}
                disabled={overageLoading}
                className="min-h-10 flex-1 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleOverageConfirm(showOverageModal)}
                disabled={overageLoading}
                className="min-h-10 flex-1 rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
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
