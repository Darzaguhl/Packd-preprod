'use client'

import { useState, useEffect } from 'react'
import { api, type ClassTemplate } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import TimeInput from '@/components/ui/TimeInput'

type SimpleInstructor = { id: string; name: string }
type SimpleRoom = { id: string; name: string }

const SPORT_OPTIONS = [
  'CYCLING', 'HIIT', 'YOGA', 'PILATES', 'BARRE', 'ROWING', 'STRENGTH', 'OTHER',
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type FormState = {
  name: string
  sport: string
  durationMin: number
  description: string
  color: string
  defaultInstructorId: string
  defaultRoomId: string
  defaultCapacity: string
  defaultCreditsRequired: string
  defaultStartTime: string
  defaultStartTime2: string
  defaultDaysOfWeek: number[]
  defaultIntervalWeeks: number
}

const EMPTY_FORM: FormState = {
  name: '', sport: 'CYCLING', durationMin: 60, description: '', color: '#6366f1',
  defaultInstructorId: '', defaultRoomId: '', defaultCapacity: '', defaultCreditsRequired: '',
  defaultStartTime: '', defaultStartTime2: '', defaultDaysOfWeek: [], defaultIntervalWeeks: 1,
}

function templateToForm(t: ClassTemplate): FormState {
  return {
    name: t.name,
    sport: t.sport,
    durationMin: t.durationMin,
    description: t.description ?? '',
    color: t.color,
    defaultInstructorId: t.defaultInstructorId ?? '',
    defaultRoomId: t.defaultRoomId ?? '',
    defaultCapacity: t.defaultCapacity != null ? String(t.defaultCapacity) : '',
    defaultCreditsRequired: t.defaultCreditsRequired != null ? String(t.defaultCreditsRequired) : '',
    defaultStartTime: t.defaultStartTime ?? '',
    defaultStartTime2: t.defaultStartTime2 ?? '',
    defaultDaysOfWeek: t.defaultDaysOfWeek ?? [],
    defaultIntervalWeeks: t.defaultIntervalWeeks ?? 1,
  }
}

interface Props {
  studioId: string
  token: string
}

export default function ClassTemplatesSection({ studioId, token }: Props) {
  const [instructors, setInstructors] = useState<SimpleInstructor[]>([])
  const [rooms, setRooms] = useState<SimpleRoom[]>([])
  const [templates, setTemplates] = useState<ClassTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function f(key: keyof FormState, val: FormState[keyof FormState]) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function load() {
    try {
      const [tmpl, staff, roomList] = await Promise.all([
        api.templates.list(studioId, token),
        api.staff.list(studioId, token),
        api.studios.rooms(studioId, token),
      ])
      setTemplates(tmpl)
      setInstructors(
        staff
          .filter(s => s.instructorId !== null)
          .map(s => ({ id: s.instructorId as string, name: s.name }))
      )
      setRooms(roomList.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [studioId, token])

  function openNew() {
    setEditId(null); setForm(EMPTY_FORM); setError(''); setShowForm(true)
  }

  function openEdit(t: ClassTemplate) {
    setEditId(t.id); setForm(templateToForm(t)); setError(''); setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.durationMin || form.durationMin < 5) { setError('Duration must be at least 5 minutes'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        name: form.name.trim(),
        sport: form.sport,
        durationMin: form.durationMin,
        description: form.description || undefined,
        color: form.color,
        defaultInstructorId: form.defaultInstructorId || null,
        defaultRoomId: form.defaultRoomId || null,
        defaultCapacity: form.defaultCapacity ? Number(form.defaultCapacity) : null,
        defaultCreditsRequired: form.defaultCreditsRequired ? Number(form.defaultCreditsRequired) : null,
        defaultStartTime: form.defaultStartTime || null,
        defaultStartTime2: form.defaultStartTime2 || null,
        defaultDaysOfWeek: form.defaultDaysOfWeek,
        defaultIntervalWeeks: form.defaultIntervalWeeks,
      }
      if (editId) {
        const updated = await api.templates.update(editId, payload, token)
        setTemplates(prev => prev.map(t => t.id === editId ? updated : t))
      } else {
        const created = await api.templates.create({ studioId, ...payload }, token)
        setTemplates(prev => [...prev, created])
      }
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await api.templates.delete(id, token)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch { /* silent */ }
    finally { setDeletingId(null) }
  }

  if (loading) {
    return <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}</div>
  }

  const instructorName = (id: string) => instructors.find(i => i.id === id)?.name ?? id
  const roomName = (id: string) => rooms.find(r => r.id === id)?.name ?? id

  return (
    <div className="space-y-3">
      {templates.length === 0 && !showForm && (
        <p className="text-sm text-gray-400">No class templates yet. Add one to start scheduling classes.</p>
      )}

      {templates.map(t => {
        const cfg = SPORT_CONFIG[t.sport] ?? SPORT_CONFIG.OTHER
        const defaults: string[] = []
        if (t.defaultStartTime) defaults.push(t.defaultStartTime + (t.defaultStartTime2 ? ` & ${t.defaultStartTime2}` : ''))
        if (t.defaultDaysOfWeek?.length) defaults.push(t.defaultDaysOfWeek.map(d => DAY_LABELS[d]).join(', '))
        if (t.defaultInstructorId) defaults.push(instructorName(t.defaultInstructorId))
        if (t.defaultRoomId) defaults.push(roomName(t.defaultRoomId))

        return (
          <div key={t.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
            <div className={`w-1.5 h-8 rounded-full ${cfg.accent}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className="text-xs text-gray-400">
                {t.durationMin} min
                {t.description ? ` · ${t.description}` : ''}
                {defaults.length > 0 ? ` · ${defaults.join(' · ')}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => openEdit(t)} className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-md px-2.5 py-1 transition-colors">Edit</button>
              <button onClick={() => handleDelete(t.id)} disabled={deletingId === t.id} className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40">
                {deletingId === t.id ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        )
      })}

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
          <h4 className="text-sm font-semibold text-gray-800">{editId ? 'Edit template' : 'New class template'}</h4>

          {/* Core identity */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Name *</label>
              <input type="text" placeholder="e.g. Morning Ride" value={form.name}
                onChange={e => f('name', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Sport *</label>
                <select value={form.sport} onChange={e => f('sport', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400">
                  {SPORT_OPTIONS.map(s => <option key={s} value={s}>{SPORT_CONFIG[s]?.label ?? s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Duration (min) *</label>
                <input type="number" min={5} max={240} step={5} value={form.durationMin}
                  onChange={e => f('durationMin', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Description (optional)</label>
              <input type="text" placeholder="Short description" value={form.description}
                onChange={e => f('description', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
            </div>
          </div>

          {/* Schedule defaults */}
          <div className="pt-2 border-t border-gray-200 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Schedule defaults (optional)</p>
            <p className="text-[11px] text-gray-400 -mt-1">These pre-fill the schedule form when this template is selected.</p>

            <div className="space-y-3">
              {/* Instructor */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Default instructor</label>
                <select value={form.defaultInstructorId} onChange={e => f('defaultInstructorId', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400">
                  <option value="">— none —</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              {/* Room */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Default room</label>
                <select value={form.defaultRoomId} onChange={e => f('defaultRoomId', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400">
                  <option value="">— none —</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {/* Capacity + Credits side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Default capacity</label>
                  <input type="number" min={1} max={500} placeholder="e.g. 20" value={form.defaultCapacity}
                    onChange={e => f('defaultCapacity', e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Credits required</label>
                  <input type="number" min={0} max={20} placeholder="e.g. 1" value={form.defaultCreditsRequired}
                    onChange={e => f('defaultCreditsRequired', e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
              </div>

              {/* Times side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Default start time</label>
                  <TimeInput value={form.defaultStartTime}
                    onChange={v => f('defaultStartTime', v)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Second session time</label>
                  <TimeInput value={form.defaultStartTime2}
                    onChange={v => f('defaultStartTime2', v)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
              </div>
            </div>

            {/* Days of week */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">Default days</label>
              <div className="flex gap-1.5">
                {DAY_LABELS.map((label, i) => (
                  <button key={i} type="button"
                    onClick={() => f('defaultDaysOfWeek', form.defaultDaysOfWeek.includes(i) ? form.defaultDaysOfWeek.filter(d => d !== i) : [...form.defaultDaysOfWeek, i].sort())}
                    className={`w-9 h-9 rounded-full text-xs font-medium transition-colors ${form.defaultDaysOfWeek.includes(i) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {label[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">Default frequency</label>
              <div className="flex gap-1.5 flex-wrap">
                {[{ label: 'Every week', value: 1 }, { label: 'Every 2 weeks', value: 2 }, { label: 'Every 3 weeks', value: 3 }, { label: 'Every 4 weeks', value: 4 }].map(opt => (
                  <button key={opt.value} type="button" onClick={() => f('defaultIntervalWeeks', opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${form.defaultIntervalWeeks === opt.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : editId ? 'Save changes' : 'Create template'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button onClick={openNew}
          className="text-sm font-medium text-gray-600 border border-dashed border-gray-300 rounded-xl px-4 py-2.5 w-full hover:border-gray-500 hover:text-gray-900 transition-colors">
          + Add class template
        </button>
      )}
    </div>
  )
}
