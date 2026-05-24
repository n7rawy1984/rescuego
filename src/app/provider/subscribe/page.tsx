import { redirect } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import { createClient } from '@/lib/supabase/server'
import SubscribePlans from './SubscribePlans'
import type { ProviderPlan, UserRole } from '@/types'

type SubscribePageProps = {
  searchParams?: Promise<{
    plan?: string | string[]
  }>
}

function parseSelectedPlan(plan: string | string[] | undefined): ProviderPlan | null {
  const value = Array.isArray(plan) ? plan[0] : plan
  if (value === 'starter' || value === 'pro' || value === 'business') return value
  return null
}

export default async function SubscribePage({ searchParams }: SubscribePageProps) {
  const params = await searchParams
  const selectedPlan = parseSelectedPlan(params?.plan)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login?redirect=/provider/subscribe')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: UserRole | null }>()

  if (profile?.role === 'admin') {
    redirect('/admin/dashboard')
  }

  if (profile?.role === 'customer') {
    redirect('/customer/request')
  }

  if (profile?.role !== 'provider') {
    redirect('/provider/register')
  }

  const { data: provider } = await supabase
    .from('providers')
    .select('status, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle<{ status: string | null; stripe_subscription_id: string | null }>()

  if (provider?.stripe_subscription_id) {
    redirect('/provider/dashboard')
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 max-w-2xl">
            <h1 className="text-2xl font-bold text-slate-900">Choose your subscription plan</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Upgrade from Pay Per Job to get monthly job allowance, better priority, and lower commissions.
            </p>
          </div>
          <SubscribePlans providerId={user.id} selectedPlan={selectedPlan} />
        </div>
      </main>
    </>
  )
}
