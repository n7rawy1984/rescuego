import { redirect } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import RatingForm from '@/components/forms/RatingForm'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { getProblemLabel } from '@/lib/utils'
import type { Metadata } from 'next'
import type { ProblemType } from '@/types'

export const metadata: Metadata = {
  title: 'Rate Completed Jobs',
  robots: { index: false, follow: false },
}

type CompletedJobRow = {
  id: string
  provider_id: string
  completed_at: string | null
  requests: {
    customer_id: string | null
    problem_type: ProblemType | null
    location_address: string | null
    final_price: number | null
  } | null
  providers: {
    users: {
      name: string | null
    } | null
  } | null
}

export default async function CustomerRatingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/customer/ratings')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'customer') redirect('/')

  const admin = createAdminClient()
  const { data: completedJobs } = await admin
    .from('jobs')
    .select('id, provider_id, completed_at, requests!inner(customer_id, problem_type, location_address, final_price), providers(users(name))')
    .eq('requests.customer_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .returns<CompletedJobRow[]>()

  const jobIds = (completedJobs ?? []).map((job) => job.id)
  const { data: ratings } = jobIds.length
    ? await admin.from('ratings').select('job_id').in('job_id', jobIds)
    : { data: [] }

  const ratedJobIds = new Set((ratings ?? []).map((rating) => rating.job_id))
  const unratedJobs = (completedJobs ?? []).filter((job) => !ratedJobIds.has(job.id))

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Rate Completed Jobs</h1>
            <p className="mt-1 text-slate-500">Ratings are required after every completed RescueGo job.</p>
          </div>

          {unratedJobs.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-center text-slate-500">No completed jobs are waiting for a rating.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="flex flex-col gap-6">
              {unratedJobs.map((job) => (
                <Card key={job.id}>
                  <CardHeader>
                    <div className="flex flex-col gap-1">
                      <h2 className="font-semibold text-slate-800">
                        {job.requests?.problem_type ? getProblemLabel(job.requests.problem_type) : 'Completed service'}
                      </h2>
                      <p className="text-sm text-slate-500">
                        Provider: {job.providers?.users?.name ?? 'Recovery provider'}
                      </p>
                      <p className="text-sm text-slate-500">
                        {job.requests?.location_address ?? 'Location unavailable'} {job.requests?.final_price ? `- ${job.requests.final_price} AED` : ''}
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <RatingForm jobId={job.id} providerId={job.provider_id} />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
