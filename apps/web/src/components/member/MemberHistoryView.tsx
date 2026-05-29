'use client'

import { useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import type { UpcomingBooking, PastBooking, CreditTransaction, AdminMemberProfile, MembershipPlan } from '@/lib/api'
import type { MemberProfile } from '@packd/types'
import { sportConfig } from '@/components/schedule/constants'
import { useTimeFormat } from '@/lib/time-format-context'
import { fmtTime } from '@/lib/fmt-time'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function durationMin(startsAt: string, endsAt: string) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000)
}

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  CONFIRMED:      { label: 'Attended',       color: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:      { label: 'Cancelled',      color: 'bg-gray-100 text-gray-500' },
  LATE_CANCELLED: { label: 'Late cancel',    color: 'bg-amber-100 text-amber-700' },
  NO_SHOW:        { label: 'No show',        color: 'bg-red-100 text-red-600' },
}

const TX_CONFIG: Record<string, { label: string; color: string }> = {
  PURCHASE:         { label: 'Credit purchase', color: 'text-emerald-600' },
  CLASS_DEBIT:      { label: 'Class',           color: 'text-gray-700' },
  REFUND:           { label: 'Refund',          color: 'text-emerald-600' },
  LATE_CANCEL_FEE:  { label: 'Late cancel fee', color: 'text-amber-600' },
  NO_SHOW_FEE:      { label: 'No-show fee',     color: 'text-red-600' },
  MANUAL_ADJUSTMENT:{ label: 'Adjustment',       color: 'text-gray-700' },
  MEMBERSHIP_RENEWAL:{ label: 'Membership',      color: 'text-emerald-600' },
  EXPIRY:            { label: 'Credits expired', color: 'text-red-500' },
}

type Tab = 'upcoming' | 'history' | 'credits'

// ─── Plan card ────────────────────────────────────────────────────────────────

function fmtPrice(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function PlanCard({
  plan,
  isCurrent,
  hasActivePlan,
  onSelect,
  onBuy,
  subscribing,
}: {
  plan: Omit<MembershipPlan, 'activeSubscriptions'>
  isCurrent: boolean
  hasActivePlan: boolean
  onSelect: (id: string) => void
  onBuy?: (id: string) => void
  subscribing: boolean
}) {
  const intervalLabel = plan.intervalMonths === 1 ? 'month' : `${plan.intervalMonths} months`

  return (
    <div className={`relative flex flex-col gap-3 rounded-2xl border p-5 transition-shadow ${
      isCurrent ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:shadow-sm'
    }`}>
      {isCurrent && (
        <span className="absolute top-3 right-3 text-[10px] font-semibold bg-white/20 text-white px-2 py-0.5 rounded-full">
          Current plan
        </span>
      )}
      <div>
        <p className={`text-base font-semibold ${isCurrent ? 'text-white' : 'text-gray-900'}`}>{plan.name}</p>
        {plan.description && (
          <p className={`text-xs mt-0.5 ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>{plan.description}</p>
        )}
      </div>
      <div className="flex items-end gap-1">
        <span className={`text-2xl font-bold tabular-nums ${isCurrent ? 'text-white' : 'text-gray-900'}`}>
          {fmtPrice(plan.priceInCents)}
        </span>
        <span className={`text-xs pb-0.5 ${isCurrent ? 'text-gray-300' : 'text-gray-400'}`}>/ {intervalLabel}</span>
      </div>
      {plan.creditsPerCycle !== null && plan.creditsPerCycle > 0 && (
        <p className={`text-xs ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>
          {plan.creditsPerCycle} credits per {intervalLabel}
        </p>
      )}
      {plan.isIntroOffer && (
        <span className="inline-flex w-fit text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
          Intro offer
        </span>
      )}
      {plan.creditExpiryDays && (
        <p className={`text-xs ${isCurrent ? 'text-gray-300' : 'text-gray-400'}`}>
          Credits expire in {plan.creditExpiryDays} days
        </p>
      )}
      {!isCurrent && (() => {
        const introUsed = plan.isIntroOffer && (plan.memberRedemptions ?? 0) >= (plan.maxRedemptionsPerMember ?? 1)
        return (
          <div className="mt-auto flex flex-col gap-2">
            {introUsed ? (
              <p className="text-xs text-gray-400 text-center italic">Already redeemed</p>
            ) : plan.priceInCents > 0 ? (
              // Paid plan — must go through Stripe
              onBuy && plan.stripePriceId ? (
                <button
                  onClick={() => onBuy(plan.id)}
                  disabled={subscribing}
                  className="w-full py-2 rounded-xl text-sm font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {subscribing ? '…' : 'Buy online'}
                </button>
              ) : (
                <p className="text-xs text-gray-400 text-center">Contact your studio to subscribe</p>
              )
            ) : (
              // Free plan — direct subscribe
              <button
                onClick={() => onSelect(plan.id)}
                disabled={subscribing}
                className="w-full py-2 rounded-xl text-sm font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {subscribing ? 'Activating…' : hasActivePlan ? 'Switch to this plan' : 'Subscribe'}
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Member profile — either the member's own or the admin view */
  profile: MemberProfile | AdminMemberProfile
  upcoming: UpcomingBooking[]
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
  /** Available plans to display/purchase */
  plans?: Omit<MembershipPlan, 'activeSubscriptions'>[]
  /** If provided, cancel button appears on upcoming bookings */
  onCancelBooking?: (bookingId: string) => Promise<void>
  /** If provided, subscribe button appears on plan cards */
  onSubscribe?: (planId: string) => Promise<void>
  /** If provided, "Buy online" button appears on plans with a stripePriceId */
  onBuyCredits?: (planId: string, promoCodeId?: string) => Promise<void>
  /** If provided, cancel membership button appears */
  onCancelMembership?: () => Promise<void>
  /** If provided, an edit button appears on the profile card (member's own view only) */
  onEditProfile?: () => void
  /** Show email — for admin view */
  showEmail?: boolean
  /** Extended profile fields (member self-view) */
  birthday?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UpcomingCard({
  booking,
  onCancel,
}: {
  booking: UpcomingBooking
  onCancel?: (id: string) => Promise<void>
}) {
  const timeFormat = useTimeFormat()
  const [cancelling, setCancelling] = useState(false)
  const cfg = sportConfig(booking.sport)

  async function handleCancel() {
    if (!onCancel) return
    setCancelling(true)
    try { await onCancel(booking.id) } finally { setCancelling(false) }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden flex items-stretch">
      <div className={`w-1 shrink-0 ${cfg.accent}`} />
      <div className="flex-1 px-4 py-3 flex items-center gap-4">
        <div className="shrink-0 w-24">
          <p className="text-xs font-medium text-gray-500">{formatDate(booking.startsAt)}</p>
          <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmtTime(booking.startsAt, timeFormat)}</p>
          <p className="text-xs text-gray-400">{durationMin(booking.startsAt, booking.endsAt)}m</p>
        </div>
        <div className="w-px h-10 bg-gray-100 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{booking.templateName}</p>
          <p className="text-xs text-gray-500 truncate">{booking.instructorName} · {booking.roomName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {booking.creditsRequired} cr
            {booking.stationLabel && (
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="text-gray-300">·</span>
                <span className="font-medium text-gray-500">Spot {booking.stationLabel}</span>
              </span>
            )}
          </p>
        </div>
        {onCancel && (
          <button
            onClick={handleCancel}
            disabled={cancelling || booking.sessionStatus === 'CANCELLED'}
            className="shrink-0 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 px-2 py-1"
          >
            {cancelling
              ? <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  )
}

function PastBookingRow({ booking }: { booking: PastBooking }) {
  const timeFormat = useTimeFormat()
  const cfg = sportConfig(booking.sport)
  const status = booking.status === 'CONFIRMED'
    ? (booking.checkedIn ? 'CONFIRMED' : 'NO_SHOW')
    : booking.status
  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.CONFIRMED

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.accent}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{booking.templateName}</p>
        <p className="text-xs text-gray-400 truncate">
          {formatDate(booking.startsAt)} · {fmtTime(booking.startsAt, timeFormat)} · {booking.instructorName}
        </p>
      </div>
      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${sc.color}`}>
        {sc.label}
      </span>
    </div>
  )
}

function TransactionRow({ tx }: { tx: CreditTransaction }) {
  const cfg = TX_CONFIG[tx.type] ?? TX_CONFIG.MANUAL_ADJUSTMENT
  const isPositive = tx.amount > 0

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {tx.note ?? cfg.label}
        </p>
        <p className="text-xs text-gray-400">{formatDateTime(tx.createdAt)}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${isPositive ? 'text-emerald-600' : 'text-gray-700'}`}>
        {isPositive ? '+' : ''}{tx.amount} cr
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MemberHistoryView({
  profile,
  upcoming,
  pastBookings,
  transactions,
  plans = [],
  onCancelBooking,
  onSubscribe,
  onBuyCredits,
  onCancelMembership,
  onEditProfile,
  showEmail = false,
  birthday,
  emergencyContactName,
  emergencyContactPhone,
}: Props) {
  const [tab, setTab] = useState<Tab>('upcoming')
  const [showPlans, setShowPlans] = useState(false)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [cancellingMembership, setCancellingMembership] = useState(false)
  const [confirmCancelMembership, setConfirmCancelMembership] = useState(false)
  const [promoInput, setPromoInput] = useState('')
  const [promoValidating, setPromoValidating] = useState(false)
  const [promoResult, setPromoResult] = useState<{ promoCodeId: string; label: string } | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)

  async function handleValidatePromo(studioId?: string) {
    if (!promoInput.trim() || !studioId) return
    setPromoValidating(true)
    setPromoResult(null)
    setPromoError(null)
    try {
      const { data: { session } } = await createClient().auth.getSession()
      const t = session?.access_token
      if (!t) return
      const res = await api.promos.redeem(promoInput.trim(), studioId, t)
      if (res.discount) {
        const label = res.discount.type === 'MEMBERSHIP_PCT'
          ? `${res.discount.value}% off`
          : `${(res.discount.value / 100).toFixed(2)} off`
        setPromoResult({ promoCodeId: res.discount.promoCodeId, label })
      } else {
        setPromoError('This code gives credits, not a membership discount')
      }
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : 'Invalid promo code')
    } finally {
      setPromoValidating(false)
    }
  }

  async function handleBuy(planId: string) {
    if (!onBuyCredits) return
    setSubscribing(planId)
    try {
      await onBuyCredits(planId, promoResult?.promoCodeId)
    } finally {
      setSubscribing(null)
    }
  }

  async function handleSubscribe(planId: string) {
    if (!onSubscribe) return
    setSubscribing(planId)
    try {
      await onSubscribe(planId)
      setShowPlans(false)
    } finally {
      setSubscribing(null)
    }
  }

  async function handleCancelMembership() {
    if (!onCancelMembership) return
    setCancellingMembership(true)
    try {
      await onCancelMembership()
      setConfirmCancelMembership(false)
    } finally {
      setCancellingMembership(false)
    }
  }

  const { firstName, lastName, email, creditBalance } = profile
  const activeSubscription = profile.activeSubscription ?? null

  return (
    <div className="space-y-4">
      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gray-900 text-white flex items-center justify-center text-base font-bold shrink-0 select-none">
          {initials(firstName, lastName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900">{firstName} {lastName}</p>
          {showEmail && <p className="text-sm text-gray-400 truncate">{email}</p>}
          {'joinedAt' in profile && (
            <p className="text-xs text-gray-400 mt-0.5">
              Member since {formatDateTime(profile.joinedAt)}
            </p>
          )}
          {birthday && (
            <p className="text-xs text-gray-400 mt-0.5">
              🎂 {new Date(birthday).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}
              {Math.floor((Date.now() - new Date(birthday).getTime()) / (365.25 * 24 * 3600 * 1000))} yo
            </p>
          )}
          {(emergencyContactName || emergencyContactPhone) && (
            <p className="text-xs text-amber-600 mt-0.5 truncate">
              🚨 {[emergencyContactName, emergencyContactPhone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {onEditProfile && (
          <button
            onClick={onEditProfile}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
              <path d="M11 2l3 3-8 8H3v-3l8-8z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Edit
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400 font-medium mb-1">Credits</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900">{creditBalance}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex flex-col justify-between gap-2">
          <p className="text-xs text-gray-400 font-medium">Membership</p>
          {activeSubscription ? (
            <>
              <div>
                <p className="text-sm font-semibold text-gray-900 leading-tight">{activeSubscription.planName}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    activeSubscription.status === 'PAST_DUE' ? 'bg-red-400' :
                    activeSubscription.status === 'PAUSED' ? 'bg-amber-400' : 'bg-emerald-400'
                  }`} />
                  <span className="text-xs text-gray-400">
                    {activeSubscription.status === 'PAST_DUE' ? 'Payment failed — please update your card' :
                     activeSubscription.status === 'PAUSED' ? 'Paused' :
                     activeSubscription.nextBillingDate
                       ? `Next billing ${new Date(activeSubscription.nextBillingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                       : activeSubscription.endDate
                         ? `Renews ${new Date(activeSubscription.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                         : 'Active'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {onSubscribe && plans.length > 0 && (
                  <button
                    onClick={() => setShowPlans(true)}
                    className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
                  >
                    Change plan
                  </button>
                )}
                {onCancelMembership && (
                  <button
                    onClick={() => setConfirmCancelMembership(true)}
                    className="text-xs text-red-400 hover:text-red-600 underline underline-offset-2"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">No active plan</p>
              {onSubscribe && plans.length > 0 && (
                <button
                  onClick={() => setShowPlans(true)}
                  className="text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors w-fit"
                >
                  Browse plans
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {([
          { id: 'upcoming', label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ''}` },
          { id: 'history',  label: `History${pastBookings.length ? ` (${pastBookings.length})` : ''}` },
          { id: 'credits',  label: `Credits${transactions.length ? ` (${transactions.length})` : ''}` },
        ] as { id: Tab; label: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'upcoming' && (
        <div className="space-y-2">
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No upcoming bookings</p>
          ) : (
            upcoming.map(b => (
              <UpcomingCard key={b.id} booking={b} onCancel={onCancelBooking} />
            ))
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {pastBookings.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No class history yet</p>
          ) : (
            pastBookings.map(b => <PastBookingRow key={b.id} booking={b} />)
          )}
        </div>
      )}

      {tab === 'credits' && (
        <>
          {/* Expiry warning — show if any credits expire within 30 days */}
          {(() => {
            const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            const expiring = transactions.filter(
              t => t.expiresAt && t.amount > 0 && new Date(t.expiresAt) <= soon && new Date(t.expiresAt) > new Date()
            )
            if (expiring.length === 0) return null
            const earliest = expiring.reduce((a, b) =>
              new Date(a.expiresAt!) < new Date(b.expiresAt!) ? a : b
            )
            const daysLeft = Math.ceil((new Date(earliest.expiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
                <span>⏳</span>
                <span>
                  {earliest.amount} credit{earliest.amount !== 1 ? 's' : ''} expire{earliest.amount === 1 ? 's' : ''} in{' '}
                  <strong>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong>
                  {expiring.length > 1 ? ` (+${expiring.length - 1} more batch${expiring.length > 2 ? 'es' : ''})` : ''}.
                  Use them before they&apos;re gone.
                </span>
              </div>
            )
          })()}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No credit transactions yet</p>
            ) : (
              transactions.map(t => <TransactionRow key={t.id} tx={t} />)
            )}
          </div>
        </>
      )}

      {/* Cancel membership confirmation */}
      {confirmCancelMembership && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setConfirmCancelMembership(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl px-6 pt-6 pb-8 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-88 sm:rounded-2xl sm:shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Cancel membership?</h2>
            <p className="text-sm text-gray-500 mb-6">
              Your membership will be cancelled immediately. Any credits already granted will remain in your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmCancelMembership(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Keep membership
              </button>
              <button
                onClick={handleCancelMembership}
                disabled={cancellingMembership}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {cancellingMembership ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Plans overlay */}
      {showPlans && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowPlans(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-gray-50 rounded-t-2xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-gray-50 px-5 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{activeSubscription ? 'Switch plan' : 'Membership Plans'}</h2>
              <button onClick={() => setShowPlans(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {/* Promo code input for membership discounts */}
            {onBuyCredits && (
              <div className="px-5 pb-2">
                <p className="text-xs text-gray-500 mb-1.5">Have a promo code?</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoResult(null); setPromoError(null) }}
                    placeholder="ENTER CODE"
                    className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2 font-mono uppercase outline-none focus:border-gray-400"
                  />
                  <button
                    onClick={() => handleValidatePromo(profile.studioId ?? undefined)}
                    disabled={promoValidating || !promoInput.trim()}
                    className="text-xs px-3 py-2 bg-gray-900 text-white rounded-xl disabled:opacity-40 hover:bg-gray-700 transition-colors"
                  >
                    {promoValidating ? '…' : 'Apply'}
                  </button>
                </div>
                {promoResult && (
                  <p className="text-xs text-emerald-600 mt-1.5 font-medium">✓ {promoResult.label} applied — select a plan below</p>
                )}
                {promoError && (
                  <p className="text-xs text-red-500 mt-1.5">{promoError}</p>
                )}
              </div>
            )}

            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plans.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrent={activeSubscription?.planName === plan.name}
                  hasActivePlan={!!activeSubscription}
                  onSelect={handleSubscribe}
                  onBuy={onBuyCredits ? handleBuy : undefined}
                  subscribing={subscribing === plan.id}
                />
              ))}
            </div>
            <p className="text-center text-xs text-gray-400 pb-6 px-5">
              {activeSubscription
                ? 'Your current plan will be cancelled and the new plan starts immediately.'
                : 'Subscription starts immediately. Credits are added to your account right away.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
