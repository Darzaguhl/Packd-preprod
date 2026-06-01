'use client'

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, bookings as bookingsClient } from '@/lib/api-client'
import type { RoomLayout, LayoutTemplate, SessionSpots, AdminSession, SpotAssignment } from '@/lib/api-client'
import RoomMapEditor from './RoomMapEditor'
import SessionRoomMap from './SessionRoomMap'

/** Imperative handle so parents can call refresh() directly without relying on the refreshKey chain. */
export interface RoomMapViewHandle {
  /** Re-fetch spots from the server (used after booking/assignment changes). */
  refresh: () => void
  /** Instantly flip a member's check-in state without a server round-trip. */
  patchCheckin: (bookingId: string, checkedIn: boolean) => void
}

interface Props {
  roomId: string
  studioId?: string
  token: string
  session?: AdminSession | null
  /** 'checkin' = session spots only (Room map tab)
   *  'editor'  = layout editor only (Rooms tab)
   *  undefined = both with toggle (legacy) */
  variant?: 'checkin' | 'editor'
  /** Called whenever the active layout changes so parent can update room card */
  onLayoutChange?: (layout: RoomLayout) => void
  /** Called when a member's name is clicked in the check-in map */
  onMemberClick?: (assignment: SpotAssignment) => void
  /** Called when an empty station is clicked */
  onEmptyStationClick?: (station: { id: string; label: string }) => void
  /** Increment to force a full reload of spots */
  refreshKey?: number
  /** Member IDs who have ordered products this session */
  orderedMemberIds?: Set<string>
  /** If true, show a × button on unassigned members to cancel their booking */
  allowRemoveBooking?: boolean
}

const RoomMapView = forwardRef<RoomMapViewHandle, Props>(function RoomMapView({ roomId, studioId, token, session, variant, onLayoutChange, onMemberClick, onEmptyStationClick, refreshKey, orderedMemberIds, allowRemoveBooking }: Props, ref) {
  const [layout, setLayout] = useState<RoomLayout | null>(null)
  const [spots, setSpots] = useState<SessionSpots | null>(null)
  const [roomLayouts, setRoomLayouts] = useState<RoomLayout[]>([])
  const [studioTemplates, setStudioTemplates] = useState<LayoutTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'map' | 'edit'>(variant === 'editor' ? 'edit' : 'map')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // Always fetch the current session token — Supabase auto-refreshes it, so
  // this never returns a stale token even after the initial 1-hour expiry.
  async function getFreshToken(): Promise<string> {
    const { data } = await createClient().auth.getSession()
    return data.session?.access_token ?? token // fall back to prop if somehow missing
  }

  // Hard-reset (show spinner + clear state) only when session or room changes,
  // NOT when refreshKey increments — so background spot refreshes are seamless.
  useEffect(() => {
    setSpots(null)
    setLoading(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session?.id])

  // Spots-only refresh — faster than full load (no layout/template fetches).
  // Used by the imperative handle so the front-desk drawer gets snappy map updates.
  const loadSpotsRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const loadSpotsCallback = useCallback(async () => {
    if (!session) return
    try {
      const t = await getFreshToken()
      const s = await api.rooms.spots(roomId, session.id, t)
      setSpots(s)
      if (s.layout) setLayout(s.layout)
    } catch {
      // leave existing state
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session?.id])
  loadSpotsRef.current = loadSpotsCallback

  // Always-fresh ref to full load — fallback used by refreshKey chain.
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined)

  useImperativeHandle(ref, () => ({
    refresh: () => { loadSpotsRef.current?.() },
    patchCheckin: (bookingId: string, checkedIn: boolean) => {
      setSpots(prev => {
        if (!prev) return prev
        return {
          ...prev,
          assignments: prev.assignments.map(a =>
            a.bookingId === bookingId ? { ...a, checkedIn } : a
          ),
        }
      })
    },
  }), [])

  const load = useCallback(async () => {
    try {
      const t = await getFreshToken()
      await Promise.all([
        session
          ? api.rooms.spots(roomId, session.id, t).then(s => { setSpots(s); setLayout(s.layout) })
          : api.rooms.layout(roomId, t).then(l => setLayout(l)),
        api.rooms.layouts(roomId, t).then(ls => setRoomLayouts(ls)).catch(() => {}),
        studioId ? api.studios.layouts(studioId, t).then(ls => setStudioTemplates(ls)).catch(() => {}) : Promise.resolve(),
      ])
    } catch {
      // leave existing state
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, studioId, session?.id, refreshKey])

  // Keep the ref in sync so the imperative handle always calls the freshest load
  loadRef.current = load

  useEffect(() => { load() }, [load])

  async function handleSaveLayout(body: Parameters<typeof api.rooms.saveLayout>[1], layoutId?: string): Promise<RoomLayout> {
    const t = await getFreshToken()
    const saved = layoutId
      ? await api.rooms.updateLayout(roomId, layoutId, body, t)
      : await api.rooms.saveLayout(roomId, body, t)
    setLayout(saved)
    onLayoutChange?.(saved)
    api.rooms.layouts(roomId, t).then(ls => setRoomLayouts(ls)).catch(() => {})
    showToast('Layout saved')
    return saved
  }

  async function handleActivateLayout(layoutId: string) {
    try {
      const t = await getFreshToken()
      const activated = await api.rooms.activateLayout(roomId, layoutId, t)
      setLayout(activated)
      onLayoutChange?.(activated)
      setRoomLayouts(prev => prev.map(l => ({ ...l, isActive: l.id === layoutId })))
      showToast('Layout activated')
    } catch {
      showToast('Failed to activate layout', false)
    }
  }

  async function handleDeleteLayout(layoutId: string) {
    try {
      const t = await getFreshToken()
      await api.rooms.deleteLayout(roomId, layoutId, t)
      setRoomLayouts(prev => prev.filter(l => l.id !== layoutId))
      showToast('Layout deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete layout', false)
    }
  }

  async function handleCheckin(bookingId: string) {
    if (!session) return
    try {
      const t = await getFreshToken()
      const res = await api.admin.checkin(session.id, bookingId, t)
      setSpots(prev => {
        if (!prev) return prev
        return {
          ...prev,
          assignments: prev.assignments.map(a =>
            a.bookingId === bookingId ? { ...a, checkedIn: res.checkedIn } : a
          ),
        }
      })
    } catch {
      showToast('Check-in failed', false)
    }
  }

  async function handleAssign(bookingId: string, stationId: string | null) {
    if (!session) return

    // Optimistic update — move the card instantly so there's no bounce-back
    const previous = spots
    setSpots(prev => {
      if (!prev) return prev
      return {
        ...prev,
        assignments: prev.assignments.map(a =>
          a.bookingId === bookingId ? { ...a, stationId } :
          stationId && a.stationId === stationId ? { ...a, stationId: null } : a
        ),
      }
    })

    try {
      const t = await getFreshToken()
      await api.rooms.assignSpot(roomId, session.id, bookingId, stationId, t)
    } catch {
      // Roll back to previous state and let the user know
      setSpots(previous)
      showToast('Failed to assign spot', false)
    }
  }

  async function handleRemoveBooking(bookingId: string) {
    const previous = spots
    setSpots(prev => prev ? { ...prev, assignments: prev.assignments.filter(a => a.bookingId !== bookingId) } : prev)
    try {
      const t = await getFreshToken()
      await bookingsClient.cancel(bookingId, t)
    } catch {
      setSpots(previous)
      showToast('Failed to remove booking', false)
    }
  }

  if (loading) {
    return <div className="h-64 bg-gray-50 rounded-2xl animate-pulse border border-gray-100" />
  }

  if (variant === 'editor') {
    return (
      <div className="space-y-4">
        {layout && (
          <span className="text-xs text-gray-400">{layout.widthM}m × {layout.lengthM}m · {layout.stations.length} stations</span>
        )}
        <RoomMapEditor
          roomId={roomId}
          initial={layout}
          roomLayouts={roomLayouts}
          studioTemplates={studioTemplates}
          onSave={handleSaveLayout}
          onActivateLayout={handleActivateLayout}
          onDeleteLayout={handleDeleteLayout}
        />
        {toast && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
            toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.msg}
          </div>
        )}
      </div>
    )
  }

  if (variant === 'checkin') {
    return (
      <div className="space-y-4">
        {session && spots ? (
          spots.layout ? (
            <SessionRoomMap
              layout={spots.layout}
              assignments={spots.assignments}
              onAssign={handleAssign}
              onCheckin={handleCheckin}
              onMemberClick={onMemberClick}
              onEmptyStationClick={onEmptyStationClick}
              onRemoveBooking={allowRemoveBooking ? handleRemoveBooking : undefined}
              orderedMemberIds={orderedMemberIds}
            />
          ) : (
            <div className="py-12 text-center text-sm text-gray-400">
              No layout configured for this room.
            </div>
          )
        ) : (
          <div className="py-12 text-center text-sm text-gray-400">
            Select a session to view spot assignments.
          </div>
        )}
        {toast && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
            toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.msg}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => setMode('map')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${mode === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {session ? 'Session map' : 'Room map'}
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${mode === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Edit layout
          </button>
        </div>
        {layout && mode === 'map' && (
          <span className="text-xs text-gray-400">{layout.widthM}m × {layout.lengthM}m · {layout.stations.length} stations</span>
        )}
      </div>

      {mode === 'edit' ? (
        <RoomMapEditor
          roomId={roomId}
          initial={layout}
          roomLayouts={roomLayouts}
          studioTemplates={studioTemplates}
          onSave={handleSaveLayout}
          onActivateLayout={handleActivateLayout}
          onDeleteLayout={handleDeleteLayout}
        />
      ) : session && spots ? (
        spots.layout ? (
          <SessionRoomMap
            layout={spots.layout}
            assignments={spots.assignments}
            onAssign={handleAssign}
            onCheckin={handleCheckin}
          />
        ) : (
          <div className="py-12 text-center text-sm text-gray-400">
            No layout configured for this room.{' '}
            <button className="underline text-gray-600 hover:text-gray-900" onClick={() => setMode('edit')}>
              Create one
            </button>
          </div>
        )
      ) : layout ? (
        <div className="py-12 text-center text-sm text-gray-400">
          Select a session from the Today tab to view spot assignments.
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">
          No layout yet.{' '}
          <button className="underline text-gray-600 hover:text-gray-900" onClick={() => setMode('edit')}>
            Create one
          </button>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
})

export default RoomMapView
