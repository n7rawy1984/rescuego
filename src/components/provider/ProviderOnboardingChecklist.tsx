import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { getProviderOnboardingState } from '@/lib/provider-onboarding'
import type { ProviderDocuments } from '@/lib/provider-onboarding'
import type { ProviderPlan, ProviderStatus } from '@/types'

type ProviderOnboardingChecklistProps = {
  name: string | null
  email: string | null
  phone: string | null
  plan: ProviderPlan | null
  status: ProviderStatus
  verifiedBadge: boolean
  documents: ProviderDocuments
}

type ChecklistItem = {
  label: string
  description: string
  complete: boolean
  actionHref?: string
  actionLabel?: string
}

export default function ProviderOnboardingChecklist({
  name,
  email,
  phone,
  plan,
  status,
  verifiedBadge,
  documents,
}: ProviderOnboardingChecklistProps) {
  const t = useTranslations('components.providerOnboarding')
  const onboarding = getProviderOnboardingState({ name, email, phone, plan, status, documents })

  const items: ChecklistItem[] = [
    {
      label: t('completeProfileLabel'),
      description: t('completeProfileDescription'),
      complete: onboarding.profileComplete,
      actionHref: '/provider/register?step=profile',
      actionLabel: t('continueSetup'),
    },
    {
      label: t('uploadDocumentsLabel'),
      description: onboarding.documentsComplete
        ? t('documentsReadyDescription')
        : t('softLaunchDocumentHint'),
      complete: onboarding.documentsComplete,
      actionHref: '/provider/register?step=documents',
      actionLabel: t('uploadDocuments'),
    },
    {
      label: t('chooseAccessPlanLabel'),
      description: t('chooseAccessPlanDescription'),
      complete: onboarding.planComplete,
      actionHref: '/provider/register?step=plan',
      actionLabel: t('chooseAccessPlan'),
    },
    {
      label: t('adminApprovalLabel'),
      description: status === 'suspended'
        ? t('suspendedDescription')
        : status === 'rejected'
          ? t('rejectedDescription')
          : onboarding.underReview
            ? t('underReviewDescription')
            : t('reviewDescription'),
      complete: onboarding.activeReady,
    },
  ]

  const completedCount = items.filter((item) => item.complete).length
  const incompleteItems = items.filter((item) => !item.complete)
  const primaryItem = incompleteItems[0]
  const progressPct = Math.round((completedCount / items.length) * 100)

  if (status === 'active' && incompleteItems.length === 0) {
    return (
      <Card className="mb-6 border-green-200 bg-green-50 shadow-sm shadow-green-100/70">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-green-900">{t('accountReadyTitle')}</p>
              <p className="mt-1 text-sm text-green-700">
                {t('accountReadyDescription')}
              </p>
            </div>
          </div>
          {verifiedBadge ? <Badge variant="success">{t('trustedRecoveryPartner')}</Badge> : null}
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="mb-6 overflow-hidden shadow-sm shadow-slate-200/70">
      <CardHeader className="border-slate-100 bg-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              {status === 'suspended'
                ? t('accountSuspendedTitle')
                : status === 'rejected'
                  ? t('accountRejectedTitle')
                  : onboarding.underReview
                    ? t('documentsUnderReviewTitle')
                    : onboarding.pendingApproval
                      ? t('documentsUnderReviewTitle')
                      : t('providerOnboardingTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {status === 'suspended'
                ? t('contactSupportBeforeAccepting')
                : status === 'rejected'
                  ? t('rejectedContactSupport')
                  : onboarding.underReview || onboarding.pendingApproval
                    ? t('approvalPendingDescription')
                    : t('completeNextStepDescription')}
            </p>
          </div>
          <Badge variant={status === 'active' ? 'success' : 'warning'} className="w-fit">
            {t('completeCount', { completed: completedCount, total: items.length })}
          </Badge>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>{t('setupProgress')}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#1D9E75] transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {completedCount > 0 && !onboarding.pendingApproval ? (
          <p className="mb-4 text-xs font-medium text-slate-500">
            {t('completedStepsHidden', { count: completedCount })}
          </p>
        ) : null}

        {primaryItem ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
                  <Circle className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{primaryItem.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{primaryItem.description}</p>
                  {primaryItem.actionHref && primaryItem.actionLabel ? (
                    <Link
                      href={primaryItem.actionHref}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#1D9E75] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D9E75] focus-visible:ring-offset-2 sm:w-auto"
                    >
                      {primaryItem.actionLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {verifiedBadge ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('trustedMarkedReview')}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            {t('verifiedConfidenceDescription')}
          </p>
        )}
      </CardBody>
    </Card>
  )
}
