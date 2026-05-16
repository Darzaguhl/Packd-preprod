import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FronthostDashboard from '@/components/fronthost/FronthostDashboard'

const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID!

export default async function FronthostPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = (user.app_metadata as { role?: string } | undefined)?.role
  // /fronthost is the check-in terminal — accessible to fronthost staff and all admin levels
  const allowed = ['fronthost', 'admin', 'franchise_admin', 'studio_admin']
  if (!allowed.includes(role ?? '')) redirect('/schedule')

  return <FronthostDashboard studioId={STUDIO_ID} />
}
