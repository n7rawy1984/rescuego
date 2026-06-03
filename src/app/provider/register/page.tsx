'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Navbar from '@/components/layout/Navbar'
import { getProviderOnboardingState } from '@/lib/provider-onboarding'
import { CheckCircle2, FileCheck2, ShieldCheck, Truck, UploadCloud } from 'lucide-react'
import type { ProviderDocuments } from '@/lib/provider-onboarding'
import { LAUNCH_PROMO, PAY_PER_JOB_PROMO_FEE_AED } from '@/types'
import type { ProviderPlan, ProviderStatus, UserRole } from '@/types'

const PLANS = [
  { id: 'starter', name: 'Starter', price: 249, jobs: '15 jobs/mo', commission: '15% on premium', highlight: false },
  { id: 'pro', name: 'Pro', price: 449, jobs: '35 jobs/mo', commission: '10% on premium', highlight: true },
  { id: 'business', name: 'Business', price: 849, jobs: 'Unlimited', commission: '0% premium commission', highlight: false },
  { id: 'pay_per_job', name: 'Pay Per Job', price: 0, jobs: 'No limit', commission: 'Flat acceptance fee, no commission', highlight: false },
]

type ProviderPlanId = (typeof PLANS)[number]['id']

type ExistingAccountState = {
  checked: boolean
  role: UserRole | null
  actionHref: string | null
  actionLabel: string | null
  message: string | null
}

type ResumeProviderState = {
  isProvider: boolean
  activeReady: boolean
  reviewReady: boolean
  status: ProviderStatus | null
  documents: ProviderDocuments
}

type TransientSuccess = 'setup_submitted' | null

const EMPTY_FORM = { name: '', phone: '', email: '', password: '' }

const EMPTY_RESUME_PROVIDER: ResumeProviderState = {
  isProvider: false,
  activeReady: false,
  reviewReady: false,
  status: null,
  documents: null,
}

const EMPTY_EXISTING_ACCOUNT: ExistingAccountState = {
  checked: false,
  role: null,
  actionHref: null,
  actionLabel: null,
  message: null,
}

function getInitialSelectedPlan(): ProviderPlanId {
  if (typeof window === 'undefined') return 'pay_per_job'
  const plan = new URLSearchParams(window.location.search).get('plan')
  if (plan === 'starter' || plan === 'pro' || plan === 'business' || plan === 'pay_per_job') return plan
  return 'pay_per_job'
}

function requestedStep(): number | null {
  if (typeof window === 'undefined') return null
  const step = new URLSearchParams(window.location.search).get('step')
  if (step === 'profile') return 1
  if (step === 'documents') return 2
  if (step === 'plan') return 3
  return null
}

function requestedStepParam(): 'profile' | 'documents' | 'plan' | null {
  if (typeof window === 'undefined') return null
  const step = new URLSearchParams(window.location.search).get('step')
  if (step === 'profile' || step === 'documents' || step === 'plan') return step
  return null
}

function currentRegisterPath(): string {
  if (typeof window === 'undefined') return '/provider/register'
  return `${window.location.pathname}${window.location.search}`
}

function stepNumber(step: 'profile' | 'documents' | 'plan' | 'review' | 'ready'): number {
  if (step === 'profile') return 1
  if (step === 'documents') return 2
  if (step === 'plan') return 3
  return 4
}

export default function ProviderRegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [userId, setUserId] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<ProviderPlanId>(getInitialSelectedPlan)
  const [form, setForm] = useState(EMPTY_FORM)
  const [files, setFiles] = useState<{ emirates_id?: File; license?: File; vehicle?: File }>({})
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState('')
  const [hydratingAccount, setHydratingAccount] = useState(true)
  const [initialLoadError, setInitialLoadError] = useState('')
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0)
  const [transientSuccess, setTransientSuccess] = useState<TransientSuccess>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [resumeProvider, setResumeProvider] = useState<ResumeProviderState>(EMPTY_RESUME_PROVIDER)
  const [existingAccount, setExistingAccount] = useState<ExistingAccountState>(EMPTY_EXISTING_ACCOUNT)

  useEffect(() => {
    let cancelled = false

    async function loadExistingAccount() {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('offline')
        }

        if (!cancelled) {
          setHydratingAccount(true)
          setInitialLoadError('')
          setError('')
          setTransientSuccess(null)
          setLoading(false)
          setLoadingLabel('')
          setExistingAccount(EMPTY_EXISTING_ACCOUNT)
          setResumeProvider(EMPTY_RESUME_PROVIDER)
          setAccessToken(null)
          setUserId('')
          setFiles({})
          setStep(requestedStep() ?? 1)
        }

        const supabase = createClient()
        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData.session?.user ?? null
        const sessionToken = sessionData.session?.access_token ?? null

        if (!user) {
          if (!cancelled) {
            setExistingAccount((current) => ({ ...current, checked: true }))
            setHydratingAccount(false)
          }
          return
        }

        const { data: profile } = await supabase
          .from('users')
          .select('role, name, phone, email')
          .eq('id', user.id)
          .maybeSingle<{ role: UserRole | null; name: string | null; phone: string | null; email: string | null }>()

        if (profile?.role === 'admin') {
          if (!cancelled) {
            setExistingAccount({
              checked: true,
              role: 'admin',
              actionHref: '/admin/dashboard',
              actionLabel: 'Go to Admin Dashboard',
              message: 'You are already signed in as an admin.',
            })
            setHydratingAccount(false)
          }
          return
        }

        if (profile?.role === 'customer') {
          if (!cancelled) {
            setExistingAccount({
              checked: true,
              role: 'customer',
              actionHref: '/customer/request',
              actionLabel: 'Request Help',
              message: 'You are already signed in as a customer.',
            })
            setHydratingAccount(false)
          }
          return
        }

        if (profile?.role === 'provider') {
          const { data: provider } = await supabase
            .from('providers')
            .select('status, plan, documents, stripe_subscription_id')
            .eq('id', user.id)
            .maybeSingle<{ status: ProviderStatus | null; plan: ProviderPlan | null; documents: ProviderDocuments; stripe_subscription_id: string | null }>()

          const onboarding = getProviderOnboardingState({
            name: profile.name,
            email: profile.email ?? user.email ?? null,
            phone: profile.phone,
            plan: provider?.plan ?? null,
            status: provider?.status ?? null,
            documents: provider?.documents ?? null,
          })
          const forcedStep = requestedStep()
          const forcedStepParam = requestedStepParam()
          const stateStep = stepNumber(onboarding.firstIncompleteStep)
          const nextStep = forcedStep && forcedStep <= Math.max(stateStep, 3) ? forcedStep : stateStep

          if (onboarding.activeReady || onboarding.pendingApproval) {
            router.replace('/provider/dashboard')
            return
          }

          if (!forcedStepParam && onboarding.firstIncompleteStep !== 'review' && onboarding.firstIncompleteStep !== 'ready') {
            router.replace(`/provider/register?step=${onboarding.firstIncompleteStep}`)
            return
          }

          if (!cancelled) {
            setUserId(user.id)
            setAccessToken(sessionToken)
            setForm({
              name: profile.name ?? user.user_metadata?.name ?? '',
              phone: profile.phone ?? user.user_metadata?.phone ?? '',
              email: profile.email ?? user.email ?? '',
              password: '',
            })
            setStep(Math.min(nextStep, 4))
            setResumeProvider({
              isProvider: true,
              activeReady: onboarding.activeReady,
              reviewReady: onboarding.pendingApproval,
              status: provider?.status ?? null,
              documents: provider?.documents ?? null,
            })
            setExistingAccount({
              checked: true,
              role: 'provider',
              actionHref: null,
              actionLabel: null,
              message: null,
            })
            setHydratingAccount(false)
          }
          return
        }

        if (!cancelled) {
          setExistingAccount((current) => ({ ...current, checked: true }))
          setHydratingAccount(false)
        }
      } catch {
        if (!cancelled) {
          setExistingAccount(EMPTY_EXISTING_ACCOUNT)
          setResumeProvider(EMPTY_RESUME_PROVIDER)
          setAccessToken(null)
          setUserId('')
          setHydratingAccount(false)
          setInitialLoadError('Connection lost. Please check your internet connection and try again.')
        }
      }
    }

    loadExistingAccount()

    return () => {
      cancelled = true
    }
  }, [initialLoadAttempt, router])

  function retryInitialLoad() {
    setHydratingAccount(true)
    setInitialLoadError('')
    setError('')
    setTransientSuccess(null)
    setExistingAccount(EMPTY_EXISTING_ACCOUNT)
    setResumeProvider(EMPTY_RESUME_PROVIDER)
    setAccessToken(null)
    setUserId('')
    setFiles({})
    setInitialLoadAttempt((current) => current + 1)
  }

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function authHeaders(contentType = true): HeadersInit {
    return {
      ...(contentType ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setLoadingLabel(resumeProvider.isProvider ? 'Saving your provider profile...' : 'Creating your account...')
    setError('')
    try {
      const supabase = createClient()

      let sessionAccessToken = accessToken

      if (!resumeProvider.isProvider) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { name: form.name, phone: form.phone } },
        })
        let signedUpUser = data.user
        sessionAccessToken = data.session?.access_token ?? null

        if (authError || !signedUpUser) {
          const { data: sessionData } = await supabase.auth.getSession()
          const sessionUser = sessionData.session?.user ?? null
          if (sessionUser?.email?.toLowerCase() === form.email.toLowerCase()) {
            signedUpUser = sessionUser
            sessionAccessToken = sessionData.session?.access_token ?? null
          } else {
            const loginRedirect = `/auth/login?redirect=${encodeURIComponent(currentRegisterPath())}`
            setError(authError?.message
              ? `${authError.message}. If you already registered, sign in to continue provider setup: ${loginRedirect}`
              : `Registration failed. If you already registered, sign in to continue provider setup: ${loginRedirect}`)
            setLoading(false)
            setLoadingLabel('')
            return
          }
        }
      }

      setAccessToken(sessionAccessToken)
      setLoadingLabel('Setting up your provider profile...')
      const profileRes = await fetch('/api/providers/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionAccessToken ? { Authorization: `Bearer ${sessionAccessToken}` } : {}),
        },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
        }),
      })
      const profile = await profileRes.json().catch(() => null) as { id?: string; error?: string } | null

      if (profileRes.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        setLoadingLabel('')
        return
      }

      if (!profileRes.ok || !profile?.id) {
        setError(profile?.error ?? 'Account created, but provider profile setup failed. Please sign in to continue setup.')
        setLoading(false)
        setLoadingLabel('')
        return
      }

      setUserId(profile.id)
      setLoading(false)
      setLoadingLabel('')
      setTransientSuccess(null)
      setResumeProvider((current) => ({ ...current, isProvider: true, activeReady: false }))
      setStep(2)
    } catch {
      setError('Network connection lost. Please try again.')
      setLoading(false)
      setLoadingLabel('')
    }
  }

  async function handleDocumentUpload(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!files.emirates_id || !files.license || !files.vehicle) {
      setError('Please upload all 3 required documents.')
      return
    }
    setLoading(true)
    setLoadingLabel('Uploading documents...')
    setError('')

    const formData = new FormData()
    formData.append('emirates_id', files.emirates_id)
    formData.append('license', files.license)
    formData.append('vehicle', files.vehicle)

    try {
      const res = await fetch('/api/providers/documents', {
        method: 'POST',
        headers: authHeaders(false),
        body: formData,
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        setLoadingLabel('')
        return
      }

      if (!res.ok) {
        setError(result?.error ?? 'Failed to upload documents. Please try again.')
        setLoading(false)
        setLoadingLabel('')
        return
      }

      setLoading(false)
      setLoadingLabel('')
      setTransientSuccess(null)
      setResumeProvider((current) => ({
        ...current,
        documents: {
          emirates_id_url: 'uploaded',
          license_url: 'uploaded',
          vehicle_photo_url: 'uploaded',
        },
      }))
      setStep(3)
    } catch {
      setError('Network connection lost. Please try again.')
      setLoading(false)
      setLoadingLabel('')
    }
  }

  async function handlePlanSubmit() {
    if (loading) return
    if (selectedPlan === 'pay_per_job') {
      setLoading(true)
      setLoadingLabel('Saving your plan...')
      setError('')
      try {
        const res = await fetch('/api/providers/plan', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ plan: 'pay_per_job' }),
        })

        if (res.status === 401) {
          setError('Your session expired. Please sign in again.')
          setLoading(false)
          setLoadingLabel('')
          return
        }

        if (!res.ok) {
          const result = await res.json().catch(() => null) as { error?: string } | null
          setError(result?.error ?? 'Failed to select plan')
          setLoading(false)
          setLoadingLabel('')
          return
        }

        setResumeProvider((current) => ({ ...current, reviewReady: true, status: current.status ?? 'pending' }))
        setTransientSuccess('setup_submitted')
        setStep(4)
      } catch {
        setError('Network connection lost. Please try again.')
        setLoading(false)
        setLoadingLabel('')
      }
      return
    }
    setLoading(true)
    setLoadingLabel('Opening secure checkout...')
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ plan: selectedPlan, provider_id: userId }),
      })
      const { url, error: checkoutError } = await res.json()
      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        setLoadingLabel('')
        return
      }
      if (url) window.location.href = url
      else { setError(checkoutError ?? 'Unable to start billing session right now.'); setLoading(false); setLoadingLabel('') }
    } catch {
      setError('Network connection lost. Please try again.')
      setLoading(false)
      setLoadingLabel('')
    }
  }

  const isResumeFlow = resumeProvider.isProvider
  const loginHref = `/auth/login?redirect=${encodeURIComponent(currentRegisterPath())}`
  const showProviderStatusCard = existingAccount.checked
    && !existingAccount.actionHref
    && !initialLoadError
    && !hydratingAccount
    && isResumeFlow
    && step === 4
    && (resumeProvider.activeReady || resumeProvider.reviewReady)
  const showStepFlow = existingAccount.checked
    && !existingAccount.actionHref
    && !initialLoadError
    && !hydratingAccount
    && !showProviderStatusCard

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        {LAUNCH_PROMO && (
          <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-center text-sm font-semibold text-[#0F6E56] shadow-sm">
            Launch Offer: Pay Per Job at just {PAY_PER_JOB_PROMO_FEE_AED} AED flat - Limited time only!
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl">
          {existingAccount.checked && existingAccount.actionHref && !hydratingAccount && (
            <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-xl shadow-slate-200/50">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-semibold text-slate-950">Account already signed in</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{existingAccount.message}</p>
              <Link
                href={existingAccount.actionHref}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
              >
                {existingAccount.actionLabel}
              </Link>
            </div>
          )}

          {initialLoadError && (
            <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-xl shadow-red-100/50">
              <h1 className="text-xl font-semibold text-red-900">Connection issue</h1>
              <p className="mt-2 text-sm leading-6 text-red-700">{initialLoadError}</p>
              <button
                type="button"
                onClick={retryInitialLoad}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-red-50 px-5 text-sm font-semibold text-red-700 ring-1 ring-red-200 transition-colors hover:bg-red-100"
              >
                Try again
              </button>
            </div>
          )}

          {!initialLoadError && (hydratingAccount || !existingAccount.checked) && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-sm">
              <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
              <div className="mt-3 h-4 w-64 max-w-full animate-pulse rounded bg-slate-100" />
            </div>
          )}

          {showProviderStatusCard && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center shadow-xl shadow-slate-200/50">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              {resumeProvider.activeReady ? (
                <>
                  <h1 className="text-xl font-semibold text-slate-950">Your provider account is ready</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">You can manage requests, availability, and subscription settings from your dashboard.</p>
                </>
              ) : (
                <>
                  <h1 className="text-xl font-semibold text-slate-950">Your documents are under review</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">RescueGo will activate your account after verification.</p>
                </>
              )}
              <Link href="/provider/dashboard" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">
                Go to Provider Dashboard
              </Link>
            </div>
          )}

          {showStepFlow && (
          <>
          <div className="mb-6 overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Provider onboarding</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              {isResumeFlow ? 'Continue your provider setup' : 'Join as Recovery Provider'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {isResumeFlow ? 'Finish the remaining steps to activate your RescueGo provider account.' : 'Start receiving recovery requests in your area'}
            </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <Truck className="h-6 w-6" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-4">
              {[1, 2, 3, 4].map((s) => (
                <div key={s} className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${step >= s ? 'border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56]' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                  Step {s}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">Step {step} of 4</p>
          </div>

          {step === 1 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-8">
              <div className="mb-6 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0F6E56]" aria-hidden="true" />
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">Complete provider profile</h2>
                    <p className="mt-1 text-sm leading-6 text-[#0F6E56]">This profile helps RescueGo verify your account and contact you during onboarding.</p>
                  </div>
                </div>
              </div>
              <form onSubmit={handleAccountSubmit} className="flex flex-col gap-4">
                <Input id="name" label="Full Name" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Ahmed Al Rashid" />
                <Input id="phone" type="tel" label="Phone Number" value={form.phone} onChange={e => update('phone', e.target.value)} required placeholder="+971 50 000 0000" />
                <Input id="email" type="email" label="Email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@example.com" disabled={isResumeFlow} />
                {!isResumeFlow && (
                  <>
                    <Input id="password" type="password" label="Password" value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Min 8 characters" minLength={8} />
                    <p className="-mt-2 text-xs text-slate-500">Use at least 8 characters. A longer password with a mix of words and numbers is stronger.</p>
                  </>
                )}
                {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
                {loadingLabel && (
                  <div className="rounded-xl bg-[#E1F5EE] px-3 py-2 text-sm font-medium text-[#0F6E56]" role="status" aria-live="polite">
                    {loadingLabel}
                  </div>
                )}
                <Button type="submit" loading={loading} size="lg" className="min-h-12 w-full">
                  {loading ? loadingLabel || 'Saving...' : isResumeFlow ? 'Save & Continue' : 'Create Account'}
                </Button>
              </form>
              {!isResumeFlow && (
                <p className="mt-4 text-center text-sm text-slate-500">
                  Already registered? <Link href={loginHref} className="text-[#1D9E75] font-semibold hover:underline">Sign In to continue setup</Link>
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-8">
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1D9E75]" aria-hidden="true" />
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Upload required documents</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">All documents are reviewed by our team before activation. Max 5MB each. JPG, PNG, or PDF.</p>
                </div>
              </div>
              <form onSubmit={handleDocumentUpload} className="flex flex-col gap-5">
                {[
                  { key: 'emirates_id', label: 'Emirates ID (Front)' },
                  { key: 'license', label: 'UAE Driving License' },
                  { key: 'vehicle', label: 'Vehicle Photo (with plate visible)' },
                ].map(({ key, label }) => (
                  <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                      <UploadCloud className="h-4 w-4 text-[#1D9E75]" aria-hidden="true" />
                      <label className="text-sm font-semibold text-slate-700">{label} <span className="text-red-500">*</span></label>
                    </div>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={e => setFiles(prev => ({ ...prev, [key]: e.target.files?.[0] }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-[#E1F5EE] file:px-4 file:py-2 file:font-semibold file:text-[#0F6E56] hover:file:bg-[#DCFCE7] focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                    />
                  </div>
                ))}
                {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
                {loadingLabel && (
                  <div className="rounded-xl bg-[#E1F5EE] px-3 py-2 text-sm font-medium text-[#0F6E56]" role="status" aria-live="polite">
                    {loadingLabel}
                  </div>
                )}
                <Button type="submit" loading={loading} size="lg" className="min-h-12 w-full">
                  {loading ? loadingLabel || 'Uploading...' : 'Upload & Continue'}
                </Button>
              </form>
            </div>
          )}

          {step === 3 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-sm sm:p-8">
              <div className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <h2 className="text-xl font-semibold text-slate-950">Choose your access plan</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">Use Pay Per Job or subscribe monthly before your account is ready for requests.</p>
              </div>
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    disabled={loading}
                    className={`relative min-h-44 rounded-2xl border p-5 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${selectedPlan === plan.id ? 'border-[#1D9E75] bg-[#E1F5EE] shadow-md shadow-[#DCFCE7]' : 'border-slate-200 bg-white hover:border-[#9FE1CB] hover:bg-[#E1F5EE]/30'}`}
                  >
                    {plan.highlight && <span className="absolute right-3 top-3 rounded-full bg-[#1D9E75] px-2 py-0.5 text-xs font-bold text-white">Popular</span>}
                    <div className="text-lg font-semibold text-slate-950">{plan.name}</div>
                    <div className="mt-2 text-3xl font-semibold text-[#1D9E75]">{plan.price === 0 ? 'Free' : `${plan.price} AED`}<span className="text-sm font-normal text-slate-500">{plan.price > 0 ? '/mo' : ''}</span></div>
                    <div className="mt-4 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-600">{plan.jobs}</div>
                    <div className="mt-2 text-sm leading-5 text-slate-600">{plan.commission}</div>
                  </button>
                ))}
              </div>
              {error && <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
              {loadingLabel && (
                <div className="mb-4 rounded-xl bg-[#E1F5EE] px-3 py-2 text-sm font-medium text-[#0F6E56]" role="status" aria-live="polite">
                  {loadingLabel}
                </div>
              )}
              <Button className="min-h-12 w-full" loading={loading} onClick={handlePlanSubmit} size="lg">
                {loading ? loadingLabel || 'Working...' : selectedPlan === 'pay_per_job' ? 'Start for Free' : 'Proceed to Payment'}
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center shadow-xl shadow-slate-200/50">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              {resumeProvider.activeReady ? (
                <>
                  <h2 className="text-xl font-semibold text-slate-950">Your provider account is ready</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">You can now manage requests, availability, and subscription settings from your dashboard.</p>
                  <Link href="/provider/dashboard" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">
                    Go to Provider Dashboard
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold text-slate-950">
                    {transientSuccess === 'setup_submitted'
                      ? 'Your documents have been submitted for review'
                      : 'Provider account under review'}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {transientSuccess === 'setup_submitted'
                      ? 'RescueGo will review your provider account and activate it after verification.'
                      : 'RescueGo is reviewing your provider account. You can check status from your dashboard while approval is pending.'}
                  </p>
                  <Link href="/provider/dashboard" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">
                    Check Dashboard
                  </Link>
                </>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </main>
    </>
  )
}
