import Link from 'next/link'
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { ProviderPlan, ProviderStatus } from '@/types'

type ProviderDocuments = {
  emirates_id_url?: string
  license_url?: string
  vehicle_photo_url?: string
} | null

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
  const hasRequiredDocuments = Boolean(
    documents?.emirates_id_url &&
    documents?.license_url &&
    documents?.vehicle_photo_url
  )

  const items: ChecklistItem[] = [
    {
      label: 'Complete provider profile',
      description: 'Name and email are saved on your provider account.',
      complete: Boolean(name && email),
    },
    {
      label: 'Add phone number',
      description: 'Customers and admins need a reliable contact number.',
      complete: Boolean(phone),
    },
    {
      label: 'Upload required documents',
      description: 'Emirates ID, UAE driving license, and vehicle photo are required for review.',
      complete: hasRequiredDocuments,
      actionHref: '/provider/register',
      actionLabel: 'Upload documents',
    },
    {
      label: 'Choose access plan',
      description: 'Use Pay Per Job or a subscription plan before taking requests.',
      complete: Boolean(plan),
      actionHref: '/provider/subscribe',
      actionLabel: 'Choose plan',
    },
    {
      label: 'Admin approval',
      description: 'RescueGo reviews accounts before providers can accept jobs.',
      complete: status === 'active',
    },
  ]

  const completedCount = items.filter((item) => item.complete).length
  const incompleteItems = items.filter((item) => !item.complete)
  const progressPct = Math.round((completedCount / items.length) * 100)

  if (status === 'active' && incompleteItems.length === 0) {
    return (
      <Card className="mb-6 border-green-200 bg-green-50">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
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
    <Card className="mb-6">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Provider onboarding</h2>
            <p className="mt-1 text-sm text-slate-500">
              Complete these steps before your account is fully ready to receive requests.
            </p>
          </div>
          <Badge variant={status === 'active' ? 'success' : 'warning'}>
            {completedCount}/{items.length} complete
          </Badge>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${progressPct}%` }} />
        </div>
      </CardHeader>
      <CardBody>
        {completedCount > 0 ? (
          <p className="mb-4 text-xs font-medium text-slate-500">
            {completedCount} completed step{completedCount === 1 ? '' : 's'} hidden to keep your next actions clear.
          </p>
        ) : null}

        <div className="space-y-3">
          {incompleteItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{item.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{item.description}</p>
                  {item.actionHref && item.actionLabel ? (
                    <Link href={item.actionHref} className="mt-3 inline-flex text-sm font-semibold text-orange-600 hover:underline">
                      {item.actionLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

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
