'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { CheckCircle2, ShieldCheck } from 'lucide-react'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Set new password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Choose a new password for your account.</p>
        </div>

        <div className="rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          {success ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-slate-950">Password updated</h2>
              <p className="mb-6 text-sm leading-6 text-slate-500">
                Your password has been changed successfully. You can now sign in with the new password.
              </p>
              <Link href="/auth/login" className="text-sm font-semibold text-[#1D9E75] hover:underline">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-sm text-[#0F6E56]">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <p>Use at least 8 characters. Longer passwords with words and numbers are stronger.</p>
                </div>
              </div>
              <Input
                id="password"
                type="password"
                label="New Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
              />
              <Input
                id="confirm-password"
                type="password"
                label="Confirm New Password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Repeat new password"
              />
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
              <Button type="submit" loading={loading} size="lg" className="mt-2 min-h-12 w-full">
                Update Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
