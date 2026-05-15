'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { SessionSlot } from '@packd/types'
import { api } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import ClassCard from './schedule/ClassCard'
import DayTabs, { type DayTab } from './schedule/DayTabs'
import FilterBar from './schedule/FilterBar'
import MiniCalendar from './schedule/MiniCalendar'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function toIsoDate(d: Date) {
  return d.toISOString().split('T')[0]
}

/** ISO week number (Mon-based) */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Monday of the week that contains `date` */
function weekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() || 7 // Mon=1…Sun=7
  d.setDate(d.getDate() - (day - 1))
  return d
}

export default function ScheduleView({ studioId }: { studioId: string }) {
  const [sessions, setSessions] = useState<SessionSlot[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(toIsoDate(new Date()))
  const [selectedSport, setSelectedSport] = useState('ALL')
  const [weekOffset, setWeekOffset] = useState(0)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Load token + sessions
  useEffect(() => {
    setLoading(true)
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const t = session?.access_token ?? null
        setToken(t)
        if (!t) return

        const base = weekStart(new Date(Date.now() + weekOffset * WEEK_MS))
        const to = new Date(base.getTime() + WEEK_MS)
        return api.schedule.list(studioId, base.toISOString(), to.toISOString(), t)
      })
      .then((data) => { if (data) setSessions(data) })
      .finally(() => setLoading(false))
  }, [studioId, weekOffset])

  // Derived: current week's Monday
  const currentWeekMonday = useMemo(
    () => weekStart(new Date(Date.now() + weekOffset * WEEK_MS)),
    [weekOffset],
  )

  // Derived: week number
  const weekNumber = useMemo(() => isoWeekNumber(currentWeekMonday), [currentWeekMonday])

  // Derived: day tabs
  const days = useMemo<DayTab[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentWeekMonday.getTime() + i * 86400000)
      const iso = toIsoDate(d)
      return {
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        iso,
        count: sessions.filter((s) => toIsoDate(new Date(s.startsAt)) === iso).length,
      }
    })
  }, [sessions, currentWeekMonday])

  // Derived: sports present in current week
  const availableSports = useMemo(
    () => [...new Set(sessions.map((s) => s.sport))].sort(),
    [sessions],
  )

  // Derived: filtered sessions for selected day
  const daySessions = useMemo(() => {
    return sessions
      .filter((s) => {
        const matchDay = toIsoDate(new Date(s.startsAt)) === selectedDay
        const matchSport = selectedSport === 'ALL' || s.sport === selectedSport
        return matchDay && matchSport
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  }, [sessions, selectedDay, selectedSport])

  // Derived: selected day label for subtitle
  const selectedDayLabel = days.find((d) => d.iso === selectedDay)
  const subtitle = selectedDayLabel
    ? `${selectedDayLabel.label}, ${selectedDayLabel.date}`
    : toIsoDate(new Date())

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function mutateSession(sessionId: string, patch: Partial<SessionSlot>) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)))
  }

  async function handleBook(sessionId: string) {
    if (!token) return
    setActionLoading(sessionId)
    try {
      await api.bookings.create(sessionId, token)
      mutateSession(sessionId, {
        bookedCount: sessions.find((s) => s.id === sessionId)!.bookedCount + 1,
        userBookingId: 'booked',
      })
      showToast('Class booked!')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to book', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancel(bookingId: string, sessionId: string) {
    if (!token) return
    setActionLoading(sessionId)
    try {
      const res = await api.bookings.cancel(bookingId, token)
      if (res.success) {
        mutateSession(sessionId, {
          bookedCount: sessions.find((s) => s.id === sessionId)!.bookedCount - 1,
          userBookingId: undefined,
        })
        showToast(
          res.data.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Cancelled',
          !res.data.isLateCancel,
        )
      }
    } catch {
      showToast('Failed to cancel', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleWaitlist(sessionId: string) {
    if (!token) return
    setActionLoading(sessionId)
    try {
      const res = await api.waitlist.join(sessionId, token)
      if (res.success) showToast(`You're #${res.data.position} on the waitlist`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to join waitlist', false)
    } finally {
      setActionLoading(null)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    console.log('Drag end — implement reschedule:', active.id, '→', over.id)
  }

  /** Called by MiniCalendar when the user clicks a day in a different week */
  function handleCalendarDaySelect(iso: string, relativeWeekOffset: number) {
    setWeekOffset((w) => w + relativeWeekOffset)
    setSelectedDay(iso)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-5 items-start">
            {/* Main column — title + tabs + filters */}
            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="py-4 flex items-start justify-between">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Schedule</h1>
                  <p className="text-sm text-gray-400">{subtitle}</p>
                </div>
                <a
                  href="/dashboard"
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors mt-1"
                >
                  Admin →
                </a>
              </div>

              {/* Day tabs with integrated arrows (constrained to this column) */}
              <DayTabs
                days={days}
                selected={selectedDay}
                onSelect={setSelectedDay}
                weekOffset={weekOffset}
                onPrev={() => setWeekOffset((w) => w - 1)}
                onNext={() => setWeekOffset((w) => w + 1)}
              />

              {/* Sport filters */}
              <div className="py-3">
                <FilterBar
                  available={availableSports}
                  selected={selectedSport}
                  onSelect={setSelectedSport}
                />
              </div>
            </div>

            {/* Sidebar spacer — keeps header aligned with body columns */}
            <div className="hidden md:block w-56 shrink-0" />
          </div>
        </div>
      </div>

      {/* Content: two-column on md+ */}
      <div className="max-w-6xl mx-auto px-4 py-4 flex gap-5 items-start">
        {/* Session list */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />
              ))}
            </div>
          ) : daySessions.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">No classes on this day</p>
              {selectedSport !== 'ALL' && (
                <button
                  onClick={() => setSelectedSport('ALL')}
                  className="mt-2 text-sm text-gray-500 underline underline-offset-2"
                >
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={daySessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {daySessions.map((s) => (
                    <ClassCard
                      key={s.id}
                      session={s}
                      onBook={handleBook}
                      onCancel={handleCancel}
                      onWaitlist={handleWaitlist}
                      isLoading={actionLoading === s.id}
                      draggable={false}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Mini calendar sidebar */}
        <div className="hidden md:block w-56 shrink-0">
          <MiniCalendar
            sessions={sessions}
            selectedDay={selectedDay}
            onSelectDay={handleCalendarDaySelect}
            currentWeekStart={currentWeekMonday}
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-all ${
            toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
