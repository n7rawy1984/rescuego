import Link from 'next/link'
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { getProviderOnboardingState, providerDocumentLabel } from '@/lib/provider-onboarding'
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
  const onboarding = getProviderOnboardingState({ name, email, phone, plan, status, documents })
  const missingDocumentLabels = onboarding.missingDocuments.map(providerDocumentLabel)

  const items: ChecklistItem[] = [
    {
      label: 'Complete provider profile',
      description: 'Add your name, email, and phone number so RescueGo can review your account.',
      complete: onboarding.profileComplete,
      actionHref: '/provider/register?step=profile',
      actionLabel: 'Continue setup',
    },
    {
      label: 'Upload required documents',
      description: missingDocumentLabels.length > 0
        ? `Missing: ${missingDocumentLabels.join(', ')}.`
        : 'Emirates ID, UAE driving license, and vehicle photo are ready for review.',
      complete: onboarding.documentsComplete,
      actionHref: '/provider/register?step=documents',
      actionLabel: 'Upload documents',
    },
    {
      label: 'Choose access plan',
      description: 'Use Pay Per Job or a subscription plan before taking requests.',
      complete: onboarding.planComplete,
      actionHref: '/provider/register?step=plan',
      actionLabel: 'Choose access plan',
    },
    {
      label: 'Admin approval',
      description: status === 'suspended'
        ? 'Your provider account is suspended. Contact support to resolve your account status.'
        : 'Your documents are under review. RescueGo will activate your account after verification.',
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
              <p className="font-semibold text-green-900">Provider account ready</p>
              <p className="mt-1 text-sm text-green-700">
                Your onboarding is complete. Keep your documents current to maintain trust with customers.
              </p>
            </div>
          </div>
          {verifiedBadge ? <Badge variant="success">Trusted Recovery Partner</Badge> : null}
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
                ? 'Provider account suspended'
                : onboarding.pendingApproval
                  ? 'Your documents are under review'
                  : 'Provider onboarding'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {status === 'suspended'
                ? 'Contact support before accepting requests or going online.'
                : onboarding.pendingApproval
                ? 'RescueGo will activate your account after verification. You cannot go online until approval is complete.'
                : 'Complete the next step before your account is ready to receive requests.'}
            </p>
          </div>
          <Badge variant={status === 'active' ? 'success' : 'warning'} className="w-fit">
            {completedCount}/{items.length} complete
          </Badge>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Setup progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {completedCount > 0 && !onboarding.pendingApproval ? (
          <p className="mb-4 text-xs font-medium text-slate-500">
            {completedCount} completed step{completedCount === 1 ? '' : 's'} hidden to keep your next actions clear.
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
                      className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 sm:w-auto"
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
            <p>You are marked as a Trusted Recovery Partner in admin review.</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Verified providers typically build more customer confidence once admin review is complete.
          </p>
        )}
      </CardBody>
    </Card>
  )
}
