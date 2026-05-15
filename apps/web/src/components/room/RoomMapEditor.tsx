'use client'

import { useState, useRef, useId } from 'react'
import type { RoomLayout, Station, StationType } from '@/lib/api'
import { STATION_META, STATION_TYPES, snapToGrid } from './constants'

interface EditorStation extends Omit<Station, 'id' | 'layoutId'> {
  tempId: string
}

interface Props {
  roomId: string
  initial: RoomLayout | null
  onSave: (layout: { name: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] }) => Promise<void>
}

// Ghost that follows the cursor while dragging from the palette
interface PaletteGhost {
  type: StationType
  x: number  // page coords
  y: number
  overCanvas: boolean
}

export default function RoomMapEditor({ roomId: _roomId, initial, onSave }: Props) {
  const uid = useId()
  const [name, setName] = useState(initial?.name ?? 'Default')
  const [widthM, setWidthM] = useState(initial?.widthM ?? 10)
  const [lengthM, setLengthM] = useState(initial?.lengthM ?? 15)
  const [stations, setStations] = useState<EditorStation[]>(() =>
    (initial?.stations ?? []).map(s => ({ ...s, tempId: s.id }))
  )
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [ghost, setGhost] = useState<PaletteGhost | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  // Moving an existing station
  const movingRef = useRef<{
    tempId: string
    startXM: number
    startYM: number
    pointerStartX: number
    pointerStartY: number
  } | null>(null)

  // ─── Palette drag ────────────────────────────────────────────────────────────

  function startPaletteDrag(e: React.PointerEvent, type: StationType) {
    e.preventDefault()

    function isOverCanvas(x: number, y: number) {
      if (!canvasRef.current) return false
      const r = canvasRef.current.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }

    function onMove(ev: PointerEvent) {
      setGhost({ type, x: ev.clientX, y: ev.clientY, overCanvas: isOverCanvas(ev.clientX, ev.clientY) })
    }

    function onUp(ev: PointerEvent) {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      setGhost(null)

      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (!isOverCanvas(ev.clientX, ev.clientY)) return

      const meta = STATION_META[type]
      const xPct = (ev.clientX - rect.left) / rect.width
      const yPct = (ev.clientY - rect.top) / rect.height
      const xM = snapToGrid(Math.max(0, Math.min(widthM - meta.w, xPct * widthM - meta.w / 2)))
      const yM = snapToGrid(Math.max(0, Math.min(lengthM - meta.h, yPct * lengthM - meta.h / 2)))

      setStations(prev => [
        ...prev,
        {
          tempId: `${uid}-${Date.now()}`,
          type,
          label: `${meta.label} ${prev.filter(s => s.type === type).length + 1}`,
          xM,
          yM,
          rotation: 0,
        },
      ])
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    // show ghost immediately at cursor
    setGhost({ type, x: e.clientX, y: e.clientY, overCanvas: false })
  }

  // ─── Move existing station ────────────────────────────────────────────────────

  function startMove(e: React.PointerEvent, tempId: string) {
    e.preventDefault()
    e.stopPropagation()
    const station = stations.find(s => s.tempId === tempId)!
    movingRef.current = {
      tempId,
      startXM: station.xM,
      startYM: station.yM,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onStationPointerMove(e: React.PointerEvent) {
    const d = movingRef.current
    if (!d) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const pxPerM = rect.width / widthM
    const dx = (e.clientX - d.pointerStartX) / pxPerM
    const dy = (e.clientY - d.pointerStartY) / pxPerM
    const meta = STATION_META[stations.find(s => s.tempId === d.tempId)!.type]
    setStations(prev => prev.map(s => {
      if (s.tempId !== d.tempId) return s
      return {
        ...s,
        xM: Math.max(0, Math.min(widthM - meta.w, snapToGrid(d.startXM + dx))),
        yM: Math.max(0, Math.min(lengthM - meta.h, snapToGrid(d.startYM + dy))),
      }
    }))
  }

  function endMove() {
    movingRef.current = null
  }

  // ─── Label editing ────────────────────────────────────────────────────────────

  function startEdit(e: React.MouseEvent, s: EditorStation) {
    e.stopPropagation()
    setEditingId(s.tempId)
    setEditLabel(s.label)
  }

  function commitEdit(tempId: string) {
    setStations(prev => prev.map(s => s.tempId === tempId ? { ...s, label: editLabel } : s))
    setEditingId(null)
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ name, widthM, lengthM, stations: stations.map(({ tempId: _, ...s }) => s) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-36 focus:outline-none focus:ring-1 focus:ring-gray-400"
          placeholder="Layout name"
        />
        <span className="text-xs text-gray-400">Room size</span>
        <input type="number" value={widthM} onChange={e => setWidthM(Number(e.target.value))} min={3} max={30} step={0.5}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-16 text-center focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <span className="text-xs text-gray-400">×</span>
        <input type="number" value={lengthM} onChange={e => setLengthM(Number(e.target.value))} min={3} max={40} step={0.5}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-16 text-center focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <span className="text-xs text-gray-400">metres</span>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save layout'}
        </button>
      </div>

      {/* Palette — drag onto canvas, or click to add at centre */}
      <div className="space-y-1">
        <p className="text-xs text-gray-400">Drag onto the canvas, or click to place at centre</p>
        <div className="flex gap-2 flex-wrap">
          {STATION_TYPES.map(type => {
            const meta = STATION_META[type]
            return (
              <div
                key={type}
                onPointerDown={e => startPaletteDrag(e, type)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing ${meta.color} hover:opacity-80 transition-opacity touch-none`}
              >
                <span>{meta.icon}</span>
                {meta.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`relative bg-gray-50 border-2 rounded-2xl overflow-hidden ${
          ghost?.overCanvas
            ? 'border-gray-900 bg-gray-100'
            : 'border-dashed border-gray-200'
        }`}
        style={{ aspectRatio: `${widthM} / ${lengthM}`, maxHeight: '65vh' }}
        onPointerMove={onStationPointerMove}
        onPointerUp={endMove}
        onPointerCancel={endMove}
      >
        {/* Grid lines */}
        {Array.from({ length: Math.floor(widthM / 0.5) + 1 }, (_, i) => (
          <div key={`v${i}`} className="absolute top-0 bottom-0 border-l border-gray-100"
            style={{ left: `${(i * 0.5 / widthM) * 100}%` }} />
        ))}
        {Array.from({ length: Math.floor(lengthM / 0.5) + 1 }, (_, i) => (
          <div key={`h${i}`} className="absolute left-0 right-0 border-t border-gray-100"
            style={{ top: `${(i * 0.5 / lengthM) * 100}%` }} />
        ))}

        {/* Placed stations */}
        {stations.map(s => {
          const meta = STATION_META[s.type]
          const isEditing = editingId === s.tempId
          return (
            <div
              key={s.tempId}
              onPointerDown={e => startMove(e, s.tempId)}
              onPointerMove={onStationPointerMove}
              onPointerUp={endMove}
              onDoubleClick={e => startEdit(e, s)}
              className={`absolute flex flex-col items-center justify-center border-2 rounded-xl cursor-grab active:cursor-grabbing shadow-sm touch-none group ${meta.color}`}
              style={{
                left: `${(s.xM / widthM) * 100}%`,
                top: `${(s.yM / lengthM) * 100}%`,
                width: `${(meta.w / widthM) * 100}%`,
                height: `${(meta.h / lengthM) * 100}%`,
              }}
            >
              <span className="text-base leading-none pointer-events-none">{meta.icon}</span>
              {isEditing ? (
                <input
                  autoFocus
                  value={editLabel}
                  onChange={e => setEditLabel(e.target.value)}
                  onBlur={() => commitEdit(s.tempId)}
                  onKeyDown={e => e.key === 'Enter' && commitEdit(s.tempId)}
                  className="text-[10px] w-full text-center bg-transparent border-none outline-none font-medium px-1"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="text-[10px] font-medium truncate px-1 max-w-full leading-tight pointer-events-none">{s.label}</span>
              )}
              {/* Delete button */}
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => setStations(prev => prev.filter(x => x.tempId !== s.tempId))}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-bold leading-none hidden group-hover:flex items-center justify-center hover:bg-red-600 z-10"
              >
                ×
              </button>
            </div>
          )
        })}

        {/* Empty state */}
        {stations.length === 0 && !ghost?.overCanvas && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-gray-400">Drag station types here</p>
          </div>
        )}

        {/* Drop target hint while dragging over */}
        {ghost?.overCanvas && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm font-medium text-gray-600 bg-white/80 px-4 py-2 rounded-xl">Release to place</p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">Drag to reposition · Double-click to rename · Hover for delete</p>

      {/* Ghost element that follows the cursor */}
      {ghost && (
        <div
          className={`fixed pointer-events-none z-50 flex flex-col items-center justify-center border-2 rounded-xl shadow-2xl transition-colors ${
            ghost.overCanvas
              ? `${STATION_META[ghost.type].color} scale-110`
              : `${STATION_META[ghost.type].color} opacity-75`
          }`}
          style={{
            left: ghost.x - 44,
            top: ghost.y - 32,
            width: 88,
            height: 64,
          }}
        >
          <span className="text-2xl leading-none">{STATION_META[ghost.type].icon}</span>
          <span className="text-xs font-semibold mt-1">{STATION_META[ghost.type].label}</span>
        </div>
      )}
    </div>
  )
}
