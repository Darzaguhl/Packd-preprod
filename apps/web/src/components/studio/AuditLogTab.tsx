'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'

interface Props {
  studioId: string
  token: string
}

interface AuditEntry {
  id: string
  actorId: string
  actorRole: string
  action: string
  targetId: string | null
  meta: unknown
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  'credit.adjust':         'Adjusted credits',
  'credit.grant':          'Granted credits',
  'booking.cancel':        'Cancelled booking',
  'booking.cancel.admin':  'Cancelled booking',
  'refund.issue':          'Issued refund',
  'member.note.delete':    'Deleted member note',
  'membership.assign':     'Assigned membership plan',
  'membership.cancel':     'Cancelled membership',
  'membership.pause':      'Paused subscription',
  'membership.resume':     'Resumed subscription',
  'stripe.replay':         'Replayed Stripe event',
  'guest.checkin':         'Checked in guest',
  'guest.pass.grant':      'Granted guest pass',
  'promo.redeem':          'Redeemed promo code',
  'shift.create':          'Created shift',
  'shift.update':          'Updated shift',
  'shift.delete':          'Deleted shift',
  'shift.pattern.create':  'Created recurring shift',
  'shift.pattern.delete':  'Deleted recurring shift',
  'staff.role.add':        'Added staff role',
  'staff.role.remove':     'Removed staff role',
  'staff.pay.update':      'Updated pay rate',
  'schedule.create':       'Created class schedule',
  'schedule.delete':       'Deleted class schedule',
  'schedule.bulk':         'Bulk session operation',
  'session.cancel':        'Cancelled session',
  'session.reschedule':    'Rescheduled session',
  'session.checkin':       'Checked in member',
  'session.announce':      'Sent session announcement',
}

function fmtAction(action: string): string {
  return ACTION_LABELS[action] ?? action.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null

  // Skip pure ID fields — not useful to display
  if (/Id$|Ids$/.test(key) && key !== 'studioId') return null

  // Cents → currency
  if (key.endsWith('Cents') && typeof value === 'number') {
    const label = key === 'payRateHourlyCents' ? 'Hourly rate'
      : key === 'payRatePerHeadCents' ? 'Per-head rate'
      : key === 'amount' ? 'Amount'
      : key === 'totalCents' ? 'Total'
      : key.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').trim()
    return `${label}: ${(value / 100).toLocaleString('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}`
  }

  // ISO date strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  // daysOfWeek array
  if (key === 'daysOfWeek' && Array.isArray(value)) {
    return 'Days: ' + (value as number[]).map(i => DOW[i] ?? i).join(', ')
  }

  // Known field labels
  const FIELD_LABELS: Record<string, string> = {
    amount: 'Credits', credits: 'Credits', futureShiftsDeleted: 'Future shifts removed',
    affected: 'Sessions affected', role: 'Role', guestName: 'Guest',
    code: 'Code', subject: 'Subject', sent: 'Sent', reason: 'Reason',
    action: 'Action', note: 'Note', from: 'From', to: 'To',
    startTime: 'Start', endTime: 'End', startsAt: 'Start', endsAt: 'End',
    intervalWeeks: 'Every N weeks',
  }
  const label = FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${label}: ${new Date(value + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  }

  return `${label}: ${value}`
}

function fmtMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Object.keys(meta as object).length === 0) return null
  const parts = Object.entries(meta as Record<string, unknown>)
    .map(([k, v]) => fmtValue(k, v))
    .filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : null
}

const ROLE_COLOURS: Record<string, string> = {
  admin:         'bg-red-100 text-red-700',
  franchise_admin: 'bg-purple-100 text-purple-700',
  studio_admin:  'bg-blue-100 text-blue-700',
  instructor:    'bg-teal-100 text-teal-700',
  fronthost:     'bg-amber-100 text-amber-700',
  member:        'bg-gray-100 text-gray-500',
}

export default function AuditLogTab({ studioId, token }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.admin.auditLog(studioId, token).then(res => {
      setEntries(res.entries)
      setCursor(res.nextCursor)
      setHasMore(!!res.nextCursor)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [studioId, token])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const res = await api.admin.auditLog(studioId, token, cursor)
      setEntries(prev => [...prev, ...res.entries])
      setCursor(res.nextCursor)
      setHasMore(!!res.nextCursor)
    } catch { /* silent */ } finally { setLoadingMore(false) }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Audit Log</h3>
        <p className="text-xs text-gray-400 mt-0.5">Staff actions recorded in the last 90 days</p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No audit events yet</p>
      ) : (
        <div className="space-y-1">
          {entries.map(e => {
            const meta = fmtMeta(e.meta)
            const date = new Date(e.createdAt)
            const roleCls = ROLE_COLOURS[e.actorRole] ?? 'bg-gray-100 text-gray-500'
            return (
              <div key={e.id} data-testid="audit-entry" data-action={e.action} className="flex items-start gap-3 px-3 py-3 bg-white rounded-xl border border-gray-100">
                {/* Role badge */}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${roleCls}`}>
                  {e.actorRole.replace('_', ' ')}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{fmtAction(e.action)}</p>
                  {meta && <p className="text-xs text-gray-400 truncate mt-0.5">{meta}</p>}
                </div>

                {/* Time */}
                <time className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                  {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {' '}
                  {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl py-2.5 transition-colors disabled:opacity-40"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
