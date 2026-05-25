'use client'

import { useState, useRef, useId, useEffect } from 'react'
import type { RoomLayout, LayoutTemplate, Station, StationType } from '@/lib/api'
import { STATION_META, STATION_TYPES, snapToGrid } from './constants'

interface EditorStation extends Omit<Station, 'id' | 'layoutId'> {
  tempId: string
}

interface Props {
  roomId: string
  initial: RoomLayout | null
  /** All saved layouts for this room (active + inactive) */
  roomLayouts?: RoomLayout[]
  /** Active layouts from other rooms in the studio */
  studioTemplates?: LayoutTemplate[]
  onSave: (layout: { name: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] }, layoutId?: string) => Promise<RoomLayout>
  /** Called when user clicks Activate on a saved layout — makes it live immediately */
  onActivateLayout?: (layoutId: string) => Promise<void>
  /** Called when user clicks Delete on a saved layout */
  onDeleteLayout?: (layoutId: string) => Promise<void>
}

// Ghost that follows the cursor while dragging from the palette
interface PaletteGhost {
  type: StationType
  x: number  // page coords
  y: number
  overCanvas: boolean
}

// Stable key for comparing station lists (ignores tempId)
function stationsKey(ss: EditorStation[]): string {
  return JSON.stringify(ss.map(({ tempId: _, ...s }) => s))
}

interface SavedSnapshot {
  name: string
  widthM: number
  lengthM: number
  stationsKey: string
}

function snapshotFrom(layout: RoomLayout): SavedSnapshot {
  return {
    name: layout.name,
    widthM: layout.widthM,
    lengthM: layout.lengthM,
    stationsKey: JSON.stringify(layout.stations.map(({ id: _, layoutId: __, ...s }) => s)),
  }
}

export default function RoomMapEditor({ roomId: _roomId, initial, roomLayouts = [], studioTemplates = [], onSave, onActivateLayout, onDeleteLayout }: Props) {
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
  const [showTemplates, setShowTemplates] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(initial?.id ?? null)
  const [renamingLayout, setRenamingLayout] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot | null>(
    () => initial ? snapshotFrom(initial) : null
  )
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplates])

  function applyTemplate(tmpl: RoomLayout) {
    setName(tmpl.name)
    setWidthM(tmpl.widthM)
    setLengthM(tmpl.lengthM)
    setStations(tmpl.stations.map(s => ({ ...s, tempId: s.id })))
    setLoadedId(tmpl.id)
    setSavedSnapshot(snapshotFrom(tmpl))
    setShowTemplates(false)
  }

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
      const saved = await onSave(
        { name, widthM, lengthM, stations: stations.map(({ tempId: _, ...s }) => s) },
        loadedId ?? undefined,
      )
      // After creating a new layout, switch into "update" mode for this record
      if (!loadedId) setLoadedId(saved.id)
      // Record the snapshot so the button goes back to "up to date"
      setSavedSnapshot(snapshotFrom(saved))
    } finally {
      setSaving(false)
    }
  }

  // Derive state about the currently loaded layout
  const loadedLayout = roomLayouts.find(l => l.id === loadedId) ?? null
  const isUnsaved = !loadedId  // no saved record yet → new layout
  const otherTemplates = studioTemplates.filter(t => t.roomId !== _roomId)

  // Dirty check — compare current editor state against last saved snapshot
  const hasChanges = isUnsaved || !savedSnapshot || (
    name !== savedSnapshot.name ||
    widthM !== savedSnapshot.widthM ||
    lengthM !== savedSnapshot.lengthM ||
    stationsKey(stations) !== savedSnapshot.stationsKey
  )

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">

        {/* ── Integrated layout selector ── */}
        <div className="relative" ref={dropdownRef}>
          {/* Pill: [dot · name (editable) · chevron] */}
          <div className={`flex items-center border rounded-lg overflow-hidden transition-colors ${showTemplates ? 'border-gray-400' : 'border-gray-200 hover:border-gray-300'}`}>
            {/* Status dot */}
            <div className="pl-2.5 pr-1.5 flex items-center">
              <span
                title={loadedLayout?.isActive ? 'Active layout' : isUnsaved ? 'New (unsaved)' : 'Inactive'}
                className={`w-2 h-2 rounded-full shrink-0 ${
                  loadedLayout?.isActive ? 'bg-green-500' :
                  isUnsaved ? 'bg-gray-300' :
                  'bg-amber-400'
                }`}
              />
            </div>

            {/* Name — click to rename inline */}
            {renamingLayout ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => setRenamingLayout(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    setRenamingLayout(false)
                  }
                }}
                autoFocus
                className="text-sm font-medium text-gray-900 py-1.5 w-36 focus:outline-none bg-transparent"
                placeholder="Layout name"
              />
            ) : (
              <button
                onClick={() => { setRenamingLayout(true); setShowTemplates(false) }}
                title="Click to rename"
                className="text-sm font-medium text-gray-800 py-1.5 text-left w-36 truncate hover:text-gray-900 transition-colors"
              >
                {name || <span className="text-gray-400 italic">Untitled</span>}
              </button>
            )}

            {/* Divider + chevron — opens the dropdown */}
            <button
              onClick={() => { setShowTemplates(v => !v); setRenamingLayout(false) }}
              className="border-l border-gray-200 px-2 py-1.5 hover:bg-gray-50 transition-colors flex items-center"
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showTemplates ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"
              >
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Dropdown */}
          {showTemplates && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[260px] py-1.5 overflow-hidden">

              {/* This room's saved layouts */}
              {roomLayouts.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-1 pb-1.5">This room</p>
                  <div className="max-h-52 overflow-y-auto">
                    {roomLayouts.map(l => {
                      const isLoaded = l.id === loadedId
                      return (
                        <div
                          key={l.id}
                          className={`flex items-center gap-2 px-3 py-2 transition-colors ${isLoaded ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                        >
                          {/* Load into editor (row click) */}
                          <button
                            onClick={() => applyTemplate(l as LayoutTemplate)}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              l.isActive ? 'bg-green-500' :
                              isLoaded ? 'bg-blue-400' :
                              'bg-gray-200'
                            }`} />
                            <div className="min-w-0">
                              <p className={`text-sm font-medium truncate ${isLoaded ? 'text-gray-900' : 'text-gray-600'}`}>{l.name}</p>
                              <p className="text-[11px] text-gray-400 leading-tight">
                                {l.widthM}m × {l.lengthM}m · {l.stations.length} stations
                                {l.isActive && <span className="text-green-600 ml-1">· active</span>}
                              </p>
                            </div>
                          </button>

                          {/* Actions: activate + delete (only for inactive) */}
                          {!l.isActive && (
                            <div className="flex items-center gap-1 shrink-0">
                              {onActivateLayout && (
                                <button
                                  onClick={async e => { e.stopPropagation(); await onActivateLayout(l.id) }}
                                  title="Set as active layout"
                                  className="text-[10px] font-semibold text-green-600 hover:text-green-800 border border-green-200 hover:border-green-400 px-1.5 py-0.5 rounded transition-colors"
                                >Activate</button>
                              )}
                              {onDeleteLayout && (
                                <button
                                  onClick={async e => { e.stopPropagation(); await onDeleteLayout(l.id) }}
                                  title="Delete layout"
                                  className="p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                                    <path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Other rooms */}
              {otherTemplates.length > 0 && (
                <>
                  <div className={`${roomLayouts.length > 0 ? 'border-t border-gray-100 mt-1' : ''}`} />
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-2 pb-1.5">Copy from other room</p>
                  {otherTemplates.map(tmpl => (
                    <button
                      key={tmpl.id}
                      onClick={() => { applyTemplate(tmpl); setLoadedId(null); setSavedSnapshot(null) }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center gap-2.5"
                    >
                      <span className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{tmpl.name}</p>
                        <p className="text-[11px] text-gray-400">{tmpl.roomName} · {tmpl.widthM}m × {tmpl.lengthM}m · {tmpl.stations.length} stations</p>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* New layout */}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => {
                    setName('New layout')
                    setWidthM(10)
                    setLengthM(15)
                    setStations([])
                    setLoadedId(null)
                    setSavedSnapshot(null)
                    setShowTemplates(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center gap-2.5"
                >
                  <span className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0">
                    <svg className="w-2 h-2 text-gray-400" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 16 16">
                      <path d="M8 3v10M3 8h10" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-gray-500">New layout</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Room size */}
        <span className="text-xs text-gray-400">Size</span>
        <input type="number" value={widthM} onChange={e => setWidthM(Number(e.target.value))} min={3} max={30} step={0.5}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-16 text-center focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <span className="text-xs text-gray-400">×</span>
        <input type="number" value={lengthM} onChange={e => setLengthM(Number(e.target.value))} min={3} max={40} step={0.5}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-16 text-center focus:outline-none focus:ring-1 focus:ring-gray-400" />
        <span className="text-xs text-gray-400">m</span>

        <div className="flex-1" />

        {/* Status hint */}
        {!isUnsaved && !loadedLayout?.isActive && (
          <span className="text-xs text-amber-500 font-medium">Not active</span>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`text-xs font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            saving
              ? 'bg-gray-900 text-white opacity-50'
              : hasChanges
              ? 'bg-gray-900 text-white hover:bg-gray-700'
              : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {saving ? 'Saving…' : !hasChanges ? (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 16 16">
                <path d="M3 8l4 4 6-7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved
            </>
          ) : loadedId ? 'Update layout' : 'Save as new'}
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
