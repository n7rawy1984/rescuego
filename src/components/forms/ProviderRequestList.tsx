'use client'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BatteryCharging, HelpCircle, MapPin, Ruler, Search, Truck, Wrench } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import ProviderQuoteForm from '@/components/provider/ProviderQuoteForm'
import { getProblemLabel } from '@/lib/utils'
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
  fuzzy_latitude?: number | null
  fuzzy_longitude?: number | null
  uae_emirate?: string | null
  uae_area?: string | null
  destination?: string | null
  destination_area?: string | null
}

interface Props {
  requests: ProviderRequestCard[]
  providerStatus: ProviderStatus
  providerPlan: ProviderPlan
  providerOnline: boolean
  locationFallback?: boolean
  requestFeedMode?: 'nearby' | 'fallback' | 'offline'
  ppjRecoveryCredits?: number
  providerEmirate?: string | null
  providerArea?: string | null
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
  const t = useTranslations('components.providerRequestList')
  const [hiddenRequestIds, setHiddenRequestIds] = useState<Set<string>>(() => new Set())
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showOverageModal, setShowOverageModal] = useState<string | null>(null)
  const [overageLoading, setOverageLoading] = useState(false)
  const [confirmRequestId, setConfirmRequestId] = useState<string | null>(null)

  const requestItems = useMemo(
    () => requests.filter((request) => !hiddenRequestIds.has(request.id)),
    [hiddenRequestIds, requests]
  )

  const formatDistance = useCallback((meters: number | null, hasGps: boolean): string => {
    if (meters === null) return hasGps ? t('distanceCalculating') : t('distanceUnavailable')
    if (meters < 1000) return t('metersAway', { distance: Math.round(meters) })
    return t('kilometersAway', { distance: (meters / 1000).toFixed(1) })
  }, [t])

  async function handleAccept(requestId: string) {
    if (accepting || overageLoading) return
    if (providerStatus !== 'active') {
      setError(t('accountMustBeActive'))
      return
    }
    if (!providerOnline) {
      setError(t('goOnlineBeforeAccepting'))
      return
    }
    const selectedRequest = requestItems.find((request) => request.id === requestId)
    if (!selectedRequest) {
      setError(t('requestNoLongerAvailable'))
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
        setError(t('sessionExpired'))
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

      if (!res.ok) {
        setError(result.error ?? t('unableToStartBilling'))
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

      if (result.credit_applied) {
        setNotice(result.message ?? t('ppjRecoveryCreditApplied'))
        setHiddenRequestIds((current) => new Set(current).add(requestId))
        router.refresh()
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

      if (!result.client_secret || !storePaymentHandoff('ppj', requestId, result.client_secret, result.fee_aed)) {
        setError(t('unableToOpenPayment'))
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }

        router.push(`/provider/ppj-pay?request_id=${requestId}&fee=${result.fee_aed}`)
      } catch {
        setError(t('networkConnectionLost'))
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
        setError(t('sessionExpired'))
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
        setError(result.error ?? t('failedToAcceptRequest'))
        setAccepting(null)
        setConfirmRequestId(null)
        return
      }
      setHiddenRequestIds((current) => new Set(current).add(requestId))
      router.refresh()
      setAccepting(null)
      setConfirmRequestId(null)
    } catch {
      setError(t('networkConnectionLost'))
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
        setError(t('sessionExpired'))
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      if (!res.ok) {
        setError(result.error ?? t('unableToStartBilling'))
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      if (!result.client_secret || !storePaymentHandoff('overage', requestId, result.client_secret, result.fee_aed)) {
        setError(t('unableToOpenPayment'))
        setOverageLoading(false)
        setShowOverageModal(null)
        return
      }

      router.push(`/provider/overage-pay?request_id=${requestId}&fee=${result.fee_aed}`)
    } catch {
      setError(t('networkConnectionLost'))
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
    <Card className="overflow-hidden rounded-xl border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <MapPin className="h-5 w-5 text-[#0F6E56]" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-slate-950">{t('nearbyRoadsideRequests')}</h2>
              <span className="rounded-full bg-[#E1F5EE] px-2 py-0.5 text-xs font-medium text-[#0F6E56]">
                {t('requestIntake')}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {requestItems.length > 0
                ? requestFeedMode === 'fallback'
                  ? t('showingFallbackRequests', { count: requestItems.length })
                  : requestFeedMode === 'offline'
                    ? t('openRequestsOffline', { count: requestItems.length })
                  : t('openRequestsNearby', { count: requestItems.length })
                : t('openRequestsWillAppear')}
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
            <span className={`h-2 w-2 rounded-full ${providerOnline ? 'bg-[#1D9E75]' : 'bg-slate-400'}`} />
            {t('autoUpdates')}
          </span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {!providerOnline && requestItems.length > 0 && (
          <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
            {t('offlineAwarenessNotice')}
          </div>
        )}
        {requestItems.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-semibold text-slate-800">
              {t('noOpenRequests')}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {requestFeedMode === 'nearby'
                ? t('nearbyEmptyDescription')
                : requestFeedMode === 'fallback'
                  ? t('fallbackEmptyDescription')
                : t('offlineEmptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {requestItems.map((req) => {
              const Icon = problemIcons[req.problem_type] ?? HelpCircle
              return (
              <div key={req.id} className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56] ring-1 ring-[#9FE1CB]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {req.uae_emirate ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#E1F5EE] px-2.5 py-1 text-sm font-semibold text-[#0F6E56] ring-1 ring-[#9FE1CB]">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {req.uae_emirate}{req.uae_area ? ` \u2014 ${req.uae_area}` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-500 ring-1 ring-slate-200">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {req.fuzzy_latitude ? t('fuzzyLocation') : t('locationHiddenUntilAccepted')}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                        <Ruler className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                        {formatDistance(req.distance_meters, req.fuzzy_latitude != null)}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-slate-950">{getProblemLabel(req.problem_type)}</div>
                    {req.problem_type === 'tow' && req.destination && (
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                        <Truck className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <span>{t('towDestination')}: {req.destination_area ?? req.destination}</span>
                      </div>
                    )}
                    {providerPlan === 'pay_per_job' && (
                      <div className="mt-2 inline-flex items-center rounded-full bg-[#FAEEDA] px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        {ppjRecoveryCredits > 0
                          ? t('recoveryCreditAvailable')
                          : LAUNCH_PROMO
                          ? t('payPerJobPromoFeeToAccept', { fee: PAY_PER_JOB_PROMO_FEE_AED })
                          : req.distance_meters !== null && req.distance_meters >= PAY_PER_JOB_DISTANCE_THRESHOLD_M
                            ? t('payPerJobFeeToAccept', { fee: PAY_PER_JOB_FEE_FAR_AED })
                            : t('payPerJobFeeToAccept', { fee: PAY_PER_JOB_FEE_NEAR_AED })
                        }
                      </div>
                    )}
                  </div>
                </div>
                <ProviderQuoteForm
                  requestId={req.id}
                  disabled={providerStatus !== 'active' || !providerOnline}
                />
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
            <h3 id="accept-request-title" className="text-lg font-bold text-slate-900">{t('acceptRequestTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {providerPlan === 'pay_per_job'
                ? ppjRecoveryCredits > 0
                  ? t('acceptWithCreditDescription')
                  : t('payPerJobAcceptDescription', { fee: confirmPpjFee })
                : t('standardAcceptDescription')}
            </p>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">{getProblemLabel(confirmRequest.problem_type)}</div>
              <div className="mt-0.5 break-words text-xs text-slate-500">{t('locationHiddenUntilAccepted')}</div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmRequestId(null)}
                disabled={accepting !== null}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleAccept(confirmRequest.id)}
                disabled={accepting !== null}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {accepting === confirmRequest.id
                  ? t('accepting')
                  : providerPlan === 'pay_per_job' && ppjRecoveryCredits > 0
                    ? t('acceptWithCredit')
                    : t('acceptRequest')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOverageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">{t('monthlyLimitReached')}</h3>
            <p className="text-sm text-slate-600 mb-4">
              {t('overageConfirmPrefix')}{' '}
              <strong className="text-[#0F6E56]">{t('aedAmount', { amount: OVERAGE_FEE_AED })}</strong>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowOverageModal(null)}
                disabled={overageLoading}
                className="min-h-10 flex-1 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => handleOverageConfirm(showOverageModal)}
                disabled={overageLoading}
                className="min-h-10 flex-1 rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {overageLoading ? t('settingUp') : t('payAmount', { amount: OVERAGE_FEE_AED })}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
