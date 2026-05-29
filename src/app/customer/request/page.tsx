'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BatteryCharging, HelpCircle, LocateFixed, Truck, Wrench } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import RatingForm from '@/components/forms/RatingForm'
import { roundDispatchCoordinate } from '@/lib/geo'
import { getProblemLabel } from '@/lib/utils'
import type { ProblemType, RequestStatus } from '@/types'
import type { LucideIcon } from 'lucide-react'

const PROBLEM_OPTIONS: { type: ProblemType; label: string; Icon: LucideIcon }[] = [
  { type: 'flat_tire', label: 'Flat Tire', Icon: Wrench },
  { type: 'battery', label: 'Battery Issue', Icon: BatteryCharging },
  { type: 'tow', label: 'Tow Required', Icon: Truck },
  { type: 'other', label: 'Other Issue', Icon: HelpCircle },
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
  final_price: number | null
  created_at: string
}

type ActiveRequestResponse = {
  active_request?: ActiveRequest | null
  completed_unrated_request?: CompletedUnratedRequest | null
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
  const addressInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)

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
    setCompletedUnratedRequest(activeData?.completed_unrated_request ?? null)
    setActiveRequest(activeData?.active_request ?? null)
    setRequestId(activeData?.active_request?.id ?? '')
    setInitialRequestError('')
  }, [])

  const loadUnratedJobsCount = useCallback(async () => {
    const unratedRes = await fetch('/api/customers/unrated-jobs')
    if (!unratedRes.ok || !mountedRef.current) return

    const unratedData = await unratedRes.json().catch(() => null) as { count?: number } | null
    if (mountedRef.current) setUnratedJobsCount(unratedData?.count ?? 0)
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
    if (activeRequestLoading || activeRequest || completedUnratedRequest) return

    void loadUnratedJobsCount().catch(() => undefined)
  }, [activeRequest, activeRequestLoading, completedUnratedRequest, loadUnratedJobsCount])

  useEffect(() => {
    if (!activeRequest || completedUnratedRequest) return

    const interval = window.setInterval(() => {
      void loadRequestState().catch(() => undefined)
    }, 12000)

    return () => {
      window.clearInterval(interval)
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
    setAddress('')
    setNote('')
    setCoords(null)
    setLocationMessage('')
    setError('')
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
    if (!problemType || !address.trim()) {
      setError('Please select a problem type and provide your location.')
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

  if (activeRequestLoading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-slate-50 pt-16 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-orange-500" aria-hidden="true" />
            <p className="font-semibold text-slate-800">Checking your active request...</p>
            <p className="mt-1 text-sm text-slate-500">This prevents duplicate roadside requests.</p>
          </div>
        </main>
      </>
    )
  }

  if (initialRequestError) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-slate-50 pt-16 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-slate-900">We couldn&apos;t load your current request</h1>
            <p className="mt-2 text-sm text-slate-500">{initialRequestError}</p>
            <Button className="mt-6" onClick={retryInitialRequestLoad}>
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
        <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
          <div className="mx-auto max-w-xl">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900">Rate Your Recovery Service</h1>
              <p className="mt-1 text-slate-500">Please rate your completed job before submitting another request.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 rounded-xl bg-slate-50 p-4">
                <div className="font-semibold text-slate-900">{getProblemLabel(completedUnratedRequest.request.problem_type)}</div>
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
                onComplete={() => {
                  setCompletedUnratedRequest(null)
                  setUnratedJobsCount((current) => Math.max(0, current - 1))
                }}
              />
            </div>
          </div>
        </main>
      </>
    )
  }

  if (visibleRequest) {
    const isOpen = visibleRequest.status === 'open'
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
        <main className="min-h-screen bg-slate-50 pt-16 flex items-center justify-center px-4">
          <div className="max-w-md w-full">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
              <p className="text-slate-600 mb-1">{description}</p>
              <p className="text-xs text-slate-400 mb-4 font-mono">ID: {visibleRequest.id.slice(0, 8).toUpperCase()}</p>
              <div className="mb-6 rounded-xl bg-slate-50 p-3 text-left">
                <div className="text-sm font-semibold text-slate-800">{getProblemLabel(visibleRequest.problem_type)}</div>
                <div className="mt-0.5 text-xs text-slate-500">{visibleRequest.location_address ?? 'Location not recorded'}</div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 mb-6 text-left space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Provider notified</p>
                    <p className="text-xs text-slate-500">Nearby providers can see and accept your request now</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${visibleRequest.status === 'accepted' || visibleRequest.status === 'in_progress' ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Provider accepts</p>
                    <p className="text-xs text-slate-500">You&apos;ll receive a call from the provider directly</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${visibleRequest.status === 'in_progress' ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>3</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Pay provider directly</p>
                    <p className="text-xs text-slate-500">Cash or card - RescueGo never charges drivers</p>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-left">
                <p className="text-xs text-amber-800">
                  <strong>Tip:</strong> Keep your phone nearby. Your provider will call you once they accept.
                </p>
              </div>

              <button
                onClick={resetForm}
                disabled
                className="text-sm text-slate-400 cursor-not-allowed"
              >
                Complete this request before submitting another
              </button>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {unratedJobsCount > 0 && (
            <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-orange-900">You have a completed job waiting for rating.</p>
                  <p className="mt-1 text-sm text-orange-800">
                    Please rate your provider to keep RescueGo quality high.
                  </p>
                </div>
                <Link
                  href="/customer/ratings"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  Rate now
                </Link>
              </div>
            </div>
          )}

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Request Roadside Help</h1>
            <p className="text-slate-500 mt-1">Free for drivers - pay the provider directly</p>
            <div className="flex gap-2 mt-4">
              {[1, 2, 3].map((s) => (
                <div key={s} className={`flex-1 h-1.5 rounded-full ${step >= s ? 'bg-orange-500' : 'bg-slate-200'}`} />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">Step {step} of 3</p>
          </div>

          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-4">What is the problem?</h2>
              <div className="grid grid-cols-2 gap-3">
                {PROBLEM_OPTIONS.map((opt) => {
                  const Icon = opt.Icon
                  return (
                    <button
                      key={opt.type}
                      onClick={() => setProblemType(opt.type)}
                      className={`p-5 rounded-xl border-2 text-left transition-all ${problemType === opt.type ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'}`}
                    >
                      <div className="mb-2 text-orange-600">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="font-semibold text-slate-800">{opt.label}</div>
                    </button>
                  )
                })}
              </div>
              {problemType && (
                <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                  <p>
                    <strong>How pricing works:</strong> Your recovery provider will agree a price with you directly before starting the job. RescueGo never charges drivers.
                  </p>
                </div>
              )}
              <Button className="w-full mt-6" disabled={!problemType} onClick={() => setStep(2)}>Continue</Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-slate-800">Where are you?</h2>
              <Button variant="outline" onClick={useMyLocation} loading={locationLoading} className="w-full">
                <LocateFixed className="mr-2 h-4 w-4" aria-hidden="true" />
                Use my current location
              </Button>
              <p className="text-xs text-slate-500">
                RescueGo requests your location once and only uses it to find nearby providers for this recovery request.
              </p>
              <Input
                ref={addressInputRef}
                id="address"
                label="Or enter your location"
                value={address}
                onChange={e => handleAddressChange(e.target.value)}
                placeholder="e.g. Dubai Mall, Al Wasl Road, Dubai"
              />
              {locationMessage && (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{locationMessage}</p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note" className="text-sm font-medium text-slate-700">Additional Note (optional)</label>
                <textarea
                  id="note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 min-h-[100px] resize-none"
                  placeholder="e.g. I am on the highway near exit 43, white Toyota Camry"
                  maxLength={500}
                />
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
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">Back</Button>
                <Button className="flex-1" disabled={!address.trim()} onClick={() => setStep(3)}>Continue</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-slate-800">Confirm Your Request</h2>
              <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Problem</span>
                  <span className="font-semibold text-slate-800 capitalize">{problemType?.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Location</span>
                  <span className="font-semibold text-slate-800 text-right max-w-[60%] truncate">{address}</span>
                </div>
                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-500 text-sm">Payment</span>
                  <span className="text-sm font-medium text-slate-700 text-right">Agreed directly with provider</span>
                </div>
                {note && (
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-slate-500 text-sm">Note</span>
                    <span className="font-medium text-slate-700 text-right max-w-[60%]">{note}</span>
                  </div>
                )}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm text-amber-800">Payment is made directly to the provider after service. RescueGo does not charge you.</p>
              </div>
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep(2)} className="flex-1">Back</Button>
                <Button className="flex-1" loading={loading} onClick={handleSubmit}>
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
