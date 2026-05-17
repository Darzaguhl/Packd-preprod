'use client'

import { useState, useEffect } from 'react'
import { api, type AdminSession, type AdminBooking } from '@/lib/api'

interface Props {
  session: AdminSession
  token: string
  onClose: () => void
  onSessionUpdate: (s: AdminSession) => void
  canCancel?: boolean
}

export default function SessionPanel({ session, token, onClose, onSessionUpdate, canCancel = true }: Props) {
  const [bookings, setBookings] = useState<AdminBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.admin.bookings(session.id, token)
      .then(setBookings)
      .finally(() => setLoading(false))
  }, [session.id, token])

  async function toggleCheckin(booking: AdminBooking) {
    setActionId(booking.id)
    try {
      const res = await api.admin.checkin(session.id, booking.id, token)
      setBookings(prev =>
        prev.map(b => b.id === booking.id
          ? { ...b, checkedIn: res.checkedIn, checkedInAt: res.checkedIn ? new Date().toISOString() : null }
          : b
        )
      )
    } finally {
      setActionId(null)
    }
  }

  async function cancelSession() {
    if (!confirm('Cancel this session? This cannot be undone.')) return
    setCancelling(true)
    try {
      await api.admin.updateSession(session.id, 'CANCELLED', token)
      onSessionUpdate({ ...session, status: 'CANCELLED' })
    } finally {
      setCancelling(false)
    }
  }

  const checkedInCount = bookings.filter(b => b.checkedIn).length
  const startTime = new Date(session.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const isCancelled = session.status === 'CANCELLED'

  return (
    <div className="h-full flex flex-col">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">{session.templateName}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{startTime} · {session.instructorName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{session.roomName}</p>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-50">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Check-in summary */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="shrink-0">
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {checkedInCount}
              <span className="text-gray-400 font-normal text-lg">/{session.bookedCount}</span>
            </p>
            <p className="text-xs text-gray-400">checked in</p>
          </div>
          {/* Three-segment bar: checked-in (black) · booked not in (amber) · empty (light gray) */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex gap-px">
              {session.capacity > 0 && (() => {
                const checkedInPct  = (checkedInCount / session.capacity) * 100
                const bookedPct     = ((session.bookedCount - checkedInCount) / session.capacity) * 100
                return (
                  <>
                    {checkedInPct > 0  && <div className="h-full bg-gray-900 transition-all duration-300 rounded-l-full" style={{ width: `${checkedInPct}%` }} />}
                    {bookedPct    > 0  && <div className="h-full bg-amber-400 transition-all duration-300" style={{ width: `${bookedPct}%` }} />}
                  </>
                )
              })()}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-900 inline-block" />Checked in</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />Booked</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-100 border border-gray-200 inline-block" />Empty</span>
            </div>
          </div>
        </div>

        {!isCancelled && canCancel && (
          <button
            onClick={cancelSession}
            disabled={cancelling}
            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {cancelling ? '…' : 'Cancel class'}
          </button>
        )}
      </div>

      {/* Attendee list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="p-5 text-center text-sm text-gray-400">No bookings yet</div>
        ) : (
          bookings.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                b.checkedIn ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
              }`}>
                {b.memberName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>

              {/* Name + email */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${b.checkedIn ? 'text-gray-900' : 'text-gray-700'}`}>
                  {b.memberName}
                </p>
                <p className="text-xs text-gray-400 truncate">{b.memberEmail}</p>
              </div>

              {/* Credits */}
              <span className="text-xs text-gray-400 tabular-nums shrink-0">{b.creditBalance} cr</span>

              {/* Check-in button */}
              <button
                onClick={() => toggleCheckin(b)}
                disabled={actionId === b.id || isCancelled}
                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-40 ${
                  b.checkedIn
                    ? 'bg-black text-white hover:bg-gray-700'
                    : 'border-2 border-gray-200 hover:border-gray-400'
                }`}
                aria-label={b.checkedIn ? 'Undo check-in' : 'Check in'}
              >
                {actionId === b.id ? (
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : b.checkedIn ? (
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
