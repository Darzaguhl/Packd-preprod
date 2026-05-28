'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { SessionSlot } from '@packd/types'
import { api, type MemberNetworkInfo } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import ClassCard from './schedule/ClassCard'
import SessionDetailView from './schedule/SessionDetailView'
import DayTabs, { type DayTab } from './schedule/DayTabs'
import FilterBar from './schedule/FilterBar'
import MiniCalendar from './schedule/MiniCalendar'
import NavBar from './NavBar'
import { TimeFormatProvider } from '@/lib/time-format-context'
import { type TimeFormat } from '@/lib/fmt-time'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Local-time ISO date — avoids UTC offset shifting midnight to the previous day. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const router = useRouter()
  const searchParams = useSearchParams()

  const [sessions, setSessions] = useState<SessionSlot[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h')
  const [userRole, setUserRole] = useState<string>('member')
  const [loading, setLoading] = useState(true)
  // Network studio switcher — populated when the member's studio belongs to a network
  const [networkInfo, setNetworkInfo] = useState<MemberNetworkInfo | null>(null)
  const [activeStudioId, setActiveStudioId] = useState<string>(studioId)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Initialise day + week from URL if present, so a hard refresh restores position.
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const d = searchParams.get('day')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : toIsoDate(new Date())
  })
  const [selectedSport, setSelectedSport] = useState('ALL')
  const [selectedLocation, setSelectedLocation] = useState('ALL')
  const [weekOffset, setWeekOffset] = useState<number>(() => {
    const w = searchParams.get('week')
    const n = w ? parseInt(w, 10) : 0
    return Number.isFinite(n) ? n : 0
  })
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // Keep URL in sync when day or week changes so refresh restores the same view.
  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString())
    p.set('day', selectedDay)
    if (weekOffset === 0) p.delete('week')
    else p.set('week', String(weekOffset))
    router.replace(`?${p.toString()}`, { scroll: false })
  }, [selectedDay, weekOffset])
  // Derive the selected session from the live sessions array so mutations stay reflected
  const selectedSession = selectedSessionId ? sessions.find(s => s.id === selectedSessionId) ?? null : null
  // Admins and fronthosts can interact with past/running classes; members cannot
  const isPrivileged = userRole !== 'member'

  async function getFreshToken(): Promise<string> {
    const { data } = await createClient().auth.getSession()
    return data.session?.access_token ?? token ?? ''
  }

  // Load token + sessions
  useEffect(() => {
    setLoading(true)
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const t = session?.access_token ?? null
        setToken(t)
        const role = (session?.user?.app_metadata?.role as string | undefined) ?? 'member'
        setUserRole(role)
        if (!t) return

        // Load network info for members so they can switch between studios in their network
        if (role === 'member') {
          api.networks.my(t).then(info => {
            if (info.network) setNetworkInfo(info)
          }).catch(() => {})
        }

        const base = weekStart(new Date(Date.now() + weekOffset * WEEK_MS))
        const to = new Date(base.getTime() + WEEK_MS)
        return api.schedule.list(activeStudioId, base.toISOString(), to.toISOString(), t)
      })
      .then((data) => {
        if (data) {
          setSessions(data.sessions)
          setTimeFormat((data.timeFormat ?? '24h') as TimeFormat)
        }
      })
      .finally(() => setLoading(false))
  }, [activeStudioId, weekOffset])

  // Derived: current week's Monday
  const currentWeekMonday = useMemo(
    () => weekStart(new Date(Date.now() + weekOffset * WEEK_MS)),
    [weekOffset],
  )

  // Derived: week number
  const weekNumber = useMemo(() => isoWeekNumber(currentWeekMonday), [currentWeekMonday])

  // Derived: unique locations across all sessions this week
  const locations = useMemo<{ id: string; name: string }[]>(() => {
    const seen = new Map<string, string>()
    sessions.forEach(s => { if (!seen.has(s.locationId)) seen.set(s.locationId, s.locationName) })
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [sessions])

  // Reset location filter when we navigate to a new week (in case the new week has different locations)
  useEffect(() => { setSelectedLocation('ALL') }, [weekOffset])

  // Derived: sessions filtered by location (used for day tab counts + day sessions)
  const locationSessions = useMemo(
    () => selectedLocation === 'ALL' ? sessions : sessions.filter(s => s.locationId === selectedLocation),
    [sessions, selectedLocation],
  )

  // Derived: day tabs (counts respect location filter)
  const days = useMemo<DayTab[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentWeekMonday.getTime() + i * 86400000)
      const iso = toIsoDate(d)
      return {
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        iso,
        count: locationSessions.filter((s) => toIsoDate(new Date(s.startsAt)) === iso).length,
      }
    })
  }, [locationSessions, currentWeekMonday])

  // Derived: sports present in current week (respect location filter)
  const availableSports = useMemo(
    () => [...new Set(locationSessions.map((s) => s.sport))].sort(),
    [locationSessions],
  )

  // Derived: filtered sessions for selected day
  const daySessions = useMemo(() => {
    return locationSessions
      .filter((s) => {
        const matchDay = toIsoDate(new Date(s.startsAt)) === selectedDay
        const matchSport = selectedSport === 'ALL' || s.sport === selectedSport
        return matchDay && matchSport
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  }, [locationSessions, selectedDay, selectedSport])

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
    setActionLoading(sessionId)
    try {
      const t = await getFreshToken()
      const res = await api.bookings.create(sessionId, t)
      const session = sessions.find((s) => s.id === sessionId)!
      mutateSession(sessionId, {
        bookedCount: session.bookedCount + 1,
        userBookingId: res.success ? res.data.id : 'booked',
      })
      showToast('Class booked!')
    } catch (e: unknown) {
      // Don't show a toast for "already booked" — the caller (handleBookAndAssign)
      // handles that case silently and falls through to spot assignment.
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      if (!msg.includes('already booked') && !msg.includes('unique')) {
        showToast(e instanceof Error ? e.message : 'Failed to book', false)
      }
      throw e  // always re-throw so callers can catch and react
    } finally {
      setActionLoading(null)
    }
  }

  async function handlePickSpot(stationId: string | null) {
    if (!selectedSession) return
    try {
      const t = await getFreshToken()
      await api.rooms.pickMySpot(selectedSession.roomId, selectedSession.id, stationId, t)
      mutateSession(selectedSession.id, { userStationId: stationId })
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to pick spot', false)
    }
  }

  async function handleCancel(bookingId: string, sessionId: string) {
    setActionLoading(sessionId)
    try {
      const t = await getFreshToken()
      const res = await api.bookings.cancel(bookingId, t)
      if (res.success) {
        mutateSession(sessionId, {
          bookedCount: sessions.find((s) => s.id === sessionId)!.bookedCount - 1,
          userBookingId: undefined,
          userStationId: undefined,
        })
        showToast(
          res.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Cancelled',
          !res.isLateCancel,
        )
      }
    } catch {
      showToast('Failed to cancel', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleWaitlist(sessionId: string) {
    setActionLoading(sessionId)
    try {
      const t = await getFreshToken()
      const res = await api.waitlist.join(sessionId, t)
      if (res.success) showToast(`You're #${res.data.position} on the waitlist`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to join waitlist', false)
    } finally {
      setActionLoading(null)
    }
  }

  /** Called by MiniCalendar when the user clicks a day in a different week */
  function handleCalendarDaySelect(iso: string, relativeWeekOffset: number) {
    setWeekOffset((w) => w + relativeWeekOffset)
    setSelectedDay(iso)
  }

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="min-h-screen bg-gray-50">
      <NavBar title="Schedule" subtitle={subtitle}>
        <div className="flex gap-5 items-start">
          {/* Day tabs + filters constrained to main column width */}
          <div className="flex-1 min-w-0">
            <DayTabs
              days={days}
              selected={selectedDay}
              onSelect={setSelectedDay}
              weekOffset={weekOffset}
              onPrev={() => setWeekOffset((w) => w - 1)}
              onNext={() => setWeekOffset((w) => w + 1)}
            />
            {/* Network studio switcher — shown when member belongs to a multi-studio network */}
            {networkInfo && networkInfo.studios.length > 1 && (
              <div className="pt-2 pb-1 flex gap-1.5 overflow-x-auto scrollbar-none items-center">
                <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold text-gray-400 mr-0.5">Studio</span>
                {networkInfo.studios.map(studio => (
                  <button
                    key={studio.id}
                    onClick={() => {
                      setActiveStudioId(studio.id)
                      setSelectedLocation('ALL')
                    }}
                    className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-150 ${
                      activeStudioId === studio.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {studio.name}
                    {studio.isHome && <span className="ml-1 opacity-60 text-[10px]">·home</span>}
                  </button>
                ))}
              </div>
            )}
            {/* Location picker — only shown when studio has multiple locations */}
            {locations.length > 1 && (
              <div className="pt-2 pb-1 flex gap-1.5 overflow-x-auto scrollbar-none">
                {[{ id: 'ALL', name: 'All locations' }, ...locations].map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocation(loc.id)}
                    className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-150 ${
                      selectedLocation === loc.id
                        ? 'bg-black text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            )}
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
      </NavBar>

      {/* Content: two-column on md+ */}
      <div className="max-w-6xl mx-auto px-4 py-4 flex gap-5 items-start">
        {/* Session list or detail view */}
        <div className="flex-1 min-w-0">
          {selectedSession ? (
            <SessionDetailView
              session={selectedSession}
              privileged={isPrivileged}
              onBack={() => setSelectedSessionId(null)}
              onBook={handleBook}
              onCancel={handleCancel}
              onWaitlist={handleWaitlist}
              onPickSpot={handlePickSpot}
            />
          ) : loading ? (
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
            <div className="space-y-2">
              {daySessions.map((s) => (
                <ClassCard
                  key={s.id}
                  session={s}
                  privileged={isPrivileged}
                  onSelect={s => setSelectedSessionId(s.id)}
                />
              ))}
            </div>
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
    </TimeFormatProvider>
  )
}
