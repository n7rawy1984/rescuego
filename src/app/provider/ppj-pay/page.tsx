'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreditCard, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import StripeElementsProvider from '@/components/stripe/StripeElementsProvider'
import PaymentElementForm from '@/components/stripe/PaymentElementForm'

function PpjPayContent() {
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
        const raw = window.sessionStorage.getItem(`rescuego:ppj-payment:${requestId}`)
        const parsed = raw ? JSON.parse(raw) as { client_secret?: string } : null
        const cached = parsed?.client_secret ?? ''

        if (cached) {
          if (!cancelled) setClientSecret(cached)
          return
        }

        const res = await fetch('/api/provider/ppj-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: requestId }),
        })
        const data = await res.json()

        if (!cancelled) {
          if (res.ok && data.client_secret) {
            try {
              window.sessionStorage.setItem(
                `rescuego:ppj-payment:${requestId}`,
                JSON.stringify({ client_secret: data.client_secret })
              )
            } catch {}
            setClientSecret(data.client_secret)
          } else if (data.credit_applied) {
            window.location.href = '/provider/dashboard?payment=credit_applied'
          } else {
            setError(data.error ?? 'This payment session is no longer valid.')
          }
        }
      } catch {
        if (!cancelled) setError('Could not load payment session. Please go back and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    window.setTimeout(() => { init() }, 0)
    return () => { cancelled = true }
  }, [requestId])

  if (loading) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center text-slate-500 shadow-xl shadow-slate-200/50">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[#1D9E75]" aria-hidden="true" />
        <p className="font-semibold text-slate-800">Preparing secure payment...</p>
        <p className="mt-1 text-sm text-slate-500">Opening the Stripe payment form safely.</p>
      </div>
    )
  }

  if (error || !clientSecret || !requestId) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <p className="font-semibold text-red-600">{error ?? 'Invalid or expired payment session.'}</p>
        <p className="mt-2 text-sm text-slate-500">Please go back to the dashboard and try again.</p>
        <a
          href="/provider/dashboard"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-[#DDE7EE] px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        >
          Back to Dashboard
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
        <p className="text-xs font-bold uppercase tracking-wide text-[#0F6E56]">Secure assignment payment</p>
        <h1 className="mb-2 mt-1 text-2xl font-semibold text-slate-950">Pay Per Job acceptance fee</h1>
        <p className="mb-6 text-slate-600">
          Pay <strong className="text-[#0F6E56]">{fee} AED</strong> to accept this recovery request.
        </p>
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-start text-sm leading-6 text-amber-800">
          <strong>Assignment protection:</strong> Once payment is confirmed, the request will be assigned to you and appear as your active job.
          Exact customer location is shown only after payment and assignment. If the customer cancels before assignment finishes, a recovery credit will be added automatically.
        </div>
        <div className="mb-6 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-start text-xs leading-5 text-[#0F6E56]">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>Secure payment powered by Stripe. Your card details are encrypted and never stored by RescueGo.</p>
          </div>
        </div>
        <StripeElementsProvider clientSecret={clientSecret}>
          <PaymentElementForm
            returnPath="/provider/dashboard?payment=processing"
            successTitle="Payment confirmed. Assigning your request..."
            successDetail="This payment is protected while assignment finishes."
          />
        </StripeElementsProvider>
        <a
          href="/provider/dashboard"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DDE7EE] px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  )
}

export default function PpjPayPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <Suspense fallback={<div className="mx-auto max-w-md rounded-3xl border border-[#DDE7EE] bg-white p-8 text-center text-slate-500 shadow-sm">Loading secure payment...</div>}>
          <PpjPayContent />
        </Suspense>
      </main>
    </>
  )
}
