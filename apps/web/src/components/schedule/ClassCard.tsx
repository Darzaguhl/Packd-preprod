'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SessionSlot } from '@packd/types'
import CapacityBar from './CapacityBar'
import { sportConfig } from './constants'

interface ClassCardProps {
  session: SessionSlot
  onSelect: (session: SessionSlot) => void
  draggable?: boolean
  /** Admins and fronthosts can click past classes; members cannot */
  privileged?: boolean
}

export default function ClassCard({
  session: s,
  onSelect,
  draggable = false,
  privileged = false,
}: ClassCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: !draggable,
  })

  const cfg = sportConfig(s.sport)
  const isFull = s.bookedCount >= s.capacity
  const isBooked = !!s.userBookingId
  const isPast = !privileged && new Date(s.startsAt) < new Date()
  const durationMin = Math.round(
    (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000,
  )
  const startTime = new Date(s.startsAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="class-card"
      data-session-id={s.id}
      onClick={() => !draggable && !isPast && onSelect(s)}
      className={`group relative flex items-stretch border rounded-2xl overflow-hidden transition-all duration-150 ${
        isPast
          ? 'bg-gray-50 opacity-50 cursor-not-allowed'
          : isDragging
            ? 'bg-white shadow-2xl border-gray-300 scale-[1.02] cursor-pointer'
            : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-md cursor-pointer'
      } ${isBooked && !isPast ? 'ring-1 ring-black ring-inset' : ''}`}
    >
      {/* Sport accent bar */}
      <div className={`w-1 shrink-0 ${cfg.accent}`} />

      {/* Drag handle */}
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="flex items-center px-2 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 touch-none"
          aria-label="Drag to reschedule"
        >
          <DragIcon />
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex items-center gap-4 px-4 py-3.5 min-w-0">
        {/* Time */}
        <div className="shrink-0 w-16 text-right">
          <p className="text-sm font-semibold text-gray-900 tabular-nums">{startTime}</p>
          <p className="text-xs text-gray-400">{durationMin}m</p>
        </div>

        <div className="w-px h-8 bg-gray-100 shrink-0" />

        {/* Class info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{s.templateName}</p>
            {isBooked && (
              <span className="shrink-0 text-xs bg-black text-white px-1.5 py-0.5 rounded-md font-medium">
                Booked
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">
            {s.instructorName} · {s.roomName}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
            <span className="text-xs text-gray-400">{s.creditsRequired} cr</span>
          </div>
          <div className="mt-2">
            <CapacityBar booked={s.bookedCount} capacity={s.capacity} />
          </div>
        </div>

        {/* Chevron */}
        <div className="shrink-0 flex items-center pr-1 text-gray-300 group-hover:text-gray-500 transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

function DragIcon() {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
      <circle cx="3" cy="4"  r="1.5" /><circle cx="9" cy="4"  r="1.5" />
      <circle cx="3" cy="10" r="1.5" /><circle cx="9" cy="10" r="1.5" />
      <circle cx="3" cy="16" r="1.5" /><circle cx="9" cy="16" r="1.5" />
    </svg>
  )
}
