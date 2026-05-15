'use client'

import { useState, useEffect } from 'react'
import { api, type RoomSummary } from '@/lib/api'
import RoomMapView from '@/components/room/RoomMapView'

interface Props {
  studioId: string
  token: string
}

export default function RoomsTab({ studioId, token }: Props) {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<RoomSummary | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCapacity, setNewCapacity] = useState(20)
  const [adding, setAdding] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    api.studios.rooms(studioId, token)
      .then(setRooms)
      .finally(() => setLoading(false))
  }, [studioId, token])

  async function addRoom() {
    if (!newName.trim()) return
    setAdding(true)
    try {
      const room = await api.studios.createRoom(studioId, { name: newName.trim(), capacity: newCapacity }, token)
      const newRoom: RoomSummary = { ...room, locationId: '', locationName: '', activeLayout: null }
      setRooms(prev => [...prev, newRoom])
      setNewName('')
      setNewCapacity(20)
      setShowAddForm(false)
      showToast('Room created')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create room', false)
    } finally {
      setAdding(false)
    }
  }

  async function deleteRoom(roomId: string) {
    try {
      await api.studios.deleteRoom(studioId, roomId, token)
      setRooms(prev => prev.filter(r => r.id !== roomId))
      if (selectedRoom?.id === roomId) setSelectedRoom(null)
      showToast('Room deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete room', false)
    } finally {
      setDeleteConfirm(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-gray-50 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  // Room layout editor view
  if (selectedRoom) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedRoom(null)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
              <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All rooms
          </button>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-900">{selectedRoom.name}</span>
          <span className="text-xs text-gray-400 ml-1">·  {selectedRoom.capacity} spots</span>
        </div>
        <RoomMapView roomId={selectedRoom.id} token={token} variant="editor" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Rooms are shared spaces that classes are scheduled into. Design a room layout to enable spot assignment.
        </p>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors shrink-0 ml-4"
        >
          + Add room
        </button>
      </div>

      {/* Add room form */}
      {showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">New room</p>
          <div className="flex gap-3 flex-wrap">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRoom()}
              placeholder="Room name (e.g. Ride Room)"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 shrink-0">Capacity</label>
              <input
                type="number"
                value={newCapacity}
                onChange={e => setNewCapacity(Number(e.target.value))}
                min={1}
                max={200}
                className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 text-center focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)} className="text-xs text-gray-500 hover:text-gray-800 px-3 py-2">
              Cancel
            </button>
            <button
              onClick={addRoom}
              disabled={adding || !newName.trim()}
              className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Creating…' : 'Create room'}
            </button>
          </div>
        </div>
      )}

      {/* Room list */}
      {rooms.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">No rooms yet. Add one above.</div>
      ) : (
        <div className="space-y-2">
          {rooms.map(room => (
            <div key={room.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-gray-200 transition-colors">
              {/* Room icon */}
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" />
                  <path d="M3 9h18M9 21V9" strokeLinecap="round" />
                </svg>
              </div>

              {/* Room info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{room.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {room.capacity} spots · {room.locationName}
                  {room.activeLayout
                    ? ` · Layout: ${room.activeLayout.name} (${room.activeLayout._count.stations} stations)`
                    : ' · No layout'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSelectedRoom(room)}
                  className="text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-400 hover:text-gray-900 transition-colors"
                >
                  {room.activeLayout ? 'Edit layout' : 'Design layout'}
                </button>

                {deleteConfirm === room.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Delete?</span>
                    <button onClick={() => deleteRoom(room.id)} className="text-xs text-red-600 font-medium hover:text-red-800 transition-colors">Yes</button>
                    <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(room.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors p-1.5"
                    title="Delete room"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
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
