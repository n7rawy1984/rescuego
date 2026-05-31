'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

type UserRole = 'admin' | 'provider' | 'customer'

function getSafeRedirect(): string | null {
  if (typeof window === 'undefined') return null
  const requestedRedirect = new URLSearchParams(window.location.search).get('redirect')
  return requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
    ? requestedRedirect
    : null
}

function getDestinationForRole(role: string | null | undefined, safeRedirect: string | null): string {
  if (role === 'admin') {
    return safeRedirect?.startsWith('/admin') ? safeRedirect : '/admin/dashboard'
  }

  if (role === 'provider') {
    return safeRedirect?.startsWith('/provider') ? safeRedirect : '/provider/dashboard'
  }

  return safeRedirect?.startsWith('/customer') ? safeRedirect : '/customer/request'
}

export default function LoginPage() {
  const router = useRouter()
  const fallbackTimerRef = useRef<number | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [error, setError] = useState('')

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  const navigateAfterAuthenticatedLogin = useCallback((destination: string) => {
    clearFallbackTimer()
    setLoading(true)
    setLoadingMessage('Opening your dashboard...')
    setError('')

    router.replace(destination)
    router.refresh()

    fallbackTimerRef.current = window.setTimeout(() => {
      if (window.location.pathname === '/auth/login') {
        window.location.assign(destination)
      }
    }, 1200)
  }, [clearFallbackTimer, router])

  const redirectAuthenticatedUser = useCallback(async () => {
    const supabase = createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    navigateAfterAuthenticatedLogin(getDestinationForRole(userData?.role as UserRole | undefined, getSafeRedirect()))
  }, [navigateAfterAuthenticatedLogin])

  useEffect(() => {
    router.prefetch('/customer/request')
    router.prefetch('/provider/dashboard')
    router.prefetch('/admin/dashboard')

    let cancelled = false
    async function redirectIfAlreadyAuthenticated() {
      try {
        const supabase = createClient()
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (cancelled || userError || !user) return

        const { data: userData } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()

        if (!cancelled) {
          navigateAfterAuthenticatedLogin(getDestinationForRole(userData?.role as UserRole | undefined, getSafeRedirect()))
        }
      } catch {
        if (!cancelled) {
          setLoading(false)
          setLoadingMessage('')
        }
      }
    }

    void redirectIfAlreadyAuthenticated()

    return () => {
      cancelled = true
      clearFallbackTimer()
    }
  }, [clearFallbackTimer, navigateAfterAuthenticatedLogin, router])

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        void redirectAuthenticatedUser()
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [redirectAuthenticatedUser])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setLoadingMessage('Signing you in...')
    setError('')

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError || !data.user) {
        setError(authError?.message ?? 'Login failed')
        setLoading(false)
        setLoadingMessage('')
        return
      }

      const confirmedSession = data.session ?? (await supabase.auth.getSession()).data.session
      if (!confirmedSession) {
        setError('We could not confirm your session. Please try signing in again.')
        setLoading(false)
        setLoadingMessage('')
        return
      }

      setLoadingMessage('Loading your dashboard...')
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle()

      navigateAfterAuthenticatedLogin(getDestinationForRole(userData?.role as UserRole | undefined, getSafeRedirect()))
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
      setLoadingMessage('')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="RescueGo home">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-bold text-2xl text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
          <p className="mt-1 text-sm text-slate-500">Welcome back to RescueGo operations</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="email" type="email" label="Email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" disabled={loading} />
            <Input id="password" type="password" label="Password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" disabled={loading} />
            <div className="text-right -mt-2">
              <Link href="/auth/forgot-password" className="text-sm text-orange-500 hover:underline">
                Forgot password?
              </Link>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
            {loadingMessage && (
              <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800" role="status" aria-live="polite">
                {loadingMessage}
              </div>
            )}
            <Button type="submit" loading={loading} size="lg" className="w-full mt-2">
              {loading ? loadingMessage : 'Sign In'}
            </Button>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-center text-sm text-slate-500">
            <p>New customer? <Link href="/auth/register" className="text-orange-500 font-semibold hover:underline">Create account</Link></p>
            <p>Recovery provider? <Link href="/provider/register" className="text-orange-500 font-semibold hover:underline">Join as Provider</Link></p>
          </div>
        </div>
      </div>
    </div>
  )
}
