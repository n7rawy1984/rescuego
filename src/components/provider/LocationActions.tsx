'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, MapPinned } from 'lucide-react'
import { formatCoordinates, googleMapsSearchUrl } from '@/lib/location-display'
import type { Coordinates } from '@/lib/geo'

type LocationActionsProps = {
  coordinates: Coordinates | null
}

export default function LocationActions({ coordinates }: LocationActionsProps) {
  const t = useTranslations('components.locationActions')
  const [copied, setCopied] = useState(false)

  if (!coordinates) {
    return (
      <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-600">
        {t('locationDetailsUnavailable')}
      </p>
    )
  }

  async function copyLocation() {
    if (!coordinates) return

    try {
      await navigator.clipboard.writeText(formatCoordinates(coordinates))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <a
        href={googleMapsSearchUrl(coordinates)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
      >
        <MapPinned className="h-4 w-4" aria-hidden="true" />
        {t('openInGoogleMaps')}
      </a>
      <button
        type="button"
        onClick={copyLocation}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#DDE7EE] bg-white px-4 text-sm font-semibold text-[#0F6E56] transition hover:bg-[#E1F5EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        {copied ? t('copied') : t('copyLocation')}
      </button>
    </div>
  )
}
