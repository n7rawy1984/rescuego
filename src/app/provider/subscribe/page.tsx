import { redirect } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import { createClient } from '@/lib/supabase/server'
import SubscribePlans from './SubscribePlans'
import type { ProviderPlan, UserRole } from '@/types'

type SubscribePageProps = {
  searchParams?: Promise<{
    plan?: string | string[]
    portal_return?: string | string[]
    updated?: string | string[]
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
  const returnedFromBillingPortal = Boolean(Array.isArray(params?.portal_return) ? params?.portal_return[0] : params?.portal_return)
  const planWasAlreadyCurrent = Boolean(Array.isArray(params?.updated) ? params?.updated[0] : params?.updated)
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
    .select('plan, status, stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle<{ plan: ProviderPlan | null; status: string | null; stripe_subscription_id: string | null }>()

  const currentPlan = provider?.stripe_subscription_id ? provider.plan ?? null : null

  if (selectedPlan && currentPlan === selectedPlan) {
    redirect('/provider/subscribe?updated=1')
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-8 overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0F6E56]">Subscription upgrade</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Choose your subscription plan</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                  Upgrade from Pay Per Job to get monthly job allowance, better priority, and lower premium commissions.
                </p>
              </div>
              <div className="rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] px-4 py-3 text-sm font-semibold text-[#0F6E56]">
                Secure checkout by Stripe
              </div>
            </div>
          </div>
          <SubscribePlans
            providerId={user.id}
            selectedPlan={selectedPlan}
            currentPlan={currentPlan}
            hasSubscription={Boolean(provider?.stripe_subscription_id)}
            returnedFromBillingPortal={returnedFromBillingPortal}
            planWasAlreadyCurrent={planWasAlreadyCurrent}
          />
        </div>
      </main>
    </>
  )
}
