'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
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
import { TimezoneProvider } from '@/lib/timezone-context'
import { type TimeFormat } from '@/lib/fmt-time'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** ISO date in browser local time (fallback when studio timezone is not yet known). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ISO date (YYYY-MM-DD) in the given timezone, or browser local time if tz is absent. */
function toIsoDateInZone(d: Date, tz?: string): string {
  if (!tz) return toIsoDate(d)
  // en-CA locale natively produces YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
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

type BrandStudios = Awaited<ReturnType<typeof api.schedule.brandStudios>>
type BrandStudio = BrandStudios['franchises'][0]['studios'][0]

export default function ScheduleView({ studioId }: { studioId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [sessions, setSessions] = useState<SessionSlot[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h')
  const [studioTimezone, setStudioTimezone] = useState<string>('UTC')
  const [cancelPolicy, setCancelPolicy] = useState<{ windowHours: number; feeCredits: number }>({ windowHours: 12, feeCredits: 1 })
  const [userRole, setUserRole] = useState<string>('member')
  const [loading, setLoading] = useState(true)
  // Network studio switcher — populated when the member's studio belongs to a network
  const [networkInfo, setNetworkInfo] = useState<MemberNetworkInfo | null>(null)
  const [activeStudioId, setActiveStudioId] = useState<string>(studioId)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Brand hierarchy for country/franchise/studio filters
  const [brandStudios, setBrandStudios] = useState<BrandStudios | null>(null)
  const [filterCountry, setFilterCountry] = useState<string | null>(null)
  const [filterFranchise, setFilterFranchise] = useState<string | null>(null)
  const [filterStudio, setFilterStudio] = useState<string | null>(null)

  // Initialise day + week from URL if present, so a hard refresh restores position.
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const d = searchParams.get('day')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : toIsoDate(new Date())
  })
  // True once we've corrected selectedDay to the studio's timezone on first load.
  // Prevents subsequent studio-filter switches from jumping the selected day.
  const initialDaySet = useRef(!!searchParams.get('day'))
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
  // Past sessions are always greyed out in the schedule — no one books from here.
  // Fronthost+ can still act on past/running sessions from the Live GUI.
  const isPrivileged = false

  async function getFreshToken(): Promise<string> {
    const { data } = await createClient().auth.getSession()
    return data.session?.access_token ?? token ?? ''
  }

  // Load brand hierarchy once — independent of auth
  useEffect(() => {
    api.schedule.brandStudios(studioId).then(setBrandStudios).catch(() => {})
  }, [studioId])

  // All studios in the brand, augmented with franchiseId for filtering
  const allBrandStudios = useMemo<(BrandStudio & { franchiseId: string | null })[]>(() => {
    if (!brandStudios) return []
    return [
      ...brandStudios.franchises.flatMap(f => f.studios.map(s => ({ ...s, franchiseId: f.id }))),
      ...brandStudios.standalone.map(s => ({ ...s, franchiseId: null })),
    ]
  }, [brandStudios])

  // Studios visible in the studio picker after applying country + franchise filters
  const filteredStudios = useMemo(() => {
    let list = allBrandStudios
    if (filterCountry) list = list.filter(s => s.country === filterCountry)
    if (filterFranchise) list = list.filter(s => s.franchiseId === filterFranchise)
    return list
  }, [allBrandStudios, filterCountry, filterFranchise])

  // The single studio whose schedule is shown.
  // Priority: explicit studio pick → first studio in filtered list → primary studioId.
  const selectedStudioId = filterStudio ?? filteredStudios[0]?.id ?? studioId

  // Derived lists for filter UI
  const availableCountries = useMemo(() => [...new Set(allBrandStudios.map(s => s.country).filter(Boolean))].sort(), [allBrandStudios])
  const availableFranchises = useMemo(() => {
    if (!brandStudios) return []
    if (!filterCountry) return brandStudios.franchises
    return brandStudios.franchises.filter(f => f.studios.some(s => s.country === filterCountry))
  }, [brandStudios, filterCountry])

  // Load auth (optional — schedule is public)
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      const role = (session?.user?.app_metadata?.role as string | undefined) ?? 'member'
      setUserRole(role)
      if (t && role === 'member') {
        api.networks.my(t).then(info => {
          if (info.network) setNetworkInfo(info)
        }).catch(() => {})
      }
    })
  }, [])

  // Fetch sessions for the selected studio when studio or week changes
  useEffect(() => {
    setLoading(true)
    const base = weekStart(new Date(Date.now() + weekOffset * WEEK_MS))
    const to = new Date(base.getTime() + WEEK_MS)
    api.schedule.list(selectedStudioId, base.toISOString(), to.toISOString(), token ?? undefined)
      .then(data => {
        setSessions(data.sessions)
        setTimeFormat((data.timeFormat ?? '24h') as TimeFormat)
        const tz = data.timezone ?? 'UTC'
        setStudioTimezone(tz)
        if (!initialDaySet.current) {
          initialDaySet.current = true
          setSelectedDay(toIsoDateInZone(new Date(), tz))
        }
        setCancelPolicy({ windowHours: data.lateCancelWindowHours ?? 12, feeCredits: data.lateCancelFeeCredits ?? 1 })
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudioId, weekOffset, token])

  // Derived: week number (computed below from days)

  // Derived: unique locations across all sessions this week
  const locations = useMemo<{ id: string; name: string }[]>(() => {
    const seen = new Map<string, string>()
    sessions.forEach(s => { if (!seen.has(s.locationId)) seen.set(s.locationId, s.locationName) })
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [sessions])

  // Reset location filter when we navigate to a new week (in case the new week has different locations)
  useEffect(() => { setSelectedLocation('ALL') }, [weekOffset])

  // When week changes: current week → today, any other week → Monday of that week
  useEffect(() => {
    const tz = studioTimezone || 'UTC'
    if (weekOffset === 0) {
      setSelectedDay(toIsoDateInZone(new Date(), tz))
    } else {
      const monday = weekStart(new Date(Date.now() + weekOffset * WEEK_MS))
      setSelectedDay(toIsoDateInZone(monday, tz))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset])

  // Derived: sessions filtered by location (used for day tab counts + day sessions)
  const locationSessions = useMemo(
    () => selectedLocation === 'ALL' ? sessions : sessions.filter(s => s.locationId === selectedLocation),
    [sessions, selectedLocation],
  )

  // Derived: day tabs — computed entirely in the studio timezone so the week
  // always starts on Monday regardless of the browser's local timezone.
  const days = useMemo<DayTab[]>(() => {
    const tz = studioTimezone || 'UTC'
    // Reference point for this week, shifted by weekOffset
    const ref = new Date(Date.now() + weekOffset * WEEK_MS)
    // "Today" as an ISO date in the studio timezone
    const todayIso = toIsoDateInZone(ref, tz)
    const [ty, tm, td] = todayIso.split('-').map(Number)
    // Use noon UTC for the reference day — avoids any DST boundary issues
    const todayNoon = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0))
    // Day-of-week in the studio timezone (Mon=0 … Sun=6)
    const dowStr = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(todayNoon)
    const fromMon: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
    const daysBack = fromMon[dowStr] ?? 0
    // Noon UTC on Monday of this week in the studio timezone
    const mondayNoon = new Date(todayNoon.getTime() - daysBack * 86400000)

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayNoon.getTime() + i * 86400000)
      const iso = toIsoDateInZone(d, tz)
      return {
        label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }),
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }),
        iso,
        count: locationSessions.filter(s => toIsoDateInZone(new Date(s.startsAt), tz) === iso).length,
      }
    })
  }, [locationSessions, studioTimezone, weekOffset])

  const weekNumber = useMemo(() => {
    if (!days.length) return 0
    const [y, m, d] = days[0].iso.split('-').map(Number)
    return isoWeekNumber(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)))
  }, [days])

  // Derived: sports present in current week (respect location filter)
  const availableSports = useMemo(
    () => [...new Set(locationSessions.map((s) => s.sport))].sort(),
    [locationSessions],
  )

  // Derived: filtered sessions for selected day
  const daySessions = useMemo(() => {
    return locationSessions
      .filter((s) => {
        const matchDay = toIsoDateInZone(new Date(s.startsAt), studioTimezone) === selectedDay
        const matchSport = selectedSport === 'ALL' || s.sport === selectedSport
        return matchDay && matchSport
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  }, [locationSessions, selectedDay, selectedSport, studioTimezone])

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

  async function handleBook(sessionId: string, memberNote?: string) {
    setActionLoading(sessionId)
    try {
      const t = await getFreshToken()
      const res = await api.bookings.create(sessionId, t, undefined, memberNote)
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
      if (!msg.includes('already booked') && !msg.includes('unique') && !msg.includes('waiver_required')) {
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
    <TimezoneProvider value={studioTimezone}>
    <div className="min-h-screen bg-gray-50">
      <NavBar title="Schedule" subtitle={subtitle}>
        <div className="flex gap-5 items-start">
          {/* Day tabs + filters constrained to main column width */}
          <div className="flex-1 min-w-0">
            {/* Brand filters — country → franchise → studio (one studio at a time) */}
            {allBrandStudios.length > 1 && (
              <div className="pt-2 pb-1 flex flex-wrap gap-2 items-center">
                {/* Country — dropdown (can have many entries) */}
                {availableCountries.length > 1 && (
                  <select
                    value={filterCountry ?? ''}
                    onChange={e => {
                      const v = e.target.value || null
                      setFilterCountry(v)
                      setFilterFranchise(null)
                      setFilterStudio(null)
                    }}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    <option value="">All countries</option>
                    {availableCountries.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {/* Franchise — dropdown */}
                {availableFranchises.length > 1 && (
                  <select
                    value={filterFranchise ?? ''}
                    onChange={e => {
                      setFilterFranchise(e.target.value || null)
                      setFilterStudio(null)
                    }}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    <option value="">All franchises</option>
                    {availableFranchises.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}

                {/* Studio — pills (final pick, typically fewer options after filtering) */}
                {filteredStudios.length > 1 && filteredStudios.map(s => (
                  <button key={s.id} onClick={() => setFilterStudio(s.id)}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                      selectedStudioId === s.id
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}>
                    {s.name}{s.city ? ` · ${s.city}` : ''}
                  </button>
                ))}
              </div>
            )}
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
              cancelPolicy={cancelPolicy}
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
            currentWeekStart={days.length ? (() => { const [y,m,d] = days[0].iso.split('-').map(Number); return new Date(Date.UTC(y, m-1, d, 12, 0, 0)) })() : new Date()}
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          data-testid="toast"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-all ${
            toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}

    </div>
    </TimezoneProvider>
    </TimeFormatProvider>
  )
}
