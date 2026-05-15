'use client'

import { useState } from 'react'
import { api, type CalendarSession, type CalendarInstructor } from '@/lib/api'

interface Props {
  session: CalendarSession
  studioId: string
  token: string
  instructors: CalendarInstructor[]
  onSave: (updated: { substituteInstructorId: string | null; substituteInstructorName: string | null }) => void
  onClose: () => void
}

export default function SubstituteModal({ session, studioId, token, instructors, onSave, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string>(session.substituteInstructorId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const otherInstructors = instructors.filter(i => i.id !== session.instructorId)

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const result = await api.schedules.setSubstitute(
        session.id,
        selectedId || null,
        studioId,
        token,
      )
      onSave(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    setError('')
    try {
      const result = await api.schedules.setSubstitute(session.id, null, studioId, token)
      onSave(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to clear')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Set substitute instructor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">{session.templateName}</span>
            {' '}· {new Date(session.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {' '}at {new Date(session.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>

          <div className="text-xs text-gray-400">
            Original instructor: <span className="text-gray-600 font-medium">{session.instructorName}</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Substitute</label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              <option value="">— no substitute —</option>
              {otherInstructors.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
          <div>
            {session.substituteInstructorId && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Clear substitute
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
