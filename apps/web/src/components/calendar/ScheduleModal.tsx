'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type CalendarTemplate, type CalendarInstructor, type CalendarRoom, type ClassSchedule, type OrphanedPattern } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import { useTimeFormat } from '@/lib/time-format-context'
import { fmtHHMM } from '@/lib/fmt-time'
import TimeInput from '@/components/ui/TimeInput'

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
  const timeFormat = useTimeFormat()

  const getFreshToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession()
    return data.session?.access_token ?? token
  }, [token])

  const [templateId, setTemplateId] = useState(editSchedule?.templateId ?? prefill?.templateId ?? templates[0]?.id ?? '')
  const [instructorId, setInstructorId] = useState(editSchedule?.instructorId ?? prefill?.instructorId ?? instructors[0]?.id ?? '')
  const [roomId, setRoomId] = useState(editSchedule?.roomId ?? prefill?.roomId ?? rooms[0]?.id ?? '')
  const [capacity, setCapacity] = useState(editSchedule?.capacity ?? rooms[0]?.capacity ?? 20)
  const [creditsRequired, setCreditsRequired] = useState(editSchedule?.creditsRequired ?? 1)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(editSchedule?.daysOfWeek ?? prefill?.daysOfWeek ?? [])
  const [startTime, setStartTime] = useState(editSchedule?.startTime ?? prefill?.startTime ?? '07:00')
  const [startTime2, setStartTime2] = useState('')   // optional second daily slot
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
  // Local copy of templates so we can append newly created ones without a page reload
  const [localTemplates, setLocalTemplates] = useState(templates)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplSport, setNewTplSport] = useState('CYCLING')
  const [newTplDuration, setNewTplDuration] = useState(durationMin)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [newTplError, setNewTplError] = useState('')

  const [saving, setSaving] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set())

  // Auto-fill capacity from selected room (only when no template default already set it)
  useEffect(() => {
    if (!editSchedule) {
      const r = rooms.find(r => r.id === roomId)
      if (r) setCapacity(r.capacity)
    }
  }, [roomId, rooms, editSchedule])

  // Auto-fill all schedule fields from template defaults when template changes
  useEffect(() => {
    if (!editSchedule && templateId) {
      const t = localTemplates.find(t => t.id === templateId)
      if (!t) return
      setDurationMin(t.durationMin)
      if (t.defaultInstructorId) setInstructorId(t.defaultInstructorId)
      if (t.defaultRoomId) setRoomId(t.defaultRoomId)
      if (t.defaultCapacity != null) setCapacity(t.defaultCapacity)
      if (t.defaultCreditsRequired != null) setCreditsRequired(t.defaultCreditsRequired)
      if (t.defaultStartTime) setStartTime(t.defaultStartTime)
      if (t.defaultStartTime2) setStartTime2(t.defaultStartTime2)
      if (t.defaultDaysOfWeek?.length) setDaysOfWeek(t.defaultDaysOfWeek)
      if (t.defaultIntervalWeeks) setIntervalWeeks(t.defaultIntervalWeeks)
    }
  }, [templateId, templates, editSchedule])

  async function handleCreateTemplate() {
    if (!newTplName.trim()) { setNewTplError('Name is required'); return }
    setCreatingTemplate(true); setNewTplError('')
    try {
      const t = await getFreshToken()
      const created = await api.templates.create({
        studioId,
        name: newTplName.trim(),
        sport: newTplSport,
        durationMin: newTplDuration,
        color: '#6366f1',
      }, t)
      // Add to local list and auto-select it
      const asCal = { id: created.id, name: created.name, sport: created.sport, durationMin: created.durationMin }
      setLocalTemplates(prev => [...prev, asCal])
      setTemplateId(created.id)
      setDurationMin(created.durationMin)
      setShowNewTemplate(false)
      setNewTplName(''); setNewTplSport('CYCLING'); setNewTplDuration(60)
    } catch (e) {
      setNewTplError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setCreatingTemplate(false)
    }
  }

  async function handleSaveAsTemplate() {
    if (!templateId) return
    setSavingTemplate(true)
    try {
      const t = await getFreshToken()
      await api.templates.update(templateId, {
        durationMin,
        defaultInstructorId: instructorId || null,
        defaultRoomId: roomId || null,
        defaultCapacity: capacity,
        defaultCreditsRequired: creditsRequired,
        defaultStartTime: startTime || null,
        defaultStartTime2: startTime2 || null,
        defaultDaysOfWeek: daysOfWeek,
        defaultIntervalWeeks: intervalWeeks,
      }, t)
      setTemplateSaved(true)
      setTimeout(() => setTemplateSaved(false), 2500)
    } catch {
      // silent — non-critical
    } finally {
      setSavingTemplate(false)
    }
  }

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function handleSave() {
    const missing = new Set<string>()
    if (!templateId) missing.add('template')
    if (!instructorId) missing.add('instructor')
    if (!roomId) missing.add('room')
    if (!daysOfWeek.length) missing.add('days')
    if (missing.size > 0) {
      setFieldErrors(missing)
      setError('Please fill in all highlighted fields')
      return
    }
    setFieldErrors(new Set())
    setSaving(true)
    setError('')
    try {
      const t = await getFreshToken()
      if (editSchedule) {
        await api.schedules.update(
          editSchedule.id,
          {
            studioId, templateId, instructorId, roomId, capacity, creditsRequired,
            daysOfWeek, startTime, durationMin, intervalWeeks,
            validUntil: validUntil || null,
          },
          t,
        )
      } else {
        const base = {
          studioId, templateId, instructorId, roomId, capacity, creditsRequired,
          daysOfWeek, durationMin, intervalWeeks, validFrom,
          validUntil: validUntil || undefined,
          generateWeeks,
        }
        await api.schedules.create({ ...base, startTime }, t)
        if (startTime2 && startTime2 !== startTime) {
          await api.schedules.create({ ...base, startTime: startTime2 }, t)
        }
      }
      onSave()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const selectedTemplate = localTemplates.find(t => t.id === templateId)
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
            <div className="flex items-center justify-between">
              <label className={`text-xs font-medium ${fieldErrors.has('template') ? 'text-red-500' : 'text-gray-500'}`}>
                Class template {fieldErrors.has('template') && <span className="font-semibold">— required</span>}
              </label>
              {!showNewTemplate && (
                <button
                  type="button"
                  onClick={() => { setShowNewTemplate(true); setNewTplError('') }}
                  className="text-[10px] font-medium text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded-md px-2 py-0.5 transition-colors"
                >
                  + New template
                </button>
              )}
            </div>

            {showNewTemplate ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Template name *"
                      value={newTplName}
                      onChange={e => setNewTplName(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                  </div>
                  <select
                    value={newTplSport}
                    onChange={e => setNewTplSport(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {['CYCLING','HIIT','YOGA','PILATES','BARRE','ROWING','STRENGTH','OTHER'].map(s => (
                      <option key={s} value={s}>{SPORT_CONFIG[s]?.label ?? s}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={5} max={240} step={5}
                    placeholder="Duration (min)"
                    value={newTplDuration}
                    onChange={e => setNewTplDuration(Number(e.target.value))}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                </div>
                {newTplError && <p className="text-xs text-red-500">{newTplError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setShowNewTemplate(false); setNewTplName(''); setNewTplError('') }}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateTemplate}
                    disabled={creatingTemplate}
                    className="text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    {creatingTemplate ? 'Creating…' : 'Create & select'}
                  </button>
                </div>
              </div>
            ) : localTemplates.length === 0 ? (
              <div className="w-full text-sm border border-amber-200 bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
                No templates yet — use "+ New template" above to create one.
              </div>
            ) : (
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setFieldErrors(prev => { const n = new Set(prev); n.delete('template'); return n }) }}
                className={`w-full text-sm border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 ${fieldErrors.has('template') ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 focus:ring-gray-400'}`}
              >
                {localTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Instructor */}
          <div className="space-y-1">
            <label className={`text-xs font-medium ${fieldErrors.has('instructor') ? 'text-red-500' : 'text-gray-500'}`}>
              Instructor {fieldErrors.has('instructor') && <span className="font-semibold">— required</span>}
            </label>
            {instructors.length === 0 ? (
              <div className="w-full text-sm border border-red-300 bg-red-50 text-red-600 rounded-lg px-3 py-2">
                No instructors for this studio — add one in the Staff tab first.
              </div>
            ) : (
              <select
                value={instructorId}
                onChange={e => { setInstructorId(e.target.value); setFieldErrors(prev => { const n = new Set(prev); n.delete('instructor'); return n }) }}
                className={`w-full text-sm border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 ${fieldErrors.has('instructor') ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 focus:ring-gray-400'}`}
              >
                {instructors.map(i => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Room */}
          <div className="space-y-1">
            <label className={`text-xs font-medium ${fieldErrors.has('room') ? 'text-red-500' : 'text-gray-500'}`}>
              Room {fieldErrors.has('room') && <span className="font-semibold">— required</span>}
            </label>
            {rooms.length === 0 ? (
              <div className="w-full text-sm border border-red-300 bg-red-50 text-red-600 rounded-lg px-3 py-2">
                No rooms for this studio — add one in the Rooms tab first.
              </div>
            ) : (
              <select
                value={roomId}
                onChange={e => { setRoomId(e.target.value); setFieldErrors(prev => { const n = new Set(prev); n.delete('room'); return n }) }}
                className={`w-full text-sm border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 ${fieldErrors.has('room') ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 focus:ring-gray-400'}`}
              >
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>{r.name} · {r.locationName}</option>
                ))}
              </select>
            )}
          </div>

          {/* Days of week */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium ${fieldErrors.has('days') ? 'text-red-500' : 'text-gray-500'}`}>
              Repeats on {fieldErrors.has('days') && <span className="font-semibold">— select at least one day</span>}
            </label>
            <div className={`flex gap-1.5 p-1 rounded-lg ${fieldErrors.has('days') ? 'ring-1 ring-red-400 bg-red-50' : ''}`}>
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { toggleDay(i); setFieldErrors(prev => { const n = new Set(prev); n.delete('days'); return n }) }}
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
              <TimeInput
                value={startTime}
                onChange={setStartTime}
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

          {/* Optional second daily slot — only for new schedules */}
          {!editSchedule && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500">Second session (optional)</label>
                {startTime2 ? (
                  <button
                    type="button"
                    onClick={() => setStartTime2('')}
                    className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Default second slot 2 hours after first
                      const [h, m] = startTime.split(':').map(Number)
                      const total = h * 60 + m + 120
                      const hh = String(Math.min(Math.floor(total / 60), 23)).padStart(2, '0')
                      const mm = String(total % 60).padStart(2, '0')
                      setStartTime2(`${hh}:${mm}`)
                    }}
                    className="text-[10px] font-medium text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded-md px-2 py-0.5 transition-colors"
                  >
                    + Add second session
                  </button>
                )}
              </div>
              {startTime2 && (
                <TimeInput
                  value={startTime2}
                  onChange={setStartTime2}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              )}
              {startTime2 && (
                <p className="text-[10px] text-gray-400">Creates two separate recurring schedules — one at each time</p>
              )}
            </div>
          )}

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
              {daysOfWeek.map(d => DAY_LABELS[d]).join(', ')} at {fmtHHMM(startTime, timeFormat)}{startTime2 ? ` & ${fmtHHMM(startTime2, timeFormat)}` : ''} · {durationMin}m · {capacity} spots
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          {/* Save as template — only when a template is selected */}
          {templateId ? (
            <button
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate || saving}
              className="text-xs font-medium text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {templateSaved ? (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Saved to template
                </>
              ) : savingTemplate ? '…' : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Save as template defaults
                </>
              )}
            </button>
          ) : <span />}

          <div className="flex gap-3">
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
    </div>
  )
}
