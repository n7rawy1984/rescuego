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
      <div className="text-center py-12 text-slate-500">
        Preparing secure payment...
      </div>
    )
  }

  if (!clientSecret || !requestId) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Invalid or expired payment session. Please go back to the dashboard and try again.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CreditCard className="h-7 w-7 text-orange-600" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Overage Payment</h1>
        <p className="text-slate-600 mb-6">
          Pay <strong className="text-orange-600">{fee} AED</strong> to accept this extra job.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800 text-left">
          <strong>What happens next:</strong> Once payment is confirmed, the request will be automatically accepted and appear as your active job.
        </div>
        <StripeElementsProvider clientSecret={clientSecret}>
          <PaymentElementForm />
        </StripeElementsProvider>
        <a
          href="/provider/dashboard"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
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
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <Suspense fallback={<div className="text-center py-12 text-slate-500">Loading...</div>}>
          <OveragePayContent />
        </Suspense>
      </main>
    </>
  )
}
