'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BatteryCharging, HelpCircle, Truck, Wrench } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { ProblemType } from '@/types'
import type { LucideIcon } from 'lucide-react'

const PRICE_ESTIMATES: Record<ProblemType, { min: number; max: number }> = {
  flat_tire: { min: 80, max: 200 },
  battery: { min: 100, max: 250 },
  tow: { min: 200, max: 800 },
  other: { min: 150, max: 500 },
}

const PROBLEM_OPTIONS: { type: ProblemType; label: string; Icon: LucideIcon }[] = [
  { type: 'flat_tire', label: 'Flat Tire', Icon: Wrench },
  { type: 'battery', label: 'Battery Issue', Icon: BatteryCharging },
  { type: 'tow', label: 'Tow Required', Icon: Truck },
  { type: 'other', label: 'Other Issue', Icon: HelpCircle },
]

type SubmitResponse = {
  id?: string
  error?: string
}

export default function RequestPage() {
  const [step, setStep] = useState(1)
  const [problemType, setProblemType] = useState<ProblemType | null>(null)
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [coords, setCoords] = useState<{ lng: number; lat: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [unratedJobsCount, setUnratedJobsCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadUnratedJobsCount() {
      const res = await fetch('/api/customers/unrated-jobs')
      if (!res.ok) return

      const data = await res.json().catch(() => null) as { count?: number } | null
      if (!cancelled) setUnratedJobsCount(data?.count ?? 0)
    }

    loadUnratedJobsCount()

    return () => {
      cancelled = true
    }
  }, [])

  function resetForm() {
    setSubmitted(false)
    setStep(1)
    setProblemType(null)
    setAddress('')
    setNote('')
    setCoords(null)
    setError('')
  }

  function useMyLocation() {
    setLocationLoading(true)
    setError('')

    if (!navigator.geolocation) {
      setError('Location is not supported by this browser. Please enter your address manually.')
      setLocationLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setCoords({ lng, lat })

        try {
          const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

          if (!googleMapsKey) {
            setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
          } else {
            const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleMapsKey}`)
            const data = await res.json()
            if (data.results?.[0]) setAddress(data.results[0].formatted_address)
            else setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
          }
        } catch {
          setAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
        }

        setLocationLoading(false)
      },
      () => {
        setError('Could not get your location. Please enter your address manually.')
        setLocationLoading(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    )
  }

  async function handleSubmit() {
    if (!problemType || !address.trim()) {
      setError('Please select a problem type and provide your location.')
      return
    }

    setLoading(true)
    setError('')

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

    if (!res.ok || !data?.id) {
      setError(data?.error ?? 'Failed to submit request. Please try again.')
      setLoading(false)
      return
    }

    setRequestId(data.id)
    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-slate-50 pt-20 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl font-bold text-green-700">OK</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Request Submitted</h1>
            <p className="text-slate-600 mb-2">Your request has been sent to nearby providers.</p>
            <p className="text-sm text-slate-500 mb-6">Request ID: <span className="font-mono text-slate-700">{requestId.slice(0, 8)}...</span></p>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 text-left">
              <p className="text-sm text-orange-800"><strong>What happens next?</strong> A nearby provider will accept your request shortly. You will see their details once accepted.</p>
            </div>
            <Button onClick={resetForm} variant="outline">
              Submit Another Request
            </Button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
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
                      {problemType === opt.type && (
                        <div className="text-sm text-orange-600 mt-1">
                          Est. {PRICE_ESTIMATES[opt.type].min}-{PRICE_ESTIMATES[opt.type].max} AED
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              {problemType && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-blue-800">
                    <strong>Estimated cost:</strong> {PRICE_ESTIMATES[problemType].min}-{PRICE_ESTIMATES[problemType].max} AED (paid directly to provider)
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
                Use My Current Location
              </Button>
              <Input
                id="address"
                label="Or enter your location"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="e.g. Dubai Mall, Al Wasl Road, Dubai"
              />
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
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
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
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Est. Price</span>
                  <span className="font-semibold text-orange-600">
                    {problemType ? `${PRICE_ESTIMATES[problemType].min}-${PRICE_ESTIMATES[problemType].max} AED` : '-'}
                  </span>
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
                <Button className="flex-1" loading={loading} onClick={handleSubmit}>Submit Request</Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
