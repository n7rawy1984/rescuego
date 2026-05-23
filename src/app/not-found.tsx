import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found - RescueGo',
}

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-8xl font-black text-slate-200 mb-4 select-none">404</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Page not found</h1>
          <p className="text-slate-500 mb-8">
            This page doesn&apos;t exist or has been moved. If you&apos;re broken down, help is still available.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/customer/request"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-orange-500 px-6 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
            >
              Request Recovery
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
