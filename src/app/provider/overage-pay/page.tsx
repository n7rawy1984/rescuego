'use client'
import { Suspense, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { CreditCard, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import StripeElementsProvider from '@/components/stripe/StripeElementsProvider'
import PaymentElementForm from '@/components/stripe/PaymentElementForm'

function OveragePayContent() {
  const t = useTranslations('payment.overage')
  const params = useSearchParams()
  const requestId = params.get('request_id')
  const fee = params.get('fee')
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!requestId) {
        setLoading(false)
        return
      }

      const url = new URL(window.location.href)
      if (url.searchParams.has('client_secret')) {
        url.searchParams.delete('client_secret')
        const search = url.searchParams.toString()
        window.history.replaceState(null, '', search ? `${url.pathname}?${search}` : url.pathname)
      }

      try {
        const raw = window.sessionStorage.getItem(`rescuego:overage-payment:${requestId}`)
        const parsed = raw ? JSON.parse(raw) as { client_secret?: string } : null
        const cached = parsed?.client_secret ?? ''

        if (cached) {
          if (!cancelled) setClientSecret(cached)
          return
        }

        const res = await fetch('/api/provider/overage-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId }),
        })
        const data = await res.json()

        if (!cancelled) {
          if (res.ok && data.client_secret) {
            try {
              window.sessionStorage.setItem(
                `rescuego:overage-payment:${requestId}`,
                JSON.stringify({ client_secret: data.client_secret })
              )
            } catch {}
            setClientSecret(data.client_secret)
          } else {
            setError(data.error ?? t('sessionExpired'))
          }
        }
      } catch {
        if (!cancelled) setError(t('loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    window.setTimeout(() => { init() }, 0)
    return () => { cancelled = true }
  }, [requestId, t])

  if (loading) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center text-slate-500 shadow-xl shadow-slate-200/50">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[#1D9E75]" aria-hidden="true" />
        <p className="font-semibold text-slate-800">{t('preparing')}</p>
        <p className="mt-1 text-sm text-slate-500">{t('openingStripe')}</p>
      </div>
    )
  }

  if (error || !clientSecret || !requestId) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <p className="font-semibold text-red-600">{error ?? t('invalidSession')}</p>
        <p className="mt-2 text-sm text-slate-500">{t('tryAgain')}</p>
        <a
          href="/provider/dashboard"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#DDE7EE] px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        >
          {t('backDashboard')}
        </a>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white p-6 text-center shadow-xl shadow-slate-200/70 sm:p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#DCFCE7]">
          <CreditCard className="h-7 w-7 text-[#0F6E56]" aria-hidden="true" />
        </div>
        <p className="text-xs font-bold uppercase tracking-wide text-[#0F6E56]">{t('eyebrow')}</p>
        <h1 className="mb-2 mt-1 text-2xl font-semibold text-slate-950">{t('heading')}</h1>
        <p className="mb-6 text-slate-600">
          {t.rich('payAmount', { fee: fee ?? '', strong: (chunks) => <strong className="text-[#0F6E56]">{chunks}</strong> })}
        </p>
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-start text-sm leading-6 text-amber-800">
          <strong>{t('nextLabel')}</strong> {t('nextDescription')}
        </div>
        <div className="mb-6 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-start text-xs leading-5 text-[#0F6E56]">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('securePayment')}</p>
          </div>
        </div>
        <StripeElementsProvider clientSecret={clientSecret}>
          <PaymentElementForm returnPath="/provider/dashboard?payment=processing" />
        </StripeElementsProvider>
        <a
          href="/provider/dashboard"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DDE7EE] px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
        >
          {t('backDashboard')}
        </a>
      </div>
    </div>
  )
}

function OveragePayFallback() {
  return (
    <>
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[#1D9E75]" aria-hidden="true" />
      <p className="font-semibold text-slate-800">Loading...</p>
    </>
  )
}

export default function OveragePayPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <Suspense fallback={<div className="mx-auto max-w-md rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center text-slate-500 shadow-sm"><OveragePayFallback /></div>}>
          <OveragePayContent />
        </Suspense>
      </main>
    </>
  )
}
