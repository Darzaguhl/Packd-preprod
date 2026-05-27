'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api } from '@/lib/api'
import type { MemberProfile } from '@packd/types'
import NavBar from '@/components/NavBar'
import MemberHistoryView from '@/components/member/MemberHistoryView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import type { UpcomingBooking, PastBooking, CreditTransaction, MembershipPlan } from '@/lib/api'

// ─── Edit profile modal ───────────────────────────────────────────────────────

function EditProfileModal({
  profile,
  token,
  onSave,
  onClose,
}: {
  profile: MemberProfile
  token: string
  onSave: (firstName: string, lastName: string) => void
  onClose: () => void
}) {
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName]   = useState(profile.lastName)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) { setError('Both fields are required'); return }
    setSaving(true)
    setError(null)
    try {
      await api.members.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() }, token)
      onSave(firstName.trim(), lastName.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl px-6 pt-6 pb-8 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-96 sm:rounded-2xl sm:shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Edit profile</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">First name</label>
            <input
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Last name</label>
            <input
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function AccountView() {
  const router = useRouter()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([])
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [plans, setPlans] = useState<Omit<MembershipPlan, 'activeSubscriptions'>[]>([])
  const [loading, setLoading] = useState(true)
  const [editingProfile, setEditingProfile] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('24h')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) { router.replace('/login'); return }

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

        // Fetch membership plans for the member's studio
        const studioId = profileData.studioId ?? (session?.user?.app_metadata as { studioId?: string })?.studioId
        if (studioId) {
          api.memberships.publicPlans(studioId, t).then(setPlans).catch(() => {})
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

  async function handleCancelMembership() {
    if (!token) return
    try {
      await api.memberships.cancelMe(token)
      const updated = await api.members.me(token)
      setProfile(updated)
      showToast('Membership cancelled')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to cancel membership', false)
    }
  }

  async function handleSubscribe(planId: string) {
    if (!token) return
    try {
      await api.memberships.subscribe(planId, token)
      // Refresh profile (new subscription + credits granted)
      const [updated, history] = await Promise.all([
        api.members.me(token),
        api.members.history(token),
      ])
      setProfile(updated)
      setTransactions(history.transactions)
      showToast('Membership activated!')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to subscribe', false)
    }
  }

  async function handleCancelBooking(bookingId: string) {
    if (!token) return
    const booking = upcoming.find(b => b.id === bookingId)
    try {
      const res = await api.bookings.cancel(bookingId, token)
      if (res.success) {
        setUpcoming(prev => prev.filter(b => b.id !== bookingId))
        showToast(
          res.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Booking cancelled',
          !res.isLateCancel,
        )
        // Re-fetch profile + transactions to get accurate balances
        // (late-cancel fee amount is server-determined, so we don't guess it)
        api.members.me(token).then(updated => setProfile(updated)).catch(() => {})
        api.members.history(token).then(h => setTransactions(h.transactions)).catch(() => {})
        // Optimistic refund for on-time cancellation (amount is known client-side)
        if (!res.isLateCancel && booking) {
          setTransactions(prev => [{
            id: `local-${Date.now()}`,
            amount: booking.creditsRequired,
            type: 'REFUND',
            note: `Cancellation: ${booking.templateName}`,
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
            plans={plans}
            onCancelBooking={handleCancelBooking}
            onSubscribe={handleSubscribe}
            onCancelMembership={handleCancelMembership}
            onEditProfile={() => setEditingProfile(true)}
          />
        </div>
      </div>

      {editingProfile && token && (
        <EditProfileModal
          profile={profile}
          token={token}
          onSave={(firstName, lastName) => {
            setProfile(p => p ? { ...p, firstName, lastName } : p)
            setEditingProfile(false)
            showToast('Profile updated')
          }}
          onClose={() => setEditingProfile(false)}
        />
      )}

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
