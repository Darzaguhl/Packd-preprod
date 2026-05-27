'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminMemberProfile, type AdminMemberHistory } from '@/lib/api'
import NavBar from '@/components/NavBar'
import MemberHistoryView from './MemberHistoryView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import type { UpcomingBooking, PastBooking, CreditTransaction } from '@/lib/api'

interface Props {
  memberId: string
}

export default function MemberProfilePage({ memberId }: Props) {
  const router = useRouter()
  const [profile, setProfile] = useState<AdminMemberProfile | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([])
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('24h')

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      if (!t) { router.replace('/login'); return }

      try {
        const [prof, history] = await Promise.all([
          api.admin.memberProfile(memberId, t),
          api.admin.memberHistory(memberId, t),
        ])
        setProfile(prof)
        setUpcoming(history.upcoming as UpcomingBooking[])
        setPastBookings(history.pastBookings)
        setTransactions(history.transactions)

        const studioId = (session?.user?.app_metadata as { studioId?: string })?.studioId
        if (studioId) {
          api.admin.stats(studioId, t).then(s => setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')).catch(() => {})
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load member')
      } finally {
        setLoading(false)
      }
    })
  }, [memberId, router])

  const backButton = (
    <button
      onClick={() => router.back()}
      className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
    >
      ← Back
    </button>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar title="Member Profile" action={backButton} />
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar title="Member Profile" action={backButton} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-sm text-gray-400">{error ?? 'Member not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <TimeFormatProvider value={timeFormat}>
      <div className="min-h-screen bg-gray-50">
        <NavBar
          title={`${profile.firstName} ${profile.lastName}`}
          subtitle={profile.email}
          action={backButton}
        />
        <div className="max-w-2xl mx-auto px-4 py-6">
          <MemberHistoryView
            profile={profile}
            upcoming={upcoming}
            pastBookings={pastBookings}
            transactions={transactions}
            showEmail
          />
        </div>
      </div>
    </TimeFormatProvider>
  )
}
