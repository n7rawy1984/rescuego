'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError || !data.user) {
        setError(authError?.message ?? 'Login failed')
        setLoading(false)
        return
      }
      const { data: userData } = await supabase.from('users').select('role').eq('id', data.user.id).single()
      const requestedRedirect = new URLSearchParams(window.location.search).get('redirect')
      const safeRedirect = requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : null

      if (userData?.role === 'admin') {
        router.push(safeRedirect?.startsWith('/admin') ? safeRedirect : '/admin/dashboard')
      } else if (userData?.role === 'provider') {
        router.push(safeRedirect?.startsWith('/provider') ? safeRedirect : '/provider/dashboard')
      } else {
        router.push(safeRedirect?.startsWith('/customer') ? safeRedirect : '/customer/request')
      }
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="RescueGo home">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-bold text-2xl text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
          <p className="text-slate-500 mt-1">Welcome back</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="email" type="email" label="Email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
            <Input id="password" type="password" label="Password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" />
            <div className="text-right -mt-2">
              <Link href="/auth/forgot-password" className="text-sm text-orange-500 hover:underline">
                Forgot password?
              </Link>
            </div>
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <Button type="submit" loading={loading} size="lg" className="w-full mt-2">
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-center text-sm text-slate-500">
            <p>New customer? <Link href="/auth/register" className="text-orange-500 font-semibold hover:underline">Create account</Link></p>
            <p>Recovery provider? <Link href="/provider/register" className="text-orange-500 font-semibold hover:underline">Join as Provider</Link></p>
          </div>
        </div>
      </div>
    </div>
  )
}
