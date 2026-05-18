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

// ─── Merged permission definition ────────────────────────────────────────────
// Each entry maps to one or both roles. For dual-role users, shared permissions
// show a single toggle that controls both simultaneously.

type RoleKey = 'instructor' | 'fronthost'

interface PermDef {
  label: string
  description: string
  // Which role(s) this permission belongs to and the field name in each
  instructor?: keyof InstructorPermissions
  fronthost?: keyof FronthostPermissions
}

const ALL_PERMS: PermDef[] = [
  { label: 'Check in members',        description: 'Scan or manually check in attendees at class',         instructor: 'canCheckInMembers' },
  { label: 'Manage waitlist',         description: 'Promote or remove members from the waitlist',           instructor: 'canManageWaitlist',     fronthost: 'canManageWaitlist' },
  { label: 'Manage bookings',         description: 'Cancel or modify member bookings',                      instructor: 'canManageBookings',     fronthost: 'canManageBookings' },
  { label: 'View member contact',     description: 'See member email addresses and phone numbers',          instructor: 'canViewMemberContact',  fronthost: 'canViewMemberContact' },
  { label: 'Adjust credits',          description: 'Add or deduct credits from member accounts',            fronthost: 'canAdjustCredits' },
  { label: 'Edit session details',    description: 'Change capacity, credits required, or timing',          instructor: 'canEditSessionDetails' },
  { label: 'Cancel a session',        description: 'Mark a session as cancelled',                           instructor: 'canCancelSession' },
  { label: 'Create & edit schedules', description: 'Add recurring schedules and modify existing ones',      instructor: 'canCreateSchedules' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function roleLabel(role: RoleKey) {
  return role === 'instructor' ? 'Instructor' : 'Front Desk'
}

function badgeClass(role: RoleKey) {
  return role === 'instructor'
    ? 'text-violet-600 bg-violet-50'
    : 'text-blue-600 bg-blue-50'
}

function avatarClass(roles: RoleKey[]) {
  if (roles.length > 1) return 'bg-gray-200 text-gray-600'
  return roles[0] === 'instructor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
}

// ─── Local permission state ───────────────────────────────────────────────────

interface LocalPerms {
  instructor: InstructorPermissions
  fronthost: FronthostPermissions
}

function buildLocal(s: StaffWithPermissions): LocalPerms {
  return {
    instructor: { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...s.instructorPermissions },
    fronthost:  { ...DEFAULT_FRONTHOST_PERMISSIONS,  ...s.fronthostPermissions  },
  }
}

function isDirty(s: StaffWithPermissions, local: LocalPerms): boolean {
  const origI = JSON.stringify({ ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...s.instructorPermissions })
  const origF = JSON.stringify({ ...DEFAULT_FRONTHOST_PERMISSIONS,  ...s.fronthostPermissions  })
  if (s.roles.includes('instructor') && JSON.stringify(local.instructor) !== origI) return true
  if (s.roles.includes('fronthost')  && JSON.stringify(local.fronthost)  !== origF) return true
  return false
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`w-9 h-5 rounded-full transition-colors shrink-0 relative mt-0.5 ${on ? 'bg-gray-900' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { studioId: string; token: string }

export default function PermissionsTab({ studioId, token }: Props) {
  const [staff, setStaff]           = useState<StaffWithPermissions[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleKey>('all')
  const [local, setLocal]           = useState<Record<string, LocalPerms>>({})
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    api.franchise.staffPermissions(studioId, token)
      .then(data => {
        setStaff(data)
        const map: Record<string, LocalPerms> = {}
        for (const s of data) map[s.id] = buildLocal(s)
        setLocal(map)
        if (data.length > 0) setSelectedId(data[0].id)
      })
      .finally(() => setLoading(false))
  }, [studioId, token])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function togglePerm(staffId: string, def: PermDef, roles: RoleKey[]) {
    setLocal(prev => {
      const cur = prev[staffId]
      // Determine current value (OR across relevant roles)
      const currentVal = (def.instructor && roles.includes('instructor'))
        ? cur.instructor[def.instructor]
        : def.fronthost ? cur.fronthost[def.fronthost] : false
      const next = !currentVal
      return {
        ...prev,
        [staffId]: {
          instructor: def.instructor && roles.includes('instructor')
            ? { ...cur.instructor, [def.instructor]: next }
            : cur.instructor,
          fronthost: def.fronthost && roles.includes('fronthost')
            ? { ...cur.fronthost, [def.fronthost]: next }
            : cur.fronthost,
        },
      }
    })
  }

  async function save() {
    if (!selectedId) return
    const s = staff.find(x => x.id === selectedId)
    if (!s) return
    const p = local[selectedId]
    setSaving(true)
    try {
      await Promise.all([
        s.roles.includes('instructor')
          ? api.franchise.updatePermissions(studioId, s.id, p.instructor, token)
          : null,
        s.roles.includes('fronthost') && s.memberId
          ? api.franchise.updateFronthostPermissions(studioId, s.memberId, p.fronthost, token)
          : null,
      ])
      setStaff(prev => prev.map(x => x.id === selectedId
        ? { ...x, instructorPermissions: p.instructor, fronthostPermissions: p.fronthost }
        : x))
      showToast('Permissions saved')
    } catch {
      showToast('Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return staff.filter(s => {
      if (roleFilter !== 'all' && !s.roles.includes(roleFilter)) return false
      if (q) return s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      return true
    })
  }, [staff, search, roleFilter])

  const selected = staff.find(s => s.id === selectedId) ?? null
  const perms    = selectedId ? local[selectedId] : null
  const dirty    = selected && perms ? isDirty(selected, perms) : false

  // Build the visible permission rows for the selected staff member
  const visiblePerms = useMemo(() => {
    if (!selected) return []
    const roles = selected.roles
    return ALL_PERMS.filter(d =>
      (d.instructor && roles.includes('instructor')) ||
      (d.fronthost  && roles.includes('fronthost'))
    )
  }, [selected])

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
    return <p className="text-sm text-gray-400 py-12 text-center">No staff assigned to this studio yet.</p>
  }

  return (
    <div className="flex gap-4 min-h-0">

      {/* ── Left: staff list ── */}
      <div className="w-64 shrink-0 flex flex-col gap-2">
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
        <div className="flex gap-1">
          {(['all', 'instructor', 'fronthost'] as const).map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`flex-1 text-[10px] font-medium py-1 rounded-md transition-colors ${
                roleFilter === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {r === 'all' ? 'All' : r === 'instructor' ? 'Instructors' : 'Front Desk'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5" style={{ maxHeight: '480px' }}>
          {filtered.length === 0
            ? <p className="text-xs text-gray-400 text-center py-6">No results</p>
            : filtered.map(s => {
              const isSel = selectedId === s.id
              return (
                <button key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    isSel ? 'bg-gray-900' : 'bg-white border border-gray-100 hover:bg-gray-50'
                  }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    isSel ? 'bg-white/20 text-white' : avatarClass(s.roles)
                  }`}>
                    {initials(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSel ? 'text-white' : 'text-gray-900'}`}>{s.name}</p>
                    <p className={`text-[10px] truncate ${isSel ? 'text-gray-300' : 'text-gray-400'}`}>{s.roles.map(roleLabel).join(' · ')}</p>
                  </div>
                  {local[s.id] && isDirty(s, local[s.id]) && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSel ? 'bg-amber-300' : 'bg-amber-400'}`} />
                  )}
                </button>
              )
            })
          }
        </div>
      </div>

      {/* ── Right: permissions detail ── */}
      <div className="flex-1 min-w-0">
        {!selected || !perms ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Select a staff member to edit permissions
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarClass(selected.roles)}`}>
                {initials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.email}</p>
              </div>
              <div className="flex gap-1.5">
                {selected.roles.map(r => (
                  <span key={r} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${badgeClass(r)}`}>
                    {roleLabel(r)}
                  </span>
                ))}
              </div>
            </div>

            {/* Permission grid — 3 columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-4">
              {visiblePerms.map(def => {
                const roles = selected.roles
                // Determine toggle value
                const val = def.instructor && roles.includes('instructor')
                  ? perms.instructor[def.instructor]
                  : def.fronthost ? perms.fronthost[def.fronthost!] : false

                return (
                  <label key={def.label} className="flex items-start gap-2.5 cursor-pointer">
                    <Toggle on={val} onToggle={() => togglePerm(selected.id, def, roles)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 leading-tight">{def.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-snug">{def.description}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              {dirty
                ? <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>
                : <span className="text-xs text-gray-300">All changes saved</span>
              }
              <button onClick={save} disabled={saving || !dirty}
                className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
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
