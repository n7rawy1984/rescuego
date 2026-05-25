'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LocateFixed, Power, RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import { distanceMeters, roundDispatchCoordinate } from '@/lib/geo'
import type { Coordinates } from '@/lib/geo'
import type { ProviderStatus } from '@/types'

const MIN_UPDATE_INTERVAL_MS = 2 * 60 * 1000
const MIN_MOVEMENT_METERS = 250

type Props = {
  providerStatus: ProviderStatus
  initialOnline: boolean
  initialUpdatedAt: string | null
}

type LocationResponse = {
  online?: boolean
  updated_at?: string
  error?: string
}

function formatUpdatedAt(updatedAt: string | null): string {
  if (!updatedAt) return 'No dispatch location shared yet.'

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return 'Dispatch location status unavailable.'

  return `Last shared ${date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}`
}

export default function ProviderAvailabilityToggle({ providerStatus, initialOnline, initialUpdatedAt }: Props) {
  const router = useRouter()
  const [online, setOnline] = useState(initialOnline)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt)
  const [lastCoords, setLastCoords] = useState<Coordinates | null>(null)
  const [lastUpdateMs, setLastUpdateMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const disabled = providerStatus !== 'active'

  function getBrowserLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not supported by this browser.'))
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: roundDispatchCoordinate(position.coords.latitude),
            lng: roundDispatchCoordinate(position.coords.longitude),
          })
        },
        (locationError) => {
          reject(new Error(
            locationError.code === locationError.PERMISSION_DENIED
              ? 'Location permission was denied. You can stay offline or allow location access when ready.'
              : 'Could not get your location. Please try again from your current dispatch area.'
          ))
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      )
    })
  }

  async function updateOnlineLocation() {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const now = Date.now()
      if (online && now - lastUpdateMs < MIN_UPDATE_INTERVAL_MS) {
        setMessage('Your dispatch location was updated recently. Try again in a couple of minutes.')
        setLoading(false)
        return
      }

      const coords = await getBrowserLocation()
      if (online && lastCoords && distanceMeters(lastCoords, coords) < MIN_MOVEMENT_METERS) {
        setMessage('No meaningful movement detected. Keeping your current dispatch location.')
        setLoading(false)
        return
      }

      const res = await fetch('/api/provider/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ online: true, coords }),
      })
      const data = await res.json().catch(() => null) as LocationResponse | null

      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to share dispatch location.')
      }

      setOnline(true)
      setUpdatedAt(data?.updated_at ?? new Date().toISOString())
      setLastCoords(coords)
      setLastUpdateMs(now)
      setMessage('You are online for nearby roadside requests.')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to update dispatch availability.')
    } finally {
      setLoading(false)
    }
  }

  async function goOffline() {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch('/api/provider/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ online: false }),
      })
      const data = await res.json().catch(() => null) as LocationResponse | null

      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to go offline.')
      }

      setOnline(false)
      setUpdatedAt(null)
      setLastCoords(null)
      setMessage('You are offline. RescueGo is not sharing your dispatch location.')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to update dispatch availability.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-900">Dispatch availability</h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-slate-400'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {online ? formatUpdatedAt(updatedAt) : 'Go online to appear in nearby request discovery.'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Location is shared only while online. RescueGo does not track you in the background.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            type="button"
            onClick={updateOnlineLocation}
            loading={loading}
            disabled={disabled}
            className="w-full sm:w-auto"
          >
            {online ? (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            ) : (
              <LocateFixed className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {online ? 'Refresh location' : 'Go online'}
          </Button>
          {online && (
            <Button
              type="button"
              variant="ghost"
              onClick={goOffline}
              loading={loading}
              className="w-full sm:w-auto"
            >
              <Power className="mr-2 h-4 w-4" aria-hidden="true" />
              Go offline
            </Button>
          )}
        </div>
      </div>
      {disabled && (
        <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Your account must be active before you can go online for dispatch.
        </p>
      )}
      {message && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </section>
  )
}
