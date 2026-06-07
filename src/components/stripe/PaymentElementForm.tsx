'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'

interface PaymentElementFormProps {
  returnPath?: string
  successTitle?: string
  successDetail?: string
}

export default function PaymentElementForm({
  returnPath = '/provider/dashboard',
  successTitle,
  successDetail,
}: PaymentElementFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const t = useTranslations('components.paymentElementForm')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (processing || success) return
    setError('')

    if (!stripe || !elements) {
      setError(t('stripeStillLoading'))
      return
    }

    setProcessing(true)

    const absoluteReturnUrl = `${window.location.origin}${returnPath}`

    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: absoluteReturnUrl,
        },
      })

      if (result.error) {
        setProcessing(false)
        setError(result.error.message ?? t('paymentFailed'))
        return
      }

      setSuccess(true)
      setProcessing(false)
      window.setTimeout(() => {
        router.push(returnPath)
        router.refresh()
      }, 1800)
    } catch {
      setProcessing(false)
      setError(t('networkConnectionLost'))
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center" role="status" aria-live="polite">
        <div className="font-semibold text-green-800">{successTitle ?? t('defaultSuccessTitle')}</div>
        <p className="mt-1 text-xs text-green-700">{successDetail ?? t('defaultSuccessDetail')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="text-start">
      <PaymentElement
        options={{
          paymentMethodOrder: ['card'],
          wallets: {
            link: 'never',
          },
        }}
      />

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-xs font-medium text-slate-600">{t('securePaymentPoweredByStripe')}</p>
        <p className="mt-1 text-xs text-slate-500">
          {t('cardDetailsEncrypted')}
        </p>
      </div>

      <button
        type="submit"
        disabled={!stripe || !elements || processing}
        aria-label={t('confirmSecureStripePayment')}
        className="mt-5 flex h-11 w-full items-center justify-center rounded-lg bg-[#1D9E75] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {processing ? t('processing') : t('paySecurely')}
      </button>
    </form>
  )
}
