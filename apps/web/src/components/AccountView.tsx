'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api } from '@/lib/api'
import type { MemberProfile } from '@packd/types'
import NavBar from '@/components/NavBar'
import MemberHistoryView from '@/components/member/MemberHistoryView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import type { UpcomingBooking, PastBooking, CreditTransaction } from '@/lib/api'

export default function AccountView() {
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([])
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('24h')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) { setLoading(false); return }

      try {
        const [profileData, upcomingData, historyData] = await Promise.all([
          api.members.me(t),
          api.members.bookings(t),
          api.members.history(t),
        ])
        setProfile(profileData)
        setUpcoming(upcomingData)
        setPastBookings(historyData.pastBookings)
        setTransactions(historyData.transactions)

        // Pull time format from studio stats if available
        const studioId = (session?.user?.app_metadata as { studioId?: string })?.studioId
        if (studioId) {
          api.admin.stats(studioId, t).then(s => setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')).catch(() => {})
        }
      } catch {
        // non-member user — show empty state
      } finally {
        setLoading(false)
      }
    })
  }, [])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleCancelBooking(bookingId: string) {
    if (!token) return
    try {
      const res = await api.bookings.cancel(bookingId, token)
      if (res.success) {
        setUpcoming(prev => prev.filter(b => b.id !== bookingId))
        showToast(
          res.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Booking cancelled',
          !res.isLateCancel,
        )
        if (profile && res.isLateCancel) {
          setProfile({ ...profile, creditBalance: profile.creditBalance - 1 })
          setTransactions(prev => [{
            id: `local-${Date.now()}`,
            amount: -1,
            type: 'LATE_CANCEL_FEE',
            note: 'Late cancellation fee',
            createdAt: new Date().toISOString(),
          }, ...prev])
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to cancel', false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar title="My Account" />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-sm text-gray-400">No member profile found for this account.</p>
        </div>
      </div>
    )
  }

  return (
    <TimeFormatProvider value={timeFormat}>
      <div className="min-h-screen bg-gray-50">
        <NavBar title="My Account" />
        <div className="max-w-2xl mx-auto px-4 py-6">
          <MemberHistoryView
            profile={profile}
            upcoming={upcoming}
            pastBookings={pastBookings}
            transactions={transactions}
            onCancelBooking={handleCancelBooking}
          />
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </TimeFormatProvider>
  )
}
