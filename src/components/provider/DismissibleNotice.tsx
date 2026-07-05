'use client'
import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  /** Unique per notice instance (e.g. cancelled request id) — scopes the dismissal. */
  storageKey: string
  dismissLabel: string
  children: ReactNode
}

/**
 * Client wrapper that lets the provider dismiss a server-rendered notice for the
 * current browser session only. sessionStorage (NOT localStorage) is intentional:
 * the notice window logic (24h, server-side) stays authoritative and the notice
 * reappears in a fresh session; the recent-activity feed remains the permanent record.
 */
export default function DismissibleNotice({ storageKey, dismissLabel, children }: Props) {
  const key = `rescuego:notice-dismissed:${storageKey}`
  // Start visible so SSR and the first client render match, then hide after
  // mount if this session already dismissed the notice.
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(key) === '1') setDismissed(true)
    } catch {
      // sessionStorage unavailable (private mode edge cases) — keep the notice visible.
    }
  }, [key])

  if (dismissed) return null

  function handleDismiss() {
    try {
      sessionStorage.setItem(key, '1')
    } catch {
      // Best effort — still hide for the current render.
    }
    setDismissed(true)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={dismissLabel}
        className="absolute end-3 top-3 z-10 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {children}
    </div>
  )
}
