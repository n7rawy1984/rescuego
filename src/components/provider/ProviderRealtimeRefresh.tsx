'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Props = {
  providerId: string
  activeRequestId: string | null
}

const DEBOUNCE_MS = 3000

export default function ProviderRealtimeRefresh({ providerId, activeRequestId }: Props) {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleRefresh() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      router.refresh()
    }, DEBOUNCE_MS)
  }

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
        () => { scheduleRefresh() }
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
  }, [providerId])

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
          const updated = payload.new as { status?: string }
          if (!updated.status) return
          scheduleRefresh()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(activeJobChannel)
    }
  }, [activeRequestId])

  return null
}
