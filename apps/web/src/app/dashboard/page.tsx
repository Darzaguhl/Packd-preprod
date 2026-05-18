import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FranchiseDashboard from '@/components/franchise/FranchiseDashboard'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'
import DualRoleDashboard from '@/components/dual/DualRoleDashboard'

const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID!

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const appMeta = user.app_metadata as { role?: string; roles?: string[] } | undefined
  const role = appMeta?.role
  const roles: string[] = appMeta?.roles ?? (role && role !== 'member' ? [role] : [])

  if (role === 'admin' || role === 'franchise_admin') {
    return <FranchiseDashboard />
  }

  if (role === 'studio_admin') {
    return <StudioManagerDashboard studioId={STUDIO_ID} />
  }

  // Dual role: has both fronthost and instructor
  if (roles.includes('fronthost') && roles.includes('instructor')) {
    return <DualRoleDashboard studioId={STUDIO_ID} />
  }

  if (role === 'fronthost') redirect('/fronthost')

  if (role === 'instructor') {
    return <StudioManagerDashboard studioId={STUDIO_ID} role="instructor" />
  }

  // members land on schedule
  redirect('/schedule')
}
