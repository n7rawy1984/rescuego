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

type PendingAction = {
  payload: { status?: ProviderStatus; verified_badge?: boolean; review_notes?: string }
  label: string
  requiresNotes?: boolean
}

export default function AdminProviderActions({ providerId, currentStatus, verifiedBadge }: Props) {
  const router = useRouter()
  const t = useTranslations('components.adminProviderActions')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notesError, setNotesError] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  function openConfirmation(payload: PendingAction['payload'], requiresNotes = false) {
    if (loading) return
    setError('')
    setNotesError('')
    setReviewNotes('')

    let label: string
    if (payload.status === 'active') {
      label = currentStatus === 'suspended' ? t('actionLabels.reactivateProvider') : t('actionLabels.activateProvider')
    } else if (payload.status === 'rejected') {
      label = t('actionLabels.rejectProvider')
    } else if (payload.status === 'suspended') {
      label = t('actionLabels.suspendProvider')
    } else if (payload.verified_badge === false) {
      label = t('actionLabels.removeVerificationBadge')
    } else if (payload.verified_badge === true) {
      label = t('actionLabels.markProviderVerified')
    } else {
      label = t('actionLabels.updateProvider')
    }

    setPendingAction({ payload, label, requiresNotes })
  }

  async function executeAction() {
    if (loading || !pendingAction) return

    if (pendingAction.requiresNotes && !reviewNotes.trim()) {
      setNotesError(t('errors.notesRequired'))
      return
    }

    setLoading(true)
    setError('')

    const body: Record<string, unknown> = {
      provider_id: providerId,
      ...pendingAction.payload,
    }

    if (reviewNotes.trim()) {
      body.review_notes = reviewNotes.trim()
    }

    try {
      const res = await fetch('/api/admin/providers/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

        {(currentStatus === 'under_review' || currentStatus === 'pending') && (
          <Button size="sm" variant="primary" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'active' })}>
            {t('approve')}
          </Button>
        )}

        {(currentStatus === 'under_review' || currentStatus === 'pending') && (
          <Button size="sm" variant="destructive" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'rejected' }, true)}>
            {t('reject')}
          </Button>
        )}

        {currentStatus === 'rejected' && (
          <Button size="sm" variant="primary" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'active' })}>
            {t('activate')}
          </Button>
        )}

        {currentStatus === 'active' && (
          <Button size="sm" variant="destructive" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'suspended' }, true)}>
            {t('suspend')}
          </Button>
        )}

        {currentStatus === 'suspended' && (
          <Button size="sm" variant="primary" loading={loading} disabled={loading} onClick={() => openConfirmation({ status: 'active' })}>
            {t('reactivate')}
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
            <h3 id={`admin-action-${providerId}`} className="text-lg font-bold text-slate-900">
              {t('confirmProviderAction')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {t('confirmProviderActionDescription', { action: pendingAction.label })}
            </p>

            <div className="mt-4">
              <label htmlFor={`review-notes-${providerId}`} className="block text-sm font-medium text-slate-700">
                {t('reviewNotes')}
                {pendingAction.requiresNotes && <span className="ms-1 text-red-500" aria-hidden="true">*</span>}
              </label>
              <textarea
                id={`review-notes-${providerId}`}
                value={reviewNotes}
                onChange={(e) => { setReviewNotes(e.target.value); setNotesError('') }}
                placeholder={t('reviewNotesPlaceholder')}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1D9E75] focus:outline-none focus:ring-1 focus:ring-[#1D9E75]"
                aria-describedby={notesError ? `notes-error-${providerId}` : undefined}
                aria-required={pendingAction.requiresNotes}
              />
              {notesError && (
                <p id={`notes-error-${providerId}`} className="mt-1 text-xs text-red-500">{notesError}</p>
              )}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => { setPendingAction(null); setNotesError('') }}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={executeAction}
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
