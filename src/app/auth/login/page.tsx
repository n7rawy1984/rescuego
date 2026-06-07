'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('auth.login')
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
    setLoadingMessage(t('openingDashboard'))
    setError('')

    router.replace(destination)
    router.refresh()

    fallbackTimerRef.current = window.setTimeout(() => {
      if (window.location.pathname === '/auth/login') {
        window.location.assign(destination)
      }
    }, 1200)
  }, [clearFallbackTimer, router, t])

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
    setLoadingMessage(t('signingIn'))
    setError('')

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError || !data.user) {
        setError(authError?.message ?? t('loginFailed'))
        setLoading(false)
        setLoadingMessage('')
        return
      }

      const confirmedSession = data.session ?? (await supabase.auth.getSession()).data.session
      if (!confirmedSession) {
        setError(t('sessionConfirmError'))
        setLoading(false)
        setLoadingMessage('')
        return
      }

      setLoadingMessage(t('loadingDashboard'))
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle()

      navigateAfterAuthenticatedLogin(getDestinationForRole(userData?.role as UserRole | undefined, getSafeRedirect()))
    } catch {
      setError(t('connectionLost'))
      setLoading(false)
      setLoadingMessage('')
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="mb-6 inline-flex items-center gap-2" aria-label={t('homeAriaLabel')}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D9E75]" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{t('title')}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t('subtitle')}</p>
        </div>
        <div className="rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="mb-5 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-sm text-[#0F6E56]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>{t('secureAccess')}</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="email" type="email" label={t('email')} value={email} onChange={e => setEmail(e.target.value)} required placeholder={t('emailPlaceholder')} disabled={loading} />
            <Input id="password" type="password" label={t('password')} value={password} onChange={e => setPassword(e.target.value)} required placeholder={t('passwordPlaceholder')} disabled={loading} />
            <div className="text-end -mt-2">
              <Link href="/auth/forgot-password" className="text-sm text-[#1D9E75] hover:underline">
                {t('forgotPassword')}
              </Link>
            </div>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
            {loadingMessage && (
              <div className="rounded-xl bg-[#E1F5EE] px-3 py-2 text-sm font-medium text-[#0F6E56]" role="status" aria-live="polite">
                {loadingMessage}
              </div>
            )}
            <Button type="submit" loading={loading} size="lg" className="mt-2 min-h-12 w-full">
              {loading ? loadingMessage : t('submit')}
            </Button>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-center text-sm text-slate-500">
            <p>{t('newCustomer')} <Link href="/auth/register" className="text-[#1D9E75] font-semibold hover:underline">{t('createAccount')}</Link></p>
            <p>{t('recoveryProvider')} <Link href="/provider/register" className="text-[#1D9E75] font-semibold hover:underline">{t('joinProvider')}</Link></p>
          </div>
        </div>
      </div>
    </div>
  )
}
