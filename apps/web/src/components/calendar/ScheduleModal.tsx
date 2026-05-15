'use client'

import { useState, useEffect } from 'react'
import { api, type CalendarTemplate, type CalendarInstructor, type CalendarRoom, type ClassSchedule, type OrphanedPattern } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localIsoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface Props {
  studioId: string
  token: string
  templates: CalendarTemplate[]
  instructors: CalendarInstructor[]
  rooms: CalendarRoom[]
  editSchedule?: ClassSchedule | null
  prefill?: Partial<OrphanedPattern>
  defaultDate?: string // ISO date for validFrom prefill
  onSave: () => void
  onClose: () => void
}

export default function ScheduleModal({
  studioId, token, templates, instructors, rooms,
  editSchedule, prefill, defaultDate, onSave, onClose,
}: Props) {
  const [templateId, setTemplateId] = useState(editSchedule?.templateId ?? prefill?.templateId ?? templates[0]?.id ?? '')
  const [instructorId, setInstructorId] = useState(editSchedule?.instructorId ?? prefill?.instructorId ?? instructors[0]?.id ?? '')
  const [roomId, setRoomId] = useState(editSchedule?.roomId ?? prefill?.roomId ?? rooms[0]?.id ?? '')
  const [capacity, setCapacity] = useState(editSchedule?.capacity ?? rooms[0]?.capacity ?? 20)
  const [creditsRequired, setCreditsRequired] = useState(editSchedule?.creditsRequired ?? 1)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(editSchedule?.daysOfWeek ?? prefill?.daysOfWeek ?? [])
  const [startTime, setStartTime] = useState(editSchedule?.startTime ?? prefill?.startTime ?? '07:00')
  const [durationMin, setDurationMin] = useState(editSchedule?.durationMin ?? prefill?.durationMin ?? 60)
  const [validFrom, setValidFrom] = useState(
    editSchedule?.validFrom
      ? editSchedule.validFrom.slice(0, 10)
      : (defaultDate ?? localIsoDate(new Date()))
  )
  const [validUntil, setValidUntil] = useState(
    editSchedule?.validUntil ? editSchedule.validUntil.slice(0, 10) : ''
  )
  const [intervalWeeks, setIntervalWeeks] = useState(editSchedule?.intervalWeeks ?? 1)
  const [generateWeeks, setGenerateWeeks] = useState(8)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Auto-fill capacity from selected room
  useEffect(() => {
    if (!editSchedule) {
      const r = rooms.find(r => r.id === roomId)
      if (r) setCapacity(r.capacity)
    }
  }, [roomId, rooms, editSchedule])

  // Auto-fill duration from selected template
  useEffect(() => {
    if (!editSchedule) {
      const t = templates.find(t => t.id === templateId)
      if (t) setDurationMin(t.durationMin)
    }
  }, [templateId, templates, editSchedule])

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function handleSave() {
    if (!daysOfWeek.length) { setError('Select at least one day'); return }
    if (!templateId || !instructorId || !roomId) { setError('Fill in all required fields'); return }
    setSaving(true)
    setError('')
    try {
      if (editSchedule) {
        await api.schedules.update(
          editSchedule.id,
          {
            studioId, templateId, instructorId, roomId, capacity, creditsRequired,
            daysOfWeek, startTime, durationMin, intervalWeeks,
            validUntil: validUntil || null,
          },
          token,
        )
      } else {
        await api.schedules.create(
          {
            studioId, templateId, instructorId, roomId, capacity, creditsRequired,
            daysOfWeek, startTime, durationMin, intervalWeeks, validFrom,
            validUntil: validUntil || undefined,
            generateWeeks,
          },
          token,
        )
      }
      onSave()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const selectedTemplate = templates.find(t => t.id === templateId)
  const sportCfg = selectedTemplate ? (SPORT_CONFIG[selectedTemplate.sport] ?? SPORT_CONFIG.OTHER) : null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {editSchedule ? 'Edit recurring schedule' : 'New recurring schedule'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Class template */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Class template</label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Instructor */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Instructor</label>
            <select
              value={instructorId}
              onChange={e => setInstructorId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {instructors.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>

          {/* Room */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Room</label>
            <select
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name} · {r.locationName}</option>
              ))}
            </select>
          </div>

          {/* Days of week */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Repeats on</label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`w-9 h-9 rounded-full text-xs font-medium transition-colors ${
                    daysOfWeek.includes(i)
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {label[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Recurrence interval */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Repeat frequency</label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: 'Every week', value: 1 },
                { label: 'Every 2 weeks', value: 2 },
                { label: 'Every 3 weeks', value: 3 },
                { label: 'Every 4 weeks', value: 4 },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIntervalWeeks(opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    intervalWeeks === opt.value
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time + duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Duration (min)</label>
              <input
                type="number"
                min={15}
                max={240}
                step={5}
                value={durationMin}
                onChange={e => setDurationMin(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {/* Capacity + credits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Capacity</label>
              <input
                type="number"
                min={1}
                max={500}
                value={capacity}
                onChange={e => setCapacity(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Credits required</label>
              <input
                type="number"
                min={0}
                max={20}
                value={creditsRequired}
                onChange={e => setCreditsRequired(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {/* Valid from / until */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">
                {editSchedule ? 'Valid from' : 'Start date'}
              </label>
              <input
                type="date"
                value={validFrom}
                onChange={e => setValidFrom(e.target.value)}
                disabled={!!editSchedule}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">End date (optional)</label>
              <input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {!editSchedule && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Generate sessions for (weeks)</label>
              <input
                type="number"
                min={1}
                max={52}
                value={generateWeeks}
                onChange={e => setGenerateWeeks(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <p className="text-[10px] text-gray-400">Sessions will be auto-created this many weeks ahead</p>
            </div>
          )}

          {/* Summary preview */}
          {sportCfg && daysOfWeek.length > 0 && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${sportCfg.accent} border-current/20 text-current/80`}>
              {daysOfWeek.map(d => DAY_LABELS[d]).join(', ')} at {startTime} · {durationMin}m · {capacity} spots
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : editSchedule ? 'Update schedule' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
