import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function roleHomePath(role: string | undefined): string {
  switch (role) {
    case 'admin':
    case 'franchise_admin':
    case 'studio_admin':
    case 'instructor':
      return '/dashboard'
    default:
      return '/schedule'
  }
}

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role = (user.app_metadata as { role?: string } | undefined)?.role
  redirect(roleHomePath(role))
}
