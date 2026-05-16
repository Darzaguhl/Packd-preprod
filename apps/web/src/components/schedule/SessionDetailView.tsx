'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type SessionSpots } from '@/lib/api'
import type { SessionSlot } from '@packd/types'
import SpotPicker from '@/components/room/SpotPicker'
import CapacityBar from './CapacityBar'
import { sportConfig } from './constants'

interface Props {
  session: SessionSlot
  /** Admins and fronthosts bypass the past-class lock */
  privileged?: boolean
  onBack: () => void
  onBook: (sessionId: string) => Promise<void>
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
  onBack,
  onBook,
  onCancel,
  onWaitlist,
  onPickSpot,
}: Props) {
  const [spots, setSpots] = useState<SessionSpots | null>(null)
  const [spotsLoading, setSpotsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const cfg = sportConfig(s.sport)
  const isBooked = !!s.userBookingId
  const isWaitlisted = !!s.userWaitlistPosition
  const isFull = s.bookedCount >= s.capacity
  const hasSpot = !!s.userStationId
  const hasLayout = !spotsLoading && !!spots?.layout && spots.layout.stations.length > 0
  const isPast = !privileged && new Date(s.startsAt) < new Date()

  const durationMin = Math.round(
    (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000,
  )
  const startTime = new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const endTime = new Date(s.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

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
  }, [s.roomId, s.id])

  // Clicking a spot when NOT yet booked: book + assign in one action.
  // If the booking already exists (409 / "Already booked"), skip booking and
  // just assign the spot — the session state was stale.
  async function handleBookAndAssign(stationId: string) {
    setActionLoading(true)
    try {
      try {
        await onBook(s.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : ''
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

  // What hint to show above the map
  const mapHint = isBooked
    ? hasSpot
      ? 'Tap your spot to cancel, or tap another to move'
      : 'Tap an available spot to reserve your place'
    : isFull
      ? 'Class is full — join the waitlist'
      : 'Tap a spot to book and reserve your place'

  return (
    <div className="animate-[fadeIn_180ms_ease-out]">
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
        <div className="w-full lg:w-72 shrink-0 space-y-4">
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
              {!spotsLoading && !hasLayout && !isBooked && !isWaitlisted && (
                <button
                  onClick={isFull ? handleWaitlist : async () => { setActionLoading(true); try { await onBook(s.id) } catch { /* toast shown in handleBook */ } finally { setActionLoading(false) } }}
                  disabled={actionLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : isFull ? 'Join waitlist' : 'Book class'}
                </button>
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
            <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {isBooked ? 'Your spot' : 'Pick a spot'}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">{mapHint}</p>
              </div>
              <SpotPicker
                layout={spots.layout}
                assignments={spots.assignments}
                myStationId={s.userStationId ?? null}
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
  )
}
