import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { requireEnv } from '@/lib/env'

const PROTECTED_PREFIXES = [
  '/provider/dashboard',
  '/provider/subscribe',
  '/admin',
  '/admin/dashboard',
  '/admin/providers',
  '/admin/requests',
  '/admin/revenue',
  '/customer/history',
  '/customer/ratings',
  '/customer/request',
]

const PROVIDER_PREFIXES = ['/provider/dashboard', '/provider/subscribe']

function getSafeRedirectTarget(request: NextRequest): string {
  const { pathname, search } = request.nextUrl
  return `${pathname}${search}`
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  if (isProtected && !user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', getSafeRedirectTarget(request))
    return NextResponse.redirect(loginUrl)
  }

  if (user && isProtected) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
      return NextResponse.redirect(new URL(profile?.role === 'provider' ? '/provider/dashboard' : '/', request.url))
    }

    if (PROVIDER_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && profile?.role !== 'provider') {
      return NextResponse.redirect(new URL(profile?.role === 'customer' ? '/customer/request' : '/', request.url))
    }

    if (pathname.startsWith('/customer') && profile?.role !== 'customer') {
      return NextResponse.redirect(new URL(profile?.role === 'provider' ? '/provider/dashboard' : '/', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/provider/:path*', '/admin/:path*', '/customer/:path*'],
}
