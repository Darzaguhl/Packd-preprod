'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type CalendarWeek, type CalendarSession, type ClassSchedule, type OrphanedPattern } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import ScheduleModal from './ScheduleModal'
import SubstituteModal from './SubstituteModal'
import ClassTemplatesSection from '@/components/studio/ClassTemplatesSection'
import BulkOpsPanel from '@/components/studio/BulkOpsPanel'
import { useTimeFormat } from '@/lib/time-format-context'
import { fmtTime, fmtHHMM } from '@/lib/fmt-time'
import { DndContext, useDraggable, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOUR_START = 6
const HOUR_END = 22
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_PX = 64

function getMonday(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  date.setDate(date.getDate() - ((day + 6) % 7))
  return date
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesSinceMidnight(iso: string) {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** Lay out overlapping sessions side-by-side within a column. */
function layoutSessions(sessions: CalendarSession[]): Array<{
  session: CalendarSession
  leftFrac: number  // 0..1 fraction of column width
  widthFrac: number // 0..1 fraction of column width
}> {
  if (sessions.length === 0) return []

  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  const result: Array<{ session: CalendarSession; leftFrac: number; widthFrac: number }> = []
  let i = 0

  while (i < sorted.length) {
    // Collect a group of mutually overlapping sessions
    const group: CalendarSession[] = [sorted[i]]
    let groupEnd = new Date(sorted[i].endsAt).getTime()

    let j = i + 1
    while (j < sorted.length && new Date(sorted[j].startsAt).getTime() < groupEnd) {
      groupEnd = Math.max(groupEnd, new Date(sorted[j].endsAt).getTime())
      group.push(sorted[j])
      j++
    }

    const n = group.length
    group.forEach((s, idx) => {
      result.push({ session: s, leftFrac: idx / n, widthFrac: 1 / n })
    })

    i = j
  }

  return result
}

interface Props {
  studioId: string
  token: string
  /** When false (instructor default), hide schedule creation/edit/delete UI */
  canCreateSchedules?: boolean
  /** When false, clicking a session does not open the substitute modal */
  canSetSubstitute?: boolean
  /** When set, filter displayed sessions to this Instructor record ID; user can toggle off */
  filterInstructorId?: string
  /** When true (studio_admin+), sessions in the week view can be dragged to reschedule */
  canReschedule?: boolean
}

type ViewMode = 'week' | 'month' | 'schedules'

function scheduleUntilStyle(validFrom: string, validUntil: string | null): {
  cls: string; label: string
} {
  if (!validUntil) return { cls: 'bg-gray-100 text-gray-400', label: 'no end date' }
  const from = new Date(validFrom).getTime()
  const until = new Date(validUntil).getTime()
  const now = Date.now()
  const progress = Math.min(1, Math.max(0, (now - from) / (until - from)))
  const date = new Date(validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (progress >= 0.90) return { cls: 'bg-red-50 text-red-600', label: `until ${date}` }
  if (progress >= 0.75) return { cls: 'bg-amber-50 text-amber-600', label: `until ${date}` }
  if (progress >= 0.50) return { cls: 'bg-amber-50 text-amber-500', label: `until ${date}` }
  return { cls: 'bg-green-50 text-green-600', label: `until ${date}` }
}

type Modal =
  | { type: 'new-schedule'; prefill?: Partial<OrphanedPattern> }
  | { type: 'edit-schedule'; schedule: ClassSchedule }
  | { type: 'substitute'; session: CalendarSession }

export default function CalendarView({ studioId, token, canCreateSchedules = true, canSetSubstitute = true, filterInstructorId, canReschedule = false }: Props) {
  const timeFormat = useTimeFormat()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [monthYear, setMonthYear] = useState(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 }
  })
  const [data, setData] = useState<CalendarWeek | null>(null)
  const [monthData, setMonthData] = useState<Record<string, { id: string; sport: string; name: string; startsAt: string; instructorId: string | null; instructorName: string; substituteInstructorId: string | null; status: string }[]>>({})
  const [allSchedules, setAllSchedules] = useState<ClassSchedule[]>([])
  const [orphaned, setOrphaned] = useState<OrphanedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<Modal | null>(null)
  const [view, setView] = useState<ViewMode>('week')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingOrphanKey, setDeletingOrphanKey] = useState<string | null>(null)
  // Instructor filter — default on when filterInstructorId is provided
  const [myClassesOnly, setMyClassesOnly] = useState(!!filterInstructorId)
  // Schedules tab filtering / bulk-select
  const [schedSearch, setSchedSearch] = useState('')
  const [schedSport, setSchedSport] = useState('')
  const [schedInstructor, setSchedInstructor] = useState('')
  const [schedDay, setSchedDay] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // DnD sensors — require 5px movement before drag activates (prevents accidental drags on click)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    if (!canReschedule) return
    const { active, delta } = event
    const sessionId = active.id as string
    const session = data?.sessions.find(s => s.id === sessionId)
    if (!session || !token) return

    // Convert pixel delta to snapped minutes (5-min grid)
    const deltaMin = Math.round((delta.y / (HOUR_PX / 60)) / 5) * 5
    if (deltaMin === 0) return

    const newStart = new Date(new Date(session.startsAt).getTime() + deltaMin * 60000)
    const newEnd   = new Date(new Date(session.endsAt).getTime()   + deltaMin * 60000)

    // Optimistically update local state
    setData(prev => prev ? {
      ...prev,
      sessions: prev.sessions.map(s => s.id === sessionId
        ? { ...s, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }
        : s
      ),
    } : prev)

    // Persist to API, revert on failure
    api.admin.rescheduleSession(sessionId, newStart.toISOString(), newEnd.toISOString(), token)
      .catch(() => {
        setData(prev => prev ? {
          ...prev,
          sessions: prev.sessions.map(s => s.id === sessionId ? session : s),
        } : prev)
      })
  }

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const instructorFilter = myClassesOnly ? filterInstructorId : undefined
      const [week, schedules, orphanedData, mData] = await Promise.all([
        api.schedules.week(studioId, isoDate(weekStart), token),
        api.schedules.all(studioId, token),
        api.schedules.orphaned(studioId, token),
        api.schedules.month(studioId, monthYear.year, monthYear.month, token, instructorFilter),
      ])
      setData(week)
      setAllSchedules(schedules)
      setOrphaned(orphanedData)
      setMonthData(mData.days)
    } catch {
      // keep existing
    } finally {
      setLoading(false)
    }
  }, [studioId, token, weekStart, monthYear, myClassesOnly, filterInstructorId])

  useEffect(() => { load() }, [load])

  function prevWeek() { setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n }) }
  function nextWeek() { setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n }) }
  function goToday() { setWeekStart(getMonday(new Date())) }

  function prevMonth() {
    setMonthYear(({ year, month }) => month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })
  }
  function nextMonth() {
    setMonthYear(({ year, month }) => month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d
  })

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const visibleSessions = myClassesOnly && filterInstructorId
    ? (data?.sessions ?? []).filter(s => s.instructorId === filterInstructorId || s.substituteInstructorId === filterInstructorId)
    : (data?.sessions ?? [])

  const visibleSchedules = myClassesOnly && filterInstructorId
    ? allSchedules.filter(s => s.instructorId === filterInstructorId)
    : allSchedules

  const visibleOrphaned = myClassesOnly && filterInstructorId
    ? orphaned.filter(p => p.instructorId === filterInstructorId)
    : orphaned

  // Schedules tab: filtered list
  const filteredSchedules = visibleSchedules.filter(s => {
    if (schedSearch) {
      const q = schedSearch.toLowerCase()
      const haystack = [
        s.templateName,
        s.instructorName,
        s.startTime,                       // e.g. "07:30"
        `${s.durationMin}`,                // e.g. "60"
        `${s.durationMin}m`,               // e.g. "60m"
        `${s.durationMin} min`,            // e.g. "60 min"
        s.roomName ?? '',
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (schedSport && s.sport !== schedSport) return false
    if (schedInstructor && s.instructorId !== schedInstructor) return false
    if (schedDay !== null && !s.daysOfWeek.includes(schedDay)) return false
    return true
  })

  // Group by day (Mon=1..Sat=6, Sun=0 displayed last)
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
  const DAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const schedsByDay: Array<{ dayNum: number; label: string; items: ClassSchedule[] }> = DAY_ORDER.map(d => ({
    dayNum: d,
    label: DAY_FULL[d],
    items: filteredSchedules
      .filter(s => s.daysOfWeek.includes(d))
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  })).filter(g => g.items.length > 0 && (schedDay === null || g.dayNum === schedDay))

  // Unique sports / instructors for filter dropdowns
  const uniqueSports = Array.from(new Set(visibleSchedules.map(s => s.sport)))
  const uniqueInstructors = Array.from(
    new Map(visibleSchedules.map(s => [s.instructorId, { id: s.instructorId, name: s.instructorName }])).values()
  )

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredSchedules.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredSchedules.map(s => s.id)))
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      await Promise.all(Array.from(selectedIds).map(id => api.schedules.delete(id, studioId, token)))
      setSelectedIds(new Set())
      await load()
    } catch { /* silent */ }
    finally { setBulkDeleting(false) }
  }

  const sessionsByDay: Record<number, CalendarSession[]> = {}
  for (let i = 0; i < 7; i++) sessionsByDay[i] = []
  visibleSessions.forEach(s => {
    const d = new Date(s.startsAt); d.setHours(0, 0, 0, 0)
    for (let i = 0; i < 7; i++) {
      if (d.getTime() === days[i].getTime()) { sessionsByDay[i].push(s); break }
    }
  })

  async function handleDeleteOrphaned(p: OrphanedPattern) {
    const key = `${p.templateId}|${p.instructorId}|${p.startTime}`
    setDeletingOrphanKey(key)
    try { await api.schedules.deleteOrphaned(studioId, p.templateId, p.instructorId, p.startTime, token); await load() }
    catch { /* silent */ }
    finally { setDeletingOrphanKey(null) }
  }

  async function handleDeleteSchedule(id: string) {
    setDeletingId(id)
    try { await api.schedules.delete(id, studioId, token); await load() }
    catch { /* silent */ }
    finally { setDeletingId(null) }
  }

  function handleSubstituteUpdate(
    sessionId: string,
    update: { substituteInstructorId: string | null; substituteInstructorName: string | null },
  ) {
    setData(prev => prev ? {
      ...prev,
      sessions: prev.sessions.map(s => s.id === sessionId ? { ...s, ...update } : s),
    } : prev)
    setMonthData(prev => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = next[key].map(s => s.id === sessionId ? { ...s, substituteInstructorId: update.substituteInstructorId } : s)
      }
      return next
    })
    setModal(null)
  }

  const weekLabel = (() => {
    const end = new Date(weekStart); end.setDate(weekStart.getDate() + 6)
    return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  })()

  const monthLabel = new Date(monthYear.year, monthYear.month - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['week', 'month', 'schedules'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{v === 'schedules' ? 'Schedules' : v === 'month' ? 'Month' : 'Week'}</button>
            ))}
          </div>

          {view === 'week' && (
            <>
              <button onClick={prevWeek} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="text-sm font-medium text-gray-700">{weekLabel}</span>
              <button onClick={nextWeek} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button onClick={goToday} className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2">Today</button>
            </>
          )}

          {view === 'month' && (
            <>
              <button onClick={prevMonth} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="text-sm font-medium text-gray-700">{monthLabel}</span>
              <button onClick={nextMonth} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* My classes filter pill — only shown when an instructor filter is available */}
          {filterInstructorId && (
            <button
              onClick={() => setMyClassesOnly(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                myClassesOnly
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {myClassesOnly && (
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              My classes
            </button>
          )}

          {canCreateSchedules && (
            <button
              onClick={() => setModal({ type: 'new-schedule' })}
              className="text-sm font-medium bg-gray-900 text-white px-4 py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
            >
              + New schedule
            </button>
          )}
        </div>
      </div>

      {/* ── BULK OPS PANEL ── (admin+ only, sits between toolbar and calendar body) */}
      {canReschedule && data && (
        <BulkOpsPanel
          studioId={studioId}
          token={token}
          instructors={data.instructors.map(i => ({ id: i.id, name: i.name }))}
          templates={data.templates.map(t => ({ id: t.id, name: t.name }))}
        />
      )}

      {/* ── WEEK VIEW ── */}
      {view === 'week' && (
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="min-w-[700px]">
              {/* Day headers */}
              <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-gray-100 sticky top-0 bg-white z-10">
                <div className="h-10" />
                {days.map((d, i) => {
                  const isToday = d.getTime() === today.getTime()
                  return (
                    <div key={i} className="h-10 flex flex-col items-center justify-center border-l border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setModal({ type: 'new-schedule' })}>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${isToday ? 'text-gray-900' : 'text-gray-400'}`}>{DAY_LABELS[i]}</span>
                      <span className={`text-sm font-bold leading-none ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>{d.getDate()}</span>
                    </div>
                  )
                })}
              </div>

              {/* Time grid */}
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="relative grid grid-cols-[48px_repeat(7,1fr)]" style={{ height: TOTAL_HOURS * HOUR_PX }}>
                {Array.from({ length: TOTAL_HOURS }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-gray-200" style={{ top: h * HOUR_PX }}>
                    <span className={`absolute left-0 w-10 text-right pr-2 text-xs font-semibold text-gray-500 ${h === 0 ? 'translate-y-0.5' : '-translate-y-2.5'}`}>
                      {timeFormat === '12h'
                        ? (() => { const hr = HOUR_START + h; return hr === 12 ? '12pm' : hr > 12 ? `${hr - 12}pm` : `${hr}am` })()
                        : String(HOUR_START + h).padStart(2, '0')}
                    </span>
                  </div>
                ))}

                {days.map((_, colIdx) => {
                  const laid = layoutSessions(sessionsByDay[colIdx])
                  return (
                    <div key={colIdx} className={`relative border-l border-gray-200 ${colIdx === 0 ? 'col-start-2' : ''}`}>
                      {laid.map(({ session: s, leftFrac, widthFrac }) => {
                        const startMin = minutesSinceMidnight(s.startsAt)
                        const endMin = minutesSinceMidnight(s.endsAt)
                        const top = (startMin - HOUR_START * 60) * (HOUR_PX / 60)
                        const height = Math.max((endMin - startMin) * (HOUR_PX / 60) - 2, 18)
                        if (top < 0 || top > TOTAL_HOURS * HOUR_PX) return null

                        return (
                          <DraggableCalendarSession
                            key={s.id}
                            session={s}
                            top={top}
                            height={height}
                            leftFrac={leftFrac}
                            widthFrac={widthFrac}
                            timeFormat={timeFormat}
                            canReschedule={canReschedule}
                            canSetSubstitute={canSetSubstitute}
                            onSubstitute={() => canSetSubstitute && setModal({ type: 'substitute', session: s })}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              </DndContext>
            </div>
          )}
        </div>
      )}

      {/* ── MONTH VIEW ── */}
      {view === 'month' && (
        <div className="flex-1 overflow-auto px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
          ) : (
            <MonthGrid
              year={monthYear.year}
              month={monthYear.month}
              days={monthData}
              onViewWeek={(date) => {
                setWeekStart(getMonday(new Date(date)))
                setView('week')
              }}
              canSetSubstitute={canSetSubstitute}
              onSubstitute={canSetSubstitute ? (s) => setModal({
                type: 'substitute',
                session: {
                  id: s.id,
                  scheduleId: null,
                  templateId: '',
                  templateName: s.name,
                  sport: s.sport,
                  instructorId: s.instructorId ?? '',
                  instructorName: s.instructorName,
                  substituteInstructorId: s.substituteInstructorId,
                  substituteInstructorName: null,
                  startsAt: s.startsAt,
                  endsAt: s.startsAt,
                  roomId: '',
                  roomName: '',
                  capacity: 0,
                  status: s.status,
                  creditsRequired: 0,
                },
              }) : undefined}
            />
          )}
        </div>
      )}

      {/* ── SCHEDULES TAB ── */}
      {view === 'schedules' && (
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full">

            {/* ── Left: schedules list ── */}
            <div className="flex-1 min-w-0 px-6 py-6 space-y-8 pb-24 overflow-auto">

            {/* Recurring schedules */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recurring schedules</h3>
                {selectedIds.size > 0 && canCreateSchedules && (
                  <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
                )}
              </div>

              {visibleSchedules.length > 0 && (
                <div className="space-y-3 mb-4">
                  {/* Filter bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Text search */}
                    <div className="relative">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4"/><path d="M11 11l3 3" strokeLinecap="round"/></svg>
                      <input
                        value={schedSearch}
                        onChange={e => setSchedSearch(e.target.value)}
                        placeholder="Name, time, duration…"
                        className="pl-7 pr-3 py-1 text-xs border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
                      />
                    </div>

                    {/* Sport pills */}
                    {uniqueSports.map(sport => {
                      const cfg = SPORT_CONFIG[sport] ?? SPORT_CONFIG.OTHER
                      const active = schedSport === sport
                      return (
                        <button key={sport}
                          onClick={() => setSchedSport(active ? '' : sport)}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                            active ? `${cfg.accent.replace('bg-', 'bg-')} bg-gray-900 text-white border-gray-900` : `border-gray-200 text-gray-500 hover:border-gray-400`
                          }`}
                        >{cfg.label ?? sport}</button>
                      )
                    })}

                    {/* Instructor filter */}
                    {uniqueInstructors.length > 1 && (
                      <select
                        value={schedInstructor}
                        onChange={e => setSchedInstructor(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300 text-gray-600"
                      >
                        <option value="">All instructors</option>
                        {uniqueInstructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    )}

                    {/* Day pills */}
                    {DAY_ORDER.map(d => {
                      const active = schedDay === d
                      return (
                        <button key={d}
                          onClick={() => setSchedDay(active ? null : d)}
                          className={`text-[10px] font-medium w-7 h-7 rounded-full border transition-colors ${
                            active ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                          }`}
                        >{DAY_FULL[d].slice(0, 2)}</button>
                      )
                    })}

                    {/* Clear filters */}
                    {(schedSearch || schedSport || schedInstructor || schedDay !== null) && (
                      <button
                        onClick={() => { setSchedSearch(''); setSchedSport(''); setSchedInstructor(''); setSchedDay(null) }}
                        className="text-[10px] text-gray-400 hover:text-gray-700 underline underline-offset-2"
                      >Clear</button>
                    )}

                    {/* Select all checkbox */}
                    {canCreateSchedules && filteredSchedules.length > 0 && (
                      <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded accent-gray-900"
                          checked={selectedIds.size === filteredSchedules.length && filteredSchedules.length > 0}
                          onChange={toggleSelectAll}
                        />
                        Select all
                      </label>
                    )}
                  </div>
                </div>
              )}

              {filteredSchedules.length === 0 && visibleSchedules.length > 0 ? (
                <p className="text-sm text-gray-400">No schedules match your filters.</p>
              ) : visibleSchedules.length === 0 ? (
                <p className="text-sm text-gray-400">No recurring schedules yet.</p>
              ) : (
                <div className="space-y-5">
                  {schedsByDay.map(({ dayNum, label, items }) => (
                    <div key={dayNum}>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
                      <div className="space-y-1">
                        {items.map(sched => {
                          const cfg = SPORT_CONFIG[sched.sport] ?? SPORT_CONFIG.OTHER
                          const isSelected = selectedIds.has(sched.id)
                          const allDayStr = sched.daysOfWeek.map(d => DAY_FULL[d].slice(0, 2)).join(' ')
                          return (
                            <div
                              key={`${dayNum}-${sched.id}`}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                                isSelected ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-100 hover:border-gray-200'
                              }`}
                            >
                              {/* Checkbox */}
                              {canCreateSchedules && (
                                <input
                                  type="checkbox"
                                  className="w-3.5 h-3.5 rounded accent-gray-900 shrink-0"
                                  checked={isSelected}
                                  onChange={() => toggleSelect(sched.id)}
                                />
                              )}

                              {/* Sport bar */}
                              <div className={`w-0.5 self-stretch rounded-full shrink-0 ${cfg.accent}`} />

                              {/* Info */}
                              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-gray-900 truncate">{sched.templateName}</p>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${cfg.bg} ${cfg.color}`}>{cfg.label ?? sched.sport}</span>
                                <span className="text-xs text-gray-400 shrink-0">{fmtHHMM(sched.startTime, timeFormat)} · {sched.durationMin}m</span>
                                <span className="text-xs text-gray-400 truncate">{sched.instructorName}</span>
                                {sched.roomName && <span className="text-xs text-gray-300 shrink-0">· {sched.roomName}</span>}
                                {sched.intervalWeeks > 1 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-500 shrink-0">Every {sched.intervalWeeks}w</span>
                                )}
                                {sched.daysOfWeek.length > 1 && (
                                  <span className="text-[10px] text-gray-300 shrink-0">{allDayStr}</span>
                                )}
                                {(() => {
                                  const { cls, label } = scheduleUntilStyle(sched.validFrom, sched.validUntil)
                                  return (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${cls}`}>
                                      {label}
                                    </span>
                                  )
                                })()}
                              </div>

                              {/* Actions */}
                              {canCreateSchedules && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button onClick={() => setModal({ type: 'edit-schedule', schedule: sched })}
                                    className="text-xs text-gray-400 hover:text-gray-700 px-2 py-0.5 rounded hover:bg-gray-100 transition-colors">Edit</button>
                                  <button onClick={() => handleDeleteSchedule(sched.id)} disabled={deletingId === sched.id}
                                    className="text-xs text-red-400 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-40">
                                    {deletingId === sched.id ? '…' : 'Del'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Orphaned sessions — not yet linked to a schedule */}
            {visibleOrphaned.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Unscheduled sessions</h3>
                <p className="text-xs text-gray-400 mb-3">These sessions exist in the calendar but are not linked to a recurring schedule. Create a schedule to manage them as a group.</p>
                <div className="space-y-1">
                  {visibleOrphaned.map((p, i) => {
                    const cfg = SPORT_CONFIG[p.sport] ?? SPORT_CONFIG.OTHER
                    const dayStr = p.daysOfWeek.map(d => DAY_FULL[d].slice(0, 2)).join(' ')
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-dashed border-gray-200 bg-white hover:border-gray-300 transition-colors">
                        <div className={`w-0.5 self-stretch rounded-full opacity-50 shrink-0 ${cfg.accent}`} />
                        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-700 truncate">{p.templateName}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${cfg.bg} ${cfg.color}`}>{cfg.label ?? p.sport}</span>
                          <span className="text-xs text-gray-400 shrink-0">{fmtHHMM(p.startTime, timeFormat)} · {p.durationMin}m</span>
                          <span className="text-xs text-gray-400 truncate">{p.instructorName}</span>
                          <span className="text-[10px] text-gray-300 shrink-0">{dayStr}</span>
                          <span className="text-[10px] text-gray-300 shrink-0">{p.sessionCount} upcoming</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {canCreateSchedules && (
                            <button
                              onClick={() => setModal({ type: 'new-schedule', prefill: p })}
                              className="text-xs font-medium text-gray-600 px-2 py-0.5 rounded border border-gray-200 hover:border-gray-500 hover:text-gray-900 transition-colors"
                            >Make recurring</button>
                          )}
                          <button
                            onClick={() => handleDeleteOrphaned(p)}
                            disabled={deletingOrphanKey === `${p.templateId}|${p.instructorId}|${p.startTime}`}
                            className="text-xs text-red-400 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            {deletingOrphanKey === `${p.templateId}|${p.instructorId}|${p.startTime}` ? '…' : 'Delete all'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {visibleSchedules.length === 0 && visibleOrphaned.length === 0 && (
              <div className="text-center py-16 text-gray-400 text-sm">
                No sessions or schedules yet.{' '}
                {canCreateSchedules && (
                  <button className="text-gray-700 underline underline-offset-2" onClick={() => setModal({ type: 'new-schedule' })}>Create a schedule</button>
                )}
              </div>
            )}
            </div>{/* end left column */}

            {/* ── Right: class templates sidebar ── */}
            {canCreateSchedules && (
              <div className="w-[28rem] shrink-0 border-l border-gray-100 px-6 py-6 overflow-auto bg-gray-50/50">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Class templates</h3>
                <p className="text-xs text-gray-400 mb-4">Define the class types offered at this studio. Templates pre-fill the schedule form when selected.</p>
                <ClassTemplatesSection
                  studioId={studioId}
                  token={token}
                />
              </div>
            )}
          </div>{/* end flex row */}

          {/* Bulk delete floating bar */}
          {selectedIds.size > 0 && canCreateSchedules && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-xl z-50">
              <span className="text-sm font-medium">{selectedIds.size} schedule{selectedIds.size > 1 ? 's' : ''} selected</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >Cancel</button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="text-sm font-medium bg-red-500 hover:bg-red-400 px-4 py-1.5 rounded-xl transition-colors disabled:opacity-50"
              >{bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}</button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {(modal?.type === 'new-schedule' || modal?.type === 'edit-schedule') && data && (
        <ScheduleModal
          studioId={studioId}
          token={token}
          templates={data.templates}
          instructors={data.instructors}
          rooms={data.rooms}
          editSchedule={modal.type === 'edit-schedule' ? modal.schedule : undefined}
          prefill={modal.type === 'new-schedule' ? modal.prefill : undefined}
          onSave={() => { setModal(null); load() }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'substitute' && canSetSubstitute && data && (
        <SubstituteModal
          session={modal.session}
          studioId={studioId}
          token={token}
          instructors={data.instructors}
          onSave={update => handleSubstituteUpdate(modal.session.id, update)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Draggable session card for week view ──────────────────────────────────────

function DraggableCalendarSession({
  session: s,
  top,
  height,
  leftFrac,
  widthFrac,
  timeFormat,
  canReschedule,
  canSetSubstitute,
  onSubstitute,
}: {
  session: CalendarSession
  top: number
  height: number
  leftFrac: number
  widthFrac: number
  timeFormat: '12h' | '24h'
  canReschedule: boolean
  canSetSubstitute: boolean
  onSubstitute: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: s.id,
    disabled: !canReschedule,
  })

  const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
  const hasSubstitute = !!s.substituteInstructorId
  const isCancelled = s.status === 'CANCELLED'
  const durationMin = Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000)
  const startLabel = fmtTime(s.startsAt, timeFormat)

  const style: React.CSSProperties = {
    top: top + (transform?.y ?? 0),
    height,
    left: `${leftFrac * 100 + 0.5}%`,
    width: `${widthFrac * 100 - 1}%`,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`absolute rounded-md overflow-hidden border transition-shadow hover:shadow-md ${cfg.bg} ${isCancelled ? 'opacity-40' : ''} ${
        canReschedule ? 'cursor-grab active:cursor-grabbing' : canSetSubstitute ? 'cursor-pointer' : 'cursor-default'
      } ${isDragging ? 'shadow-xl ring-1 ring-gray-900/20' : 'hover:z-10'}`}
      onClick={!canReschedule ? onSubstitute : undefined}
      {...(canReschedule ? { ...attributes, ...listeners } : {})}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${cfg.accent}`} />
      <div className="pl-2 pr-1 py-0.5 h-full flex flex-col justify-start overflow-hidden gap-px">
        <p className={`text-[10px] font-semibold truncate leading-tight ${cfg.color}`}>{s.templateName}</p>
        {height > 22 && (
          <p className="text-[9px] text-gray-500 leading-tight tabular-nums">
            {startLabel} · {durationMin}m
          </p>
        )}
        {height > 42 && (
          <p className="text-[9px] text-gray-500 truncate leading-tight">
            {hasSubstitute
              ? <span className="inline-flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />{s.substituteInstructorName}</span>
              : s.instructorName}
          </p>
        )}
        {height > 68 && s.roomName && (
          <p className="text-[9px] text-gray-400 truncate leading-tight">{s.roomName}</p>
        )}
        {canReschedule && canSetSubstitute && height > 32 && (
          <button
            className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded bg-white/80 hover:bg-white border border-gray-300 hover:border-gray-500 text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors z-10 shadow-sm leading-none"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onSubstitute() }}
            title="Assign substitute"
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

// ── Month grid component ──────────────────────────────────────────────────────

type MonthSession = { id: string; sport: string; name: string; startsAt: string; instructorId: string | null; instructorName: string; substituteInstructorId: string | null; status: string }

function MonthGrid({
  year, month, days, onViewWeek, canSetSubstitute, onSubstitute,
}: {
  year: number
  month: number
  days: Record<string, MonthSession[]>
  onViewWeek: (isoDate: string) => void
  canSetSubstitute?: boolean
  onSubstitute?: (session: MonthSession) => void
}) {
  const [popoverDay, setPopoverDay] = useState<string | null>(null)

  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const startOffset = (firstDay.getDay() + 6) % 7 // Mon=0
  const totalCells = startOffset + lastDay.getDate()
  const rows = Math.ceil(totalCells / 7)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const popoverSessions = popoverDay ? (days[popoverDay] ?? []) : []
  const popoverDate = popoverDay ? new Date(popoverDay + 'T00:00:00') : null

  return (
    <div className="w-full">
      {/* Day name headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: rows * 7 }, (_, cell) => {
          const dayNum = cell - startOffset + 1
          if (dayNum < 1 || dayNum > lastDay.getDate()) {
            return <div key={cell} className="min-h-[100px]" />
          }
          const date = new Date(year, month - 1, dayNum)
          const dateStr = isoDate(date)
          const sessions = days[dateStr] ?? []
          const isToday = date.getTime() === today.getTime()
          const isWeekend = date.getDay() === 0 || date.getDay() === 6
          const CHIP_MAX = 3
          const visible = sessions.slice(0, CHIP_MAX)
          const overflow = Math.max(0, sessions.length - CHIP_MAX)

          return (
            <div
              key={cell}
              onClick={() => sessions.length > 0 && setPopoverDay(dateStr)}
              className={`min-h-[100px] rounded-lg p-1.5 transition-colors border flex flex-col gap-0.5 ${
                sessions.length > 0 ? 'cursor-pointer' : ''
              } ${
                isToday
                  ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                  : 'border-gray-100 bg-white hover:bg-gray-50'
              } ${isWeekend && !isToday ? 'bg-gray-50/50' : ''}`}
            >
              <span className={`text-xs font-semibold leading-none mb-0.5 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                {dayNum}
              </span>
              {visible.map(s => {
                const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
                const time = new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                return (
                  <div
                    key={s.id}
                    className={`rounded px-1 py-0.5 text-[10px] leading-tight truncate flex items-center gap-0.5 ${cfg.bg} ${cfg.color}`}
                  >
                    <span className={`w-1 h-1 rounded-full shrink-0 ${cfg.accent}`} />
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="opacity-60 shrink-0">{time}</span>
                  </div>
                )
              })}
              {overflow > 0 && (
                <span className="text-[9px] text-gray-400 leading-none mt-0.5">+{overflow} more</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Day popover */}
      {popoverDay && popoverDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={() => setPopoverDay(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-80 max-h-[70vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Popover header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {popoverDate.toLocaleDateString('en-US', { weekday: 'long' })}
                </p>
                <p className="text-base font-semibold text-gray-900">
                  {popoverDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                </p>
              </div>
              <button
                onClick={() => { setPopoverDay(null); onViewWeek(popoverDay) }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                View week →
              </button>
            </div>

            {/* Session list */}
            <div className="overflow-y-auto divide-y divide-gray-50">
              {popoverSessions.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No classes</p>
              ) : (
                popoverSessions.map(s => {
                  const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
                  const time = new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                  const hasSub = !!s.substituteInstructorId
                  return (
                    <div key={s.id} className="flex items-start gap-3 px-4 py-3">
                      <div className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${cfg.accent}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                        <p className="text-xs text-gray-500">
                          {time}
                          {hasSub
                            ? <> · <span className="line-through opacity-50">{s.instructorName}</span> <span className="text-amber-600 font-medium">sub</span></>
                            : <> · {s.instructorName}</>}
                        </p>
                        {s.status !== 'SCHEDULED' && (
                          <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {s.status.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                      {canSetSubstitute && onSubstitute && (
                        <button
                          onClick={() => { setPopoverDay(null); onSubstitute(s) }}
                          title="Set substitute instructor"
                          className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                            hasSub
                              ? 'border-amber-300 text-amber-600 hover:bg-amber-50'
                              : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600'
                          }`}
                        >
                          {hasSub ? '⇄ sub' : '+ sub'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Close */}
            <div className="px-4 py-3 border-t">
              <button
                onClick={() => setPopoverDay(null)}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
