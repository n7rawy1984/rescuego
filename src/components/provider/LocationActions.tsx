'use client'

import { useState } from 'react'
import { Copy, MapPinned } from 'lucide-react'
import { formatCoordinates, googleMapsSearchUrl } from '@/lib/location-display'
import type { Coordinates } from '@/lib/geo'

type LocationActionsProps = {
  coordinates: Coordinates | null
}

export default function LocationActions({ coordinates }: LocationActionsProps) {
  const [copied, setCopied] = useState(false)

  if (!coordinates) {
    return (
      <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-600">
        Location details unavailable. Contact support.
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
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
      >
        <MapPinned className="h-4 w-4" aria-hidden="true" />
        Open in Google Maps
      </a>
      <button
        type="button"
        onClick={copyLocation}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-4 text-sm font-semibold text-orange-700 transition hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        {copied ? 'Copied' : 'Copy location'}
      </button>
    </div>
  )
}
