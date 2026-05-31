'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types'

function dashboardHrefForRole(role: UserRole | null): string {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'provider') return '/provider/dashboard'
  return '/customer/request'
}

function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/provider')
    || pathname.startsWith('/customer')
    || pathname.startsWith('/admin')
}

export default function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const pathnameRef = useRef(pathname)
  const localLogoutRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [role, setRole] = useState<UserRole | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    function redirectToLogin() {
      const targetPath = pathnameRef.current
      if (!isProtectedPath(targetPath)) return
      router.replace(`/auth/login?redirect=${encodeURIComponent(targetPath)}`)
    }

    async function loadUserRole() {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('offline')
        }

        setLoadError('')
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          if (!cancelled) {
            setAuthenticated(false)
            setRole(null)
            setLoading(false)
          }
          return
        }

        if (!cancelled) {
          setAuthenticated(true)
        }

        const { data: profile } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle<{ role: UserRole | null }>()

        if (!cancelled) {
          setRole(profile?.role ?? 'customer')
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false)
          setRole(null)
          setLoading(false)
          setLoadError('Connection lost. Please check your internet connection and try again.')
        }
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        setAuthenticated(false)
        setRole(null)
        setLoading(false)
        setOpen(false)
        if (!localLogoutRef.current) {
          redirectToLogin()
        }
      }
    })

    loadUserRole()

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [loadAttempt, router])

  const dashboardHref = dashboardHrefForRole(role)

  function retryLoadUserRole() {
    setLoadError('')
    setLoading(true)
    setLoadAttempt((current) => current + 1)
  }

  function handleLogout(event: MouseEvent<HTMLButtonElement>) {
    event.currentTarget.blur()
    localLogoutRef.current = true
    const supabase = createClient()
    setLoadError('')
    setLoading(false)
    setAuthenticated(false)
    setRole(null)
    setOpen(false)
    router.replace('/')
    void supabase.auth
      .signOut()
      .catch(() => undefined)
      .finally(() => {
        localLogoutRef.current = false
      })
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
        <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2" aria-label="RescueGo home">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 shadow-sm" aria-hidden="true">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <span className="font-bold text-xl text-slate-900">RescueGo</span>
        </Link>

        <div className="hidden md:flex items-center gap-2">
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">Pricing</Link>
          <Link href="/about" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">About</Link>
          {role === 'admin' && !loadError && !loading && (
            <Link href="/admin/providers" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">Admin Tools</Link>
          )}
          {loadError ? (
            <div className="flex items-center gap-3">
              <span className="max-w-40 text-xs font-medium text-red-600">{loadError}</span>
              <button
                type="button"
                onClick={retryLoadUserRole}
                className="text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-4" aria-hidden="true">
              <div className="h-5 w-16 rounded bg-slate-100 animate-pulse" />
              <div className="h-10 w-28 rounded-lg bg-slate-100 animate-pulse" />
            </div>
          ) : authenticated ? (
            <>
              <Link
                href={dashboardHref}
                onClick={(event) => event.currentTarget.blur()}
                className="inline-flex min-h-10 items-center rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 active:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-orange-600 active:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">Sign In</Link>
              <Link href="/customer/request" className="inline-flex min-h-10 items-center rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
                Get Help Now
              </Link>
            </>
          )}
        </div>

        <button
          className="rounded-lg p-2 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? (
            <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-4 shadow-sm md:hidden">
          <Link href="/pricing" className="rounded-lg px-3 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/about" className="rounded-lg px-3 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50" onClick={() => setOpen(false)}>About</Link>
          {role === 'admin' && !loadError && !loading && (
            <Link href="/admin/providers" className="rounded-lg px-3 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50" onClick={() => setOpen(false)}>Admin Tools</Link>
          )}
          {loadError ? (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-700">{loadError}</p>
              <button
                type="button"
                onClick={retryLoadUserRole}
                className="mt-2 text-sm font-semibold text-orange-600"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-2" aria-hidden="true">
              <div className="h-10 rounded-lg bg-slate-100 animate-pulse" />
              <div className="h-10 rounded-lg bg-slate-100 animate-pulse" />
            </div>
          ) : authenticated ? (
            <>
              <Link
                href={dashboardHref}
                className="rounded-lg bg-orange-500 px-4 py-3 text-center font-semibold text-white shadow-sm active:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                onClick={(event) => {
                  event.currentTarget.blur()
                  setOpen(false)
                }}
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-3 text-left font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-orange-600 active:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="rounded-lg px-3 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50" onClick={() => setOpen(false)}>Sign In</Link>
              <Link href="/customer/request" className="rounded-lg bg-orange-500 px-4 py-3 text-center font-semibold text-white shadow-sm" onClick={() => setOpen(false)}>
                Get Help Now
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
