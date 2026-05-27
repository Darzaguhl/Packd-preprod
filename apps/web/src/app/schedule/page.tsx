import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ScheduleView from '@/components/ScheduleView'

export default async function SchedulePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Suspense>
      <ScheduleView studioId={process.env.NEXT_PUBLIC_STUDIO_ID!} />
    </Suspense>
  )
}
