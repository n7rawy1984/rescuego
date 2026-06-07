import Link from 'next/link'
import NavbarServer from '@/components/layout/NavbarServer'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found - RescueGo',
}

export default async function NotFound() {
  const t = await getTranslations('notFound')

  return (
    <>
      <NavbarServer />
      <main className="min-h-screen bg-slate-50 pt-16 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-8xl font-black text-slate-200 mb-4 select-none">404</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('title')}</h1>
          <p className="text-slate-500 mb-8">
            {t('description')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/customer/request"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#1D9E75] px-6 text-sm font-semibold text-white hover:bg-[#0F6E56] transition-colors"
            >
              {t('requestRecovery')}
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t('backHome')}
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
