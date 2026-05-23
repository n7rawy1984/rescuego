'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import StripeElementsProvider from '@/components/stripe/StripeElementsProvider'
import PaymentElementForm from '@/components/stripe/PaymentElementForm'

function PpjPayContent() {
  const params = useSearchParams()
  const clientSecret = params.get('client_secret')
  const requestId = params.get('request_id')
  const fee = params.get('fee')

  if (!clientSecret || !requestId) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Invalid payment link. Please go back to the dashboard.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">💳</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Pay Per Job Acceptance Fee</h1>
        <p className="text-slate-600 mb-6">
          Pay <strong className="text-orange-600">{fee} AED</strong> to accept this recovery request.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800 text-left">
          Once payment is confirmed, the request will be automatically assigned to you and appear as your active job.
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

export default function PpjPayPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <Suspense fallback={<div className="text-center py-12 text-slate-500">Loading...</div>}>
          <PpjPayContent />
        </Suspense>
      </main>
    </>
  )
}
