'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SessionSlot } from '@packd/types'
import CapacityBar from './CapacityBar'
import { sportConfig } from './constants'

interface ClassCardProps {
  session: SessionSlot
  onBook: (sessionId: string) => void
  onCancel: (bookingId: string, sessionId: string) => void
  onWaitlist: (sessionId: string) => void
  isLoading: boolean
  draggable?: boolean
}

export default function ClassCard({
  session: s,
  onBook,
  onCancel,
  onWaitlist,
  isLoading,
  draggable = false,
}: ClassCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: !draggable,
  })

  const cfg = sportConfig(s.sport)
  const isFull = s.bookedCount >= s.capacity
  const isBooked = !!s.userBookingId
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
      className={`group relative flex items-stretch bg-white border rounded-2xl overflow-hidden transition-all duration-150 ${
        isDragging
          ? 'shadow-2xl border-gray-300 scale-[1.02]'
          : 'border-gray-100 hover:border-gray-200 hover:shadow-md'
      } ${isBooked ? 'ring-1 ring-black ring-inset' : ''}`}
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

        {/* Action */}
        <div className="shrink-0">
          {isBooked ? (
            <button
              onClick={() => onCancel(s.userBookingId!, s.id)}
              disabled={isLoading}
              data-testid="cancel-btn"
              className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors font-medium"
            >
              {isLoading ? '…' : 'Cancel'}
            </button>
          ) : isFull ? (
            <button
              onClick={() => onWaitlist(s.id)}
              disabled={isLoading}
              data-testid="waitlist-btn"
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors font-medium"
            >
              {isLoading ? '…' : 'Waitlist'}
            </button>
          ) : (
            <button
              onClick={() => onBook(s.id)}
              disabled={isLoading}
              data-testid="book-btn"
              className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-40 transition-colors font-medium"
            >
              {isLoading ? '…' : 'Book'}
            </button>
          )}
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
