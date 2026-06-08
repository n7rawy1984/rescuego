'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
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

export default function Navbar({
  initialAuthenticated,
  initialRole,
}: {
  initialAuthenticated?: boolean
  initialRole?: UserRole | null
} = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('nav')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const pathnameRef = useRef(pathname)
  const localLogoutRef = useRef(false)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(initialAuthenticated === undefined)
  const [authenticated, setAuthenticated] = useState(initialAuthenticated ?? false)
  const [role, setRole] = useState<UserRole | null>(initialRole ?? null)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

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
          setLoadError('network')
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
      if (event === 'SIGNED_IN') {
        loadUserRole()
      }
    })

    if (initialAuthenticated === undefined || loadAttempt > 0) {
      loadUserRole()
    }

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [loadAttempt, router, initialAuthenticated])

  const dashboardHref = dashboardHrefForRole(role)
  const baseNavLink = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2'
  const activeNavLink = 'bg-[#E1F5EE] text-[#0F6E56]'

  function retryLoadUserRole() {
    setLoadError('')
    setLoading(true)
    setLoadAttempt((current) => current + 1)
  }

  function switchLocale() {
    const next = locale === 'ar' ? 'en' : 'ar'
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000`
    router.refresh()
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
      .signOut({ scope: 'local' })
      .catch(() => undefined)
      .finally(() => {
        localLogoutRef.current = false
      })
  }

  if (!mounted) {
    return (
      <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D9E75]" aria-hidden="true">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="font-bold text-xl text-slate-900">RescueGo</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
      </nav>
    )
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white" suppressHydrationWarning>
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2" aria-label="RescueGo home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D9E75]" aria-hidden="true">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-xl text-slate-900">RescueGo</span>
          </Link>
          <button
            type="button"
            onClick={switchLocale}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56]"
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <Link href="/pricing" className={`${baseNavLink} ${pathname === '/pricing' ? activeNavLink : ''}`}>{t('pricing')}</Link>
          <Link href="/about" className={`${baseNavLink} ${pathname === '/about' ? activeNavLink : ''}`}>{t('about')}</Link>
          {role === 'admin' && !loadError && !loading && (
            <Link href="/admin/providers" className={`${baseNavLink} ${pathname.startsWith('/admin') ? activeNavLink : ''}`}>{t('dashboard')}</Link>
          )}
          {loadError ? (
            <div className="flex items-center gap-3">
              <span className="max-w-40 text-xs font-medium text-red-600">{tErrors('network')}</span>
              <button
                type="button"
                onClick={retryLoadUserRole}
                className="text-sm font-semibold text-[#0F6E56] hover:text-[#1D9E75]"
              >
                {tCommon('retry')}
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
                className={`inline-flex min-h-9 items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 ${pathname.startsWith(dashboardHref) ? activeNavLink : 'text-slate-700 hover:bg-[#E1F5EE] hover:text-[#0F6E56]'}`}
              >
                {t('dashboard')}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] active:text-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
              >
                {t('logout')}
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className={`${baseNavLink} ${pathname.startsWith('/auth/login') ? activeNavLink : ''}`}>{t('login')}</Link>
              <Link href="/customer/request" className="inline-flex min-h-9 items-center rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2">
                {t('request')}
              </Link>
            </>
          )}
        </div>

        <button
          className="rounded-lg p-2 transition-colors hover:bg-[#E1F5EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 md:hidden"
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
          <button
            type="button"
            onClick={switchLocale}
            className="rounded-lg px-3 py-3 text-start font-medium text-slate-700 transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56]"
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
          <Link href="/pricing" className={`rounded-lg px-3 py-3 font-medium transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] ${pathname === '/pricing' ? activeNavLink : 'text-slate-700'}`} onClick={() => setOpen(false)}>{t('pricing')}</Link>
          <Link href="/about" className={`rounded-lg px-3 py-3 font-medium transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] ${pathname === '/about' ? activeNavLink : 'text-slate-700'}`} onClick={() => setOpen(false)}>{t('about')}</Link>
          {role === 'admin' && !loadError && !loading && (
            <Link href="/admin/providers" className={`rounded-lg px-3 py-3 font-medium transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] ${pathname.startsWith('/admin') ? activeNavLink : 'text-slate-700'}`} onClick={() => setOpen(false)}>{t('dashboard')}</Link>
          )}
          {loadError ? (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-700">{tErrors('network')}</p>
              <button
                type="button"
                onClick={retryLoadUserRole}
                className="mt-2 text-sm font-semibold text-[#0F6E56]"
              >
                {tCommon('retry')}
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
                className={`rounded-lg px-4 py-3 text-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 ${pathname.startsWith(dashboardHref) ? activeNavLink : 'text-slate-700 hover:bg-[#E1F5EE] hover:text-[#0F6E56]'}`}
                onClick={(event) => {
                  event.currentTarget.blur()
                  setOpen(false)
                }}
              >
                {t('dashboard')}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-3 text-start font-medium text-slate-700 transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] active:text-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2"
              >
                {t('logout')}
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className={`rounded-lg px-3 py-3 font-medium transition-colors hover:bg-[#E1F5EE] hover:text-[#0F6E56] ${pathname.startsWith('/auth/login') ? activeNavLink : 'text-slate-700'}`} onClick={() => setOpen(false)}>{t('login')}</Link>
              <Link href="/customer/request" className="rounded-lg bg-[#1D9E75] px-4 py-3 text-center font-medium text-white" onClick={() => setOpen(false)}>
                {t('request')}
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
