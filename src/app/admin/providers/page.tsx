import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import AdminProviderActions from '@/components/forms/AdminProviderActions'
import { getPlanLabel } from '@/lib/utils'
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

export default async function AdminProvidersPage() {
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
    (providers ?? []).map(async (provider) => ({
      ...provider,
      documentLinks: await createDocumentLinks(provider),
    }))
  )

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-20 px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Manage Providers</h1>
            <a href="/admin/dashboard" className="text-sm text-orange-500 hover:underline">Back to Dashboard</a>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">All Providers ({providersWithLinks.length})</h2>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Name', 'Email', 'Plan', 'Status', 'Rating', 'Jobs', 'Docs', 'Verified', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {providersWithLinks.map((provider) => (
                      <tr key={provider.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{provider.users?.name ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{provider.users?.email ?? '-'}</td>
                        <td className="px-4 py-3"><Badge variant="info">{getPlanLabel(provider.plan)}</Badge></td>
                        <td className="px-4 py-3">
                          <Badge variant={provider.status === 'active' ? 'success' : provider.status === 'suspended' ? 'danger' : 'warning'}>
                            {provider.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{provider.rating?.toFixed(1) ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{provider.jobs_this_month ?? 0}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {provider.documentLinks.emiratesId && <a className="text-orange-500 hover:underline" href={provider.documentLinks.emiratesId} target="_blank" rel="noopener noreferrer">Emirates ID</a>}
                            {provider.documentLinks.license && <a className="text-orange-500 hover:underline" href={provider.documentLinks.license} target="_blank" rel="noopener noreferrer">License</a>}
                            {provider.documentLinks.vehicle && <a className="text-orange-500 hover:underline" href={provider.documentLinks.vehicle} target="_blank" rel="noopener noreferrer">Vehicle</a>}
                            {!provider.documentLinks.emiratesId && !provider.documentLinks.license && !provider.documentLinks.vehicle && (
                              <span className="text-slate-400">No documents uploaded</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {provider.verified_badge ? (
                            <Badge variant="success">Verified Provider</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">Not verified</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <AdminProviderActions providerId={provider.id} currentStatus={provider.status} verifiedBadge={Boolean(provider.verified_badge)} />
                        </td>
                      </tr>
                    ))}
                    {providersWithLinks.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-slate-500">No providers yet.</td>
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
