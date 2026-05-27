'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'

export default function PaymentElementForm() {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (processing || success) return
    setError('')

    if (!stripe || !elements) {
      setError('Stripe is still loading. Please try again in a moment.')
      return
    }

    setProcessing(true)

    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}/provider/dashboard`,
        },
      })

      if (result.error) {
        setProcessing(false)
        setError(result.error.message ?? 'Payment failed. Please check your card and try again.')
        return
      }

      setSuccess(true)
      setProcessing(false)
      window.setTimeout(() => {
        router.push('/provider/dashboard')
        router.refresh()
      }, 1800)
    } catch {
      setProcessing(false)
      setError('Network connection lost. Please try again.')
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center" role="status" aria-live="polite">
        <div className="font-semibold text-green-800">Payment successful. Your request is being assigned...</div>
        <p className="mt-1 text-xs text-green-700">You will be redirected to your dashboard shortly.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="text-left">
      <PaymentElement />

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">Secure payment powered by Stripe</p>

      <button
        type="submit"
        disabled={!stripe || !elements || processing}
        aria-label="Confirm secure Stripe payment"
        className="mt-5 flex h-11 w-full items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {processing ? 'Processing...' : 'Pay securely'}
      </button>
    </form>
  )
}
