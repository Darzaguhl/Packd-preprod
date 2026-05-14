'use client'

import { useState } from 'react'
import type { SessionSlot } from '@packd/types'
import { api } from '@/lib/api'

const SPORT_COLORS: Record<string, string> = {
  CYCLING: 'bg-orange-100 text-orange-700',
  HIIT: 'bg-red-100 text-red-700',
  YOGA: 'bg-green-100 text-green-700',
  PILATES: 'bg-purple-100 text-purple-700',
  BARRE: 'bg-pink-100 text-pink-700',
  STRENGTH: 'bg-blue-100 text-blue-700',
  OTHER: 'bg-gray-100 text-gray-700',
}

export default function ScheduleView({
  sessions,
  token,
}: {
  sessions: SessionSlot[]
  token: string
}) {
  const [slots, setSlots] = useState(sessions)
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function book(sessionId: string) {
    setLoading(sessionId)
    setMessage(null)
    try {
      await api.bookings.create(sessionId, token)
      setMessage('Booked!')
      setSlots((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, bookedCount: s.bookedCount + 1, userBookingId: 'booked' }
            : s,
        ),
      )
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to book')
    } finally {
      setLoading(null)
    }
  }

  async function joinWaitlist(sessionId: string) {
    setLoading(sessionId)
    try {
      const res = await api.waitlist.join(sessionId, token)
      if (res.success) setMessage(`You're #${res.data.position} on the waitlist`)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to join waitlist')
    } finally {
      setLoading(null)
    }
  }

  async function cancel(bookingId: string, sessionId: string) {
    setLoading(sessionId)
    try {
      const res = await api.bookings.cancel(bookingId, token)
      if (res.success) {
        setMessage(res.data.isLateCancel ? 'Cancelled (late cancel fee applied)' : 'Cancelled')
        setSlots((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, bookedCount: s.bookedCount - 1, userBookingId: undefined }
              : s,
          ),
        )
      }
    } catch {
      setMessage('Failed to cancel')
    } finally {
      setLoading(null)
    }
  }

  const grouped = slots.reduce<Record<string, SessionSlot[]>>((acc, s) => {
    const day = new Date(s.startsAt).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    })
    ;(acc[day] ??= []).push(s)
    return acc
  }, {})

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Schedule</h1>
      {message && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
          {message}
        </div>
      )}
      {Object.entries(grouped).map(([day, daySessions]) => (
        <div key={day} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">{day}</h2>
          <div className="space-y-2">
            {daySessions.map((s) => {
              const isFull = s.bookedCount >= s.capacity
              const isLoading = loading === s.id
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="text-center w-12">
                      <p className="text-sm font-semibold text-gray-900">
                        {new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-gray-400">{Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000)}m</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{s.templateName}</p>
                      <p className="text-xs text-gray-500">{s.instructorName} · {s.roomName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SPORT_COLORS[s.sport] ?? SPORT_COLORS.OTHER}`}>
                          {s.sport}
                        </span>
                        <span className="text-xs text-gray-400">
                          {s.capacity - s.bookedCount} spots · {s.creditsRequired} credit{s.creditsRequired !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    {s.userBookingId ? (
                      <button
                        onClick={() => cancel(s.userBookingId!, s.id)}
                        disabled={isLoading}
                        className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        {isLoading ? '...' : 'Cancel'}
                      </button>
                    ) : isFull ? (
                      <button
                        onClick={() => joinWaitlist(s.id)}
                        disabled={isLoading}
                        className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isLoading ? '...' : 'Waitlist'}
                      </button>
                    ) : (
                      <button
                        onClick={() => book(s.id)}
                        disabled={isLoading}
                        className="text-xs px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                      >
                        {isLoading ? '...' : 'Book'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
