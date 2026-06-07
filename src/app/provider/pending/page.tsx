import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getProviderOnboardingState, providerDocumentLabel } from '@/lib/provider-onboarding'
import { getPlanLabel } from '@/lib/utils'
import { CheckCircle2, Clock, AlertCircle, XCircle, FileText, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { ProviderPlan, ProviderStatus } from '@/types'

export const metadata: Metadata = {
  title: 'Application Status — RescueGo',
  robots: { index: false, follow: false },
}

type PendingProviderRow = {
  id: string
  plan: ProviderPlan
  status: ProviderStatus
  verified_badge: boolean
  documents: { emirates_id_url?: string; license_url?: string; vehicle_photo_url?: string } | null
  users: { name: string | null; email: string | null; phone: string | null } | null
}

export default async function ProviderPendingPage() {
  const t = await getTranslations('provider.pending')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: provider } = await admin
    .from('providers')
    .select('id, plan, status, verified_badge, documents, users(name, email, phone)')
    .eq('id', user.id)
    .single<PendingProviderRow>()

  if (!provider) redirect('/provider/register')

  if (provider.status === 'active') redirect('/provider/dashboard')

  const state = getProviderOnboardingState({
    status: provider.status,
    plan: provider.plan,
    documents: provider.documents,
    name: provider.users?.name ?? null,
    email: provider.users?.email ?? null,
    phone: provider.users?.phone ?? null,
  })

  const isSuspended = provider.status === 'suspended'

  const docs = [
    { key: 'emirates_id_url' as const, label: providerDocumentLabel('emirates_id_url') },
    { key: 'license_url' as const, label: providerDocumentLabel('license_url') },
    { key: 'vehicle_photo_url' as const, label: providerDocumentLabel('vehicle_photo_url') },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">

        <div className="mb-8 text-center">
          {isSuspended ? (
            <XCircle className="mx-auto mb-3 h-12 w-12 text-red-500" />
          ) : state.pendingApproval ? (
            <Clock className="mx-auto mb-3 h-12 w-12 text-amber-500" />
          ) : (
            <AlertCircle className="mx-auto mb-3 h-12 w-12 text-blue-500" />
          )}
          <h1 className="text-2xl font-bold text-slate-900">
            {isSuspended ? t('accountSuspended') : state.pendingApproval ? t('applicationUnderReview') : t('completeApplication')}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {isSuspended
              ? t('suspendedDescription')
              : state.pendingApproval
              ? t('reviewDescription')
              : t('completeDescription')}
          </p>
        </div>

        <div className="space-y-4">

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{t('profile')}</span>
                {state.profileComplete
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <AlertCircle className="h-5 w-5 text-amber-500" />}
              </div>
            </CardHeader>
            <CardBody>
              {state.profileComplete ? (
                <div className="space-y-1 text-sm text-slate-600">
                  <p><span className="font-medium">{t('name')}</span> {provider.users?.name ?? '—'}</p>
                  <p><span className="font-medium">{t('email')}</span> {provider.users?.email ?? '—'}</p>
                  <p><span className="font-medium">{t('phone')}</span> {provider.users?.phone ?? '—'}</p>
                </div>
              ) : (
                <Link href="/provider/register" className="text-sm font-medium text-emerald-600 hover:underline">
                  {t('completeProfile')}
                </Link>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{t('documents')}</span>
                {state.documentsComplete
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <AlertCircle className="h-5 w-5 text-amber-500" />}
              </div>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2">
                {docs.map(({ key, label }) => {
                  const uploaded = Boolean(provider.documents?.[key])
                  return (
                    <li key={key} className="flex items-center gap-2 text-sm">
                      {uploaded
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        : <FileText className="h-4 w-4 shrink-0 text-slate-300" />}
                      <span className={uploaded ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
                    </li>
                  )
                })}
              </ul>
              {!state.documentsComplete && (
                <Link href="/provider/register" className="mt-3 block text-sm font-medium text-emerald-600 hover:underline">
                  {t('uploadDocuments')}
                </Link>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{t('plan')}</span>
                {state.planComplete
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <AlertCircle className="h-5 w-5 text-amber-500" />}
              </div>
            </CardHeader>
            <CardBody>
              {state.planComplete ? (
                <p className="text-sm text-slate-600">
                  <span className="font-medium">{t('selectedPlan')}</span> {getPlanLabel(provider.plan)}
                </p>
              ) : (
                <Link href="/provider/register" className="text-sm font-medium text-emerald-600 hover:underline">
                  {t('selectPlan')}
                </Link>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{t('adminApproval')}</span>
                {isSuspended
                  ? <XCircle className="h-5 w-5 text-red-500" />
                  : <Clock className="h-5 w-5 text-amber-400" />}
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-slate-600">
                {isSuspended
                  ? t('suspendedSupport')
                  : state.pendingApproval
                  ? t('submittedReview')
                  : t('submitRequirements')}
              </p>
            </CardBody>
          </Card>

        </div>

        {state.pendingApproval && (
          <div className="mt-8 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-slate-700">{t('whatNext')}</p>
              <p className="mt-1 text-sm text-slate-500">
                {t('whatNextDescription')}
              </p>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
