import type { NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type RequestUserResult = {
  supabase: SupabaseClient
  user: User | null
  authError: Error | null
}

function bearerToken(req: NextRequest): string | null {
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null

  const token = authorization.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export async function getRequestUser(req: NextRequest): Promise<RequestUserResult> {
  const supabase = await createClient()
  const cookieSession = await supabase.auth.getUser()

  if (cookieSession.data.user && !cookieSession.error) {
    return { supabase, user: cookieSession.data.user, authError: null }
  }

  const token = bearerToken(req)
  if (!token) {
    return {
      supabase,
      user: null,
      authError: cookieSession.error ? new Error(cookieSession.error.message) : null,
    }
  }

  const tokenSession = await supabase.auth.getUser(token)

  return {
    supabase,
    user: tokenSession.data.user,
    authError: tokenSession.error ? new Error(tokenSession.error.message) : null,
  }
}
