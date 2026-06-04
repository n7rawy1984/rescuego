'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BatteryCharging, CheckCircle2, Clock3, HelpCircle, History, LocateFixed, MapPin, PhoneCall, ShieldCheck, Truck, Wrench } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import RatingForm from '@/components/forms/RatingForm'
import { roundDispatchCoordinate } from '@/lib/geo'
import { getProblemLabel } from '@/lib/utils'
import type { ProblemType, RequestStatus } from '@/types'
import type { LucideIcon } from 'lucide-react'

const PROBLEM_OPTIONS: { type: ProblemType; label: string; description: string; Icon: LucideIcon }[] = [
  { type: 'flat_tire', label: 'Flat Tire', description: 'Tyre change or repair support', Icon: Wrench },
  { type: 'battery', label: 'Battery Issue', description: 'Jump start or battery help', Icon: BatteryCharging },
  { type: 'tow', label: 'Tow Required', description: 'Recovery truck needed', Icon: Truck },
  { type: 'other', label: 'Other Issue', description: 'Tell the provider what happened', Icon: HelpCircle },
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
  status: Extract<RequestStatus, 'open' | 'accepted' | 'in_progress'>
  accepted_by: string | null
  provider_name?: string | null
  provider_phone?: string | null
  final_price: number | null
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

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadRequestState = useCallback(async () => {
    const activeRes = await fetch('/api/requests')

    if (activeRes.status === 401) {
      throw new Error('Your session expired. Please sign in again.')
    }

    if (!activeRes.ok) {
      throw new Error('We couldn\'t load your current request. Please try again.')
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
      setStatusMessage('Your provider is no longer assigned. We are searching for another provider.')
    }
    assignedRequestRef.current = nextActiveRequest?.accepted_by ? nextActiveRequest.id : null
    setCompletedUnratedRequest(activeData?.completed_unrated_request ?? null)
    setActiveRequest(nextActiveRequest)
    setRequestId(nextActiveRequest?.id ?? '')
    setLateCancellations24h(activeData?.late_cancellations_24h ?? 0)
    setUnratedJobsCount(activeData?.unrated_jobs_count ?? 0)
    if (activeData?.customer_phone) setPhone(activeData.customer_phone)
    setInitialRequestError('')
  }, [])

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
            : 'We couldn\'t load your current request. Please try again.'
          setInitialRequestError(
            typeof navigator !== 'undefined' && !navigator.onLine
              ? 'Connection lost. Please check your internet connection and try again.'
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
  }, [loadRequestState])

  useEffect(() => {
    if (!activeRequest || completedUnratedRequest) return

    const interval = window.setInterval(() => {
      void loadRequestState().catch(() => undefined)
    }, 12000)

    return () => {
      window.clearInterval(interval)
    }
  }, [activeRequest, completedUnratedRequest, loadRequestState])

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
        : 'We couldn\'t load your current request. Please try again.'
      setInitialRequestError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'Connection lost. Please check your internet connection and try again.'
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
      setError('Location is not supported by this browser. Please enter your address manually.')
      setLocationLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundDispatchCoordinate(pos.coords.latitude)
        const lng = roundDispatchCoordinate(pos.coords.longitude)
        setCoords({ lng, lat })
        setAddress(`Current GPS location (${lat}, ${lng})`)
        setLocationMessage('Location added for this request only. You can edit the address if needed.')
        setLocationPermissionDenied(false)
        setLocationLoading(false)
      },
      (locationError) => {
        const denied = locationError.code === locationError.PERMISSION_DENIED
        const message = denied
          ? 'We couldn\'t access your location. You can enter your address manually and still request help.'
          : 'Could not get your location. Please enter your address manually.'
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
      setLocationMessage('Using manual location entry. GPS coordinates were cleared.')
    }
  }

  async function handleSubmit() {
    if (loading) return
    if (!problemType || !phone.trim() || !address.trim()) {
      setError('Please select a problem type, phone number, and location details.')
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
        setError('Your session expired. Please sign in again.')
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
        setError(data?.error ?? 'Unable to submit request right now. Please try again.')
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
        created_at: new Date().toISOString(),
      })
      setSubmitted(true)
      setLoading(false)
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
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
        setError('Your session expired. Please sign in again.')
        setCancelling(false)
        return
      }

      if (!res.ok && res.status !== 202) {
        setError(result?.error ?? 'Unable to cancel this request right now.')
        setCancelling(false)
        return
      }

      resetForm()
      setStatusMessage(
        result?.late_cancellation
          ? 'Your request was cancelled. Provider compensation was handled automatically.'
          : 'Your request was cancelled.'
      )
      setCancelling(false)
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
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
            <p className="text-lg font-semibold text-slate-950">Checking your current request</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
              RescueGo is making sure you do not accidentally create a duplicate roadside request.
            </p>
            <div className="mt-6 space-y-3 text-left">
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
            <h1 className="text-xl font-semibold text-slate-950">We couldn&apos;t load your current request</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{initialRequestError}</p>
            <Button className="mt-6 min-h-11 w-full sm:w-auto" onClick={retryInitialRequestLoad}>
              Try again
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
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Job completed</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Rate your recovery service</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Please rate your completed job before submitting another request.</p>
            </div>

            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/60 sm:p-6">
              <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-slate-950">
                  <CheckCircle2 className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                  {getProblemLabel(completedUnratedRequest.request.problem_type)}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Provider: {completedUnratedRequest.provider_name ?? 'Recovery provider'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {completedUnratedRequest.request.location_address ?? 'Location unavailable'}
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
    const showCancellationAbuseWarning = !isOpen && lateCancellations24h >= 2
    const title = isOpen
      ? 'Request Sent!'
      : visibleRequest.status === 'accepted'
        ? 'Provider Accepted'
        : 'Service In Progress'
    const description = isOpen
      ? 'Your request is live and visible to nearby providers.'
      : visibleRequest.status === 'accepted'
        ? 'A provider accepted your request and will contact you directly.'
        : 'Your recovery service is currently in progress.'

    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
          <div className="mx-auto w-full max-w-2xl">
            <div className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white shadow-xl shadow-slate-200/60">
              <div className="border-b border-slate-100 bg-white p-5 text-center sm:p-7">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                  {isOpen ? (
                    <Clock3 className="h-7 w-7 animate-pulse" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                  )}
                </div>
                <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">
                  <span className="h-2 w-2 rounded-full bg-[#1D9E75]" aria-hidden="true" />
                  {isOpen ? 'Searching for provider' : 'Provider assigned'}
                </div>
                <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
                <p className="mt-3 text-xs font-medium text-slate-400">Request #{visibleRequest.id.slice(0, 8).toUpperCase()}</p>
              </div>

              <div className="space-y-5 p-5 sm:p-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#0F6E56] ring-1 ring-[#DDE7EE]">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950">{getProblemLabel(visibleRequest.problem_type)}</div>
                    <div className="mt-1 break-words text-sm text-slate-500">{visibleRequest.location_address ?? 'Location not recorded'}</div>
                  </div>
                </div>
              </div>

              {!isOpen && (
                <div className="rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-left">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Assigned provider</div>
                      <div className="mt-1 text-base font-semibold text-slate-950">
                        {visibleRequest.provider_name ?? 'Recovery provider assigned'}
                      </div>
                      <p className="mt-1 text-xs text-[#0F6E56]">Keep your phone nearby. Your provider may call for exact access details.</p>
                    </div>
                    {visibleRequest.provider_phone ? (
                      <a
                        href={`tel:${visibleRequest.provider_phone}`}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 sm:w-auto"
                      >
                        <PhoneCall className="mr-2 h-4 w-4" aria-hidden="true" />
                        Call provider
                      </a>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-950">Request progress</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                    {visibleRequest.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-xs font-bold text-white">1</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Provider notified</p>
                    <p className="text-xs text-slate-500">Nearby providers can see and accept your request now</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${visibleRequest.status === 'accepted' || visibleRequest.status === 'in_progress' ? 'bg-[#1D9E75] text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Provider accepts</p>
                    <p className="text-xs text-slate-500">You&apos;ll receive a call from the provider directly</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${visibleRequest.status === 'in_progress' ? 'bg-[#1D9E75] text-white' : 'bg-slate-200 text-slate-500'}`}>3</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Pay provider directly</p>
                    <p className="text-xs text-slate-500">Cash or card. RescueGo never charges drivers.</p>
                  </div>
                </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                <p className="text-sm text-amber-800">
                  <strong>Tip:</strong> Keep your phone nearby. Your provider will call you once they accept.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={cancelling}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelling ? 'Cancelling...' : isOpen ? 'Cancel request' : 'Cancel assigned request'}
                </button>
                <p className="text-sm text-slate-400">
                  Complete or cancel this request before submitting another.
                </p>
              </div>
              </div>
            </div>
          </div>
          {cancelConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <h2 id="cancel-request-title" className="text-lg font-bold text-slate-900">
                  Cancel this recovery request?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {isOpen
                    ? 'Your request has not been assigned yet, so you can cancel it freely.'
                    : 'Your provider may already be traveling to your location. RescueGo will handle provider compensation automatically.'}
                </p>
                {showCancellationAbuseWarning && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left">
                    <p className="text-sm font-semibold text-amber-900">Please cancel only when necessary.</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      Repeated cancellations after provider assignment may temporarily restrict your account in the future.
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
                    Keep request
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(visibleRequest)}
                    disabled={cancelling}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-red-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancelling ? 'Cancelling...' : 'Cancel request'}
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
                    <p className="font-semibold text-slate-950">You have a completed job waiting for rating.</p>
                    <p className="mt-1 text-sm text-slate-500">
                    Please rate your provider to keep RescueGo quality high.
                    </p>
                  </div>
                </div>
                <Link
                  href="/customer/ratings"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
                >
                  Rate now
                </Link>
              </div>
            </div>
          )}

          <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Customer request</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Request roadside help</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  Tell us what happened, share where you are, and nearby verified providers can accept your request.
                </p>
              </div>
              <Link
                href="/customer/history"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DDE7EE] bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
              >
                <History className="mr-2 h-4 w-4" aria-hidden="true" />
                Request history
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <ShieldCheck className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">Verified providers</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Your exact details are shared only after assignment.</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <MapPin className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">Location supported</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Use GPS or enter a clear landmark manually.</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <PhoneCall className="h-5 w-5 text-[#1D9E75]" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-slate-800">Direct contact</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">The assigned provider can call to coordinate access.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3" aria-label={`Step ${step} of 3`}>
              {[
                ['1', 'Issue'],
                ['2', 'Location'],
                ['3', 'Confirm'],
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
                <h2 className="text-xl font-semibold text-slate-950">What happened?</h2>
                <p className="mt-1 text-sm text-slate-500">Choose the closest match so providers can quickly understand the job.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROBLEM_OPTIONS.map((opt) => {
                  const Icon = opt.Icon
                  return (
                    <button
                      key={opt.type}
                      onClick={() => setProblemType(opt.type)}
                      className={`min-h-32 rounded-2xl border p-5 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${problemType === opt.type ? 'border-[#1D9E75] bg-[#E1F5EE] shadow-sm' : 'border-slate-200 bg-white hover:border-[#9FE1CB] hover:bg-[#E1F5EE]/30'}`}
                    >
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#E1F5EE] text-[#0F6E56]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="font-semibold text-slate-800">{opt.label}</div>
                      <p className="mt-1 text-sm leading-5 text-slate-500">{opt.description}</p>
                    </button>
                  )
                })}
              </div>
              {problemType && (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  <p>
                    <strong>How pricing works:</strong> Your recovery provider will agree a price with you directly before starting the job. RescueGo never charges drivers.
                  </p>
                </div>
              )}
              <Button className="mt-6 min-h-12 w-full" disabled={!problemType} onClick={() => setStep(2)}>Continue</Button>
            </div>
          )}

          {step === 2 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">Where should help go?</h2>
                <p className="mt-1 text-sm text-slate-500">Add a phone number and clear location details for the assigned provider.</p>
              </div>
              <div className="flex flex-col gap-4">
              <Input
                id="phone"
                type="tel"
                label="Phone number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+971 50 000 0000"
                required
              />
              <p className="-mt-2 text-xs text-slate-500">
                Your assigned provider will use this number to call you after accepting the request.
              </p>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <Button variant="outline" onClick={useMyLocation} loading={locationLoading} className="min-h-11 w-full bg-white">
                  <LocateFixed className="mr-2 h-4 w-4" aria-hidden="true" />
                  Use my current location
                </Button>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  RescueGo requests your location once and only uses it to find nearby providers for this recovery request.
                </p>
              </div>
              <Input
                ref={addressInputRef}
                id="address"
                label="Emirate, area, or landmark"
                value={address}
                onChange={e => handleAddressChange(e.target.value)}
                placeholder="e.g. Dubai Mall parking, Al Wasl Road, Dubai"
              />
              {locationMessage && (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{locationMessage}</p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note" className="text-sm font-medium text-slate-700">Operational notes (optional)</label>
                <textarea
                  id="note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75] min-h-[100px] resize-none"
                  placeholder="Building name, parking level, gate/security instructions, or nearby landmark"
                  maxLength={500}
                />
                <p className="text-xs text-slate-500">
                  These details are shown only to the provider assigned to your request.
                </p>
              </div>
              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-sm text-red-500">{error}</p>
                  {locationPermissionDenied && (
                    <p className="mt-1 text-xs text-red-400">
                      Click the location icon in your browser address bar to allow location access.
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(1)} className="min-h-11 flex-1">Back</Button>
                <Button className="min-h-11 flex-1" disabled={!phone.trim() || !address.trim()} onClick={() => setStep(3)}>Continue</Button>
              </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-950">Confirm your request</h2>
                <p className="mt-1 text-sm text-slate-500">Review the details before sending them to nearby providers.</p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-slate-500">Problem</span>
                  <span className="font-semibold capitalize text-slate-800">{problemType?.replace('_', ' ')}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <span className="text-sm text-slate-500">Location</span>
                  <span className="max-w-full break-words font-semibold text-slate-800 sm:max-w-[65%] sm:text-right">{address}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-slate-500">Phone</span>
                  <span className="font-semibold text-slate-800 sm:text-right">{phone}</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <span className="text-sm text-slate-500">Payment</span>
                  <span className="text-sm font-medium text-slate-700 sm:text-right">Agreed directly with provider</span>
                </div>
                {note && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <span className="text-sm text-slate-500">Note</span>
                    <span className="max-w-full break-words font-medium text-slate-700 sm:max-w-[65%] sm:text-right">{note}</span>
                  </div>
                )}
              </div>
              <div className="my-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm leading-6 text-amber-800">Payment is made directly to the provider after service. RescueGo does not charge you.</p>
              </div>
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(2)} className="min-h-11 flex-1">Back</Button>
                <Button className="min-h-11 flex-1" loading={loading} onClick={handleSubmit}>
                  {loading ? 'Submitting...' : 'Submit Request'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
