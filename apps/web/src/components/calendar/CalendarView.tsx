'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type CalendarWeek, type CalendarSession, type ClassSchedule, type OrphanedPattern } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import ScheduleModal from './ScheduleModal'
import SubstituteModal from './SubstituteModal'

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
  /** When set, filter displayed sessions to this Instructor record ID; user can toggle off */
  filterInstructorId?: string
}

type ViewMode = 'week' | 'month' | 'schedules'

type Modal =
  | { type: 'new-schedule'; prefill?: Partial<OrphanedPattern> }
  | { type: 'edit-schedule'; schedule: ClassSchedule }
  | { type: 'substitute'; session: CalendarSession }

export default function CalendarView({ studioId, token, canCreateSchedules = true, filterInstructorId }: Props) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [monthYear, setMonthYear] = useState(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 }
  })
  const [data, setData] = useState<CalendarWeek | null>(null)
  const [monthData, setMonthData] = useState<Record<string, { sport: string; count: number }[]>>({})
  const [allSchedules, setAllSchedules] = useState<ClassSchedule[]>([])
  const [orphaned, setOrphaned] = useState<OrphanedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<Modal | null>(null)
  const [view, setView] = useState<ViewMode>('week')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingOrphanKey, setDeletingOrphanKey] = useState<string | null>(null)
  // Instructor filter — default on when filterInstructorId is provided
  const [myClassesOnly, setMyClassesOnly] = useState(!!filterInstructorId)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [week, schedules, orphanedData, mData] = await Promise.all([
        api.schedules.week(studioId, isoDate(weekStart), token),
        api.schedules.all(studioId, token),
        api.schedules.orphaned(studioId, token),
        api.schedules.month(studioId, monthYear.year, monthYear.month, token),
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
  }, [studioId, token, weekStart, monthYear])

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
                    <div key={i} className="h-10 flex flex-col items-center justify-center border-l border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setModal({ type: 'new-schedule' })}>
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${isToday ? 'text-gray-900' : 'text-gray-400'}`}>{DAY_LABELS[i]}</span>
                      <span className={`text-sm font-bold leading-none ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>{d.getDate()}</span>
                    </div>
                  )
                })}
              </div>

              {/* Time grid */}
              <div className="relative grid grid-cols-[48px_repeat(7,1fr)]" style={{ height: TOTAL_HOURS * HOUR_PX }}>
                {Array.from({ length: TOTAL_HOURS }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: h * HOUR_PX }}>
                    <span className="absolute left-0 w-10 text-right pr-2 text-[10px] text-gray-300 -translate-y-2">
                      {String(HOUR_START + h).padStart(2, '0')}
                    </span>
                  </div>
                ))}

                {days.map((_, colIdx) => {
                  const laid = layoutSessions(sessionsByDay[colIdx])
                  return (
                    <div key={colIdx} className={`relative border-l border-gray-100 ${colIdx === 0 ? 'col-start-2' : ''}`}>
                      {laid.map(({ session: s, leftFrac, widthFrac }) => {
                        const startMin = minutesSinceMidnight(s.startsAt)
                        const endMin = minutesSinceMidnight(s.endsAt)
                        const top = (startMin - HOUR_START * 60) * (HOUR_PX / 60)
                        const height = Math.max((endMin - startMin) * (HOUR_PX / 60) - 2, 18)
                        if (top < 0 || top > TOTAL_HOURS * HOUR_PX) return null

                        const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
                        const hasSubstitute = !!s.substituteInstructorId
                        const isCancelled = s.status === 'CANCELLED'

                        return (
                          <div
                            key={s.id}
                            className={`absolute rounded-md overflow-hidden cursor-pointer border transition-shadow hover:shadow-md hover:z-10 ${cfg.bg} ${isCancelled ? 'opacity-40' : ''}`}
                            style={{ top, height, left: `${leftFrac * 100 + 0.5}%`, width: `${widthFrac * 100 - 1}%` }}
                            onClick={() => setModal({ type: 'substitute', session: s })}
                          >
                            <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${cfg.accent}`} />
                            <div className="pl-2 pr-1 py-0.5 h-full flex flex-col justify-start overflow-hidden">
                              <p className={`text-[10px] font-semibold truncate leading-tight ${cfg.color}`}>{s.templateName}</p>
                              {height > 28 && (
                                <p className="text-[9px] text-gray-500 truncate leading-tight">
                                  {hasSubstitute
                                    ? <span className="inline-flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />{s.substituteInstructorName}</span>
                                    : s.instructorName}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
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
              onDayClick={(date) => {
                setWeekStart(getMonday(new Date(date)))
                setView('week')
              }}
            />
          )}
        </div>
      )}

      {/* ── SCHEDULES TAB ── */}
      {view === 'schedules' && (
        <div className="flex-1 overflow-auto px-6 py-6 space-y-8 max-w-2xl">
          {/* Recurring schedules */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recurring schedules</h3>
            {allSchedules.length === 0 ? (
              <p className="text-sm text-gray-400">No recurring schedules yet.</p>
            ) : (
              <div className="space-y-2">
                {allSchedules.map(sched => {
                  const cfg = SPORT_CONFIG[sched.sport] ?? SPORT_CONFIG.OTHER
                  const dayStr = sched.daysOfWeek.map(d => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join(', ')
                  return (
                    <div key={sched.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-4">
                      <div className={`w-1 self-stretch rounded-full ${cfg.accent}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{sched.templateName}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label ?? sched.sport}</span>
                          {sched.intervalWeeks > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-600">Every {sched.intervalWeeks} weeks</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{dayStr} · {sched.startTime} · {sched.durationMin}m · {sched.instructorName} · {sched.roomName}</p>
                      </div>
                      {canCreateSchedules && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => setModal({ type: 'edit-schedule', schedule: sched })}
                            className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-md px-2.5 py-1 transition-colors">Edit</button>
                          <button onClick={() => handleDeleteSchedule(sched.id)} disabled={deletingId === sched.id}
                            className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40">
                            {deletingId === sched.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Orphaned sessions — not yet linked to a schedule */}
          {orphaned.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Unscheduled sessions</h3>
              <p className="text-xs text-gray-400 mb-3">These sessions exist in the calendar but are not linked to a recurring schedule. Create a schedule to manage them as a group.</p>
              <div className="space-y-2">
                {orphaned.map((p, i) => {
                  const cfg = SPORT_CONFIG[p.sport] ?? SPORT_CONFIG.OTHER
                  const dayStr = p.daysOfWeek.map(d => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join(', ')
                  return (
                    <div key={i} className="bg-white border border-dashed border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4">
                      <div className={`w-1 self-stretch rounded-full opacity-50 ${cfg.accent}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-700">{p.templateName}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label ?? p.sport}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{dayStr} · {p.startTime} · {p.durationMin}m · {p.instructorName} · {p.roomName} · {p.sessionCount} sessions upcoming</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canCreateSchedules && (
                          <button
                            onClick={() => setModal({ type: 'new-schedule', prefill: p })}
                            className="text-xs font-medium text-gray-600 border border-gray-300 rounded-md px-2.5 py-1 hover:border-gray-600 hover:text-gray-900 transition-colors"
                          >
                            Make recurring
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteOrphaned(p)}
                          disabled={deletingOrphanKey === `${p.templateId}|${p.instructorId}|${p.startTime}`}
                          className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40"
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

          {allSchedules.length === 0 && orphaned.length === 0 && (
            <div className="text-center py-16 text-gray-400 text-sm">
              No sessions or schedules yet.{' '}
              {canCreateSchedules && (
                <button className="text-gray-700 underline underline-offset-2" onClick={() => setModal({ type: 'new-schedule' })}>Create a schedule</button>
              )}
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

      {modal?.type === 'substitute' && data && (
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

// ── Month grid component ──────────────────────────────────────────────────────

function MonthGrid({
  year, month, days, onDayClick,
}: {
  year: number
  month: number
  days: Record<string, { sport: string; count: number }[]>
  onDayClick: (isoDate: string) => void
}) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const startOffset = (firstDay.getDay() + 6) % 7 // Mon=0
  const totalCells = startOffset + lastDay.getDate()
  const rows = Math.ceil(totalCells / 7)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  return (
    <div className="max-w-3xl">
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
            return <div key={cell} className="h-16" />
          }
          const date = new Date(year, month - 1, dayNum)
          const dateStr = isoDate(date)
          const sessions = days[dateStr] ?? []
          const isToday = date.getTime() === today.getTime()
          const isWeekend = date.getDay() === 0 || date.getDay() === 6

          // Aggregate sport dots (max 4)
          const sportDots = sessions
            .reduce<string[]>((acc, s) => acc.includes(s.sport) ? acc : [...acc, s.sport], [])
            .slice(0, 4)

          return (
            <div
              key={cell}
              onClick={() => onDayClick(dateStr)}
              className={`h-16 rounded-lg p-1.5 cursor-pointer transition-colors border ${
                isToday
                  ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                  : 'border-gray-100 bg-white hover:bg-gray-50'
              } ${isWeekend && !isToday ? 'bg-gray-50/50' : ''}`}
            >
              <span className={`text-xs font-semibold leading-none ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                {dayNum}
              </span>
              {sessions.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {sportDots.map(sport => {
                    const cfg = SPORT_CONFIG[sport] ?? SPORT_CONFIG.OTHER
                    return <span key={sport} className={`w-1.5 h-1.5 rounded-full ${cfg.accent}`} />
                  })}
                  {sessions.length > 4 && (
                    <span className="text-[9px] text-gray-400 leading-none self-end">+{sessions.length - 4}</span>
                  )}
                </div>
              )}
              {sessions.length > 0 && (
                <p className="text-[9px] text-gray-400 mt-0.5 leading-none">{sessions.length} class{sessions.length !== 1 ? 'es' : ''}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
