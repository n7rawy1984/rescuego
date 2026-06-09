'use client'
import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'

type Props = {
  providerId: string
  activeRequestId: string | null
}

const DEBOUNCE_MS = 800

export default function ProviderRealtimeRefresh({ providerId, activeRequestId }: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const t = useTranslations('components.providerRealtime')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      router.refresh()
    }, DEBOUNCE_MS)
  }, [router])

  useEffect(() => {
    const supabase = createClient()

    const openRequestsChannel = supabase
      .channel(`provider-open-requests:${providerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'requests',
          filter: `status=eq.open`,
        },
        () => {
          showToast(t('newRequestNearby'), 'info')
          scheduleRefresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'requests',
          filter: `status=eq.open`,
        },
        () => { scheduleRefresh() }
      )
      .subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      void supabase.removeChannel(openRequestsChannel)
    }
  }, [providerId, scheduleRefresh, showToast, t])

  useEffect(() => {
    const supabase = createClient()

    const quotesChannel = supabase
      .channel(`provider-quotes:${providerId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'request_quotes',
          filter: `provider_id=eq.${providerId}`,
        },
        (payload) => {
          const updated = payload.new as { status?: string }
          if (updated.status === 'selected') {
            showToast(t('quoteSelected'), 'success')
            scheduleRefresh()
          } else if (updated.status === 'rejected') {
            showToast(t('quoteRejected'), 'warning')
            scheduleRefresh()
          } else if (updated.status === 'expired') {
            scheduleRefresh()
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(quotesChannel)
    }
  }, [providerId, scheduleRefresh, showToast, t])

  useEffect(() => {
    if (!activeRequestId) return

    const supabase = createClient()

    const activeJobChannel = supabase
      .channel(`provider-active-job:${activeRequestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'requests',
          filter: `id=eq.${activeRequestId}`,
        },
        (payload) => {
          const updated = payload.new as { status?: string; price_change_status?: string }
          if (!updated.status) return
          if (updated.price_change_status === 'approved') {
            showToast(t('priceChangeApproved'), 'success')
          } else if (updated.price_change_status === 'rejected') {
            showToast(t('priceChangeRejected'), 'warning')
          }
          scheduleRefresh()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(activeJobChannel)
    }
  }, [activeRequestId, scheduleRefresh, showToast, t])

  return null
}
