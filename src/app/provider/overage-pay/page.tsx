'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreditCard } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import StripeElementsProvider from '@/components/stripe/StripeElementsProvider'
import PaymentElementForm from '@/components/stripe/PaymentElementForm'

function OveragePayContent() {
  const params = useSearchParams()
  const requestId = params.get('request_id')
  const fee = params.get('fee')
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.setTimeout(() => {
      if (cancelled) return

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
        setClientSecret(parsed?.client_secret ?? '')
      } catch {
        setClientSecret('')
      } finally {
        setLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
    }
  }, [requestId])

  if (loading) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-orange-500" aria-hidden="true" />
        <p className="font-semibold text-slate-800">Preparing secure payment...</p>
        <p className="mt-1 text-sm text-slate-500">Opening the Stripe payment form safely.</p>
      </div>
    )
  }

  if (!clientSecret || !requestId) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <p className="font-semibold text-red-600">Invalid or expired payment session.</p>
        <p className="mt-1 text-sm text-slate-500">Please go back to the dashboard and try again.</p>
      </div>
    )
  }

  return (
      <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl shadow-slate-200/70 sm:p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100">
          <CreditCard className="h-7 w-7 text-orange-600" aria-hidden="true" />
        </div>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Monthly capacity overage</p>
        <h1 className="mb-2 mt-1 text-2xl font-bold text-slate-900">Overage Payment</h1>
        <p className="text-slate-600 mb-6">
          Pay <strong className="text-orange-600">{fee} AED</strong> to accept this extra job.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 text-sm text-amber-800 text-left">
          <strong>What happens next:</strong> Once payment is confirmed, the request will be automatically accepted
          and appear as your active job. Exact customer location is shown after assignment.
        </div>
        <p className="mb-6 rounded-2xl bg-slate-50 px-4 py-3 text-left text-xs leading-5 text-slate-500">
          Secure payment powered by Stripe. Your card details are encrypted and never stored by RescueGo.
        </p>
        <StripeElementsProvider clientSecret={clientSecret}>
          <PaymentElementForm returnPath="/provider/dashboard?payment=processing" />
        </StripeElementsProvider>
        <a
          href="/provider/dashboard"
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  )
}

export default function OveragePayPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <Suspense fallback={<div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">Loading secure payment...</div>}>
          <OveragePayContent />
        </Suspense>
      </main>
    </>
  )
}
