import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OnboardingFlow from '@/components/onboarding/OnboardingFlow'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = user.app_metadata?.role as string | undefined
  const ROLE_RANK: Record<string, number> = { member: 1, instructor: 2, fronthost: 2, studio_admin: 3, franchise_admin: 4, admin: 5 }
  if (!role || (ROLE_RANK[role] ?? 0) < ROLE_RANK['franchise_admin']) redirect('/dashboard')

  return <OnboardingFlow />
}
