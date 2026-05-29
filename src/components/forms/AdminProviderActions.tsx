'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import type { ProviderStatus } from '@/types'

interface Props {
  providerId: string
  currentStatus: ProviderStatus
  verifiedBadge: boolean
}

export default function AdminProviderActions({ providerId, currentStatus, verifiedBadge }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<{
    payload: { status?: ProviderStatus; verified_badge?: boolean }
    label: string
  } | null>(null)

  function openConfirmation(payload: { status?: ProviderStatus; verified_badge?: boolean }) {
    if (loading) return
    const actionLabel = payload.status === 'active'
      ? currentStatus === 'suspended' ? 'reactivate this provider' : 'activate this provider'
      : payload.status === 'suspended'
        ? 'suspend this provider'
        : payload.verified_badge === false
          ? 'remove this provider verification badge'
          : payload.verified_badge === true
            ? 'mark this provider as verified'
            : 'update this provider'

    setPendingAction({ payload, label: actionLabel })
  }

  async function updateProvider() {
    if (loading || !pendingAction) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/providers/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: providerId, ...pendingAction.payload }),
      })

      if (!res.ok) {
        const result = await res.json().catch(() => null) as { error?: string } | null
        setError(result?.error ?? 'Failed to update provider')
        setLoading(false)
        return
      }

      router.refresh()
      setLoading(false)
      setPendingAction(null)
    } catch {
      setError('Network connection lost. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {currentStatus !== 'active' && (
          <Button size="sm" variant="primary" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'active' })}>
            Activate
          </Button>
        )}
        {currentStatus !== 'suspended' && (
          <Button size="sm" variant="destructive" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'suspended' })}>
            Suspend
          </Button>
        )}
        <Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => openConfirmation({ verified_badge: !verifiedBadge })}>
          {verifiedBadge ? 'Remove verified badge' : 'Mark verified'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby={`admin-action-${providerId}`}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id={`admin-action-${providerId}`} className="text-lg font-bold text-slate-900">Confirm provider action</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Are you sure you want to {pendingAction.label}? This updates the provider account immediately.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={updateProvider}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
