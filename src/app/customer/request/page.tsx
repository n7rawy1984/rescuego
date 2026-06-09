'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BatteryCharging, CheckCircle2, Clock3, HelpCircle, History, LocateFixed, MapPin, PhoneCall, ShieldCheck, Truck, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/layout/Navbar'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import RatingForm from '@/components/forms/RatingForm'
import CustomerQuoteList from '@/components/customer/CustomerQuoteList'
import PriceChangeNotification from '@/components/customer/PriceChangeNotification'
import { roundDispatchCoordinate } from '@/lib/geo'
import { getProblemLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { ProblemType, RequestStatus } from '@/types'
import type { LucideIcon } from 'lucide-react'

const PROBLEM_OPTIONS: { type: ProblemType; labelKey: string; descKey: string; Icon: LucideIcon }[] = [
  { type: 'flat_tire', labelKey: 'flatTire', descKey: 'flatTireDesc', Icon: Wrench },
  { type: 'battery', labelKey: 'batteryIssue', descKey: 'batteryIssueDesc', Icon: BatteryCharging },
  { type: 'tow', labelKey: 'towRequired', descKey: 'towRequiredDesc', Icon: Truck },
  { type: 'other', labelKey: 'otherIssue', descKey: 'otherIssueDesc', Icon: HelpCircle },
]

type SubmitResponse = {
  id?: string
  status?: RequestStatus
  error?: string
}

type ActiveRequest = {
  id: string
  problem_type: ProblemType
  location_address: string | null
  note: string | null
  status: Extract<RequestStatus, 'open' | 'quoted' | 'accepted' | 'en_route' | 'arrived' | 'in_progress'>
  accepted_by: string | null
  provider_name?: string | null
  provider_phone?: string | null
  final_price: number | null
  price_change_requested: number | null
  price_change_status: string | null
  selected_quote_id: string | null
  created_at: string
}

type ActiveRequestResponse = {
  active_request?: ActiveRequest | null
  completed_unrated_request?: CompletedUnratedRequest | null
  customer_phone?: string | null
  late_cancellations_24h?: number
  unrated_jobs_count?: number
  error?: string
}

type CompletedUnratedRequest = {
  job_id: string
  provider_id: string
  provider_name: string | null
  completed_at: string | null
  request: {
    id: string
    problem_type: ProblemType
    location_address: string | null
    final_price: number | null
    status: 'completed'
    created_at: string | null
  }
}

export default function RequestPage() {
  const [step, setStep] = useState(1)
  const [problemType, setProblemType] = useState<ProblemType | null>(null)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [error, setError] = useState('')
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null)
  const [completedUnratedRequest, setCompletedUnratedRequest] = useState<CompletedUnratedRequest | null>(null)
  const [activeRequestLoading, setActiveRequestLoading] = useState(true)
  const [initialRequestError, setInitialRequestError] = useState('')
  const [unratedJobsCount, setUnratedJobsCount] = useState(0)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [lateCancellations24h, setLateCancellations24h] = useState(0)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const assignedRequestRef = useRef<string | null>(null)
  const t = useTranslations('customer.request')
  const commonT = useTranslations('common')

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadRequestState = useCallback(async () => {
    const activeRes = await fetch('/api/requests')

    if (activeRes.status === 401) {
      throw new Error(t('sessionExpired'))
    }

    if (!activeRes.ok) {
      throw new Error(t('loadErrorDefault'))
    }

    const activeData = await activeRes.json().catch(() => null) as ActiveRequestResponse | null
    if (!mountedRef.current) return
    const nextActiveRequest = activeData?.active_request ?? null
    if (
      assignedRequestRef.current
      && nextActiveRequest?.id === assignedRequestRef.current
      && nextActiveRequest.status === 'open'
      && !nextActiveRequest.accepted_by
    ) {
      setStatusMessage(t('providerReassigned'))
    }
    assignedRequestRef.current = nextActiveRequest?.accepted_by ? nextActiveRequest.id : null
    setCompletedUnratedRequest(activeData?.completed_unrated_request ?? null)
    setActiveRequest(nextActiveRequest)
    setRequestId(nextActiveRequest?.id ?? '')
    setLateCancellations24h(activeData?.late_cancellations_24h ?? 0)
    setUnratedJobsCount(activeData?.unrated_jobs_count ?? 0)
    if (activeData?.customer_phone) setPhone(activeData.customer_phone)
    setInitialRequestError('')
  }, [t])

  useEffect(() => {
    let cancelled = false

    async function loadInitialState() {
      try {
        await loadRequestState()
      } catch (caught) {
        if (!cancelled) {
          setUnratedJobsCount(0)
          const message = caught instanceof Error
            ? caught.message
            : t('loadErrorDefault')
          setInitialRequestError(
            typeof navigator !== 'undefined' && !navigator.onLine
              ? t('connectionLost')
              : message
          )
        }
      } finally {
        if (!cancelled) setActiveRequestLoading(false)
      }
    }

    void loadInitialState()

    return () => {
      cancelled = true
    }
  }, [loadRequestState, t])

  useEffect(() => {
    if (!activeRequest || completedUnratedRequest) return

    const isActiveState = ['accepted', 'en_route', 'arrived', 'in_progress'].includes(activeRequest.status)
    const pollMs = isActiveState ? 5000 : 60000
    const interval = window.setInterval(() => {
      void loadRequestState().catch(() => undefined)
    }, pollMs)

    return () => {
      window.clearInterval(interval)
    }
  }, [activeRequest, completedUnratedRequest, loadRequestState])

  useEffect(() => {
    if (!activeRequest?.id) return

    const supabase = createClient()
    const channel = supabase
      .channel(`request-status:${activeRequest.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'requests',
          filter: `id=eq.${activeRequest.id}`,
        },
        (payload) => {
          if (!mountedRef.current) return
          const updated = payload.new as Record<string, unknown>
          const newStatus = updated.status as RequestStatus | undefined
          if (!newStatus) return
          if (newStatus === 'cancelled' || newStatus === 'expired' || newStatus === 'completed') {
            void loadRequestState().catch(() => undefined)
            return
          }
          setActiveRequest((prev) => prev ? { ...prev, ...(updated as Partial<ActiveRequest>) } : prev)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeRequest?.id, loadRequestState])

  useEffect(() => {
    if (!activeRequest && !completedUnratedRequest) return

    function refreshOnReturn() {
      if (document.visibilityState === 'visible') {
        void loadRequestState().catch(() => undefined)
      }
    }

    window.addEventListener('online', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)

    return () => {
      window.removeEventListener('online', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [activeRequest, completedUnratedRequest, loadRequestState])

  async function retryInitialRequestLoad() {
    setActiveRequestLoading(true)
    setInitialRequestError('')
    setError('')

    try {
      await loadRequestState()
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : t('loadErrorDefault')
      setInitialRequestError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? t('connectionLost')
          : message
      )
    } finally {
      setActiveRequestLoading(false)
    }
  }

  function resetForm() {
    setSubmitted(false)
    setActiveRequest(null)
    setCompletedUnratedRequest(null)
    setStep(1)
    setProblemType(null)
    setPhone('')
    setAddress('')
    setNote('')
    setCoords(null)
    setLocationMessage('')
    setError('')
    setCancelConfirmOpen(false)
    assignedRequestRef.current = null
  }

  function resetAfterRating() {
    const currentPhone = phone
    resetForm()
    setPhone(currentPhone)
    setUnratedJobsCount((current) => Math.max(0, current - 1))
  }

  function useMyLocation() {
    setLocationLoading(true)
    setError('')
    setLocationMessage('')
    setLocationPermissionDenied(false)

    if (!navigator.geolocation) {
      setError(t('locationNotSupported'))
      setLocationLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundDispatchCoordinate(pos.coords.latitude)
        const lng = roundDispatchCoordinate(pos.coords.longitude)
        setCoords({ lng, lat })
        setAddress(`Current GPS location (${lat}, ${lng})`)
        setLocationMessage(t('locationAdded'))
        setLocationPermissionDenied(false)
        setLocationLoading(false)
      },
      (locationError) => {
        const denied = locationError.code === locationError.PERMISSION_DENIED
        const message = denied
          ? t('locationDenied')
          : t('locationFailed')
        setError(message)
        setLocationPermissionDenied(denied)
        setLocationLoading(false)
        if (denied) {
          window.setTimeout(() => addressInputRef.current?.focus(), 0)
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    )
  }

  function handleAddressChange(value: string) {
    setAddress(value)
    if (coords) {
      setCoords(null)
      setLocationMessage(t('manualLocation'))
    }
  }

  async function handleSubmit() {
    if (loading) return
    if (!problemType || !phone.trim() || !address.trim()) {
      setError(t('validationError'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_type: problemType,
          phone,
          location_address: address,
          note,
          coords,
        }),
      })
      const data = await res.json().catch(() => null) as SubmitResponse | null

      if (res.status === 401) {
        setError(t('sessionExpired'))
        setLoading(false)
        return
      }

      if (!res.ok || !data?.id) {
        if (res.status === 409 && data?.id) {
          setRequestId(data.id)
          setSubmitted(true)
          setLoading(false)
          setError('')
          return
        }
        setError(data?.error ?? t('submitError'))
        setLoading(false)
        return
      }

      setRequestId(data.id)
      setActiveRequest({
        id: data.id,
        problem_type: problemType,
        location_address: address,
        note: note || null,
        status: 'open',
        accepted_by: null,
        final_price: null,
        price_change_requested: null,
        price_change_status: null,
        selected_quote_id: null,
        created_at: new Date().toISOString(),
      })
      setSubmitted(true)
      setLoading(false)
    } catch {
      setError(t('connectionLost'))
      setLoading(false)
    }
  }

  async function handleCancelRequest(requestToCancel: ActiveRequest) {
    if (cancelling) return

    setCancelling(true)
    setError('')
    setStatusMessage('')

    try {
      const res = await fetch('/api/requests/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestToCancel.id }),
      })
      const result = await res.json().catch(() => null) as { error?: string; late_cancellation?: boolean } | null

      if (res.status === 401) {
        setError(t('sessionExpired'))
        setCancelling(false)
        return
      }

      if (!res.ok && res.status !== 202) {
        setError(result?.error ?? t('cancelError'))
        setCancelling(false)
        return
      }

      resetForm()
      setStatusMessage(
        result?.late_cancellation
          ? t('cancelledLate')
          : t('cancelledSimple')
      )
      setCancelling(false)
    } catch {
      setError(t('connectionLost'))
      setCancelling(false)
    }
  }

  if (activeRequestLoading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
          <div className="mx-auto w-full max-w-lg rounded-3xl border border-[#DDE7EE] bg-white p-6 text-center shadow-xl shadow-slate-200/60 sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
              <Clock3 className="h-6 w-6 animate-pulse" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-slate-950">{t('loading')}</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
              {t('loadingDesc')}
            </p>
            <div className="mt-6 space-y-3 text-start">
              <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
              <div className="h-3 w-4/5 animate-pulse rounded-full bg-slate-100" />
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
            </div>
          </div>
        </main>
      </>
    )
  }

  if (initialRequestError) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
          <div className="mx-auto w-full max-w-lg rounded-3xl border border-red-100 bg-white p-6 text-center shadow-xl shadow-slate-200/60 sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <HelpCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">{t('loadError')}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{initialRequestError}</p>
            <Button className="mt-6 min-h-11 w-full sm:w-auto" onClick={retryInitialRequestLoad}>
              {t('tryAgain')}
            </Button>
          </div>
        </main>
      </>
    )
  }

  const visibleRequest = activeRequest ?? (submitted && requestId
    ? {
        id: requestId,
        problem_type: problemType ?? 'other',
        location_address: address || null,
        note: note || null,
        status: 'open' as const,
        accepted_by: null,
        final_price: null,
        price_change_requested: null,
        price_change_status: null,
        selected_quote_id: null,
        created_at: new Date().toISOString(),
      }
    : null)

  if (completedUnratedRequest) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('jobCompleted')}</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">{t('rateTitle')}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t('rateSubtitle')}</p>
            </div>

            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/60 sm:p-6">
              <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-950">
                  <CheckCircle2 className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                  {getProblemLabel(completedUnratedRequest.request.problem_type)}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {t('providerLabel', { name: completedUnratedRequest.provider_name ?? t('providerAssignedDefault') })}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {completedUnratedRequest.request.location_address ?? t('locationUnavailable')}
                  {completedUnratedRequest.request.final_price ? ` - ${completedUnratedRequest.request.final_price} AED` : ''}
                </p>
              </div>
              <RatingForm
                jobId={completedUnratedRequest.job_id}
                providerId={completedUnratedRequest.provider_id}
                onComplete={resetAfterRating}
              />
            </div>
          </div>
        </main>
      </>
    )
  }

  if (visibleRequest) {
    const isOpen = visibleRequest.status === 'open'
    const isQuoted = visibleRequest.status === 'quoted'
    const showCancellationAbuseWarning = !isOpen && !isQuoted && lateCancellations24h >= 2
    const title = isOpen
      ? t('requestSent')
      : isQuoted
        ? t('quotesReceived')
        : visibleRequest.status === 'accepted'
          ? t('providerAcceptedTitle')
          : t('serviceInProgress')
    const description = isOpen
      ? t('requestLive')
      : isQuoted
        ? t('selectBestQuote')
        : visibleRequest.status === 'accepted'
          ? t('providerAcceptedDesc')
          : visibleRequest.status === 'en_route'
            ? t('providerEnRouteDesc')
            : visibleRequest.status === 'arrived'
              ? t('providerArrivedDesc')
              : t('inProgressDesc')

    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
          <div className="mx-auto w-full max-w-2xl">
            <div className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white shadow-xl shadow-slate-200/60">
              <div className="border-b border-slate-100 bg-white p-5 text-center sm:p-7">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                  {(isOpen || isQuoted) ? (
                    <Clock3 className="h-7 w-7 animate-pulse" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                  )}
                </div>
                <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">
                  <span className="h-2 w-2 rounded-full bg-[#1D9E75]" aria-hidden="true" />
                  {isOpen ? t('searchingProvider')
                    : isQuoted ? t('quotesAvailable')
                    : visibleRequest.status === 'en_route' ? t('providerOnWay')
                    : visibleRequest.status === 'arrived' ? t('providerArrivedBadge')
                    : t('providerAssigned')}
                </div>
                <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
                <p className="mt-3 text-xs font-medium text-slate-400">{t('requestNumber', { id: visibleRequest.id.slice(0, 8).toUpperCase() })}</p>
              </div>

              <div className="space-y-5 p-5 sm:p-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-start">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#0F6E56] ring-1 ring-[#DDE7EE]">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950">{getProblemLabel(visibleRequest.problem_type)}</div>
                    <div className="mt-1 break-words text-sm text-slate-500">{visibleRequest.location_address ?? t('locationNotRecorded')}</div>
                  </div>
                </div>
              </div>

              {isQuoted && (
                <CustomerQuoteList requestId={visibleRequest.id} />
              )}

              {!isOpen && !isQuoted && visibleRequest.price_change_status === 'pending' && visibleRequest.price_change_requested != null && visibleRequest.selected_quote_id != null && (
                <PriceChangeNotification
                  requestId={visibleRequest.id}
                  currentPrice={visibleRequest.final_price ?? 0}
                  newPrice={visibleRequest.price_change_requested}
                />
              )}

              {!isOpen && !isQuoted && (
                <div className="rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-start">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('assignedProvider')}</div>
                      <div className="mt-1 text-base font-semibold text-slate-950">
                        {visibleRequest.provider_name ?? t('providerAssignedDefault')}
                      </div>
                      <p className="mt-1 text-xs text-[#0F6E56]">{t('keepPhoneNearby')}</p>
                    </div>
                    {visibleRequest.provider_phone ? (
                      <a
                        href={`tel:${visibleRequest.provider_phone}`}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 sm:w-auto"
                      >
                        <PhoneCall className="me-2 h-4 w-4" aria-hidden="true" />
                        {t('callProvider')}
                      </a>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-100 bg-white p-4 text-start shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-950">{t('requestProgress')}</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                    {visibleRequest.status === 'in_progress' ? t('statusInProgress')
                      : visibleRequest.status === 'arrived' ? t('statusArrived')
                      : visibleRequest.status === 'en_route' ? t('statusEnRoute')
                      : visibleRequest.status === 'accepted' ? t('statusAccepted')
                      : t('statusOpen')}
                  </span>
                </div>
                <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-xs font-bold text-white">1</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t('step1Title')}</p>
                    <p className="text-xs text-slate-500">{t('step1Desc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${['accepted','en_route','arrived','in_progress'].includes(visibleRequest.status) ? 'bg-[#1D9E75] text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t('step2Title')}</p>
                    <p className="text-xs text-slate-500">{t('step2Desc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${['en_route','arrived','in_progress'].includes(visibleRequest.status) ? 'bg-[#1D9E75] text-white' : 'bg-slate-200 text-slate-500'}`}>3</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t('step3Title')}</p>
                    <p className="text-xs text-slate-500">
                      {visibleRequest.status === 'arrived' ? t('step3DescArrived') : visibleRequest.status === 'en_route' ? t('step3DescEnRoute') : t('step3DescDefault')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${visibleRequest.status === 'in_progress' ? 'bg-[#1D9E75] text-white' : 'bg-slate-200 text-slate-500'}`}>4</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t('step4Title')}</p>
                    <p className="text-xs text-slate-500">{t('step4Desc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-500">5</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t('step5Title')}</p>
                    <p className="text-xs text-slate-500">{t('step5Desc')}</p>
                  </div>
                </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-start">
                <p className="text-sm text-amber-800">
                  <strong>Tip:</strong> {t('tip')}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={cancelling}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelling ? t('cancelling') : isOpen ? t('cancelRequestOpen') : t('cancelRequestAssigned')}
                </button>
                <p className="text-sm text-slate-400">
                  {t('completeOrCancel')}
                </p>
              </div>
              </div>
            </div>
          </div>
          {cancelConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <h2 id="cancel-request-title" className="text-lg font-bold text-slate-900">
                  {t('cancelDialogTitle')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {isOpen
                    ? t('cancelDialogOpen')
                    : visibleRequest.provider_name
                      ? t('cancelDialogAssigned', { name: visibleRequest.provider_name })
                      : t('cancelDialogAssignedDefault')}
                </p>
                {showCancellationAbuseWarning && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-start">
                    <p className="text-sm font-semibold text-amber-900">{t('cancelAbuseTitle')}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      {t('cancelAbuseDesc')}
                    </p>
                  </div>
                )}
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setCancelConfirmOpen(false)}
                    disabled={cancelling}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('keepRequest')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(visibleRequest)}
                    disabled={cancelling}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-red-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancelling ? t('cancelling') : t('cancelRequestOpen')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <div className="mx-auto w-full max-w-3xl">
          {statusMessage && (
            <div className="mb-6 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-sm font-medium text-[#0F6E56] shadow-sm">
              {statusMessage}
            </div>
          )}

          {unratedJobsCount > 0 && (
            <div className="mb-6 rounded-3xl border border-[#9FE1CB] bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E1F5EE] text-[#0F6E56]">
                    <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-950">{t('unratedJobTitle')}</p>
                    <p className="mt-1 text-sm text-slate-500">
                    {t('unratedJobDesc')}
                    </p>
                  </div>
                </div>
                <Link
                  href="/customer/ratings"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
                >
                  {t('rateNow')}
                </Link>
              </div>
            </div>
          )}

          <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">{t('pageEyebrow')}</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{t('pageTitle')}</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  {t('pageSubtitle')}
                </p>
              </div>
              <Link
                href="/customer/history"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DDE7EE] bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
              >
                <History className="me-2 h-4 w-4" aria-hidden="true" />
                {t('requestHistory')}
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <ShieldCheck className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">{t('verifiedProviders')}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{t('verifiedProvidersDesc')}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <MapPin className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">{t('locationSupported')}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{t('locationSupportedDesc')}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <PhoneCall className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">{t('directContact')}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{t('directContactDesc')}</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3" aria-label={`${t('stepLabel')} ${step} ${t('stepOf')} 3`}>
              {[
                ['1', t('stepIssue')],
                ['2', t('stepLocation')],
                ['3', t('stepConfirm')],
              ].map(([value, label], index) => {
                const current = step === index + 1
                const complete = step > index + 1
                return (
                  <div
                    key={value}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm ${
                      current || complete
                        ? 'border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56]'
                        : 'border-slate-100 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      complete ? 'bg-[#1D9E75] text-white' : current ? 'bg-white text-[#0F6E56]' : 'bg-white text-slate-400'
                    }`}>
                      {complete ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : value}
                    </span>
                    <span className="font-semibold">{label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {step === 1 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">{t('whatHappened')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('whatHappenedDesc')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROBLEM_OPTIONS.map((opt) => {
                  const Icon = opt.Icon
                  return (
                    <button
                      key={opt.type}
                      onClick={() => setProblemType(opt.type)}
                      className={`min-h-32 rounded-2xl border p-5 text-start transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${problemType === opt.type ? 'border-[#1D9E75] bg-[#E1F5EE] shadow-sm' : 'border-slate-200 bg-white hover:border-[#9FE1CB] hover:bg-[#E1F5EE]/30'}`}
                    >
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#E1F5EE] text-[#0F6E56]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="font-semibold text-slate-800">{t(opt.labelKey)}</div>
                      <p className="mt-1 text-sm leading-5 text-slate-500">{t(opt.descKey)}</p>
                    </button>
                  )
                })}
              </div>
              {problemType && (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  <p>
                    <strong>{t('pricingLabel')}</strong> {t('pricingInfo')}
                  </p>
                </div>
              )}
              <Button className="mt-6 min-h-12 w-full" disabled={!problemType} onClick={() => setStep(2)}>{t('continue')}</Button>
            </div>
          )}

          {step === 2 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">{t('whereHelp')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('whereHelpDesc')}</p>
              </div>
              <div className="flex flex-col gap-4">
              <Input
                id="phone"
                type="tel"
                label={t('phoneLabel')}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
                required
              />
              <p className="-mt-2 text-xs text-slate-500">
                {t('phoneHint')}
              </p>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <Button variant="outline" onClick={useMyLocation} loading={locationLoading} className="min-h-11 w-full bg-white">
                  <LocateFixed className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('useMyLocation')}
                </Button>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  {t('locationPrivacy')}
                </p>
              </div>
              <Input
                ref={addressInputRef}
                id="address"
                label={t('addressLabel')}
                value={address}
                onChange={e => handleAddressChange(e.target.value)}
                placeholder={t('addressPlaceholder')}
              />
              {locationMessage && (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{locationMessage}</p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note" className="text-sm font-medium text-slate-700">{t('noteLabel')}</label>
                <textarea
                  id="note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75] min-h-[100px] resize-none"
                  placeholder={t('notePlaceholder')}
                  maxLength={500}
                />
                <p className="text-xs text-slate-500">
                  {t('notePrivacy')}
                </p>
              </div>
              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-sm text-red-500">{error}</p>
                  {locationPermissionDenied && (
                    <p className="mt-1 text-xs text-red-400">
                      {t('locationPermHint')}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(1)} className="min-h-11 flex-1">{commonT('back')}</Button>
                <Button className="min-h-11 flex-1" disabled={!phone.trim() || !address.trim()} onClick={() => setStep(3)}>{t('continue')}</Button>
              </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">{t('confirmTitle')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('confirmDesc')}</p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-slate-500">{t('problemLabel')}</span>
                  <span className="font-semibold capitalize text-slate-800">{problemType?.replace('_', ' ')}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <span className="text-sm text-slate-500">{t('locationLabel')}</span>
                  <span className="max-w-full break-words font-semibold text-slate-800 sm:max-w-[65%] sm:text-right">{address}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-slate-500">{t('phoneConfirmLabel')}</span>
                  <span className="font-semibold text-slate-800 sm:text-right">{phone}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <span className="text-sm text-slate-500">{t('paymentLabel')}</span>
                  <span className="text-sm font-medium text-slate-700 sm:text-right">{t('paymentValue')}</span>
                </div>
                {note && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <span className="text-sm text-slate-500">{t('noteConfirmLabel')}</span>
                    <span className="max-w-full break-words font-medium text-slate-700 sm:max-w-[65%] sm:text-right">{note}</span>
                  </div>
                )}
              </div>
              <div className="my-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm leading-6 text-amber-800">{t('paymentDisclaimer')}</p>
              </div>
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(2)} className="min-h-11 flex-1">{commonT('back')}</Button>
                <Button className="min-h-11 flex-1" loading={loading} onClick={handleSubmit}>
                  {loading ? t('submitting') : t('submitRequest')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
