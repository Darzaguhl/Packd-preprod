'use client'

import { useState } from 'react'
import type { SessionSlot } from '@packd/types'
import { SPORT_CONFIG } from './constants'

/** Local-time ISO date — avoids UTC offset shifting midnight to the previous day. */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayOfWeekMon(d: Date) {
  return (d.getDay() + 6) % 7  // Mon=0 … Sun=6
}

/** Monday of the week containing d (local time). */
function localWeekStart(d: Date): Date {
  const result = new Date(d)
  result.setHours(0, 0, 0, 0)
  const dow = result.getDay() || 7  // Mon=1…Sun=7
  result.setDate(result.getDate() - (dow - 1))
  return result
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

interface Props {
  sessions: SessionSlot[]
  selectedDay: string
  onSelectDay: (iso: string, relativeWeekOffset: number) => void
  currentWeekStart: Date
}

export default function MiniCalendar({ sessions, selectedDay, onSelectDay, currentWeekStart }: Props) {
  const today = new Date()
  const todayIso = isoDate(today)

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  // Build map: iso → sport accent colors for booked sessions only
  const bookedByDay: Record<string, string[]> = {}
  for (const s of sessions) {
    if (!s.userBookingId) continue
    const key = isoDate(new Date(s.startsAt))
    if (!bookedByDay[key]) bookedByDay[key] = []
    const accent = SPORT_CONFIG[s.sport]?.accent ?? 'bg-gray-400'
    if (!bookedByDay[key].includes(accent)) bookedByDay[key].push(accent)
  }

  const leadingBlanks = dayOfWeekMon(new Date(viewYear, viewMonth, 1))
  const totalDays = daysInMonth(viewYear, viewMonth)

  // Build rows of 7, each row starts after leading blanks
  const allCells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  while (allCells.length % 7 !== 0) allCells.push(null)

  const rows: (number | null)[][] = []
  for (let i = 0; i < allCells.length; i += 7) rows.push(allCells.slice(i, i + 7))

  // Week number for each row: use first non-null day
  function weekNumForRow(row: (number | null)[]): number {
    const firstDay = row.find((d) => d !== null)
    if (!firstDay) return 0
    return isoWeekNumber(new Date(viewYear, viewMonth, firstDay))
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  function handleDayClick(day: number) {
    const clicked = new Date(viewYear, viewMonth, day)
    // Compare week-starts so the diff is always an exact multiple of 7 days.
    // Using Math.round on individual days causes Sat/Sun to round up to the next week.
    const clickedWeekMonday = localWeekStart(clicked)
    const currentWeekMonday = localWeekStart(currentWeekStart)
    const diffWeeks = Math.round(
      (clickedWeekMonday.getTime() - currentWeekMonday.getTime()) / (7 * 86400000),
    )
    onSelectDay(isoDate(clicked), diffWeeks)
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Previous month">
          <Chevron dir="left" />
        </button>
        <span className="text-xs font-semibold text-gray-700">{monthLabel}</span>
        <button onClick={nextMonth} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Next month">
          <Chevron dir="right" />
        </button>
      </div>

      {/* Column headers: Wk + Mon–Sun */}
      <div className="grid grid-cols-8 mb-1">
        <div className="text-center text-[9px] font-medium text-gray-300 py-0.5">Wk</div>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-0.5">{d}</div>
        ))}
      </div>

      {/* Rows */}
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-8 gap-y-0.5">
          {/* Week number */}
          <div className="flex items-center justify-center text-[9px] font-medium text-gray-300">
            {weekNumForRow(row)}
          </div>

          {/* Day cells */}
          {row.map((day, ci) => {
            if (!day) return <div key={ci} />
            const iso = isoDate(new Date(viewYear, viewMonth, day))
            const isToday = iso === todayIso
            const isSelected = iso === selectedDay
            const dots = bookedByDay[iso] ?? []

            return (
              <button
                key={ci}
                onClick={() => handleDayClick(day)}
                className={`relative flex flex-col items-center justify-center rounded-lg py-1 text-[11px] font-medium transition-colors ${
                  isSelected
                    ? 'bg-black text-white'
                    : isToday
                    ? 'ring-1 ring-gray-700 ring-inset text-gray-900 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {day}
                {dots.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dots.slice(0, 3).map((accent, j) => (
                      <span key={j} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/70' : accent}`} />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      ))}

      {/* Bookings legend */}
      <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Your bookings</p>
        {Object.entries(bookedByDay).length === 0 ? (
          <p className="text-[10px] text-gray-400">No bookings this week</p>
        ) : (
          Object.entries(bookedByDay).map(([iso, accents]) => {
            const label = new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            return (
              <div key={iso} className="flex items-center gap-1.5">
                <div className="flex gap-0.5">
                  {accents.map((a, i) => <span key={i} className={`w-2 h-2 rounded-full ${a}`} />)}
                </div>
                <span className="text-[11px] text-gray-600">{label}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {dir === 'left' ? <path d="M10 4L6 8l4 4" /> : <path d="M6 4l4 4-4 4" />}
    </svg>
  )
}
