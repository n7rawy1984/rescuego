'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Button from '@/components/ui/Button'
import type { ProviderStatus } from '@/types'

interface Props {
  providerId: string
  currentStatus: ProviderStatus
  verifiedBadge: boolean
}

export default function AdminProviderActions({ providerId, currentStatus, verifiedBadge }: Props) {
  const router = useRouter()
  const t = useTranslations('components.adminProviderActions')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<{
    payload: { status?: ProviderStatus; verified_badge?: boolean }
    label: string
  } | null>()

  function openConfirmation(payload: { status?: ProviderStatus; verified_badge?: boolean }) {
    if (loading) return
    const actionLabel = payload.status === 'active'
      ? currentStatus === 'suspended' ? t('actionLabels.reactivateProvider') : t('actionLabels.activateProvider')
      : payload.status === 'suspended'
        ? t('actionLabels.suspendProvider')
        : payload.verified_badge === false
          ? t('actionLabels.removeVerificationBadge')
          : payload.verified_badge === true
            ? t('actionLabels.markProviderVerified')
            : t('actionLabels.updateProvider')

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
        setError(result?.error ?? t('errors.updateFailed'))
        setLoading(false)
        return
      }

      router.refresh()
      setLoading(false)
      setPendingAction(null)
    } catch {
      setError(t('errors.connectionLost'))
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {currentStatus !== 'active' && (
          <Button size="sm" variant="primary" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'active' })}>
            {t('activate')}
          </Button>
        )}
        {currentStatus !== 'suspended' && (
          <Button size="sm" variant="destructive" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'suspended' })}>
            {t('suspend')}
          </Button>
        )}
        <Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => openConfirmation({ verified_badge: !verifiedBadge })}>
          {verifiedBadge ? t('removeVerifiedBadge') : t('markVerified')}
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby={`admin-action-${providerId}`}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id={`admin-action-${providerId}`} className="text-lg font-bold text-slate-900">{t('confirmProviderAction')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t('confirmProviderActionDescription', { action: pendingAction.label })}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={updateProvider}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? t('updating') : t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
