import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { requireEnv } from '@/lib/env'

// Next.js 16 renamed the `middleware` file convention to `proxy` (deprecated
// `middleware.ts`). This file at src/proxy.ts with a named `proxy` export is the
// registered request proxy for Next.js 16.2.6 — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// It does two things only: refresh the Supabase session token and redirect
// unauthenticated users away from protected routes (plus a CSRF origin check on
// state-mutating API requests).
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

const CSRF_EXEMPT_PATHS = [
  '/api/stripe/webhook',
  '/api/ops/',
]

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null,
  'https://rescuego.ae',
  'https://www.rescuego.ae',
  'http://localhost:3000',
].filter(Boolean) as string[]

function getSafeRedirectTarget(request: NextRequest): string {
  const { pathname, search } = request.nextUrl
  return `${pathname}${search}`
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (request.method === 'POST' && pathname.startsWith('/api/')) {
    const isExempt = CSRF_EXEMPT_PATHS.some((p) => pathname.startsWith(p))
    if (!isExempt) {
      const origin = request.headers.get('origin')
      const referer = request.headers.get('referer')
      const requestOrigin = origin || (referer ? new URL(referer).origin : null)
      const requestHost = request.nextUrl.origin

      // H7: if neither Origin nor Referer is present we cannot verify the
      // request source. Previously this case silently skipped the check, which
      // let a forged cross-site POST through. Treat a missing source as a
      // rejection for state-mutating API requests.
      if (!requestOrigin) {
        console.warn('[CSRF_BLOCK]', {
          pathname,
          reason: 'missing_origin_and_referer',
          requestHost,
        })
        return NextResponse.json(
          { error: 'Forbidden', message: 'Missing request origin' },
          { status: 403 }
        )
      }

      // D9: the *.vercel.app wildcard was removed. Only the explicitly
      // enumerated ALLOWED_ORIGINS (plus the request's own host) are accepted.
      const isAllowed = requestOrigin === requestHost || ALLOWED_ORIGINS.includes(requestOrigin)
      if (!isAllowed) {
        console.warn('[CSRF_BLOCK]', {
          pathname,
          origin,
          referer,
          requestOrigin,
          requestHost,
          allowedOrigins: ALLOWED_ORIGINS,
        })
        return NextResponse.json(
          { error: 'Forbidden', message: 'Invalid request origin' },
          { status: 403 }
        )
      }
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.next({ request })
  }

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
  matcher: ['/provider/:path*', '/admin/:path*', '/customer/:path*', '/api/:path*'],
}
