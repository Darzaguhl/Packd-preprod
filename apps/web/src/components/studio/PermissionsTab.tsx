'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  api,
  type StaffWithPermissions,
  type InstructorPermissions,
  type FronthostPermissions,
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  DEFAULT_FRONTHOST_PERMISSIONS,
} from '@/lib/api'

// ─── Permission metadata ────────────────────────────────────────────────────

const INSTRUCTOR_PERMISSION_META: { key: keyof InstructorPermissions; label: string; description: string }[] = [
  { key: 'canCheckInMembers',     label: 'Check in members',        description: 'Scan or manually check in attendees at class' },
  { key: 'canManageWaitlist',     label: 'Manage waitlist',         description: 'Promote or remove members from the waitlist' },
  { key: 'canManageBookings',     label: 'Manage bookings',         description: 'Cancel or modify member bookings' },
  { key: 'canViewMemberContact',  label: 'View member contact',     description: 'See member email addresses and phone numbers' },
  { key: 'canEditSessionDetails', label: 'Edit session details',    description: 'Change capacity, credits required, or timing' },
  { key: 'canCancelSession',      label: 'Cancel a session',        description: 'Mark a session as cancelled' },
  { key: 'canCreateSchedules',    label: 'Create & edit schedules', description: 'Add recurring schedules and modify existing ones' },
]

const FRONTHOST_PERMISSION_META: { key: keyof FronthostPermissions; label: string; description: string }[] = [
  { key: 'canAdjustCredits',     label: 'Adjust credits',      description: 'Add or deduct credits from member accounts' },
  { key: 'canManageWaitlist',    label: 'Manage waitlist',     description: 'Promote or remove members from the waitlist' },
  { key: 'canManageBookings',    label: 'Manage bookings',     description: 'Cancel or modify member bookings' },
  { key: 'canViewMemberContact', label: 'View member contact', description: 'See member email addresses and phone numbers' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

type AnyPermissions = InstructorPermissions | FronthostPermissions

function defaultsFor(staff: StaffWithPermissions): AnyPermissions {
  return staff.role === 'instructor' ? { ...DEFAULT_INSTRUCTOR_PERMISSIONS } : { ...DEFAULT_FRONTHOST_PERMISSIONS }
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  studioId: string
  token: string
}

// ─── Toggle switch ─────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`w-10 h-6 rounded-full transition-colors shrink-0 relative ${on ? 'bg-gray-900' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function PermissionsTab({ studioId, token }: Props) {
  const [staff, setStaff] = useState<StaffWithPermissions[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'instructor' | 'fronthost'>('all')
  const [local, setLocal] = useState<Record<string, AnyPermissions>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.franchise.staffPermissions(studioId, token)
      .then(data => {
        setStaff(data)
        const map: Record<string, AnyPermissions> = {}
        for (const s of data) map[s.id] = { ...defaultsFor(s), ...s.permissions }
        setLocal(map)
        if (data.length > 0) setSelectedId(data[0].id)
      })
      .finally(() => setLoading(false))
  }, [studioId, token])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function toggle(staffId: string, key: string) {
    setLocal(prev => ({
      ...prev,
      [staffId]: { ...prev[staffId], [key]: !(prev[staffId] as Record<string, boolean>)[key] },
    }))
  }

  async function save() {
    if (!selectedId) return
    const member = staff.find(s => s.id === selectedId)
    if (!member) return
    setSaving(true)
    try {
      if (member.role === 'instructor') {
        await api.franchise.updatePermissions(studioId, selectedId, local[selectedId] as InstructorPermissions, token)
      } else {
        await api.franchise.updateFronthostPermissions(studioId, selectedId, local[selectedId] as FronthostPermissions, token)
      }
      setStaff(prev => prev.map(s => s.id === selectedId ? { ...s, permissions: local[selectedId] } as StaffWithPermissions : s))
      showToast('Permissions saved')
    } catch {
      showToast('Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return staff.filter(s => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false
      if (q) return s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      return true
    })
  }, [staff, search, roleFilter])

  const selected = staff.find(s => s.id === selectedId) ?? null
  const perms = selectedId ? local[selectedId] : null
  const isDirty = selected && perms
    ? JSON.stringify(perms) !== JSON.stringify({ ...defaultsFor(selected), ...selected.permissions })
    : false

  if (loading) {
    return (
      <div className="flex gap-4 h-80">
        <div className="w-64 shrink-0 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
        <div className="flex-1 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (staff.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-12 text-center">
        No staff assigned to this studio yet. Add someone in the Staff tab.
      </p>
    )
  }

  const permMeta = selected?.role === 'instructor' ? INSTRUCTOR_PERMISSION_META : FRONTHOST_PERMISSION_META

  return (
    <div className="flex gap-4 min-h-0">
      {/* ── Left: staff list ── */}
      <div className="w-64 shrink-0 flex flex-col gap-2">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
            <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
          />
        </div>

        {/* Role filter */}
        <div className="flex gap-1">
          {(['all', 'instructor', 'fronthost'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`flex-1 text-[10px] font-medium py-1 rounded-md transition-colors ${
                roleFilter === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {r === 'all' ? 'All' : r === 'instructor' ? 'Instructors' : 'Front Desk'}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5" style={{ maxHeight: '480px' }}>
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">No results</p>
          ) : (
            filtered.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  selectedId === s.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-100 hover:bg-gray-50 text-gray-900'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  selectedId === s.id ? 'bg-white/20 text-white' : (s.role === 'instructor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700')
                }`}>
                  {initials(s.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${selectedId === s.id ? 'text-white' : 'text-gray-900'}`}>
                    {s.name}
                  </p>
                  <p className={`text-[10px] truncate ${selectedId === s.id ? 'text-gray-300' : 'text-gray-400'}`}>
                    {s.role === 'instructor' ? 'Instructor' : 'Front Desk'}
                  </p>
                </div>
                {local[s.id] && JSON.stringify(local[s.id]) !== JSON.stringify({ ...defaultsFor(s), ...s.permissions }) && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedId === s.id ? 'bg-amber-300' : 'bg-amber-400'}`} />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: permissions detail ── */}
      <div className="flex-1 min-w-0">
        {!selected || !perms ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Select a staff member to edit permissions
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                selected.role === 'instructor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {initials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.email}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                selected.role === 'instructor' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
              }`}>
                {selected.role === 'instructor' ? 'Instructor' : 'Front Desk'}
              </span>
            </div>

            {/* Permission toggles */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
              {(permMeta as typeof INSTRUCTOR_PERMISSION_META | typeof FRONTHOST_PERMISSION_META).map(({ key, label, description }) => {
                const val = (perms as Record<string, boolean>)[key] ?? false
                return (
                  <label key={key} className="flex items-start gap-3 cursor-pointer group">
                    <Toggle on={val} onToggle={() => toggle(selected.id, key)} />
                    <div className="pt-0.5">
                      <p className="text-sm font-medium text-gray-800 leading-tight">{label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-snug">{description}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-50">
              {isDirty ? (
                <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>
              ) : (
                <span className="text-xs text-gray-300">All changes saved</span>
              )}
              <button
                onClick={save}
                disabled={saving || !isDirty}
                className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Save permissions'}
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
