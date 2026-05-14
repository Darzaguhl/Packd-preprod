'use client'

export interface DayTab {
  label: string   // "Wed"
  date: string    // "May 14"
  iso: string     // "2026-05-14"
  count: number
}

interface Props {
  days: DayTab[]
  selected: string
  onSelect: (iso: string) => void
  weekOffset: number
  onPrev: () => void
  onNext: () => void
}

const todayIso = new Date().toISOString().split('T')[0]

export default function DayTabs({ days, selected, onSelect, weekOffset, onPrev, onNext }: Props) {
  return (
    <div className="flex items-center gap-2 pl-2">
      {/* Prev arrow */}
      <button
        onClick={onPrev}
        disabled={weekOffset <= 0}
        className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous week"
      >
        <Chevron dir="left" />
      </button>

      {/* Day pills */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {days.map((d) => {
          const isSelected = d.iso === selected
          const isToday = d.iso === todayIso

          return (
            <button
              key={d.iso}
              onClick={() => onSelect(d.iso)}
              data-testid="day-tab"
              aria-selected={isSelected}
              className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl transition-all duration-150 min-w-[56px] ${
                isSelected
                  ? 'bg-black text-white shadow-sm'
                  : isToday
                  ? 'ring-1 ring-gray-800 ring-inset text-gray-900'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="text-[11px] font-medium">{d.label}</span>
              <span className={`text-lg font-bold leading-tight tabular-nums ${
                isSelected ? 'text-white' : 'text-gray-900'
              }`}>
                {d.date.split(' ')[1]}
              </span>
              {d.count > 0 && (
                <span className={`mt-0.5 text-[10px] ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                  {d.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Next arrow — immediately after the last pill */}
      <button
        onClick={onNext}
        className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label="Next week"
      >
        <Chevron dir="right" />
      </button>
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {dir === 'left' ? <path d="M10 4L6 8l4 4" /> : <path d="M6 4l4 4-4 4" />}
    </svg>
  )
}
