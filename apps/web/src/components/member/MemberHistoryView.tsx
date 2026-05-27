'use client'

import { useState } from 'react'
import type { UpcomingBooking, PastBooking, CreditTransaction, AdminMemberProfile } from '@/lib/api'
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
}

type Tab = 'upcoming' | 'history' | 'credits'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Member profile — either the member's own or the admin view */
  profile: MemberProfile | AdminMemberProfile
  upcoming: UpcomingBooking[]
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
  /** If provided, cancel button appears on upcoming bookings */
  onCancelBooking?: (bookingId: string) => Promise<void>
  /** Show email — for admin view */
  showEmail?: boolean
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
          <p className="text-xs text-gray-400 mt-0.5">{booking.creditsRequired} cr</p>
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
  onCancelBooking,
  showEmail = false,
}: Props) {
  const [tab, setTab] = useState<Tab>('upcoming')

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
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400 font-medium mb-1">Credits</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900">{creditBalance}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400 font-medium mb-1">Membership</p>
          {activeSubscription ? (
            <>
              <p className="text-sm font-semibold text-gray-900 leading-tight">{activeSubscription.planName}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-gray-400">
                  {activeSubscription.endDate
                    ? `Renews ${new Date(activeSubscription.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : 'Active'}
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-1">No active plan</p>
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
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {transactions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No credit transactions yet</p>
          ) : (
            transactions.map(t => <TransactionRow key={t.id} tx={t} />)
          )}
        </div>
      )}
    </div>
  )
}
