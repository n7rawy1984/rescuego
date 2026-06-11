import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import NavbarServer from '@/components/layout/NavbarServer'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import AdminProviderActions from '@/components/forms/AdminProviderActions'
import { getPlanLabel } from '@/lib/utils'
import { hasMinimumDocument } from '@/lib/provider-onboarding'
import type { Metadata } from 'next'
import type { ProviderPlan, ProviderStatus } from '@/types'

export const metadata: Metadata = {
  title: 'Manage Providers - Admin',
  robots: { index: false, follow: false },
}

type AdminProviderRow = {
  id: string
  plan: ProviderPlan
  status: ProviderStatus
  rating: number | null
  jobs_this_month: number | null
  verified_badge: boolean | null
  created_at: string | null
  documents: {
    emirates_id_url?: string
    license_url?: string
    vehicle_photo_url?: string
  } | null
  users: {
    name: string | null
    email: string | null
    phone: string | null
    role: string | null
  } | null
}

type ProviderDocumentLinks = {
  emiratesId?: string
  license?: string
  vehicle?: string
}

type AdminProviderWithLinks = AdminProviderRow & {
  documentLinks: ProviderDocumentLinks
  documentsComplete: boolean
}

type ProviderFilter = 'all' | 'pending' | 'under_review' | 'active' | 'rejected' | 'suspended' | 'missing-documents'

const FILTERS: { id: ProviderFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'filters.all' },
  { id: 'under_review', labelKey: 'filters.underReview' },
  { id: 'pending', labelKey: 'filters.pending' },
  { id: 'active', labelKey: 'filters.active' },
  { id: 'rejected', labelKey: 'filters.rejected' },
  { id: 'suspended', labelKey: 'filters.suspended' },
  { id: 'missing-documents', labelKey: 'filters.missingDocuments' },
]

const REVIEW_STATUSES: ProviderStatus[] = ['pending', 'under_review']

function needsDocumentLinks(status: ProviderStatus, activeFilter: ProviderFilter): boolean {
  if (activeFilter !== 'all') return true
  return REVIEW_STATUSES.includes(status)
}

async function createDocumentLinks(provider: AdminProviderRow): Promise<ProviderDocumentLinks> {
  const admin = createAdminClient()
  const entries = [
    ['emiratesId', provider.documents?.emirates_id_url],
    ['license', provider.documents?.license_url],
    ['vehicle', provider.documents?.vehicle_photo_url],
  ] as const

  const links: ProviderDocumentLinks = {}

  await Promise.all(entries.map(async ([key, path]) => {
    if (!path) return

    const { data } = await admin.storage
      .from('provider-documents')
      .createSignedUrl(path, 60 * 10)

    if (data?.signedUrl) links[key] = data.signedUrl
  }))

  return links
}

function statusBadgeVariant(status: ProviderStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success'
  if (status === 'suspended' || status === 'rejected') return 'danger'
  if (status === 'under_review') return 'info'
  return 'warning'
}

const DOCUMENT_SLOTS = [
  { key: 'emiratesId' as const, labelKey: 'documents.emiratesId' },
  { key: 'license' as const, labelKey: 'documents.uaeDrivingLicense' },
  { key: 'vehicle' as const, labelKey: 'documents.vehiclePhoto' },
]

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>
}) {
  const t = await getTranslations('admin.providers')
  const params = await searchParams
  const activeFilter = FILTERS.some((filter) => filter.id === params?.filter)
    ? params?.filter as ProviderFilter
    : 'all'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (userData?.role !== 'admin') redirect('/')

  const { data: providers } = await supabase
    .from('providers')
    .select('id, plan, status, rating, jobs_this_month, verified_badge, created_at, documents, users(name, email, phone, role)')
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<AdminProviderRow[]>()

  const legitimateProviders = (providers ?? []).filter((provider) => provider.users?.role === 'provider')
  const invalidProviderRows = (providers ?? []).filter((provider) => provider.users?.role !== 'provider')

  const providersWithDocumentState = legitimateProviders.map((provider) => ({
    ...provider,
    documentsComplete: hasMinimumDocument(provider.documents),
  }))

  const filteredProviderRows = providersWithDocumentState.filter((provider) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'missing-documents') return !provider.documentsComplete
    return provider.status === activeFilter
  })

  const filterCounts: Record<ProviderFilter, number> = {
    all: providersWithDocumentState.length,
    pending: providersWithDocumentState.filter((p) => p.status === 'pending').length,
    under_review: providersWithDocumentState.filter((p) => p.status === 'under_review').length,
    active: providersWithDocumentState.filter((p) => p.status === 'active').length,
    rejected: providersWithDocumentState.filter((p) => p.status === 'rejected').length,
    suspended: providersWithDocumentState.filter((p) => p.status === 'suspended').length,
    'missing-documents': providersWithDocumentState.filter((p) => !p.documentsComplete).length,
  }

  const filteredProviders: AdminProviderWithLinks[] = await Promise.all(
    filteredProviderRows.map(async (provider) => ({
      ...provider,
      documentLinks: needsDocumentLinks(provider.status, activeFilter)
        ? await createDocumentLinks(provider)
        : {},
    }))
  )

  return (
    <>
      <NavbarServer />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{t('eyebrow')}</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">{t('title')}</h1>
                <p className="mt-1 text-sm text-slate-500">{t('description')}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="/admin/dashboard" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">{t('dashboard')}</a>
                <a href="/admin/requests" className="inline-flex min-h-10 items-center rounded-lg bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0F6E56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]">{t('requests')}</a>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="bg-white">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-semibold text-slate-900">{t('providersCount', { count: filteredProviders.length })}</h2>
                  <p className="text-sm text-slate-500">{t('legitimateProviderAccounts', { count: providersWithDocumentState.length })}</p>
                </div>
                {invalidProviderRows.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">{t('dataIntegrityWarning')}</p>
                    <p className="mt-1">
                      {t('invalidProviderRowsWarning', { count: invalidProviderRows.length })}
                    </p>
                  </div>
                )}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {FILTERS.map((filter) => (
                    <a
                      key={filter.id}
                      href={filter.id === 'all' ? '/admin/providers' : `/admin/providers?filter=${filter.id}`}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        activeFilter === filter.id
                          ? 'bg-[#1D9E75] text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]`}
                    >
                      {t(filter.labelKey)}
                      {filterCounts[filter.id] > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeFilter === filter.id ? 'bg-white/25 text-white' : 'bg-slate-300 text-slate-700'}`}>
                          {filterCounts[filter.id]}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['provider', 'contact', 'plan', 'status', 'jobs', 'created', 'documents', 'trust', 'actions'].map((h) => (
                        <th key={h} className="px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide text-slate-500">{t(`table.${h}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProviders.map((provider) => (
                      <tr key={provider.id} className="align-top hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-800">{provider.users?.name ?? t('unnamedProvider')}</div>
                          <div className="text-xs text-slate-400">{provider.id.slice(0, 8)}</div>
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          <div className="max-w-56 break-words">{provider.users?.email ?? t('dash')}</div>
                          <div className="text-xs text-slate-400">{provider.users?.phone ?? t('noPhone')}</div>
                        </td>
                        <td className="px-5 py-4"><Badge variant="info">{getPlanLabel(provider.plan)}</Badge></td>
                        <td className="px-5 py-4">
                          <Badge variant={statusBadgeVariant(provider.status)}>
                            {t(`statusLabel.${provider.status}`)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-slate-700">{provider.jobs_this_month ?? 0}</td>
                        <td className="px-5 py-4 text-slate-500">
                          {provider.created_at ? new Date(provider.created_at).toLocaleDateString('en-AE') : t('dash')}
                        </td>
                        <td className="px-5 py-4">
                          <div className="min-w-52 space-y-1.5">
                            <Badge variant={provider.documentsComplete ? 'success' : 'warning'}>
                              {provider.documentsComplete ? t('documentsComplete') : t('missingDocuments')}
                            </Badge>
                            <div className="flex flex-col gap-1 pt-1">
                              {DOCUMENT_SLOTS.map(({ key, labelKey }) => {
                                const url = provider.documentLinks[key]
                                const label = t(labelKey)
                                return url ? (
                                  <a
                                    key={key}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D9E75] hover:underline"
                                  >
                                    <span aria-hidden="true">&#10003;</span>
                                    {t('viewDocument', { document: label })}
                                  </a>
                                ) : (
                                  <span key={key} className="text-xs text-slate-400">
                                    <span aria-hidden="true">&#8212;</span>
                                    {' '}{label}
                                    {': '}{t('notUploaded')}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {provider.verified_badge ? (
                            <Badge variant="success">{t('verifiedProvider')}</Badge>
                          ) : (
                            <Badge>{t('notVerified')}</Badge>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <AdminProviderActions providerId={provider.id} currentStatus={provider.status} verifiedBadge={Boolean(provider.verified_badge)} />
                        </td>
                      </tr>
                    ))}
                    {filteredProviders.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-5 py-14 text-center">
                          <p className="font-semibold text-slate-700">{t('noProvidersTitle')}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {t('noProvidersDescription')}
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  )
}
