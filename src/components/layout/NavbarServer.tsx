import { createClient } from '@/lib/supabase/server'
import Navbar from '@/components/layout/Navbar'
import type { UserRole } from '@/types'

export default async function NavbarServer() {
  let authenticated = false
  let role: UserRole | null = null

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      authenticated = true
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle<{ role: UserRole | null }>()
      role = profile?.role ?? 'customer'
    }
  } catch {
    // Fall through with unauthenticated defaults
  }

  return (
    <Navbar
      key={`nav-${authenticated}-${role}`}
      initialAuthenticated={authenticated}
      initialRole={role}
    />
  )
}
