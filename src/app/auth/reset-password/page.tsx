'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="RescueGo home">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center" aria-hidden="true">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-bold text-2xl text-slate-900">RescueGo</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Set New Password</h1>
          <p className="mt-1 text-sm text-slate-500">Choose a new password for your account</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Password updated</h2>
              <p className="text-sm text-slate-500 mb-6">
                Your password has been changed successfully. You can now sign in with the new password.
              </p>
              <Link href="/auth/login" className="text-orange-500 font-semibold hover:underline text-sm">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <p className="-mt-2 text-xs text-slate-500">Use at least 8 characters. A longer password with a mix of words and numbers is stronger.</p>
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
              {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <Button type="submit" loading={loading} size="lg" className="w-full mt-2">
                Update Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
