'use client'

import { useState } from 'react'
import type { OnboardingData } from './OnboardingFlow'

const SPORTS = ['CYCLING', 'HIIT', 'YOGA', 'PILATES', 'BARRE', 'ROWING', 'STRENGTH', 'OTHER']

export default function StepClasses({
  data,
  onNext,
  onBack,
}: {
  data: OnboardingData
  onNext: (patch: Partial<OnboardingData>) => void
  onBack: () => void
}) {
  const [rooms, setRooms] = useState(data.rooms)

  function addRoom() {
    setRooms((r) => [...r, { name: '', capacity: 20, sport: 'CYCLING' }])
  }

  function removeRoom(i: number) {
    setRooms((r) => r.filter((_, idx) => idx !== i))
  }

  function updateRoom(i: number, patch: Partial<(typeof rooms)[0]>) {
    setRooms((r) => r.map((room, idx) => (idx === i ? { ...room, ...patch } : room)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onNext({ rooms })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Rooms & class types</h2>
        <p className="text-sm text-gray-500 mt-1">Add the rooms in your studio and what happens in them.</p>
      </div>

      <div className="space-y-3">
        {rooms.map((room, i) => (
          <div key={i} className="p-4 border border-gray-100 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Room {i + 1}</span>
              {rooms.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRoom(i)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={room.name}
              onChange={(e) => updateRoom(i, { name: e.target.value })}
              placeholder="The Ride Room"
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Capacity</label>
                <input
                  type="number"
                  value={room.capacity}
                  onChange={(e) => updateRoom(i, { capacity: Number(e.target.value) })}
                  min={1}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sport type</label>
                <select
                  value={room.sport}
                  onChange={(e) => updateRoom(i, { sport: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRoom}
        className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        + Add another room
      </button>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Continue
        </button>
      </div>
    </form>
  )
}
