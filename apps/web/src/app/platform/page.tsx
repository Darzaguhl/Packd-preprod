import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PlatformDashboard from '@/components/platform/PlatformDashboard'

export default async function PlatformPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const appMeta = user.app_metadata as { role?: string } | undefined
  const role = appMeta?.role
  if (role !== 'admin') redirect('/dashboard')

  return (
    <Suspense>
      <PlatformDashboard />
    </Suspense>
  )
}
