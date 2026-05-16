'use client'

import type { RoomLayout, SpotAssignment, Station } from '@/lib/api'
import { STATION_META } from './constants'

interface Props {
  layout: RoomLayout
  assignments: SpotAssignment[]
  myStationId: string | null
  onPick: (stationId: string | null) => void
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export default function SpotPicker({ layout, assignments, myStationId, onPick }: Props) {
  const takenByStation = new Map(assignments.filter(a => a.stationId).map(a => [a.stationId!, a]))

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden select-none"
        style={{ aspectRatio: `${layout.widthM} / ${layout.lengthM}` }}
      >
        {/* Grid */}
        {Array.from({ length: Math.floor(layout.widthM / 0.5) + 1 }, (_, i) => (
          <div key={`v${i}`} className="absolute top-0 bottom-0 border-l border-gray-100"
            style={{ left: `${(i * 0.5 / layout.widthM) * 100}%` }} />
        ))}
        {Array.from({ length: Math.floor(layout.lengthM / 0.5) + 1 }, (_, i) => (
          <div key={`h${i}`} className="absolute left-0 right-0 border-t border-gray-100"
            style={{ top: `${(i * 0.5 / layout.lengthM) * 100}%` }} />
        ))}

        {layout.stations.map(station => {
          const meta = STATION_META[station.type]
          const occupant = takenByStation.get(station.id)
          const isMine = station.id === myStationId
          const isTaken = !!occupant && !isMine

          return (
            <button
              key={station.id}
              disabled={isTaken}
              onClick={() => onPick(isMine ? null : station.id)}
              className={`group absolute flex flex-col items-center justify-center border-2 rounded-xl transition-all ${
                isMine
                  ? 'border-gray-900 bg-gray-900 text-white scale-105 shadow-md hover:border-red-500 hover:bg-red-500'
                  : isTaken
                  ? 'border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed'
                  : `${meta.color} hover:scale-105 hover:shadow-sm cursor-pointer`
              }`}
              style={{
                left: `${(station.xM / layout.widthM) * 100}%`,
                top: `${(station.yM / layout.lengthM) * 100}%`,
                width: `${(meta.w / layout.widthM) * 100}%`,
                height: `${(meta.h / layout.lengthM) * 100}%`,
              }}
            >
              {isMine ? (
                <>
                  {/* Normal state: checkmark + "You" */}
                  <svg className="w-3 h-3 group-hover:hidden" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-[8px] font-semibold truncate px-0.5 max-w-full leading-tight group-hover:hidden">You</span>
                  {/* Hover state: X + "Cancel" */}
                  <svg className="w-3 h-3 hidden group-hover:block" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  <span className="text-[8px] font-semibold truncate px-0.5 max-w-full leading-tight hidden group-hover:block">Cancel</span>
                </>
              ) : isTaken ? (
                <>
                  <div className="w-4 h-4 rounded-full bg-gray-400 text-white flex items-center justify-center text-[7px] font-bold">
                    {initials(occupant!.memberName)}
                  </div>
                  <span className="text-[8px] text-gray-500 truncate px-0.5 max-w-full leading-tight">Taken</span>
                </>
              ) : (
                <>
                  <span className="text-xs">{meta.icon}</span>
                  <span className="text-[8px] font-medium truncate px-0.5 max-w-full">{station.label}</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-gray-900 bg-gray-900 inline-block" /> Your spot
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-emerald-300 bg-emerald-100 inline-block" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2 border-gray-200 bg-gray-100 opacity-50 inline-block" /> Taken
        </span>
      </div>

      {myStationId && (
        <p className="text-xs text-gray-500">Tap your spot to cancel, or tap another to move.</p>
      )}
    </div>
  )
}
