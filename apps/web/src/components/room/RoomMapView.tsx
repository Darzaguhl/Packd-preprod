'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type RoomLayout, type SessionSpots, type AdminSession } from '@/lib/api'
import RoomMapEditor from './RoomMapEditor'
import SessionRoomMap from './SessionRoomMap'

interface Props {
  roomId: string
  token: string
  session?: AdminSession | null
  /** 'checkin' = session spots only (Room map tab)
   *  'editor'  = layout editor only (Rooms tab)
   *  undefined = both with toggle (legacy) */
  variant?: 'checkin' | 'editor'
}

export default function RoomMapView({ roomId, token, session, variant }: Props) {
  const [layout, setLayout] = useState<RoomLayout | null>(null)
  const [spots, setSpots] = useState<SessionSpots | null>(null)
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const t = await getFreshToken()
      if (session) {
        const s = await api.rooms.spots(roomId, session.id, t)
        setSpots(s)
        setLayout(s.layout)
      } else {
        const l = await api.rooms.layout(roomId, t)
        setLayout(l)
      }
    } catch {
      // leave existing
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session])

  useEffect(() => { load() }, [load])

  async function handleSaveLayout(body: Parameters<typeof api.rooms.saveLayout>[1]) {
    const t = await getFreshToken()
    const saved = await api.rooms.saveLayout(roomId, body, t)
    setLayout(saved)
    showToast('Layout saved')
    setMode('map')
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

  if (loading) {
    return <div className="h-64 bg-gray-50 rounded-2xl animate-pulse border border-gray-100" />
  }

  if (variant === 'editor') {
    return (
      <div className="space-y-4">
        {layout && (
          <span className="text-xs text-gray-400">{layout.widthM}m × {layout.lengthM}m · {layout.stations.length} stations</span>
        )}
        <RoomMapEditor roomId={roomId} initial={layout} onSave={handleSaveLayout} />
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
        <RoomMapEditor roomId={roomId} initial={layout} onSave={handleSaveLayout} />
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
}
