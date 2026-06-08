'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { MailCheck, ShieldCheck } from 'lucide-react'

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
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
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/reset-password`,
      })
      if (resetError) {
        setError(tErrors('generic'))
        setLoading(false)
        return
      }

      setSent(true)
      setLoading(false)
    } catch {
      setError(tErrors('network'))
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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{t('title')}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t('subtitle')}</p>
        </div>
        <div className="rounded-3xl border border-[#DDE7EE] bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E1F5EE] text-[#0F6E56]">
                <MailCheck className="h-8 w-8" aria-hidden="true" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-slate-950">{t('successTitle')}</h2>
              <p className="mb-6 text-sm leading-6 text-slate-500">
                {t('successDesc')}
              </p>
              <Link href="/auth/login" className="text-sm font-semibold text-[#1D9E75] hover:underline">
                {t('backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="rounded-2xl border border-[#9FE1CB] bg-[#E1F5EE] p-4 text-sm text-[#0F6E56]">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <p>{t('infoBox')}</p>
                </div>
              </div>
              <Input
                id="email"
                type="email"
                label={tCommon('email')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder={tCommon('email')}
              />
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
              <Button type="submit" loading={loading} size="lg" className="mt-2 min-h-12 w-full">
                {loading ? tCommon('loading') : t('submit')}
              </Button>
              <p className="text-center text-sm text-slate-500">
                {t('rememberPassword')} <Link href="/auth/login" className="text-[#1D9E75] font-semibold hover:underline">{t('backToLogin')}</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
