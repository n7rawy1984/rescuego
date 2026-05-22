import Link from 'next/link'
import { redirect } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

export default async function SubscribePage() {
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

  if (provider?.status === 'active' || provider?.stripe_subscription_id) {
    redirect('/provider/dashboard')
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-24">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Choose your provider plan</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your provider account already exists. Review the available plans and choose the subscription that fits your recovery business.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
            >
              View Pricing
            </Link>
            <Link
              href="/provider/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Provider Dashboard
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
