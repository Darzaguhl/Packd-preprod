import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FranchiseDashboard from '@/components/franchise/FranchiseDashboard'
import BrandDashboard from '@/components/brand/BrandDashboard'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'
import DualRoleDashboard from '@/components/dual/DualRoleDashboard'
import AdminShell from '@/components/admin/AdminShell'

const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID!

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const appMeta = user.app_metadata as { role?: string; roles?: string[]; studioId?: string; studioIds?: string[]; brandId?: string } | undefined
  const role = appMeta?.role
  const roles: string[] = appMeta?.roles ?? (role && role !== 'member' ? [role] : [])
  // All studio IDs the user is assigned to (multi-studio support)
  const studioIds: string[] = appMeta?.studioIds ?? (appMeta?.studioId ? [appMeta.studioId] : [STUDIO_ID])
  const primaryStudioId = studioIds[0] ?? STUDIO_ID

  if (role === 'brand_admin') {
    return (
      <Suspense>
        <BrandDashboard />
      </Suspense>
    )
  }

  if (role === 'admin' || role === 'franchise_admin') {
    return (
      <Suspense>
        <FranchiseDashboard />
      </Suspense>
    )
  }

  if (role === 'studio_admin') {
    return (
      <Suspense>
        <AdminShell studioId={primaryStudioId} studioIds={studioIds} />
      </Suspense>
    )
  }

  // Dual role: has both fronthost and instructor
  if (roles.includes('fronthost') && roles.includes('instructor')) {
    return <DualRoleDashboard studioId={STUDIO_ID} />
  }

  if (role === 'fronthost') redirect('/fronthost')

  if (role === 'instructor') {
    return (
      <Suspense>
        <StudioManagerDashboard studioId={STUDIO_ID} role="instructor" />
      </Suspense>
    )
  }

  // members land on schedule
  redirect('/schedule')
}
