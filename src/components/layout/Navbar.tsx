'use client'
import Link from 'next/link'
import { useState } from 'react'

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <span className="font-bold text-xl text-slate-900">RescueGo</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link href="/pricing" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">Pricing</Link>
          <Link href="/about" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">About</Link>
          <Link href="/auth/login" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">Sign In</Link>
          <Link href="/customer/request" className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
            Get Help Now
          </Link>
        </div>

        <button
          className="md:hidden p-2 rounded-lg hover:bg-slate-100"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          <div className="w-5 h-0.5 bg-slate-700 mb-1"></div>
          <div className="w-5 h-0.5 bg-slate-700 mb-1"></div>
          <div className="w-5 h-0.5 bg-slate-700"></div>
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-slate-200 px-4 py-4 flex flex-col gap-4">
          <Link href="/pricing" className="text-slate-700 font-medium" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/about" className="text-slate-700 font-medium" onClick={() => setOpen(false)}>About</Link>
          <Link href="/auth/login" className="text-slate-700 font-medium" onClick={() => setOpen(false)}>Sign In</Link>
          <Link href="/customer/request" className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold text-center" onClick={() => setOpen(false)}>
            Get Help Now
          </Link>
        </div>
      )}
    </nav>
  )
}
