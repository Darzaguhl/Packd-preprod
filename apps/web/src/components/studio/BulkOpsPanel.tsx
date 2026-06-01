'use client'

import React, { useState } from 'react'
import { api } from '@/lib/api-client'

interface Instructor { id: string; name: string }
interface Template { id: string; name: string }

interface Props {
  studioId: string
  token: string
  open: boolean
  onClose: () => void
  instructors: Instructor[]
  templates: Template[]
}

interface Preview {
  total: number
  sessionIds: string[]
  byTemplate: { name: string; count: number }[]
  sessions: { id: string; startsAt: string; templateName: string; instructorName: string; confirmedBookings: number }[]
}

function toMonday(d: Date) {
  const copy = new Date(d)
  const dow = copy.getDay() || 7
  copy.setDate(copy.getDate() - (dow - 1))
  copy.setHours(0, 0, 0, 0)
  return copy
}

function toSunday(monday: Date) {
  const copy = new Date(monday)
  copy.setDate(copy.getDate() + 7)
  return copy
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function BulkOpsPanel({ studioId, token, open, onClose, instructors, templates }: Props) {
  const now = new Date()
  const monday = toMonday(now)
  const sunday = toSunday(monday)

  const [from, setFrom] = useState(isoDate(monday))
  const [to, setTo] = useState(isoDate(sunday))
  const [instructorId, setInstructorId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [action, setAction] = useState<'CANCEL' | 'SUBSTITUTE'>('CANCEL')
  const [substituteId, setSubstituteId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function reset() {
    setPreview(null)
    setConfirmed(false)
  }

  async function handlePreview() {
    setPreviewing(true)
    reset()
    try {
      const fromIso = new Date(from).toISOString()
      const toIso   = new Date(to).toISOString()
      const result = await api.admin.bulkPreview({
        studioId,
        from: fromIso,
        to: toIso,
        ...(instructorId ? { instructorId } : {}),
        ...(templateId   ? { templateId   } : {}),
      }, token)
      setPreview(result)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setPreviewing(false)
    }
  }

  async function handleExecute() {
    if (!confirmed) { setConfirmed(true); return }
    setRunning(true)
    try {
      const fromIso = new Date(from).toISOString()
      const toIso   = new Date(to).toISOString()
      const result = await api.admin.bulkExecute({
        studioId,
        from: fromIso,
        to: toIso,
        ...(instructorId ? { instructorId } : {}),
        ...(templateId   ? { templateId   } : {}),
        action,
        ...(action === 'SUBSTITUTE' && substituteId ? { substituteInstructorId: substituteId } : {}),
      }, token)
      showToast(`Done — ${result.affected} session${result.affected !== 1 ? 's' : ''} updated`)
      setPreview(null)
      setConfirmed(false)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  if (!open) return null

  return (
    <div className="border-b border-gray-100 bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-3 pb-4 space-y-4">
          {/* Controls */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={e => { setFrom(e.target.value); reset() }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To (exclusive)</label>
              <input
                type="date"
                value={to}
                onChange={e => { setTo(e.target.value); reset() }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Instructor</label>
              <select
                value={instructorId}
                onChange={e => { setInstructorId(e.target.value); reset() }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                <option value="">All</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); reset() }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                <option value="">All</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
              <select
                value={action}
                onChange={e => { setAction(e.target.value as 'CANCEL' | 'SUBSTITUTE'); reset() }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                <option value="CANCEL">Cancel sessions</option>
                <option value="SUBSTITUTE">Change instructor</option>
              </select>
            </div>
            {action === 'SUBSTITUTE' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Substitute</label>
                <select
                  value={substituteId}
                  onChange={e => setSubstituteId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                >
                  <option value="">— select —</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Preview button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {previewing ? 'Loading…' : 'Preview'}
            </button>
          </div>

          {/* Preview result */}
          {preview && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              {preview.total === 0 ? (
                <p className="text-sm text-gray-600">No matching sessions found for this range.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-900">
                    {preview.total} session{preview.total !== 1 ? 's' : ''} matched
                    {' — '}
                    {preview.byTemplate.map(t => `${t.name} ×${t.count}`).join(', ')}
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {preview.sessions.slice(0, 20).map(s => (
                      <div key={s.id} className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="text-gray-400 tabular-nums">{new Date(s.startsAt).toLocaleDateString()} {new Date(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{s.templateName}</span>
                        <span className="text-gray-400">·</span>
                        <span>{s.instructorName}</span>
                        {s.confirmedBookings > 0 && (
                          <span className="text-amber-600 font-medium">{s.confirmedBookings} booking{s.confirmedBookings !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    ))}
                    {preview.sessions.length > 20 && (
                      <p className="text-xs text-gray-400">…and {preview.sessions.length - 20} more</p>
                    )}
                  </div>

                  {/* Execute */}
                  {confirmed ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-red-600">
                        {action === 'CANCEL'
                          ? 'This will cancel all matched sessions and refund member credits. Confirm?'
                          : 'This will set a substitute instructor on all matched sessions. Confirm?'}
                      </span>
                      <button
                        onClick={handleExecute}
                        disabled={running || (action === 'SUBSTITUTE' && !substituteId)}
                        className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
                          action === 'CANCEL'
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-gray-900 text-white hover:bg-gray-700'
                        }`}
                      >
                        {running ? 'Running…' : 'Yes, execute'}
                      </button>
                      <button onClick={() => setConfirmed(false)} className="text-sm text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleExecute}
                      disabled={action === 'SUBSTITUTE' && !substituteId}
                      className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
                        action === 'CANCEL'
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-gray-900 text-white hover:bg-gray-700'
                      }`}
                    >
                      {action === 'CANCEL' ? 'Cancel sessions…' : 'Set substitute…'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
    </div>
  )
}

