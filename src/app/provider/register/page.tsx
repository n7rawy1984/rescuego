'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Navbar from '@/components/layout/Navbar'
import { getProviderOnboardingState } from '@/lib/provider-onboarding'
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
  const [step, setStep] = useState(1)
  const [userId, setUserId] = useState('')
  const [selectedPlan, setSelectedPlan] = useState<ProviderPlanId>(getInitialSelectedPlan)
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' })
  const [files, setFiles] = useState<{ emirates_id?: File; license?: File; vehicle?: File }>({})
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState('')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [resumeProvider, setResumeProvider] = useState<ResumeProviderState>({
    isProvider: false,
    activeReady: false,
    reviewReady: false,
    status: null,
    documents: null,
  })
  const [existingAccount, setExistingAccount] = useState<ExistingAccountState>({
    checked: false,
    role: null,
    actionHref: null,
    actionLabel: null,
    message: null,
  })

  useEffect(() => {
    let cancelled = false

    async function loadExistingAccount() {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user ?? null
      const sessionToken = sessionData.session?.access_token ?? null

      if (!user) {
        if (!cancelled) setExistingAccount((current) => ({ ...current, checked: true }))
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
        const stateStep = stepNumber(onboarding.firstIncompleteStep)
        const nextStep = forcedStep && forcedStep <= Math.max(stateStep, 3) ? forcedStep : stateStep

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
        }
        return
      }

      if (!cancelled) setExistingAccount((current) => ({ ...current, checked: true }))
    }

    loadExistingAccount()

    return () => {
      cancelled = true
    }
  }, [])

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
    setLoading(true)
    setLoadingLabel(resumeProvider.isProvider ? 'Saving your provider profile...' : 'Creating your account...')
    setError('')
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

    if (!profileRes.ok || !profile?.id) {
      setError(profile?.error ?? 'Account created, but provider profile setup failed. Please sign in to continue setup.')
      setLoading(false)
      setLoadingLabel('')
      return
    }

    setUserId(profile.id)
    setLoading(false)
    setLoadingLabel('')
    setResumeProvider((current) => ({ ...current, isProvider: true, activeReady: false }))
    setStep(2)
  }

  async function handleDocumentUpload(e: React.FormEvent) {
    e.preventDefault()
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

    const res = await fetch('/api/providers/documents', {
      method: 'POST',
      headers: authHeaders(false),
      body: formData,
    })
    const result = await res.json().catch(() => null) as { error?: string } | null

    if (!res.ok) {
      setError(result?.error ?? 'Failed to upload documents. Please try again.')
      setLoading(false)
      setLoadingLabel('')
      return
    }

    setLoading(false)
    setLoadingLabel('')
    setResumeProvider((current) => ({
      ...current,
      documents: {
        emirates_id_url: 'uploaded',
        license_url: 'uploaded',
        vehicle_photo_url: 'uploaded',
      },
    }))
    setStep(3)
  }

  async function handlePlanSubmit() {
    if (selectedPlan === 'pay_per_job') {
      setLoading(true)
      setLoadingLabel('Saving your plan...')
      setError('')
      const res = await fetch('/api/providers/plan', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ plan: 'pay_per_job' }),
      })

      if (!res.ok) {
        const result = await res.json().catch(() => null) as { error?: string } | null
        setError(result?.error ?? 'Failed to select plan')
        setLoading(false)
        setLoadingLabel('')
        return
      }

      setResumeProvider((current) => ({ ...current, reviewReady: true, status: current.status ?? 'pending' }))
      setStep(4)
      return
    }
    setLoading(true)
    setLoadingLabel('Opening secure checkout...')
    const res = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ plan: selectedPlan, provider_id: userId }),
    })
    const { url, error: checkoutError } = await res.json()
    if (url) window.location.href = url
    else { setError(checkoutError ?? 'Failed to create checkout'); setLoading(false); setLoadingLabel('') }
  }

  const isResumeFlow = resumeProvider.isProvider
  const loginHref = `/auth/login?redirect=${encodeURIComponent(currentRegisterPath())}`

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        {LAUNCH_PROMO && (
          <div className="-mx-4 -mt-8 mb-8 bg-orange-500 text-white text-center py-3 px-4 text-sm font-semibold">
            🎉 Launch Offer: Pay Per Job at just {PAY_PER_JOB_PROMO_FEE_AED} AED flat - Limited time only!
          </div>
        )}
        <div className="max-w-2xl mx-auto">
          {existingAccount.checked && existingAccount.actionHref && (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h1 className="text-xl font-bold text-slate-900">Account already signed in</h1>
              <p className="mt-2 text-sm text-slate-600">{existingAccount.message}</p>
              <Link
                href={existingAccount.actionHref}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
              >
                {existingAccount.actionLabel}
              </Link>
            </div>
          )}

          {!existingAccount.checked && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="h-6 w-48 rounded bg-slate-100" />
              <div className="mt-3 h-4 w-64 rounded bg-slate-100" />
            </div>
          )}

          {existingAccount.checked && !existingAccount.actionHref && (
          <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">
              {isResumeFlow ? 'Continue your provider setup' : 'Join as Recovery Provider'}
            </h1>
            <p className="text-slate-500 mt-1">
              {isResumeFlow ? 'Finish the remaining steps to activate your RescueGo provider account.' : 'Start receiving recovery requests in your area'}
            </p>
            <div className="flex gap-2 mt-4">
              {[1, 2, 3, 4].map((s) => (
                <div key={s} className={`flex-1 h-1.5 rounded-full ${step >= s ? 'bg-orange-500' : 'bg-slate-200'}`} />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">Step {step} of 4</p>
          </div>

          {step === 1 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
              <h2 className="text-lg font-semibold mb-4">Complete provider profile</h2>
              <form onSubmit={handleAccountSubmit} className="flex flex-col gap-4">
                <Input id="name" label="Full Name" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Ahmed Al Rashid" />
                <Input id="phone" type="tel" label="Phone Number" value={form.phone} onChange={e => update('phone', e.target.value)} required placeholder="+971 50 000 0000" />
                <Input id="email" type="email" label="Email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@example.com" disabled={isResumeFlow} />
                {!isResumeFlow && (
                  <Input id="password" type="password" label="Password" value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Min 8 characters" minLength={8} />
                )}
                {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <Button type="submit" loading={loading} size="lg" className="w-full">
                  {loading ? loadingLabel || 'Saving...' : isResumeFlow ? 'Save & Continue' : 'Create Account'}
                </Button>
              </form>
              {!isResumeFlow && (
                <p className="mt-4 text-center text-sm text-slate-500">
                  Already registered? <Link href={loginHref} className="text-orange-500 font-semibold hover:underline">Sign In to continue setup</Link>
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
              <h2 className="text-lg font-semibold mb-2">Upload Required Documents</h2>
              <p className="text-sm text-slate-500 mb-6">All documents are reviewed by our team before activation. Max 5MB each. JPG, PNG, or PDF.</p>
              <form onSubmit={handleDocumentUpload} className="flex flex-col gap-5">
                {[
                  { key: 'emirates_id', label: 'Emirates ID (Front)' },
                  { key: 'license', label: 'UAE Driving License' },
                  { key: 'vehicle', label: 'Vehicle Photo (with plate visible)' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-slate-700">{label} <span className="text-red-500">*</span></label>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={e => setFiles(prev => ({ ...prev, [key]: e.target.files?.[0] }))}
                      className="w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-700 file:font-semibold hover:file:bg-orange-100"
                    />
                  </div>
                ))}
                {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <Button type="submit" loading={loading} size="lg" className="w-full">
                  {loading ? loadingLabel || 'Uploading...' : 'Upload & Continue'}
                </Button>
              </form>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Choose your access plan</h2>
              <p className="mb-4 text-sm text-slate-500">Use Pay Per Job or subscribe monthly before your account is ready for requests.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`p-5 rounded-xl border-2 text-left transition-all relative ${selectedPlan === plan.id ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'}`}
                  >
                    {plan.highlight && <span className="absolute top-3 right-3 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">Popular</span>}
                    <div className="font-bold text-slate-900 text-lg">{plan.name}</div>
                    <div className="text-2xl font-bold text-orange-500 mt-1">{plan.price === 0 ? 'Free' : `${plan.price} AED`}<span className="text-sm text-slate-500 font-normal">{plan.price > 0 ? '/mo' : ''}</span></div>
                    <div className="text-sm text-slate-600 mt-2">{plan.jobs}</div>
                    <div className="text-sm text-slate-600">{plan.commission}</div>
                  </button>
                ))}
              </div>
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}
              <Button className="w-full" loading={loading} onClick={handlePlanSubmit} size="lg">
                {loading ? loadingLabel || 'Working...' : selectedPlan === 'pay_per_job' ? 'Start for Free' : 'Proceed to Payment'}
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              {resumeProvider.activeReady ? (
                <>
                  <h2 className="text-xl font-bold text-slate-900">Your provider account is ready</h2>
                  <p className="mt-2 text-sm text-slate-500">You can now manage requests, availability, and subscription settings from your dashboard.</p>
                  <Link href="/provider/dashboard" className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600">
                    Go to Provider Dashboard
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-slate-900">Your documents are under review</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    RescueGo is reviewing your provider account. You can check status and finish any remaining dashboard steps while approval is pending.
                  </p>
                  <Link href="/provider/dashboard" className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600">
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
