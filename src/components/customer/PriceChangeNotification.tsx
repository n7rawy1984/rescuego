'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertCircle, ArrowRight } from 'lucide-react'
import Button from '@/components/ui/Button'

interface Props {
  requestId: string
  currentPrice: number
  newPrice: number
}

export default function PriceChangeNotification({ requestId, currentPrice, newPrice }: Props) {
  const t = useTranslations('components.priceChangeNotification')
  const router = useRouter()
  const [responding, setResponding] = useState(false)
  const [error, setError] = useState('')

  async function handleRespond(action: 'approve' | 'reject') {
    setResponding(true)
    setError('')

    try {
      const res = await fetch('/api/customer/price-change/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action }),
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result.error ?? t('respondFailed'))
        setResponding(false)
        return
      }

      router.refresh()
    } catch {
      setError(t('networkError'))
      setResponding(false)
    }
  }

  const priceDiff = newPrice - currentPrice
  const isIncrease = priceDiff > 0

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-amber-800">{t('title')}</h4>
          <p className="mt-1 text-xs text-amber-700">{t('description')}</p>

          <div className="mt-3 flex items-center gap-4 rounded-lg bg-white p-3 ring-1 ring-amber-100">
            <div className="text-center">
              <p className="text-xs text-slate-400">{t('currentPrice')}</p>
              <p className="text-sm font-medium text-slate-600">{currentPrice} AED</p>
            </div>
            <ArrowRight className="h-5 w-5 text-amber-500 rtl:rotate-180" aria-hidden="true" />
            <div className="text-center">
              <p className="text-xs text-slate-400">{t('newPrice')}</p>
              <p className={`text-sm font-bold ${isIncrease ? 'text-red-600' : 'text-green-600'}`}>
                {newPrice} AED
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-400">{t('difference')}</p>
              <p className={`text-xs font-medium ${isIncrease ? 'text-red-500' : 'text-green-500'}`}>
                {isIncrease ? '+' : ''}{priceDiff} AED
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-[#1D9E75] text-white hover:bg-[#0F6E56]"
              loading={responding}
              onClick={() => handleRespond('approve')}
            >
              {t('approve')}
            </Button>
            <Button
              size="sm"
              className="flex-1 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              loading={responding}
              onClick={() => handleRespond('reject')}
            >
              {t('reject')}
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
