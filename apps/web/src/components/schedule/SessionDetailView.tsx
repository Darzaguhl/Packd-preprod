'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type SessionSpots } from '@/lib/api'
import type { SessionSlot } from '@packd/types'
import SpotPicker from '@/components/room/SpotPicker'
import CapacityBar from './CapacityBar'
import { sportConfig } from './constants'
import { useTimeFormat } from '@/lib/time-format-context'
import { useTimezone } from '@/lib/timezone-context'
import { fmtTime } from '@/lib/fmt-time'
import WaiverModal from './WaiverModal'

interface Props {
  session: SessionSlot
  /** Admins and fronthosts bypass the past-class lock */
  privileged?: boolean
  cancelPolicy?: { windowHours: number; feeCredits: number }
  onBack: () => void
  onBook: (sessionId: string, memberNote?: string) => Promise<void>
  onCancel: (bookingId: string, sessionId: string) => Promise<void>
  onWaitlist: (sessionId: string) => Promise<void>
  onPickSpot: (stationId: string | null) => Promise<void>
}

async function getFreshToken() {
  const { data } = await createClient().auth.getSession()
  return data.session?.access_token ?? ''
}

export default function SessionDetailView({
  session: s,
  privileged = false,
  cancelPolicy,
  onBack,
  onBook,
  onCancel,
  onWaitlist,
  onPickSpot,
}: Props) {
  const [spots, setSpots] = useState<SessionSpots | null>(null)
  const [spotsLoading, setSpotsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [memberNote, setMemberNote] = useState('')
  const [showNoteField, setShowNoteField] = useState(false)

  // Waiver state — set when booking returns WAIVER_REQUIRED
  const [pendingBookArgs, setPendingBookArgs] = useState<{ sessionId: string; note?: string } | null>(null)
  const [waiverData, setWaiverData] = useState<{ id: string; title: string; body: string } | null>(null)

  const timeFormat = useTimeFormat()
  const timezone = useTimezone()
  const cfg = sportConfig(s.sport)
  const isBooked = !!(s.userBookingId ?? spots?.myBookingId)
  const isWaitlisted = !!s.userWaitlistPosition
  const isFull = s.bookedCount >= s.capacity
  // Prefer server-authoritative stationId from spots over potentially stale session prop
  const effectiveStationId = spots?.myStationId ?? s.userStationId ?? null
  const hasSpot = !!effectiveStationId
  const hasLayout = !spotsLoading && !!spots?.layout && spots.layout.stations.length > 0
  const isPast = !privileged && new Date(s.startsAt) < new Date()

  const durationMin = Math.round(
    (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000,
  )
  const startTime = fmtTime(s.startsAt, timeFormat, timezone)
  const endTime = fmtTime(s.endsAt, timeFormat, timezone)

  async function refreshSpots() {
    const t = await getFreshToken()
    const fresh = await api.rooms.spots(s.roomId, s.id, t).catch(() => null)
    if (fresh) setSpots(fresh)
  }

  useEffect(() => {
    setSpotsLoading(true)
    getFreshToken()
      .then(t => api.rooms.spots(s.roomId, s.id, t))
      .then(setSpots)
      .catch(() => setSpots(null))
      .finally(() => setSpotsLoading(false))

    // On cold load getFreshToken() may return '' before Supabase restores the
    // session from storage. Re-fetch spots once auth is confirmed so
    // myBookingId / myStationId arrive server-authoritative.
    let reloaded = false
    const { data: { subscription } } = createClient().auth.onAuthStateChange(
      (_event, session) => {
        if (session && !reloaded) {
          reloaded = true
          refreshSpots()
        }
      },
    )
    return () => subscription.unsubscribe()
  }, [s.roomId, s.id])

  // Clicking a spot when NOT yet booked: book + assign in one action.
  // If the booking already exists (409 / "Already booked"), skip booking and
  // just assign the spot — the session state was stale.
  async function handleBookAndAssign(stationId: string) {
    setActionLoading(true)
    try {
      try {
        await handleBookWithWaiverCheck(s.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : ''
        // If waiver modal opened, abort spot assignment — user must retry after signing
        if (msg.includes('waiver_required')) return
        if (!msg.includes('already booked') && !msg.includes('unique')) throw e
        // Already booked — fall through to spot assignment
      }
      await onPickSpot(stationId)
      await refreshSpots()
    } finally {
      setActionLoading(false)
    }
  }

  // Clicking a spot when already booked: just reassign
  async function handlePickSpot(stationId: string | null) {
    setActionLoading(true)
    try {
      await onPickSpot(stationId)
      await refreshSpots()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleBookWithWaiverCheck(sessionId: string, note?: string) {
    try {
      await onBook(sessionId, note)
    } catch (e) {
      const err = e as Error & { error?: string; waiverId?: string }
      if (err.message === 'WAIVER_REQUIRED' && err.waiverId && s.studioId) {
        // Fetch waiver content and show modal
        const t = await getFreshToken()
        const res = await api.waivers.getActive(s.studioId, t).catch(() => null)
        if (res?.waiver) {
          setWaiverData({ id: res.waiver.id, title: res.waiver.title, body: res.waiver.body })
          setPendingBookArgs({ sessionId, note })
          return
        }
      }
      throw e
    }
  }

  async function handleSignAndBook() {
    if (!pendingBookArgs || !waiverData) return
    const t = await getFreshToken()
    await api.waivers.sign(waiverData.id, t)
    setWaiverData(null)
    const { sessionId, note } = pendingBookArgs
    setPendingBookArgs(null)
    await onBook(sessionId, note)
  }

  async function handleCancel() {
    setActionLoading(true)
    try {
      await onCancel(s.userBookingId!, s.id)
      await refreshSpots()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleWaitlist() {
    setActionLoading(true)
    try {
      await onWaitlist(s.id)
    } finally {
      setActionLoading(false)
    }
  }

  // Cancellation window hint
  const cancelHint = (() => {
    if (!isBooked || isPast || privileged || !cancelPolicy) return null
    const now = Date.now()
    const classStart = new Date(s.startsAt).getTime()
    const windowMs = cancelPolicy.windowHours * 60 * 60 * 1000
    const windowCutoff = classStart - windowMs
    const msUntilCutoff = windowCutoff - now
    if (msUntilCutoff <= 0) {
      // Already in late-cancel window
      return cancelPolicy.feeCredits > 0
        ? { type: 'late' as const, text: `Late cancellation — ${cancelPolicy.feeCredits} credit fee applies` }
        : { type: 'late' as const, text: 'Late cancellation window active' }
    }
    const hoursLeft = Math.floor(msUntilCutoff / (60 * 60 * 1000))
    const minsLeft = Math.floor((msUntilCutoff % (60 * 60 * 1000)) / 60000)
    const timeStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`
    return {
      type: 'free' as const,
      text: cancelPolicy.feeCredits > 0
        ? `Free cancellation for ${timeStr} · ${cancelPolicy.feeCredits} credit fee after`
        : `Free cancellation for ${timeStr}`,
    }
  })()

  // What hint to show above the map
  const mapHint = isBooked
    ? hasSpot
      ? 'Tap your spot to cancel, or tap another to move'
      : 'Tap an available spot to reserve your place'
    : isFull
      ? 'Class is full — join the waitlist'
      : 'Tap a spot to book and reserve your place'

  return (
    <>
    <div className="animate-[fadeIn_180ms_ease-out]" data-testid="session-detail">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-5"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to schedule
      </button>

      <div className="flex gap-6 items-start flex-col lg:flex-row">
        {/* ── Left: class info + actions ── */}
        <div className="w-full lg:w-64 shrink-0 space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className={`h-1.5 w-full ${cfg.accent}`} />
            <div className="p-5 space-y-4">
              {/* Time */}
              <div>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{startTime}</p>
                <p className="text-sm text-gray-400">{endTime} · {durationMin} min</p>
              </div>
              <div className="h-px bg-gray-100" />
              {/* Class details */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900">{s.templateName}</h2>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{s.instructorName}</p>
                <p className="text-sm text-gray-400">{s.roomName}</p>
              </div>
              <div className="h-px bg-gray-100" />
              {/* Capacity + credits */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{s.bookedCount}/{s.capacity} booked</span>
                  <span className="font-medium text-gray-900">{s.creditsRequired} credits</span>
                </div>
                <CapacityBar booked={s.bookedCount} capacity={s.capacity} />
              </div>
              {/* Status badges */}
              {isBooked && (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  You're booked
                </div>
              )}
              {isWaitlisted && (
                <div className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                  #{s.userWaitlistPosition} on the waitlist
                </div>
              )}

            </div>
          </div>

          {/* ── Action buttons ── */}

          {isPast ? (
            <p className="text-xs text-center text-gray-400 py-1">This class has already started</p>
          ) : (
            <>
              {/* No layout: show full book/cancel/waitlist controls */}
              {!spotsLoading && !hasLayout && !isBooked && !isWaitlisted && !isFull && (
                <div className="space-y-2">
                  {showNoteField ? (
                    <textarea
                      value={memberNote}
                      onChange={e => setMemberNote(e.target.value)}
                      placeholder="Any notes for the instructor? (injuries, preferences…)"
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowNoteField(true)}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      + Add a note for the instructor
                    </button>
                  )}
                  <button
                    data-testid="book-btn"
                    onClick={async () => {
                      setActionLoading(true)
                      try {
                        await handleBookWithWaiverCheck(s.id, memberNote || undefined)
                        await refreshSpots()
                      } catch { /* toast shown in handleBook */ }
                      finally { setActionLoading(false) }
                    }}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    {actionLoading ? '…' : 'Book class'}
                  </button>
                </div>
              )}

              {!spotsLoading && !hasLayout && !isBooked && !isWaitlisted && isFull && (
                <button
                  data-testid="waitlist-btn"
                  onClick={handleWaitlist}
                  disabled={actionLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : 'Join waitlist'}
                </button>
              )}

              {/* Cancellation window hint */}
              {cancelHint && (
                <div className={`flex items-start gap-1.5 text-xs rounded-xl px-3 py-2 ${
                  cancelHint.type === 'late'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-blue-50 text-blue-700'
                }`}>
                  <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  {cancelHint.text}
                </div>
              )}

              {/* Cancel: always visible; active only when booked + spot picked (or no layout) */}
              {(() => {
                const needsSpot = isBooked && hasLayout && !hasSpot
                const inactive = !isBooked || needsSpot
                const title = !isBooked
                  ? 'Book a class first'
                  : needsSpot
                    ? 'Pick a spot first'
                    : 'Cancel your booking'
                return (
                  <button
                    data-testid="cancel-btn"
                    onClick={inactive ? undefined : handleCancel}
                    disabled={actionLoading || inactive}
                    title={title}
                    className={`w-full py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      inactive
                        ? 'border-gray-200 text-gray-300 bg-white cursor-not-allowed'
                        : 'border-red-200 text-red-500 hover:bg-red-50 bg-white disabled:opacity-40'
                    }`}
                  >
                    {actionLoading ? '…' : 'Cancel booking'}
                  </button>
                )
              })()}

              {/* Waitlisted: leave waitlist */}
              {isWaitlisted && !isBooked && (
                <button
                  onClick={handleWaitlist}
                  disabled={actionLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50 bg-white disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : 'Leave waitlist'}
                </button>
              )}

              {/* Full + not booked/waitlisted + has layout: offer waitlist */}
              {!isBooked && !isWaitlisted && isFull && hasLayout && (
                <button
                  onClick={handleWaitlist}
                  disabled={actionLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : 'Join waitlist'}
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Right: spot picker map ── */}
        <div className="flex-1 min-w-0">
          {spotsLoading ? (
            <div className="h-64 bg-white rounded-2xl border border-gray-100 animate-pulse" />
          ) : spots?.layout && spots.layout.stations.length > 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-3 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {isBooked ? 'Your spot' : 'Pick a spot'}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">{mapHint}</p>
              </div>
              <SpotPicker
                layout={spots.layout}
                assignments={spots.assignments}
                myStationId={effectiveStationId}
                onPick={
                  actionLoading || isPast
                    ? () => {}
                    : isBooked
                      ? (id: string | null) => id === null
                          ? handleCancel()          // tapped own spot → cancel booking
                          : handlePickSpot(id)      // tapped another spot → move
                      : isFull
                        ? () => {}                  // full, can't book by picking
                        : (id: string | null) => id ? handleBookAndAssign(id) : Promise.resolve()
                }
              />
            </div>
          ) : !spotsLoading && (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400 bg-white border border-gray-100 rounded-2xl">
              No room layout configured
            </div>
          )}
        </div>
      </div>
    </div>

    {waiverData && (
      <WaiverModal
        title={waiverData.title}
        body={waiverData.body}
        onSign={handleSignAndBook}
        onClose={() => { setWaiverData(null); setPendingBookArgs(null) }}
      />
    )}
    </>
  )
}
