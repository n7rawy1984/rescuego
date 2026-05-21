'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

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
    setLoading(true)
    setError('')
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

    if (!profileRes.ok || !profile?.id) {
      setError(profile?.error ?? 'Account created, but profile setup failed. Please sign in and try again.')
      setLoading(false)
      return
    }

    router.push('/customer/request')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-bold text-2xl text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Create Account</h1>
          <p className="text-slate-500 mt-1">Free for drivers - no credit card needed</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="name" label="Full Name" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Ahmed Al Rashid" />
            <Input id="phone" type="tel" label="Phone Number" value={form.phone} onChange={e => update('phone', e.target.value)} required placeholder="+971 50 000 0000" />
            <Input id="email" type="email" label="Email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@example.com" />
            <Input id="password" type="password" label="Password" value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Min 8 characters" minLength={8} />
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <Button type="submit" loading={loading} size="lg" className="w-full mt-2">Create Account</Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account? <Link href="/auth/login" className="text-orange-500 font-semibold hover:underline">Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
