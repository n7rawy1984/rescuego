'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { ShieldCheck } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { name: form.name, phone: form.phone } },
      })
      if (authError || !data.user) {
        setError(authError?.message ?? 'Registration failed')
        setLoading(false)
        return
      }
      const profileRes = await fetch('/api/customers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
        }),
      })
      const profile = await profileRes.json().catch(() => null) as { id?: string; error?: string } | null

      if (profileRes.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        return
      }

      if (!profileRes.ok || !profile?.id) {
        setError(profile?.error ?? 'Account created, but profile setup failed. Please sign in and try again.')
        setLoading(false)
        return
      }

      router.push('/customer/request')
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="mb-6 inline-flex items-center gap-2" aria-label="RescueGo home">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D9E75]" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Create account</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Free for drivers. No credit card needed.</p>
        </div>
        <div className="rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="mb-5 rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-sm text-[#0F6E56]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>Your contact details are shared with an assigned provider only when you request help.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="name" label="Full Name" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Ahmed Al Rashid" />
            <Input id="phone" type="tel" label="Phone Number" value={form.phone} onChange={e => update('phone', e.target.value)} required placeholder="+971 50 000 0000" />
            <Input id="email" type="email" label="Email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@example.com" />
            <Input id="password" type="password" label="Password" value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Min 8 characters" minLength={8} />
            <p className="-mt-2 text-xs text-slate-500">Use at least 8 characters. A longer password with a mix of words and numbers is stronger.</p>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
            <Button type="submit" loading={loading} size="lg" className="mt-2 min-h-12 w-full">
              {loading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account? <Link href="/auth/login" className="text-[#1D9E75] font-semibold hover:underline">Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
