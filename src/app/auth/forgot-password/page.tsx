'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/reset-password`,
      })
      if (resetError) {
        setError('Unable to send a reset link right now. Please try again.')
        setLoading(false)
        return
      }

      setSent(true)
      setLoading(false)
    } catch {
      setError('Network connection lost. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="rg-page-shell flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="RescueGo home">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-bold text-2xl text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Reset Password</h1>
          <p className="mt-1 text-sm text-slate-500">We&apos;ll send a reset link to your email</p>
        </div>
        <div className="rg-card p-6 sm:p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Check your email</h2>
              <p className="text-sm text-slate-500 mb-6">
                If an account exists for this email, a reset link has been sent. Check your spam folder if you don&apos;t see it.
              </p>
              <Link href="/auth/login" className="text-orange-500 font-semibold hover:underline text-sm">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                id="email"
                type="email"
                label="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <Button type="submit" loading={loading} size="lg" className="w-full mt-2">
                {loading ? 'Sending reset link...' : 'Send Reset Link'}
              </Button>
              <p className="text-center text-sm text-slate-500">
                Remember it? <Link href="/auth/login" className="text-orange-500 font-semibold hover:underline">Sign In</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
