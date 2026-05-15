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
  closestCenter,
  pointerWithin,
  type DragEndEvent,
  type CollisionDetection,
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

function MemberTile({ assignment, isDragging = false }: { assignment: SpotAssignment; isDragging?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-white border transition-all ${
      isDragging ? 'shadow-lg opacity-80 border-gray-300' : 'border-gray-100'
    }`}>
      <div className={`w-1 h-10 rounded-full shrink-0 ${assignment.checkedIn ? 'bg-emerald-400' : 'bg-gray-200'}`} />
      <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
        {initials(assignment.memberName)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-900 truncate">{assignment.memberName}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <MembershipBadge status={assignment.membershipStatus} />
          <span className="text-[9px] text-gray-400">{assignment.creditBalance} cr</span>
        </div>
        <p className="text-[9px] text-gray-400 mt-0.5">{assignment.checkedIn ? '✓ Checked in' : 'Not checked in'}</p>
      </div>
    </div>
  )
}

function DraggableMember({ assignment }: { assignment: SpotAssignment }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: assignment.bookingId })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`cursor-grab ${isDragging ? 'opacity-30' : ''}`}>
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

  return (
    <div
      ref={setNodeRef}
      className={`absolute rounded-xl border-2 transition-all overflow-hidden ${
        isOver
          ? 'border-gray-900 bg-gray-100 scale-105 z-20'
          : assignment
            ? `${meta.color} border-opacity-100 z-10`
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
              {/* Check-in toggle */}
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onCheckin?.(assignment.bookingId) }}
                title={assignment.checkedIn ? 'Mark as not checked in' : 'Check in'}
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
              {/* Unassign */}
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onUnassign?.(assignment.bookingId) }}
                title="Remove from station"
                className="w-5 h-5 rounded-full bg-white/80 text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-[11px] font-bold transition-colors"
              >
                ×
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-black/10" />

          {/* Member info */}
          <div className="flex items-center gap-1.5 flex-1 min-h-0">
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
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 pointer-events-none">
          <span className="text-xl leading-none opacity-60">{meta.icon}</span>
          <span className="text-[10px] font-semibold text-gray-500 truncate px-1 max-w-full">{station.label}</span>
          {isOver ? (
            <span className="text-[9px] text-gray-700 font-medium">Drop here</span>
          ) : (
            <span className="text-[9px] text-gray-400">Empty</span>
          )}
        </div>
      )}
    </div>
  )
}

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length > 0 ? within : closestCenter(args)
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
  const activeAssignment = activeId ? assignments.find(a => a.bookingId === activeId) : null

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    await onAssign(active.id as string, over.id as string)
  }

  const canvasW = layout.widthM * SCALE
  const canvasH = layout.lengthM * SCALE

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={e => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4">
        {/* Roster sidebar */}
        <div className="w-56 shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Members ({assignments.length})
            </p>
            <span className="text-xs text-emerald-600 font-medium">
              {checkedInCount}/{assignments.length} in
            </span>
          </div>

          <div className="overflow-y-auto max-h-[600px] space-y-1.5 pr-1">
            {assignments.map(a => (
              <div key={a.bookingId} className="relative">
                <DraggableMember assignment={a} />
                {a.stationId && (
                  <button
                    onClick={() => onAssign(a.bookingId, null)}
                    className="absolute top-1.5 right-1.5 w-4 h-4 text-[9px] text-gray-400 hover:text-red-500 transition-colors flex items-center justify-center font-bold"
                    title="Remove from station"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {assignments.length === 0 && (
              <p className="text-xs text-gray-400 px-1">No bookings yet</p>
            )}
          </div>

          {unassigned.length > 0 && (
            <p className="text-[10px] text-amber-500 font-medium px-1">
              {unassigned.length} unassigned
            </p>
          )}
        </div>

        {/* Map canvas — fixed pixel scale, scrollable */}
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

            {/* Metre labels along edges */}
            {Array.from({ length: Math.floor(layout.widthM) + 1 }, (_, i) => (
              <span key={`lx${i}`} className="absolute text-[8px] text-gray-300 font-medium"
                style={{ left: i * SCALE + 2, top: 2 }}>{i}m</span>
            ))}
            {Array.from({ length: Math.floor(layout.lengthM) + 1 }, (_, i) => (
              <span key={`ly${i}`} className="absolute text-[8px] text-gray-300 font-medium"
                style={{ left: 2, top: i * SCALE + 2 }}>{i > 0 ? `${i}m` : ''}</span>
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
        Drag members onto stations · Click ✓ to toggle check-in
      </p>

      <DragOverlay>
        {activeAssignment && <MemberTile assignment={activeAssignment} isDragging />}
      </DragOverlay>
    </DndContext>
  )
}
