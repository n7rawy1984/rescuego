import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type RequestUserResult = {
  supabase: SupabaseClient
  user: User | null
  authError: Error | null
}

// Cookie-session only (D10). The previous Bearer-token fallback was removed:
// no integration depends on it, and accepting a user JWT from the Authorization
// header widened the auth surface unnecessarily. Cron/ops routes authenticate
// with OPS_CRON_SECRET (see src/lib/ops-auth.ts), not a Bearer user token, so
// they are unaffected. The request argument is no longer needed.
export async function getRequestUser(): Promise<RequestUserResult> {
  const supabase = await createClient()
  const cookieSession = await supabase.auth.getUser()

  if (cookieSession.data.user && !cookieSession.error) {
    return { supabase, user: cookieSession.data.user, authError: null }
  }

  return {
    supabase,
    user: null,
    authError: cookieSession.error ? new Error(cookieSession.error.message) : null,
  }
}
