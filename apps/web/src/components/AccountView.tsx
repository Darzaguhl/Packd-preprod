'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, bookings as bookingsClient, members as membersClient } from '@/lib/api-client'
import type { UpcomingBooking, PastBooking, CreditTransaction, MembershipPlan } from '@/lib/api-client'
import type { MemberProfile } from '@packd/types'
import NavBar from '@/components/NavBar'
import MemberHistoryView from '@/components/member/MemberHistoryView'
import AccountExtrasSection from '@/components/member/AccountExtrasSection'
import { TimeFormatProvider } from '@/lib/time-format-context'

// ─── Activity feed ────────────────────────────────────────────────────────────

type FeedItem =
  | { kind: 'booking'; date: string; name: string; status: PastBooking['status']; checkedIn: boolean }
  | { kind: 'credit';  date: string; amount: number; type: CreditTransaction['type']; note: string | null }

function ActivityFeed({ pastBookings, transactions }: { pastBookings: PastBooking[]; transactions: CreditTransaction[] }) {
  const items: FeedItem[] = [
    ...pastBookings.slice(0, 30).map(b => ({
      kind: 'booking' as const,
      date: b.startsAt,
      name: b.templateName,
      status: b.status,
      checkedIn: b.checkedIn,
    })),
    ...transactions.slice(0, 30).map(t => ({
      kind: 'credit' as const,
      date: t.createdAt,
      amount: t.amount,
      type: t.type,
      note: t.note,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  if (!items.length) return null

  function bookingIcon(status: PastBooking['status'], checkedIn: boolean) {
    if (checkedIn) return { icon: '✓', color: 'text-emerald-600 bg-emerald-50' }
    if (status === 'CANCELLED') return { icon: '×', color: 'text-gray-400 bg-gray-100' }
    if (status === 'LATE_CANCELLED') return { icon: '!', color: 'text-amber-600 bg-amber-50' }
    if (status === 'NO_SHOW') return { icon: '—', color: 'text-red-500 bg-red-50' }
    return { icon: '✓', color: 'text-gray-500 bg-gray-100' }
  }

  function creditIcon(type: CreditTransaction['type'], amount: number) {
    if (type === 'REFERRAL')    return { icon: '★', color: 'text-purple-600 bg-purple-50' }
    if (type === 'EXPIRY')      return { icon: '↓', color: 'text-red-500 bg-red-50' }
    if (amount > 0)             return { icon: '+', color: 'text-emerald-600 bg-emerald-50' }
    return                               { icon: '−', color: 'text-gray-400 bg-gray-100' }
  }

  function label(item: FeedItem) {
    if (item.kind === 'booking') {
      if (item.status === 'CANCELLED')      return `Cancelled · ${item.name}`
      if (item.status === 'LATE_CANCELLED') return `Late cancel · ${item.name}`
      if (item.status === 'NO_SHOW')        return `No-show · ${item.name}`
      return item.checkedIn ? `Attended ${item.name}` : `Booked ${item.name}`
    }
    const sign = item.amount > 0 ? `+${item.amount}` : `${item.amount}`
    const base = `${sign} credit${Math.abs(item.amount) !== 1 ? 's' : ''}`
    if (item.note)                           return `${base} · ${item.note}`
    if (item.type === 'MEMBERSHIP_RENEWAL') return `${base} · Membership renewal`
    if (item.type === 'REFERRAL')           return `${base} · Referral reward`
    if (item.type === 'EXPIRY')             return `${base} · Credits expired`
    if (item.type === 'PURCHASE')           return `${base} · Purchase`
    return base
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent activity</h3>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const { icon, color } = item.kind === 'booking'
            ? bookingIcon(item.status, item.checkedIn)
            : creditIcon(item.type, item.amount)
          return (
            <li key={i} className="flex items-center gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${color}`}>
                {icon}
              </span>
              <span className="flex-1 text-xs text-gray-700 truncate">{label(item)}</span>
              <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                {new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Edit profile modal ───────────────────────────────────────────────────────

function EditProfileModal({
  profile,
  token,
  onSave,
  onClose,
}: {
  profile: MemberProfile & { birthday?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }
  token: string
  onSave: (firstName: string, lastName: string) => void
  onClose: () => void
}) {
  const [firstName, setFirstName]                   = useState(profile.firstName)
  const [lastName, setLastName]                     = useState(profile.lastName)
  const [birthday, setBirthday]                     = useState(profile.birthday ? profile.birthday.slice(0, 10) : '')
  const [emergencyName, setEmergencyName]           = useState(profile.emergencyContactName ?? '')
  const [emergencyPhone, setEmergencyPhone]         = useState(profile.emergencyContactPhone ?? '')
  const [saving, setSaving]                         = useState(false)
  const [error, setError]                           = useState<string | null>(null)

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) { setError('Both fields are required'); return }
    setSaving(true)
    setError(null)
    try {
      await membersClient.updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthday: birthday || null,
        emergencyContactName: emergencyName.trim() || null,
        emergencyContactPhone: emergencyPhone.trim() || null,
      }, token)
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
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Birthday</label>
            <input
              type="date"
              value={birthday}
              onChange={e => setBirthday(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Emergency contact name</label>
            <input
              value={emergencyName}
              onChange={e => setEmergencyName(e.target.value)}
              placeholder="Full name"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Emergency contact phone</label>
            <input
              type="tel"
              value={emergencyPhone}
              onChange={e => setEmergencyPhone(e.target.value)}
              placeholder="+1 555 000 0000"
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
  const searchParams = useSearchParams()
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
  const [memberStats, setMemberStats] = useState<import('@/lib/api').MemberStats | null>(null)
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [icalCopied, setIcalCopied] = useState(false)
  const [instructorIcalUrl, setInstructorIcalUrl] = useState<string | null>(null)
  const [instructorIcalCopied, setInstructorIcalCopied] = useState(false)
  const [fronthostIcalUrl, setFronthostIcalUrl] = useState<string | null>(null)
  const [fronthostIcalCopied, setFronthostIcalCopied] = useState(false)
  const [upcomingShifts, setUpcomingShifts] = useState<import('@/lib/api-client').StaffShift[]>([])
  const [profileExtended, setProfileExtended] = useState<{ birthday: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null } | null>(null)
  const [guestPassBalance, setGuestPassBalance] = useState(0)
  const [guestPasses, setGuestPasses] = useState<import('@/lib/api-client').GuestPassEntry[]>([])
  const [purchases, setPurchases] = useState<import('@/lib/api').ProductSale[]>([])
  const [selfCheckInEnabled, setSelfCheckInEnabled] = useState(false)
  const [creditPurchaseEnabled, setCreditPurchaseEnabled] = useState(false)
  const [allowMemberPause, setAllowMemberPause] = useState(false)
  const [referralEnabled, setReferralEnabled] = useState(false)
  const [lateCancelWindowHours, setLateCancelWindowHours] = useState<number | undefined>()
  const [lateCancelFeeCredits, setLateCancelFeeCredits] = useState<number | undefined>()

  // Show success toast and refresh data when Stripe redirects back after payment
  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      showToast('Payment successful! Your membership is now active.')
      router.replace('/account')
      // Re-fetch profile + history so updated credits/subscription are shown immediately
      createClient().auth.getSession().then(async ({ data: { session } }) => {
        const t = session?.access_token
        if (!t) return
        try {
          const [profileData, historyData] = await Promise.all([
            membersClient.me(t),
            api.members.history(t),
          ])
          setProfile(profileData)
          setPastBookings(historyData.pastBookings)
          setTransactions(historyData.transactions)
        } catch { /* non-fatal */ }
      })
    }
  }, [searchParams])

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) { router.replace('/login'); return }

      try {
        const [profileData, upcomingData, historyData] = await Promise.all([
          membersClient.me(t),
          api.members.bookings(t),
          api.members.history(t),
        ])
        setProfile(profileData)
        setUpcoming(upcomingData)
        setPastBookings(historyData.pastBookings)
        setTransactions(historyData.transactions)

        // Capture extended profile fields
        const extProfile = profileData as typeof profileData & { birthday: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null }
        setProfileExtended({ birthday: extProfile.birthday ?? null, emergencyContactName: extProfile.emergencyContactName ?? null, emergencyContactPhone: extProfile.emergencyContactPhone ?? null })
        setGuestPassBalance((profileData as typeof profileData & { guestPassBalance: number }).guestPassBalance ?? 0)

        // Fetch membership plans for the member's studio
        const studioId = profileData.studioId ?? (session?.user?.app_metadata as { studioId?: string })?.studioId
        if (studioId) {
          api.memberships.publicPlans(studioId, t).then(setPlans).catch(() => {})
          api.admin.stats(studioId, t).then(s => {
            setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')
            setSelfCheckInEnabled(s.selfCheckInEnabled ?? false)
            setCreditPurchaseEnabled(s.creditPurchaseEnabled ?? false)
            setAllowMemberPause((s as typeof s & { allowMemberPause?: boolean }).allowMemberPause ?? false)
            setReferralEnabled(((s as typeof s & { referralRewardCredits?: number }).referralRewardCredits ?? 0) > 0)
          }).catch(() => {})
          api.members.stats(studioId, t).then(setMemberStats).catch(() => {})
          api.studios.getPolicy(studioId, t).then(p => {
            setLateCancelWindowHours(p.lateCancelWindowHours)
            setLateCancelFeeCredits(p.lateCancelFeeCredits)
          }).catch(() => {})
          api.ical.getToken(t).then(d => {
            setIcalUrl(d.urls.member)
            if (d.urls.instructor) setInstructorIcalUrl(d.urls.instructor)
            if (d.urls.fronthost) {
              setFronthostIcalUrl(d.urls.fronthost)
              const today = new Date().toISOString()
              api.shifts.mine(t, studioId, today).then(setUpcomingShifts).catch(() => {})
            }
          }).catch(() => {})
          api.admin.guestPassLog(profileData.id ?? '', t).then(setGuestPasses).catch(() => {})
          api.members.purchases(t, studioId).then(setPurchases).catch(() => {})
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
      const updated = await membersClient.me(token)
      setProfile(updated)
      showToast('Membership cancelled')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to cancel membership', false)
    }
  }

  async function handleBuyCredits(planId: string, promoCodeId?: string) {
    if (!token || !profile) return
    try {
      const res = await api.stripe.checkout(planId, profile.studioId, token, promoCodeId)
      if (res.url) window.location.href = res.url
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to start checkout', false)
    }
  }

  async function handleManagePayments() {
    if (!token) return
    try {
      const res = await api.stripe.portal(token)
      if (res.url) window.location.href = res.url
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to open payment portal', false)
    }
  }

  async function handleSubscribe(planId: string) {
    if (!token) return
    try {
      await api.memberships.subscribe(planId, token)
      // Refresh profile (new subscription + credits granted)
      const [updated, history] = await Promise.all([
        membersClient.me(token),
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
      const res = await bookingsClient.cancel(bookingId, token)
      if (res.success) {
        setUpcoming(prev => prev.filter(b => b.id !== bookingId))
        showToast(
          res.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Booking cancelled',
          !res.isLateCancel,
        )
        // Re-fetch profile + transactions to get accurate balances
        // (late-cancel fee amount is server-determined, so we don't guess it)
        membersClient.me(token).then(updated => setProfile(updated)).catch(() => {})
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

  async function handleSelfCheckIn(bookingId: string) {
    if (!token) return
    try {
      await bookingsClient.selfCheckIn(bookingId, token)
      setUpcoming(prev => prev.map(b => b.id === bookingId ? { ...b, checkedIn: true } : b))
      showToast('Checked in! See you in class 🎉')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Check-in failed', false)
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
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <MemberHistoryView
            profile={profile}
            upcoming={upcoming}
            pastBookings={pastBookings}
            transactions={transactions}
            plans={plans}
            onCancelBooking={handleCancelBooking}
            onSelfCheckIn={selfCheckInEnabled ? handleSelfCheckIn : undefined}
            onSubscribe={handleSubscribe}
            onBuyCredits={creditPurchaseEnabled ? handleBuyCredits : undefined}
            onCancelMembership={handleCancelMembership}
            onEditProfile={() => setEditingProfile(true)}
            birthday={profileExtended?.birthday}
            emergencyContactName={profileExtended?.emergencyContactName}
            emergencyContactPhone={profileExtended?.emergencyContactPhone}
            lateCancelWindowHours={lateCancelWindowHours}
            lateCancelFeeCredits={lateCancelFeeCredits}
          />

          {/* ══ MY PLAN ══════════════════════════════════════════════════════ */}
          <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase px-1 pt-2">My Plan</p>

          {/* ── My stats ── */}
          {memberStats && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">My stats</h3>
              <p className="text-sm text-gray-700">
                You&apos;ve attended{' '}
                <span className="font-bold text-gray-900">{memberStats.visits} class{memberStats.visits !== 1 ? 'es' : ''}</span>
                {memberStats.rank && memberStats.totalMembers > 0 && (
                  <> — you&apos;re{' '}
                    <span className="font-bold text-gray-900">#{memberStats.rank}</span>{' '}
                    of {memberStats.totalMembers} members this month 🏆
                  </>
                )}
              </p>
              {memberStats.topInstructors.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Your top instructors</p>
                  <div className="flex flex-wrap gap-2">
                    {memberStats.topInstructors.map(i => (
                      <span key={i.instructorId} className="inline-flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1 text-xs font-medium text-gray-700">
                        {i.name}
                        <span className="text-gray-400">{i.sessionsTogether} together</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Guest passes ── */}
          {guestPassBalance > 0 || guestPasses.some(p => p.amount < 0) ? (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Guest passes</h3>
                <span className="text-xs text-gray-400">{guestPassBalance} remaining</span>
              </div>
              {guestPasses.filter(p => p.amount < 0).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Guests you've brought</p>
                  {guestPasses.filter(p => p.amount < 0).map(p => (
                    <div key={p.id} className="flex items-center gap-3 text-xs py-1 border-b border-gray-50 last:border-0">
                      <span className="flex-1 text-gray-700">{p.guestName ?? 'Guest'}</span>
                      <span className="text-gray-400 shrink-0">
                        {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* ── Payment methods ── */}
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Payment methods</h3>
            <p className="text-xs text-gray-500">Manage your saved cards, view invoices and billing history.</p>
            <button
              onClick={handleManagePayments}
              className="text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Manage payment methods →
            </button>
          </div>

          {/* ══ ACTIVITY ═════════════════════════════════════════════════════ */}
          <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase px-1 pt-2">Activity</p>

          {/* ── Activity feed ── */}
          <ActivityFeed pastBookings={pastBookings} transactions={transactions} />

          {/* ── Purchase history ── */}
          {purchases.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Purchase history</h3>
              <div className="space-y-2">
                {purchases.map(sale => (
                  <div key={sale.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700 font-medium truncate">
                        {(sale.items as import('@/lib/api').CartSaleItem[]).map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}
                      </p>
                      <p className="text-gray-400">
                        {new Date(sale.soldAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        <span className="capitalize">{sale.paymentMethod}</span>
                        {sale.refundedAt && <span className="text-red-500 ml-1">· Refunded</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {sale.totalCents > 0 && (
                        <p className={`font-semibold tabular-nums ${sale.refundedAt ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {(sale.totalCents / 100).toFixed(2)}
                        </p>
                      )}
                      {sale.totalCredits > 0 && (
                        <p className="text-gray-500">{sale.totalCredits} cr</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Calendar subscribe ── */}
          {icalUrl && (
            <div data-testid="ical-member-card" className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Subscribe to my schedule</h3>
              <p className="text-xs text-gray-500">Add your upcoming classes to Google Calendar or Apple Calendar.</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(icalUrl).then(() => {
                      setIcalCopied(true)
                      setTimeout(() => setIcalCopied(false), 2000)
                    })
                  }}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {icalCopied ? '✓ Copied!' : 'Copy iCal URL'}
                </button>
                <a
                  href={`webcal://${icalUrl.replace(/^https?:\/\//, '')}`}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Open in Calendar
                </a>
              </div>
            </div>
          )}

          {/* ── Instructor calendar subscribe ── */}
          {instructorIcalUrl && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Subscribe to my teaching schedule</h3>
              <p className="text-xs text-gray-500">Add all classes you&apos;re teaching to Google Calendar or Apple Calendar.</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(instructorIcalUrl).then(() => {
                      setInstructorIcalCopied(true)
                      setTimeout(() => setInstructorIcalCopied(false), 2000)
                    })
                  }}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {instructorIcalCopied ? '✓ Copied!' : 'Copy iCal URL'}
                </button>
                <a
                  href={`webcal://${instructorIcalUrl.replace(/^https?:\/\//, '')}`}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Open in Calendar
                </a>
              </div>
            </div>
          )}

          {/* ── Fronthost: upcoming shifts ── */}
          {upcomingShifts.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Upcoming shifts</h3>
              <div className="space-y-2">
                {upcomingShifts.slice(0, 5).map(shift => {
                  const start = new Date(shift.startsAt)
                  const end = new Date(shift.endsAt)
                  const dateLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  const timeLabel = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                  return (
                    <div key={shift.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-xs font-medium text-gray-900">{dateLabel}</p>
                        <p className="text-xs text-gray-500">{timeLabel}</p>
                      </div>
                      {shift.note && <p className="text-xs text-gray-400 max-w-[120px] text-right truncate">{shift.note}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ══ SETTINGS ═════════════════════════════════════════════════════ */}
          <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase px-1 pt-2">Settings</p>

          {/* ── Account extras (referral, email prefs, self-pause, receipts, privacy) ── */}
          {token && (
            <div className="space-y-2">
              <AccountExtrasSection
                token={token}
                activeSubscriptionId={profile?.activeSubscription?.id ?? null}
                allowMemberPause={allowMemberPause}
                referralEnabled={referralEnabled}
              />
            </div>
          )}

          {/* ── Fronthost calendar subscribe ── */}
          {fronthostIcalUrl && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Subscribe to my shifts</h3>
              <p className="text-xs text-gray-500">Add your upcoming front desk shifts to Google Calendar or Apple Calendar.</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(fronthostIcalUrl).then(() => {
                      setFronthostIcalCopied(true)
                      setTimeout(() => setFronthostIcalCopied(false), 2000)
                    })
                  }}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {fronthostIcalCopied ? '✓ Copied!' : 'Copy iCal URL'}
                </button>
                <a
                  href={`webcal://${fronthostIcalUrl.replace(/^https?:\/\//, '')}`}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Open in Calendar
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {editingProfile && token && (
        <EditProfileModal
          profile={{ ...profile, ...(profileExtended ?? {}) }}
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
