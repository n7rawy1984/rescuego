import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { requireEnv } from '@/lib/env'

// In Next.js 16 the middleware entry point is proxy.ts, not middleware.ts.
// This proxy does two things only: refresh the Supabase session token and
// redirect unauthenticated users away from protected routes.
//
// Role enforcement (customer vs provider vs admin) is NOT done here.
// It happens at the page level and is backed by Supabase RLS.
// Adding a DB role lookup here would fire on every navigation — explicitly
// discouraged by Next.js auth docs and removed in Phase 1A Task 1.

const PROTECTED_PREFIXES = [
  '/provider',
  '/admin',
  '/customer',
]

const PUBLIC_OVERRIDES = [
  '/provider/register',
  '/provider/subscribe',
]

function getSafeRedirectTarget(request: NextRequest): string {
  const { pathname, search } = request.nextUrl
  return `${pathname}${search}`
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // The cookie dance below is required by @supabase/ssr: the client must be
  // able to mutate response cookies so that a refreshed session token is
  // written back to the browser. Both getAll and setAll must be implemented.
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

  // getUser() triggers a token refresh if the access token is expired.
  // Must be called even when the route is public — the cookie write-back
  // happens as a side effect.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    && !PUBLIC_OVERRIDES.some((override) => pathname.startsWith(override))

  if (isProtected && !user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', getSafeRedirectTarget(request))
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/provider/:path*', '/admin/:path*', '/customer/:path*'],
}
