'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Power, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import Button from '@/components/ui/Button'
import { distanceMeters, roundDispatchCoordinate } from '@/lib/geo'
import type { Coordinates } from '@/lib/geo'
import { PAY_PER_JOB_PROMO_FEE_AED } from '@/types'
import type { ProviderPlan, ProviderStatus } from '@/types'

const MIN_UPDATE_INTERVAL_MS = 2 * 60 * 1000
const MIN_MOVEMENT_METERS = 250

type Props = {
  providerStatus: ProviderStatus
  initialOnline: boolean
  initialUpdatedAt: string | null
  disabledReason?: string
  hasActiveJob?: boolean
  activeRequestId?: string | null
  providerPlan?: ProviderPlan
}

type LocationResponse = {
  online?: boolean
  updated_at?: string
  error?: string
}

type ReleaseResponse = {
  success?: boolean
  error?: string
}

function formatUpdatedAt(updatedAt: string | null, t: ReturnType<typeof useTranslations>): string {
  if (!updatedAt) return t('noDispatchLocationShared')

  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return t('dispatchLocationStatusUnavailable')

  return t('lastShared', { time: date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) })
}

export default function ProviderAvailabilityToggle({
  providerStatus,
  initialOnline,
  initialUpdatedAt,
  disabledReason,
  hasActiveJob = false,
  activeRequestId = null,
  providerPlan,
}: Props) {
  const t = useTranslations('components.providerAvailability')
  const router = useRouter()
  const [online, setOnline] = useState(initialOnline)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt)
  const [lastCoords, setLastCoords] = useState<Coordinates | null>()
  const [lastUpdateMs, setLastUpdateMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false)
  const [showReleaseDialog, setShowReleaseDialog] = useState(false)
  const [releaseLoading, setReleaseLoading] = useState(false)

  const disabled = providerStatus !== 'active'

  function getBrowserLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error(t('locationNotSupported')))
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
              ? t('locationPermissionDenied')
              : t('locationFailed')
          ))
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      )
    })
  }

  async function updateOnlineLocation() {
    if (loading || disabled) return
    setLoading(true)
    setError('')
    setMessage('')
    setLocationPermissionDenied(false)

    try {
      const now = Date.now()
      if (online && now - lastUpdateMs < MIN_UPDATE_INTERVAL_MS) {
        setMessage(t('updatedRecently'))
        setLoading(false)
        return
      }

      const coords = await getBrowserLocation()
      if (online && lastCoords && distanceMeters(lastCoords, coords) < MIN_MOVEMENT_METERS) {
        setMessage(t('noMeaningfulMovement'))
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
        throw new Error(data?.error ?? t('shareLocationFailed'))
      }

      setOnline(true)
      setUpdatedAt(data?.updated_at ?? new Date().toISOString())
      setLastCoords(coords)
      setLastUpdateMs(now)
      setMessage(t('onlineForRequests'))
      router.refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('updateAvailabilityFailed')
      setError(message)
      setLocationPermissionDenied(message === t('locationPermissionDenied'))
    } finally {
      setLoading(false)
    }
  }

  async function goOffline() {
    if (loading) return
    if (hasActiveJob) {
      setShowReleaseDialog(true)
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    setLocationPermissionDenied(false)

    try {
      const res = await fetch('/api/provider/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ online: false }),
      })
      const data = await res.json().catch(() => null) as LocationResponse | null

      if (!res.ok) {
        throw new Error(data?.error ?? t('goOfflineFailed'))
      }

      setOnline(false)
      setUpdatedAt(null)
      setLastCoords(null)
      setMessage(t('offlineLocationNotShared'))
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('updateAvailabilityFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function releaseJobAndGoOffline() {
    if (releaseLoading || !activeRequestId) return
    setReleaseLoading(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch('/api/provider/jobs/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: activeRequestId }),
      })
      const data = await res.json().catch(() => null) as ReleaseResponse | null

      if (!res.ok) {
        throw new Error(data?.error ?? t('releaseJobFailed'))
      }

      setOnline(false)
      setUpdatedAt(null)
      setLastCoords(null)
      setShowReleaseDialog(false)
      setMessage(t('jobReleasedOffline'))
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('releaseJobFailed'))
    } finally {
      setReleaseLoading(false)
    }
  }

  return (
    <section className={`mb-6 block w-full clear-both rounded-xl border p-5 shadow-sm transition-colors ${
      online ? 'border-[#9FE1CB] bg-[#E1F5EE]' : 'border-slate-200 bg-white'
    }`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            online ? 'bg-white text-[#0F6E56]' : 'bg-slate-100 text-slate-500'
          }`}>
            {online ? (
              <Wifi className="h-5 w-5" aria-hidden="true" />
            ) : (
              <WifiOff className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${online ? 'animate-pulse bg-[#1D9E75]' : 'bg-[#E24B4A]'}`} aria-hidden="true" />
              <h2 className="text-base font-medium text-slate-950">
                {online ? t('onlineTitle') : t('offlineTitle')}
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {online ? formatUpdatedAt(updatedAt, t) : t('goOnlinePrompt')}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t('locationSharedOnlineOnly')}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            type="button"
            onClick={updateOnlineLocation}
            loading={loading}
            disabled={disabled}
            className="h-11 w-full bg-[#1D9E75] px-5 text-white hover:bg-[#0F6E56] focus:ring-[#1D9E75] sm:w-auto"
          >
            {online ? (
              <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
            ) : (
              <Radio className="me-2 h-4 w-4" aria-hidden="true" />
            )}
            {online ? t('refreshLocation') : t('goOnline')}
          </Button>
          {online && (
            <Button
              type="button"
              variant="ghost"
              onClick={goOffline}
              loading={loading}
              className="h-11 w-full px-5 sm:w-auto"
            >
              <Power className="me-2 h-4 w-4" aria-hidden="true" />
              {t('goOffline')}
            </Button>
          )}
        </div>
      </div>
      {disabled && (
        <p className="mt-4 rounded-xl bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {disabledReason ?? t('mustBeActive')}
        </p>
      )}
      {message && <p className="mt-4 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && (
        <div className="mt-4 rounded-xl bg-red-50 px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
          {locationPermissionDenied && (
            <p className="mt-1 text-xs text-red-400">
              {t('locationPermissionHint')}
            </p>
          )}
        </div>
      )}
      {showReleaseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="release-job-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="release-job-title" className="text-lg font-bold text-slate-900">{t('activeJobInProgress')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {providerPlan === 'pay_per_job'
                ? t('releasePayPerJobWarning', { fee: PAY_PER_JOB_PROMO_FEE_AED })
                : t('releasePlanWarning')}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowReleaseDialog(false)}
                disabled={releaseLoading}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('stayOnline')}
              </button>
              <button
                type="button"
                onClick={releaseJobAndGoOffline}
                disabled={releaseLoading || !activeRequestId}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {releaseLoading ? t('releasing') : t('releaseJobAndGoOffline')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
