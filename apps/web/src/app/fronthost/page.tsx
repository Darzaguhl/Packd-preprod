import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FronthostDashboard from '@/components/fronthost/FronthostDashboard'

const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID!

export default async function FronthostPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = (user.app_metadata as { role?: string } | undefined)?.role
  if (role !== 'fronthost' && role !== 'admin' && role !== 'franchise_admin' && role !== 'studio_admin') {
    redirect('/schedule')
  }

  return <FronthostDashboard studioId={STUDIO_ID} />
}
