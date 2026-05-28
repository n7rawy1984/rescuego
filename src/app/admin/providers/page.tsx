import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import AdminProviderActions from '@/components/forms/AdminProviderActions'
import { getPlanLabel } from '@/lib/utils'
import { missingProviderDocuments, providerDocumentLabel } from '@/lib/provider-onboarding'
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
  } | null
}

type ProviderDocumentLinks = {
  emiratesId?: string
  license?: string
  vehicle?: string
}

type AdminProviderWithLinks = AdminProviderRow & {
  documentLinks: ProviderDocumentLinks
  missingDocumentLabels: string[]
  documentsComplete: boolean
}

type ProviderFilter = 'all' | 'pending' | 'active' | 'suspended' | 'missing-documents'

const FILTERS: { id: ProviderFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'missing-documents', label: 'Missing documents' },
]

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

function statusBadgeVariant(status: ProviderStatus): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success'
  if (status === 'suspended') return 'danger'
  return 'warning'
}

function documentLinkLabel(key: keyof ProviderDocumentLinks): string {
  if (key === 'emiratesId') return 'Emirates ID'
  if (key === 'license') return 'UAE driving license'
  return 'Vehicle photo'
}

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>
}) {
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
    .select('*, users(name, email, phone)')
    .order('created_at', { ascending: false })
    .returns<AdminProviderRow[]>()

  const providersWithLinks: AdminProviderWithLinks[] = await Promise.all(
    (providers ?? []).map(async (provider) => {
      const missingDocumentLabels = missingProviderDocuments(provider.documents).map(providerDocumentLabel)
      return {
        ...provider,
        documentLinks: await createDocumentLinks(provider),
        missingDocumentLabels,
        documentsComplete: missingDocumentLabels.length === 0,
      }
    })
  )

  const filteredProviders = providersWithLinks.filter((provider) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'missing-documents') return !provider.documentsComplete
    return provider.status === activeFilter
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Admin moderation</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Manage Providers</h1>
              <p className="mt-1 text-sm text-slate-500">Review documents, approve providers, and manage trust badges.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="/admin/dashboard" className="text-sm font-semibold text-orange-500 hover:underline">Dashboard</a>
              <a href="/admin/requests" className="text-sm font-semibold text-slate-500 hover:text-orange-500">Requests</a>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="bg-white">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-semibold text-slate-900">Providers ({filteredProviders.length})</h2>
                  <p className="text-sm text-slate-500">{providersWithLinks.length} total provider accounts</p>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {FILTERS.map((filter) => (
                    <a
                      key={filter.id}
                      href={filter.id === 'all' ? '/admin/providers' : `/admin/providers?filter=${filter.id}`}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        activeFilter === filter.id
                          ? 'bg-orange-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {filter.label}
                    </a>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Provider', 'Contact', 'Plan', 'Status', 'Jobs', 'Created', 'Documents', 'Trust', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProviders.map((provider) => (
                      <tr key={provider.id} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="font-medium text-slate-800">{provider.users?.name ?? 'Unnamed provider'}</div>
                          <div className="text-xs text-slate-400">{provider.id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-4 text-slate-600">
                          <div>{provider.users?.email ?? '-'}</div>
                          <div className="text-xs text-slate-400">{provider.users?.phone ?? 'No phone'}</div>
                        </td>
                        <td className="px-4 py-3"><Badge variant="info">{getPlanLabel(provider.plan)}</Badge></td>
                        <td className="px-4 py-3">
                          <Badge variant={statusBadgeVariant(provider.status)} className="capitalize">
                            {provider.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{provider.jobs_this_month ?? 0}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {provider.created_at ? new Date(provider.created_at).toLocaleDateString('en-AE') : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="min-w-48 space-y-2">
                            <Badge variant={provider.documentsComplete ? 'success' : 'warning'}>
                              {provider.documentsComplete ? 'Documents complete' : 'Missing documents'}
                            </Badge>
                            <div className="flex flex-col gap-1">
                              {(['emiratesId', 'license', 'vehicle'] as const).map((key) => (
                                provider.documentLinks[key] ? (
                                  <a key={key} className="text-xs font-semibold text-orange-500 hover:underline" href={provider.documentLinks[key]} target="_blank" rel="noopener noreferrer">
                                    View {documentLinkLabel(key)}
                                  </a>
                                ) : null
                              ))}
                            </div>
                            {provider.missingDocumentLabels.length > 0 && (
                              <p className="text-xs leading-5 text-slate-500">
                                Missing: {provider.missingDocumentLabels.join(', ')}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {provider.verified_badge ? (
                            <Badge variant="success">Verified Provider</Badge>
                          ) : (
                            <Badge>Not verified</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <AdminProviderActions providerId={provider.id} currentStatus={provider.status} verifiedBadge={Boolean(provider.verified_badge)} />
                        </td>
                      </tr>
                    ))}
                    {filteredProviders.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-slate-500">No providers match this filter.</td>
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
