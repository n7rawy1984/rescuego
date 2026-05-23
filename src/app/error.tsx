'use client'
import { useEffect } from 'react'
import Link from 'next/link'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Sentry will be wired here in TASK-OBS01
    console.error('[RescueGo Error]', error)
  }, [error])

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-8xl font-black text-slate-200 mb-4 select-none">500</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
          <p className="text-slate-500 mb-6">
            We hit an unexpected error. Our team has been notified.
          </p>
          {error.digest && (
            <p className="text-xs font-mono text-slate-400 mb-6">Error ID: {error.digest}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={reset}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-6 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
