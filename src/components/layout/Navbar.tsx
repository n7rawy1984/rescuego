'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types'

function dashboardHrefForRole(role: UserRole | null): string {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'provider') return '/provider/dashboard'
  return '/customer/request'
}

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [role, setRole] = useState<UserRole | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadUserRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        if (!cancelled) {
          setAuthenticated(false)
          setRole(null)
          setLoading(false)
        }
        return
      }

      if (!cancelled) {
        setAuthenticated(true)
      }

      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle<{ role: UserRole | null }>()

      if (!cancelled) {
        setRole(profile?.role ?? 'customer')
        setLoading(false)
      }
    }

    loadUserRole()

    return () => {
      cancelled = true
    }
  }, [])

  const dashboardHref = dashboardHrefForRole(role)

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthenticated(false)
    setRole(null)
    setOpen(false)
    window.location.href = '/'
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
        <Link href="/" className="flex items-center gap-2" aria-label="RescueGo home">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center" aria-hidden="true">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <span className="font-bold text-xl text-slate-900">RescueGo</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link href="/pricing" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">Pricing</Link>
          <Link href="/about" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">About</Link>
          {loading ? (
            <div className="h-10 w-32 rounded-lg bg-slate-100" aria-hidden="true" />
          ) : authenticated ? (
            <>
              <Link href={dashboardHref} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
                Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-slate-600 hover:text-orange-500 font-medium transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-slate-600 hover:text-orange-500 font-medium transition-colors">Sign In</Link>
              <Link href="/customer/request" className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
                Get Help Now
              </Link>
            </>
          )}
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
          {loading ? (
            <div className="h-10 rounded-lg bg-slate-100" aria-hidden="true" />
          ) : authenticated ? (
            <>
              <Link href={dashboardHref} className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold text-center" onClick={() => setOpen(false)}>
                Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-left text-slate-700 font-medium"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-slate-700 font-medium" onClick={() => setOpen(false)}>Sign In</Link>
              <Link href="/customer/request" className="bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold text-center" onClick={() => setOpen(false)}>
                Get Help Now
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
