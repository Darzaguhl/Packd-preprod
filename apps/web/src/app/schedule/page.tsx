import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { api } from '@/lib/api'
import ScheduleView from '@/components/ScheduleView'

export default async function SchedulePage() {
  const supabase = await createClient()
  const { data: { user }, } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token!

  const studioId = process.env.NEXT_PUBLIC_STUDIO_ID!
  const from = new Date().toISOString()
  const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const sessions = await api.schedule.list(studioId, from, to, token)

  return <ScheduleView sessions={sessions} token={token} />
}
