'use client'

import { useState, useCallback } from 'react'
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
} from '@dnd-kit/core'
import type { RoomLayout, SpotAssignment, Station } from '@/lib/api'
import { STATION_META } from './constants'

const SCALE = 90 // px per metre
const STATION_MIN_W = 130
const STATION_MIN_H = 100

interface Props {
  layout: RoomLayout
  assignments: SpotAssignment[]
  onAssign: (bookingId: string, stationId: string | null) => Promise<void>
  onCheckin?: (bookingId: string) => Promise<void>
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// "Treadmill 1" → "T1", "Floor 2" → "F2"
function shortLabel(label: string) {
  const num = label.match(/\d+/)
  return `${label.trim()[0].toUpperCase()}${num ? num[0] : ''}`
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

// Tile shown in the unassigned roster and as the DragOverlay
function MemberTile({ assignment, isDragging = false }: { assignment: SpotAssignment; isDragging?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-white border transition-all ${
      isDragging ? 'shadow-lg opacity-80 border-gray-300' : 'border-gray-100'
    }`}>
      <div className={`w-1 h-10 rounded-full shrink-0 ${assignment.checkedIn ? 'bg-emerald-400' : 'bg-gray-200'}`} />
      <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
        {initials(assignment.memberName)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-900 truncate">{assignment.memberName}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <MembershipBadge status={assignment.membershipStatus} />
          <span className="text-[9px] text-gray-400">{assignment.creditBalance} cr</span>
        </div>
      </div>
    </div>
  )
}

function DraggableMember({ assignment }: { assignment: SpotAssignment }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: assignment.bookingId,
    disabled: assignment.checkedIn, // locked once checked in
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`${assignment.checkedIn ? 'cursor-default' : 'cursor-grab'} ${isDragging ? 'opacity-30' : ''}`}
    >
      <MemberTile assignment={assignment} />
    </div>
  )
}

function DroppableStation({
  station,
  assignment,
  layout,
  onCheckin,
  onUnassign,
}: {
  station: Station
  assignment: SpotAssignment | undefined
  layout: RoomLayout
  onCheckin?: (bookingId: string) => void
  onUnassign?: (bookingId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: station.id })
  const meta = STATION_META[station.type]

  const w = Math.max(meta.w * SCALE, STATION_MIN_W)
  const h = Math.max(meta.h * SCALE, STATION_MIN_H)
  const isLocked = assignment?.checkedIn ?? false

  return (
    <div
      ref={setNodeRef}
      className={`absolute rounded-xl border-2 transition-all overflow-hidden ${
        isOver && !isLocked
          ? 'border-gray-900 bg-gray-100 scale-105 z-20'
          : assignment
            ? `${meta.color} ${isLocked ? 'ring-2 ring-emerald-400' : ''} z-10`
            : 'border-dashed border-gray-300 bg-white/60 hover:border-gray-400'
      }`}
      style={{
        left: station.xM * SCALE,
        top: station.yM * SCALE,
        width: w,
        height: h,
      }}
    >
      {assignment ? (
        <div className="flex flex-col h-full p-2 gap-1">
          {/* Station header */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm leading-none">{meta.icon}</span>
              <span className="text-[10px] font-semibold truncate text-gray-700">{station.label}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onCheckin?.(assignment.bookingId) }}
                title={assignment.checkedIn ? 'Undo check-in' : 'Check in'}
                className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                  assignment.checkedIn
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white border-2 border-gray-300 text-transparent hover:border-emerald-400'
                }`}
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
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
            </div>
          </div>

          <div className="h-px bg-black/10" />

          {/* Member info — draggable when not checked in */}
          <DraggableInStation assignment={assignment} />
        </div>
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

function DraggableInStation({ assignment }: { assignment: SpotAssignment }) {
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
        <p className="text-[11px] font-semibold text-gray-900 truncate leading-tight">{assignment.memberName}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <MembershipBadge status={assignment.membershipStatus} />
          <span className="text-[9px] text-gray-500">{assignment.creditBalance} cr</span>
        </div>
      </div>
    </div>
  )
}

function DroppableListStation({
  station,
  assignment,
  onCheckin,
  onUnassign,
}: {
  station: Station
  assignment: SpotAssignment | undefined
  onCheckin?: (bookingId: string) => void
  onUnassign?: (bookingId: string) => void
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
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all ${
        isOver && !isLocked
          ? 'bg-gray-900 ring-2 ring-gray-900 scale-[1.02]'
          : assignment?.checkedIn
            ? 'bg-emerald-50'
            : assignment
              ? 'bg-gray-50'
              : 'bg-white'
      }`}
    >
      <span className="text-sm leading-none shrink-0">{meta.icon}</span>
      <span
        className={`text-[10px] font-semibold w-6 shrink-0 ${isOver && !isLocked ? 'text-gray-300' : 'text-gray-500'}`}
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
          <p className={`text-[11px] font-medium truncate leading-tight ${isOver && !isLocked ? 'text-white' : 'text-gray-900'}`}>
            {isOver && !isLocked ? 'Drop here' : assignment.memberName}
          </p>
        ) : (
          <p className={`text-[11px] italic ${isOver ? 'text-gray-300' : 'text-gray-300'}`}>
            {isOver ? 'Drop here' : 'empty'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
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
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={() => assignment && onCheckin?.(assignment.bookingId)}
          disabled={!assignment}
          title={assignment?.checkedIn ? 'Undo check-in' : 'Check in'}
          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            assignment?.checkedIn
              ? 'bg-emerald-500 text-white'
              : assignment
                ? 'border-2 border-gray-300 text-transparent hover:border-emerald-400 bg-white'
                : 'border border-dashed border-gray-200 text-transparent cursor-default'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function SessionRoomMap({ layout, assignments, onAssign, onCheckin }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const assignmentByStation = useCallback(
    (stationId: string) => assignments.find(a => a.stationId === stationId),
    [assignments],
  )

  const unassigned = assignments.filter(a => !a.stationId)
  const checkedInCount = assignments.filter(a => a.checkedIn).length
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
            <span className="text-[11px] font-semibold text-emerald-600">{checkedInCount}/{assignments.length} in</span>
          </div>

          {/* Station rows */}
          {sortedStations.map(station => (
            <DroppableListStation
              key={station.id}
              station={station}
              assignment={assignmentByStation(station.id)}
              onCheckin={onCheckin}
              onUnassign={bookingId => onAssign(bookingId, null)}
            />
          ))}

          {/* Unassigned section */}
          {unassigned.length > 0 && (
            <>
              <div className="mt-2 mb-1 px-1">
                <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">
                  Unassigned ({unassigned.length})
                </p>
              </div>
              {unassigned.map(a => (
                <div key={a.bookingId}>
                  <DraggableMember assignment={a} />
                </div>
              ))}
            </>
          )}
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

            {layout.stations.map(station => (
              <DroppableStation
                key={station.id}
                station={station}
                assignment={assignmentByStation(station.id)}
                layout={layout}
                onCheckin={onCheckin}
                onUnassign={bookingId => onAssign(bookingId, null)}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Drag members onto stations · Drag assigned members to reassign · Click ✓ to check in · Checked-in spots are locked
      </p>

      <DragOverlay>
        {activeAssignment && <MemberTile assignment={activeAssignment} isDragging />}
      </DragOverlay>
    </DndContext>
  )
}
