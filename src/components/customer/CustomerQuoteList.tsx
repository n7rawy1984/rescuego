'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Clock, ShieldCheck, Star } from 'lucide-react'
import Button from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

type Quote = {
  id: string
  proposed_price: number
  expires_at: string
  provider_anonymous_id: string
  provider_rating: number
  provider_verified: boolean
  distance_km: number
  score: number
  sent_at: string
}

type QuotesResponse = {
  data: Quote[]
  count: number
  price_range: { min: number; max: number }
  quoted_at: string | null
}

interface Props {
  requestId: string
}

export default function CustomerQuoteList({ requestId }: Props) {
  const t = useTranslations('components.customerQuoteList')
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [priceRange, setPriceRange] = useState<{ min: number; max: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Migration 057: quotes that failed selection with `overage_required`.
  // Option A (approved design) leaves the quote row pending in the DB --
  // select_quote_atomic remains the sole enforcement backstop -- so the
  // quotes API keeps returning it on refetch. Hidden client-side for the
  // lifetime of this mounted view.
  const [unavailableQuoteIds, setUnavailableQuoteIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(tick)
  }, [])
  const fetchInFlightRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyQuotesResult = useCallback((result: QuotesResponse) => {
    setQuotes(result.data ?? [])
    setPriceRange(result.price_range ?? null)
    setLoading(false)
  }, [])

  const fetchQuotes = useCallback(async () => {
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    try {
      const res = await fetch(`/api/requests/quotes?request_id=${requestId}`)
      if (!res.ok) return
      const result = (await res.json()) as QuotesResponse
      applyQuotesResult(result)
    } catch {
      /* silent retry on next poll */
    } finally {
      fetchInFlightRef.current = false
    }
  }, [requestId, applyQuotesResult])

  const debouncedFetchQuotes = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchQuotes()
    }, 1000)
  }, [fetchQuotes])

  useEffect(() => {
    void fetchQuotes()
    const interval = setInterval(() => { void fetchQuotes() }, 30000)
    return () => {
      clearInterval(interval)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchQuotes])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`customer-quotes:${requestId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'request_quotes',
        filter: `request_id=eq.${requestId}`,
      }, () => { debouncedFetchQuotes() })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'request_quotes',
        filter: `request_id=eq.${requestId}`,
      }, () => { debouncedFetchQuotes() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [requestId, debouncedFetchQuotes])

  useEffect(() => {
    if (quotes.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setQuotes((prev) => prev.filter((q) => new Date(q.expires_at).getTime() > now))
    }, 5000)
    return () => clearInterval(timer)
  }, [quotes.length])

  async function handleSelect(quoteId: string) {
    setSelecting(quoteId)
    setError('')

    try {
      const res = await fetch('/api/customer/quote/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, quote_id: quoteId }),
      })
      const result = await res.json()

      if (!res.ok) {
        if (result.code === 'overage_required') {
          setUnavailableQuoteIds((prev) => new Set(prev).add(quoteId))
          setError(t('providerNoLongerAvailable'))
          setSelecting(null)
          void fetchQuotes()
          return
        }
        setError(result.error ?? t('selectFailed'))
        setSelecting(null)
        return
      }

      router.refresh()
    } catch {
      setError(t('networkError'))
      setSelecting(null)
    }
  }

  const visibleQuotes = quotes.filter((q) => !unavailableQuoteIds.has(q.id))

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="h-4 w-1/3 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    )
  }

  if (visibleQuotes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center">
        <Clock className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-600">{t('waitingForQuotes')}</p>
        <p className="mt-1 text-xs text-slate-400">{t('quotesWillAppear')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{t('availableQuotes', { count: visibleQuotes.length })}</h3>
        {priceRange && (
          <span className="text-xs text-slate-400">
            {t('fairRange', { min: priceRange.min.toFixed(0), max: priceRange.max.toFixed(0) })}
          </span>
        )}
      </div>

      {visibleQuotes.map((quote) => {
        const expiresMs = new Date(quote.expires_at).getTime() - nowMs
        const expiresMins = Math.max(0, Math.ceil(expiresMs / 60000))

        return (
          <div
            key={quote.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E1F5EE] text-xs font-bold text-[#0F6E56]">
                  {quote.provider_anonymous_id}
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-700">{quote.provider_rating.toFixed(1)}</span>
                    {quote.provider_verified && (
                      <ShieldCheck className="h-3.5 w-3.5 text-[#1D9E75]" aria-label={t('verified')} />
                    )}
                  </div>
                  <span className="text-xs text-slate-400">{quote.distance_km.toFixed(1)} km</span>
                </div>
              </div>

              <div className="text-end">
                <p className="text-lg font-bold text-slate-900">{quote.proposed_price.toFixed(0)} <span className="text-xs font-normal text-slate-400">AED</span></p>
                <p className="text-xs text-slate-400">
                  <Clock className="inline h-3 w-3" aria-hidden="true" /> {t('expiresIn', { minutes: expiresMins })}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <Button
                size="sm"
                className="w-full bg-[#1D9E75] text-white shadow-sm hover:bg-[#0F6E56]"
                loading={selecting === quote.id}
                disabled={selecting !== null}
                onClick={() => handleSelect(quote.id)}
              >
                {t('selectProvider')}
              </Button>
            </div>
          </div>
        )
      })}

      {error && <p className="text-center text-sm text-red-500">{error}</p>}
    </div>
  )
}
