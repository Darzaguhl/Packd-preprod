'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
  type DropAnimation,
} from '@dnd-kit/core'
import type { RoomLayout, SpotAssignment, Station } from '@/lib/api-client'
import { STATION_META } from './constants'

const SCALE = 90 // px per metre
const STATION_MIN_W = 130
const STATION_MIN_H = 100

type NameSize = 's' | 'm' | 'l' | 'xl'
const NAME_SIZE_CLASS: Record<NameSize, string> = {
  s:  'text-[9px]',
  m:  'text-[11px]',
  l:  'text-[14px]',
  xl: 'text-[18px]',
}
const LS_KEY = 'packd-map-name-size'

interface Props {
  layout: RoomLayout
  assignments: SpotAssignment[]
  onAssign: (bookingId: string, stationId: string | null) => Promise<void>
  onCheckin?: (bookingId: string) => Promise<void>
  onMemberClick?: (assignment: SpotAssignment) => void
  onEmptyStationClick?: (station: Station) => void
  onRemoveBooking?: (bookingId: string) => Promise<void>
  orderedMemberIds?: Set<string>
}

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// "Treadmill 1" → "T1", "Floor 2" → "F2"
function shortLabel(label: string) {
  const num = label.match(/\d+/)
  return `${label.trim()[0].toUpperCase()}${num ? num[0] : ''}`
}

function CheckInButton({
  checkedIn,
  onClick,
  size = 'sm',
}: {
  checkedIn: boolean
  onClick: () => void
  size?: 'sm' | 'md'
}) {
  const dim = size === 'md' ? 'w-6 h-6' : 'w-5 h-5'
  return (
    <button
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick() }}
      title={checkedIn ? 'Undo check-in' : 'Check in'}
      className={`group ${dim} rounded-full flex items-center justify-center transition-colors shrink-0 ${
        checkedIn
          ? 'bg-emerald-500 text-white hover:bg-red-500'
          : 'bg-white border-2 border-gray-300 text-transparent hover:border-emerald-400'
      }`}
    >
      {/* Checkmark — hidden on hover when checked in */}
      <svg
        className={`w-3 h-3 ${checkedIn ? 'group-hover:hidden' : ''}`}
        viewBox="0 0 12 12" fill="none"
      >
        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {/* × — shown on hover only when checked in */}
      {checkedIn && (
        <svg className="w-3 h-3 hidden group-hover:block" viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  )
}

function MembershipBadge({ status }: { status: SpotAssignment['membershipStatus'] }) {
  if (status === 'ACTIVE') return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
  )
  if (status === 'PAUSED') return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Paused</span>
  )
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">No plan</span>
  )
}

// Tile shown as the DragOverlay
function MemberTile({ assignment, isDragging = false, onMemberClick, ordered }: { assignment: SpotAssignment; isDragging?: boolean; onMemberClick?: (a: SpotAssignment) => void; ordered?: boolean }) {
  const clickable = onMemberClick && !isDragging
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-white border transition-all ${
      isDragging ? 'shadow-lg opacity-80 border-gray-300' : 'border-gray-100'
    }`}>
      <div className={`w-1 h-10 rounded-full shrink-0 ${assignment.checkedIn ? 'bg-emerald-400' : 'bg-gray-200'}`} />
      <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
        {initials(assignment.memberName)}
      </div>
      <div className="flex-1 min-w-0">
        {clickable ? (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMemberClick!(assignment) }}
            className={`text-xs font-semibold text-left w-full ${assignment.checkedIn ? 'text-emerald-700 hover:text-emerald-900' : 'text-gray-800 hover:text-gray-950'}`}
          >
            <span className={`inline-block border rounded px-1.5 py-0.5 leading-tight transition-colors max-w-full truncate ${assignment.checkedIn ? 'border-emerald-300 hover:border-emerald-500' : 'border-gray-300 hover:border-gray-500'}`}>
              {assignment.memberName}
            </span>
          </button>
        ) : (
          <p className="text-xs font-semibold text-gray-900 truncate">{assignment.memberName}</p>
        )}
        <div className="flex items-center gap-1 mt-0.5">
          <MembershipBadge status={assignment.membershipStatus} />
          <span className="text-[9px] text-gray-400">{assignment.creditBalance} cr</span>
          {ordered && <span className="text-[9px]" title="Has ordered">🥤</span>}
        </div>
      </div>
    </div>
  )
}


function DroppableStation({
  station,
  assignment,
  layout,
  onCheckin,
  onUnassign,
  onMemberClick,
  onEmptyStationClick,
  isAssigningTarget,
  ordered,
  nameSize,
}: {
  station: Station
  assignment: SpotAssignment | undefined
  layout: RoomLayout
  onCheckin?: (bookingId: string) => void
  onUnassign?: (bookingId: string) => void
  onMemberClick?: (a: SpotAssignment) => void
  onEmptyStationClick?: (station: Station) => void
  isAssigningTarget?: boolean
  ordered?: boolean
  nameSize?: NameSize
}) {
  const { setNodeRef, isOver } = useDroppable({ id: station.id })
  const meta = STATION_META[station.type]

  const w = Math.max(meta.w * SCALE, STATION_MIN_W)
  const h = Math.max(meta.h * SCALE, STATION_MIN_H)
  const isLocked = assignment?.checkedIn ?? false

  return (
    <div
      ref={setNodeRef}
      className={`absolute rounded-xl border-2 transition-all overflow-visible ${
        isOver && !isLocked
          ? 'border-gray-900 bg-gray-100 scale-105 z-20'
          : isAssigningTarget
            ? 'border-amber-500 bg-amber-50 z-20 ring-2 ring-amber-300'
            : isLocked
              ? 'border-emerald-400 bg-emerald-50 z-10'
              : assignment
                ? 'border-gray-300 bg-white z-10'
                : 'border-dashed border-gray-300 bg-gray-50/60 hover:border-gray-400'
      }`}
      style={{
        left: station.xM * SCALE,
        top: station.yM * SCALE,
        width: w,
        height: h,
      }}
    >
      {assignment ? (
        <div key={assignment.bookingId} className="flex flex-col h-full p-2 gap-1 animate-[fadeIn_180ms_ease-out] rounded-xl bg-inherit">
          {/* Station header */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm leading-none">{meta.icon}</span>
              <span className="text-[10px] font-semibold truncate text-gray-700">{station.label}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!isLocked && (
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onUnassign?.(assignment.bookingId) }}
                  title="Remove from station"
                  className="w-5 h-5 rounded-full bg-white/80 text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-[11px] font-bold transition-colors"
                >
                  ×
                </button>
              )}
              <CheckInButton
                checkedIn={assignment.checkedIn}
                onClick={() => onCheckin?.(assignment.bookingId)}
              />
            </div>
          </div>

          <div className="h-px bg-black/10" />

          {/* Member info — draggable when not checked in */}
          <DraggableInStation assignment={assignment} onMemberClick={onMemberClick} ordered={ordered} nameSize={nameSize} />
        </div>
      ) : onEmptyStationClick && !isOver ? (
        <button
          className="flex flex-col items-center justify-center h-full w-full gap-1 hover:bg-gray-100 transition-colors rounded-xl"
          onClick={() => onEmptyStationClick(station)}
        >
          <span className="text-xl leading-none opacity-40">{meta.icon}</span>
          <span className="text-[10px] font-semibold text-gray-400 truncate px-1 max-w-full">{station.label}</span>
          <span className="text-[9px] text-gray-400 font-medium">+ add</span>
        </button>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 pointer-events-none">
          <span className="text-xl leading-none opacity-60">{meta.icon}</span>
          <span className="text-[10px] font-semibold text-gray-500 truncate px-1 max-w-full">{station.label}</span>
          <span className="text-[9px] text-gray-400">{isOver ? 'Drop here' : 'Empty'}</span>
        </div>
      )}
    </div>
  )
}

function DraggableInStation({ assignment, onMemberClick, ordered, nameSize = 'm' }: { assignment: SpotAssignment; onMemberClick?: (a: SpotAssignment) => void; ordered?: boolean; nameSize?: NameSize }) {
  const nameCls = NAME_SIZE_CLASS[nameSize]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: assignment.bookingId,
    disabled: assignment.checkedIn,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-1.5 flex-1 min-h-0 rounded-lg transition-opacity ${
        !assignment.checkedIn ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className={`w-7 h-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0 ${
        assignment.checkedIn ? 'ring-2 ring-emerald-400 ring-offset-1' : ''
      }`}>
        {initials(assignment.memberName)}
      </div>
      <div className="flex-1 min-w-0">
        {onMemberClick && !isDragging ? (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMemberClick(assignment) }}
            className={`${nameCls} font-semibold text-left w-full ${assignment.checkedIn ? 'text-emerald-700 hover:text-emerald-900' : 'text-gray-800 hover:text-gray-950'}`}
          >
            <span className={`inline border rounded px-1 py-0 leading-snug transition-colors break-words ${assignment.checkedIn ? 'border-emerald-300 hover:border-emerald-500' : 'border-gray-300 hover:border-gray-500'}`}>
              {assignment.memberName}
            </span>
          </button>
        ) : (
          <p className={`${nameCls} font-semibold text-gray-900 leading-snug break-words`}>{assignment.memberName}</p>
        )}
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <MembershipBadge status={assignment.membershipStatus} />
          <span className="text-[9px] text-gray-500">{assignment.creditBalance} cr</span>
          {ordered && <span className="text-[9px]" title="Has ordered">🥤</span>}
        </div>
      </div>
    </div>
  )
}

/** A draggable row for members booked but not yet assigned to any station */
function UnassignedMemberRow({
  assignment,
  onCheckin,
  onMemberClick,
  onAssignToStation,
  onRemove,
  ordered,
}: {
  assignment: SpotAssignment
  onCheckin?: (bookingId: string) => void
  onMemberClick?: (a: SpotAssignment) => void
  /** When in assign-mode, called instead of onMemberClick */
  onAssignToStation?: (bookingId: string) => void
  onRemove?: (bookingId: string) => Promise<void>
  ordered?: boolean
}) {
  const inAssignMode = !!onAssignToStation
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `list-drag-${assignment.bookingId}`,
    disabled: assignment.checkedIn || inAssignMode,
  })
  return (
    <div
      ref={setNodeRef}
      {...(!inAssignMode && !assignment.checkedIn ? { ...listeners, ...attributes } : {})}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-l-2 transition-all ${
        inAssignMode
          ? 'bg-amber-100 border-l-amber-500 cursor-pointer hover:bg-amber-200'
          : assignment.checkedIn
            ? 'bg-amber-50 border-l-amber-400 cursor-default'
            : 'bg-amber-50 border-l-amber-400 cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'opacity-30' : ''}`}
      onClick={inAssignMode ? () => onAssignToStation(assignment.bookingId) : undefined}
    >
      <div className="w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
        {initials(assignment.memberName)}
      </div>
      <div className="flex-1 min-w-0">
        {inAssignMode ? (
          <p className="text-[11px] font-semibold text-amber-900 truncate">{assignment.memberName}</p>
        ) : onMemberClick ? (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMemberClick(assignment) }}
            className="text-[11px] font-medium text-gray-800 hover:text-gray-950 text-left w-full truncate"
          >
            {assignment.memberName}
          </button>
        ) : (
          <p className="text-[11px] font-medium text-gray-800 truncate">{assignment.memberName}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {ordered && <span className="text-[11px]" title="Has ordered">🥤</span>}
        {!inAssignMode && onRemove && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onRemove(assignment.bookingId) }}
            title="Cancel booking"
            className="w-5 h-5 rounded-full bg-white text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-[11px] font-bold transition-colors"
          >
            ×
          </button>
        )}
        {!inAssignMode && (
          <CheckInButton
            checkedIn={assignment.checkedIn}
            onClick={() => onCheckin?.(assignment.bookingId)}
            size="md"
          />
        )}
      </div>
    </div>
  )
}

function DroppableListStation({
  station,
  assignment,
  onCheckin,
  onUnassign,
  onMemberClick,
  onEmptyStationClick,
  ordered,
}: {
  station: Station
  assignment: SpotAssignment | undefined
  onCheckin?: (bookingId: string) => void
  onUnassign?: (bookingId: string) => void
  onMemberClick?: (a: SpotAssignment) => void
  onEmptyStationClick?: (station: Station) => void
  ordered?: boolean
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `list-${station.id}` })
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    // Prefix with list-drag- so the canvas tile's useDraggable (bare bookingId)
    // does NOT see isDragging=true when the drag originates from the list.
    id: assignment ? `list-drag-${assignment.bookingId}` : `empty-${station.id}`,
    disabled: !assignment || assignment.checkedIn,
  })
  const meta = STATION_META[station.type]
  const isLocked = assignment?.checkedIn ?? false

  return (
    <div
      ref={setDropRef}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all border-l-2 ${
        isOver && !isLocked
          ? 'bg-gray-900 border-l-gray-900 scale-[1.02]'
          : isLocked
            ? 'bg-emerald-50 border-l-emerald-500'
            : assignment
              ? 'bg-white border-l-gray-400'
              : 'bg-gray-50 border-l-gray-200'
      }`}
    >
      <span className="text-sm leading-none shrink-0">{meta.icon}</span>
      <span
        className={`text-[10px] font-semibold w-6 shrink-0 ${isOver && !isLocked ? 'text-gray-300' : isLocked ? 'text-emerald-700' : 'text-gray-500'}`}
        title={station.label}
      >
        {shortLabel(station.label)}
      </span>
      {/* Member name — draggable when assigned and not checked in */}
      <div
        ref={setDragRef}
        {...(assignment && !isLocked ? { ...listeners, ...attributes } : {})}
        className={`flex-1 min-w-0 ${assignment && !isLocked ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''}`}
      >
        {assignment ? (
          isOver && !isLocked ? (
            <p className="text-[11px] font-medium truncate leading-tight text-white">Drop here</p>
          ) : onMemberClick ? (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onMemberClick(assignment) }}
              className={`text-[11px] font-medium text-left w-full ${isLocked ? 'text-emerald-800 hover:text-emerald-950' : 'text-gray-900 hover:text-gray-700'}`}
            >
              <span className={`inline-block border rounded px-1 leading-tight transition-colors max-w-full truncate ${isLocked ? 'border-emerald-300 hover:border-emerald-500' : 'border-gray-300 hover:border-gray-500'}`}>
                {assignment.memberName}
              </span>
            </button>
          ) : (
            <p className={`text-[11px] font-medium truncate leading-tight ${isLocked ? 'text-emerald-800' : 'text-gray-900'}`}>
              {assignment.memberName}
            </p>
          )
        ) : onEmptyStationClick && !isOver ? (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onEmptyStationClick(station) }}
            className="text-[11px] text-gray-400 hover:text-gray-700 italic text-left w-full hover:not-italic transition-colors"
          >
            + add member
          </button>
        ) : (
          <p className={`text-[11px] italic ${isOver ? 'text-gray-300' : 'text-gray-400'}`}>
            {isOver ? 'Drop here' : 'empty'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/* Ordered indicator */}
        {ordered && assignment && (
          <span className="text-[11px]" title="Has ordered">🥤</span>
        )}
        {/* Remove from station */}
        {assignment && !isLocked && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onUnassign?.(assignment.bookingId) }}
            title="Remove from station"
            className="w-5 h-5 rounded-full bg-white text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-[11px] font-bold transition-colors"
          >
            ×
          </button>
        )}
        {/* Check-in */}
        {assignment ? (
          <CheckInButton
            checkedIn={assignment.checkedIn}
            onClick={() => onCheckin?.(assignment.bookingId)}
            size="md"
          />
        ) : (
          <div className="w-6 h-6 rounded-full border border-dashed border-gray-200 shrink-0" />
        )}
      </div>
    </div>
  )
}

// Fade the ghost out in-place rather than snapping it to the destination.
// Combined with the optimistic state update the real card is already visible
// at the target, so this creates a seamless "settle" feel.
const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: 'ease-out',
  keyframes() {
    return [{ opacity: 1 }, { opacity: 0 }]
  },
}

export default function SessionRoomMap({ layout, assignments, onAssign, onCheckin, onMemberClick, onEmptyStationClick, onRemoveBooking, orderedMemberIds }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [assigningStationId, setAssigningStationId] = useState<string | null>(null)
  const [nameSize, setNameSize] = useState<NameSize>(() => {
    if (typeof window === 'undefined') return 'm'
    return (localStorage.getItem(LS_KEY) as NameSize) ?? 'm'
  })

  function cycleNameSize(size: NameSize) {
    setNameSize(size)
    localStorage.setItem(LS_KEY, size)
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const assignmentByStation = useCallback(
    (stationId: string) => assignments.find(a => a.stationId === stationId),
    [assignments],
  )

  const checkedInCount = assignments.filter(a => a.checkedIn).length
  const unassigned = assignments.filter(a => !a.stationId)

  // When the assigned member list empties, exit assign mode automatically
  useEffect(() => {
    if (assigningStationId && unassigned.length === 0) setAssigningStationId(null)
  }, [assigningStationId, unassigned.length])

  function handleEmptyStationClick(station: Station) {
    if (unassigned.length > 0) {
      // Toggle: clicking the same station again cancels assign mode
      setAssigningStationId(prev => prev === station.id ? null : station.id)
    } else {
      onEmptyStationClick?.(station)
    }
  }

  async function handleAssignFromList(bookingId: string) {
    if (!assigningStationId) return
    setAssigningStationId(null)
    await onAssign(bookingId, assigningStationId)
  }
  // Resolve bare bookingId from either canvas (bare) or list (list-drag-) drag ids
  const activeBookingId = activeId?.replace(/^list-drag-/, '') ?? null
  const activeAssignment = activeBookingId ? assignments.find(a => a.bookingId === activeBookingId) : null

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    // Strip prefixes: over uses list-{stationId}, active may use list-drag-{bookingId}
    const stationId = (over.id as string).replace(/^list-/, '')
    const bookingId = (active.id as string).replace(/^list-drag-/, '')
    // Don't overwrite a checked-in member
    const targetAssignment = assignmentByStation(stationId)
    if (targetAssignment?.checkedIn) return
    await onAssign(bookingId, stationId)
  }

  // Sorted stations for the list panel
  const sortedStations = [...layout.stations].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  const canvasW = layout.widthM * SCALE
  const canvasH = layout.lengthM * SCALE

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={e => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 min-h-0">

        {/* ── Left panel: station list ── */}
        <div className="w-52 shrink-0 flex flex-col gap-1 overflow-y-auto max-h-[680px]">
          {/* Header */}
          <div className="flex items-center justify-between px-1 mb-1">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Stations</p>
            <div className="flex items-center gap-2">
              {/* Name size toggle */}
              <div className="flex rounded-md border border-gray-200 overflow-hidden">
                {(['s', 'm', 'l', 'xl'] as NameSize[]).map(s => (
                  <button
                    key={s}
                    onClick={() => cycleNameSize(s)}
                    className={`px-1.5 py-0.5 text-[9px] font-bold uppercase transition-colors ${
                      nameSize === s ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-semibold text-emerald-600">{checkedInCount}/{assignments.length} in</span>
            </div>
          </div>

          {/* Unassigned members — booked but no station yet */}
          {unassigned.length > 0 && (
            <>
              {assigningStationId ? (
                <div className="flex items-center justify-between px-1 mt-1">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                    Pick member for {layout.stations.find(s => s.id === assigningStationId)?.label}
                  </p>
                  <button
                    onClick={() => setAssigningStationId(null)}
                    className="text-[10px] text-gray-400 hover:text-gray-700 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide px-1 mt-1">
                  No station · {unassigned.length}
                </p>
              )}
              {unassigned.map(a => {
                const ordered = orderedMemberIds?.has(a.memberId)
                return (
                  <UnassignedMemberRow
                    key={a.bookingId}
                    assignment={a}
                    onCheckin={onCheckin}
                    onMemberClick={assigningStationId ? undefined : onMemberClick}
                    onAssignToStation={assigningStationId ? handleAssignFromList : undefined}
                    onRemove={onRemoveBooking}
                    ordered={ordered}
                  />
                )
              })}
              <div className="h-px bg-gray-100 my-1" />
            </>
          )}

          {/* Station rows */}
          {sortedStations.map(station => {
            const a = assignmentByStation(station.id)
            return (
              <DroppableListStation
                key={station.id}
                station={station}
                assignment={a}
                onCheckin={onCheckin}
                onUnassign={onRemoveBooking}
                onMemberClick={onMemberClick}
                onEmptyStationClick={handleEmptyStationClick}
                ordered={a ? orderedMemberIds?.has(a.memberId) : false}
              />
            )
          })}

        </div>

        {/* ── Map canvas ── */}
        <div className="flex-1 min-w-0 overflow-auto rounded-2xl border border-gray-200 bg-gray-50">
          <div
            className="relative select-none"
            style={{ width: canvasW, height: canvasH, minWidth: canvasW, minHeight: canvasH }}
          >
            {/* Grid */}
            {Array.from({ length: Math.floor(layout.widthM / 0.5) + 1 }, (_, i) => (
              <div key={`v${i}`} className="absolute top-0 bottom-0 border-l border-gray-100"
                style={{ left: i * 0.5 * SCALE }} />
            ))}
            {Array.from({ length: Math.floor(layout.lengthM / 0.5) + 1 }, (_, i) => (
              <div key={`h${i}`} className="absolute left-0 right-0 border-t border-gray-100"
                style={{ top: i * 0.5 * SCALE }} />
            ))}

            {/* Metre labels */}
            {Array.from({ length: Math.floor(layout.widthM) + 1 }, (_, i) => (
              <span key={`lx${i}`} className="absolute text-[8px] text-gray-300 font-medium pointer-events-none"
                style={{ left: i * SCALE + 2, top: 2 }}>{i}m</span>
            ))}
            {Array.from({ length: Math.floor(layout.lengthM) + 1 }, (_, i) => i > 0 && (
              <span key={`ly${i}`} className="absolute text-[8px] text-gray-300 font-medium pointer-events-none"
                style={{ left: 2, top: i * SCALE + 2 }}>{i}m</span>
            ))}

            {layout.stations.map(station => {
              const a = assignmentByStation(station.id)
              return (
                <DroppableStation
                  key={station.id}
                  station={station}
                  assignment={a}
                  layout={layout}
                  onCheckin={onCheckin}
                  onUnassign={onRemoveBooking}
                  onMemberClick={onMemberClick}
                  onEmptyStationClick={handleEmptyStationClick}
                  isAssigningTarget={assigningStationId === station.id}
                  ordered={a ? orderedMemberIds?.has(a.memberId) : false}
                  nameSize={nameSize}
                />
              )
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Drag members onto stations · Drag assigned members to reassign · Click ✓ to check in · Checked-in spots are locked
      </p>

      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeAssignment && <MemberTile assignment={activeAssignment} isDragging />}
      </DragOverlay>
    </DndContext>
  )
}
