'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  api,
  type StaffWithPermissions,
  type StudioSummary,
  type InstructorPermissions,
  type FronthostPermissions,
  DEFAULT_INSTRUCTOR_PERMISSIONS,
  DEFAULT_FRONTHOST_PERMISSIONS,
} from '@/lib/api-client'

type RoleKey = 'instructor' | 'fronthost'

interface PermDef {
  label: string
  description: string
  instructor?: keyof InstructorPermissions
  fronthost?: keyof FronthostPermissions
}

const ALL_PERMS: PermDef[] = [
  { label: 'Check in members',        description: 'Scan or manually check in attendees',                    instructor: 'canCheckInMembers',     fronthost: 'canCheckInMembers' },
  { label: 'Manage waitlist',         description: 'Promote or remove members from the waitlist',            instructor: 'canManageWaitlist',     fronthost: 'canManageWaitlist' },
  { label: 'Manage bookings',         description: 'Cancel or modify member bookings',                       instructor: 'canManageBookings',     fronthost: 'canManageBookings' },
  { label: 'View member contact',     description: 'See member email and phone numbers',                     instructor: 'canViewMemberContact',  fronthost: 'canViewMemberContact' },
  { label: 'Adjust credits',          description: 'Add or deduct credits from member accounts',             fronthost: 'canAdjustCredits' },
  { label: 'Grant credits',           description: 'Manually grant credits',                                 instructor: 'canGrantCredits',       fronthost: 'canGrantCredits' },
  { label: 'Issue refunds',           description: 'Refund Stripe transactions for product sales',           fronthost: 'canIssueRefunds' },
  { label: 'Manage promo codes',      description: 'Create, edit and deactivate promo codes',                instructor: 'canManagePromoCodes',   fronthost: 'canManagePromoCodes' },
  { label: 'View purchase history',   description: "See a member's payment and credit history",              instructor: 'canViewPurchaseHistory', fronthost: 'canViewPurchaseHistory' },
  { label: 'Export data',             description: 'Download CSV exports',                                   fronthost: 'canExportData' },
  { label: 'Override booking rules',  description: 'Book past the close time or into full classes',          instructor: 'canOverrideBookingRestrictions', fronthost: 'canOverrideBookingRestrictions' },
  { label: 'Edit session details',    description: 'Change capacity, credits required, or timing',           instructor: 'canEditSessionDetails' },
  { label: 'Cancel a session',        description: 'Mark a session as cancelled',                            instructor: 'canCancelSession' },
  { label: 'Set a substitute',        description: 'Assign a substitute instructor',                         instructor: 'canSetSubstitute' },
  { label: 'Create & edit schedules', description: 'Add recurring schedules and modify existing ones',       instructor: 'canCreateSchedules',    fronthost: 'canCreateSchedules' },
  { label: 'View analytics',          description: 'Access the studio analytics dashboard and reports',      instructor: 'canViewAnalytics',      fronthost: 'canViewAnalytics' },
]

// ── State helpers ─────────────────────────────────────────────────────────────

interface LocalPerms {
  instructor: InstructorPermissions
  fronthost: FronthostPermissions
}

function buildLocal(s: StaffWithPermissions): LocalPerms {
  return {
    instructor: { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...s.instructorPermissions },
    fronthost:  { ...DEFAULT_FRONTHOST_PERMISSIONS,  ...s.fronthostPermissions },
  }
}

function permsKey(p: LocalPerms, roles: RoleKey[]) {
  const parts: string[] = []
  if (roles.includes('instructor')) parts.push(JSON.stringify(p.instructor))
  if (roles.includes('fronthost'))  parts.push(JSON.stringify(p.fronthost))
  return parts.join('|')
}

function isDirty(s: StaffWithPermissions, local: LocalPerms): boolean {
  const origI = JSON.stringify({ ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...s.instructorPermissions })
  const origF = JSON.stringify({ ...DEFAULT_FRONTHOST_PERMISSIONS,  ...s.fronthostPermissions })
  if (s.roles.includes('instructor') && JSON.stringify(local.instructor) !== origI) return true
  if (s.roles.includes('fronthost')  && JSON.stringify(local.fronthost)  !== origF) return true
  return false
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function Avatar({ name, url, size = 8, selected = false }: { name: string; url?: string | null; size?: number; selected?: boolean }) {
  const cls = `w-${size} h-${size} rounded-full shrink-0 overflow-hidden flex items-center justify-center text-xs font-bold mt-0.5 ${
    selected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
  }`
  if (url) return <img src={url} alt={name} className={`${cls} object-cover`} />
  return <div className={cls}>{initials(name)}</div>
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={onToggle}
      className={`w-9 h-5 rounded-full transition-colors shrink-0 relative mt-0.5 ${on ? 'bg-gray-900' : 'bg-gray-200'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

// ── Data structures ───────────────────────────────────────────────────────────

interface StudioEntry {
  studioId: string
  studioName: string
  staffEntry: StaffWithPermissions
  localKey: string // "{staffId}:{studioId}"
}

// One row per person in the list
interface PersonEntry {
  userId: string
  id: string      // memberId (from first studio — used for fronthost updates)
  name: string
  email: string
  avatarUrl?: string | null
  roles: RoleKey[]
  studios: StudioEntry[]
  permissionsVary: boolean  // instructor only — true when perms differ across studios
}

interface Props { studios: StudioSummary[]; token: string }

export default function FranchisePermissionsRoster({ studios, token }: Props) {
  const [byStudio, setByStudio] = useState<Record<string, StaffWithPermissions[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleKey>('all')
  const [local, setLocal] = useState<Record<string, LocalPerms>>({})
  // selectedKey = "{staffId}:{studioId}" — the active studio context in the panel
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [applyToAll, setApplyToAll] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load all studios' permissions in parallel ──────────────────────────────
  useEffect(() => {
    if (!studios.length) return
    Promise.all(studios.map(s => api.franchise.staffPermissions(s.id, token).then((data: StaffWithPermissions[]) => ({ studioId: s.id, data }))))
      .then(results => {
        const map: Record<string, StaffWithPermissions[]> = {}
        const localMap: Record<string, LocalPerms> = {}
        for (const { studioId, data } of results) {
          map[studioId] = data
          for (const s of data) {
            localMap[`${s.id}:${studioId}`] = buildLocal(s)
          }
        }
        setByStudio(map)
        setLocal(localMap)
      })
      .finally(() => setLoading(false))
  }, [studios, token])

  // ── Build deduplicated person list ────────────────────────────────────────
  const persons: PersonEntry[] = useMemo(() => {
    const studioMap = new Map(studios.map(s => [s.id, s.name]))
    const byUser = new Map<string, PersonEntry>()

    for (const [studioId, staff] of Object.entries(byStudio)) {
      for (const s of staff) {
        const existing = byUser.get(s.userId)
        const entry: StudioEntry = {
          studioId,
          studioName: studioMap.get(studioId) ?? studioId,
          staffEntry: s,
          localKey: `${s.id}:${studioId}`,
        }
        if (existing) {
          existing.studios.push(entry)
        } else {
          byUser.set(s.userId, {
            userId: s.userId,
            id: s.id,
            name: s.name,
            email: s.email,
            avatarUrl: s.avatarUrl ?? null,
            roles: s.roles as RoleKey[],
            studios: [entry],
            permissionsVary: false,
          })
        }
      }
    }

    // Compute permissionsVary for multi-studio instructors
    // (fronthost permissions are member-level = same everywhere by design)
    for (const p of byUser.values()) {
      if (p.studios.length > 1 && p.roles.includes('instructor')) {
        const keys = p.studios.map(st => {
          const lp = local[st.localKey]
          return lp ? permsKey(lp, p.roles) : null
        })
        p.permissionsVary = new Set(keys.filter(Boolean)).size > 1
      }
    }

    return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [byStudio, studios, local])

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return persons.filter(p => {
      if (roleFilter !== 'all' && !p.roles.includes(roleFilter)) return false
      if (q) return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      return true
    })
  }, [persons, search, roleFilter])

  // ── Selected state ────────────────────────────────────────────────────────
  const selectedPerson = useMemo(() => {
    if (!selectedKey) return null
    const [staffId] = selectedKey.split(':')
    return persons.find(p => p.studios.some(st => st.staffEntry.id === staffId)) ?? null
  }, [selectedKey, persons])

  const activeStudio = useMemo(() => {
    if (!selectedKey || !selectedPerson) return null
    return selectedPerson.studios.find(st => st.localKey === selectedKey) ?? null
  }, [selectedKey, selectedPerson])

  const perms = selectedKey ? local[selectedKey] : null
  const dirty = activeStudio && perms ? isDirty(activeStudio.staffEntry, perms) : false

  // Any unsaved changes in any studio for this person
  const anyDirty = useMemo(() => {
    if (!selectedPerson) return false
    return selectedPerson.studios.some(st => {
      const lp = local[st.localKey]
      return lp ? isDirty(st.staffEntry, lp) : false
    })
  }, [selectedPerson, local])

  const visiblePerms = useMemo(() => {
    if (!selectedPerson) return []
    return ALL_PERMS.filter(d =>
      (d.instructor && selectedPerson.roles.includes('instructor')) ||
      (d.fronthost  && selectedPerson.roles.includes('fronthost'))
    )
  }, [selectedPerson])

  // ── Interactions ──────────────────────────────────────────────────────────

  function selectPerson(person: PersonEntry) {
    // Default to first studio
    setSelectedKey(person.studios[0].localKey)
    setApplyToAll(true)
  }

  function togglePerm(def: PermDef) {
    if (!selectedKey || !selectedPerson) return
    const roles = selectedPerson.roles as RoleKey[]

    const cur = local[selectedKey]
    const currentVal = (def.instructor && roles.includes('instructor'))
      ? cur.instructor[def.instructor!]
      : def.fronthost ? cur.fronthost[def.fronthost!] : false
    const next = !currentVal

    const updated: LocalPerms = {
      instructor: def.instructor && roles.includes('instructor') ? { ...cur.instructor, [def.instructor]: next } : cur.instructor,
      fronthost:  def.fronthost  && roles.includes('fronthost')  ? { ...cur.fronthost,  [def.fronthost]:  next } : cur.fronthost,
    }

    if (applyToAll && selectedPerson.studios.length > 1) {
      // Propagate to all studios immediately so user sees the change
      const patch: Record<string, LocalPerms> = {}
      for (const st of selectedPerson.studios) {
        const existing = local[st.localKey]
        patch[st.localKey] = {
          instructor: def.instructor && roles.includes('instructor') ? { ...existing.instructor, [def.instructor]: next } : existing.instructor,
          fronthost:  def.fronthost  && roles.includes('fronthost')  ? { ...existing.fronthost,  [def.fronthost]:  next } : existing.fronthost,
        }
      }
      setLocal(prev => ({ ...prev, ...patch }))
    } else {
      setLocal(prev => ({ ...prev, [selectedKey]: updated }))
    }
  }

  async function save() {
    if (!selectedKey || !selectedPerson) return
    setSaving(true)
    try {
      const targets = applyToAll
        ? selectedPerson.studios
        : activeStudio ? [activeStudio] : []

      await Promise.all(targets.flatMap(st => {
        const lp = local[st.localKey]
        const ops = []
        if (selectedPerson.roles.includes('instructor')) {
          ops.push(api.franchise.updatePermissions(st.studioId, st.staffEntry.id, lp.instructor, token))
        }
        if (selectedPerson.roles.includes('fronthost') && st.staffEntry.memberId) {
          // Fronthost perms are member-level — only need to save once but safe to repeat
          ops.push(api.franchise.updateFronthostPermissions(st.studioId, st.staffEntry.memberId, lp.fronthost, token))
        }
        return ops
      }))

      showToast(applyToAll && selectedPerson.studios.length > 1 ? 'Saved for all studios' : 'Permissions saved')
    } catch {
      showToast('Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex gap-4 h-80">
        <div className="w-64 shrink-0 space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
        <div className="flex-1 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!persons.length) {
    return <p className="text-sm text-gray-400 py-12 text-center">No staff assigned to any studio yet.</p>
  }

  return (
    <div className="flex gap-4 min-h-0">

      {/* ── Left: person list ── */}
      <div className="w-64 shrink-0 flex flex-col gap-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
            <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
          </svg>
          <input type="text" placeholder="Search staff…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white" />
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

        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5" style={{ maxHeight: '520px' }}>
          {filtered.length === 0
            ? <p className="text-xs text-gray-400 text-center py-6">No results</p>
            : filtered.map(person => {
              const isSelected = selectedPerson?.userId === person.userId
              const hasDirty = person.studios.some(st => local[st.localKey] && isDirty(st.staffEntry, local[st.localKey]))
              return (
                <button key={person.userId} onClick={() => selectPerson(person)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    isSelected ? 'bg-gray-900' : 'bg-white border border-gray-100 hover:bg-gray-50'
                  }`}>
                  <Avatar name={person.name} url={person.avatarUrl} selected={isSelected} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{person.name}</p>
                    {/* Studio chips */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {person.studios.map(st => (
                        <span key={st.studioId} className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                          isSelected ? 'bg-white/20 text-white/80' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {st.studioName}
                        </span>
                      ))}
                      {/* Varies badge */}
                      {person.permissionsVary && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                          isSelected ? 'bg-amber-400/30 text-amber-200' : 'bg-amber-50 text-amber-600'
                        }`}>
                          ⚠ varies
                        </span>
                      )}
                    </div>
                  </div>
                  {hasDirty && <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${isSelected ? 'bg-amber-300' : 'bg-amber-400'}`} />}
                </button>
              )
            })
          }
        </div>
      </div>

      {/* ── Right: permissions panel ── */}
      <div className="flex-1 min-w-0">
        {!selectedPerson || !perms ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Select a staff member to edit permissions
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 flex flex-col gap-5">

            {/* Header */}
            <div className="flex items-center gap-3">
              <Avatar name={selectedPerson.name} url={selectedPerson.avatarUrl} size={10} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{selectedPerson.name}</p>
                <p className="text-xs text-gray-400">{selectedPerson.email}</p>
              </div>
              <div className="flex gap-1.5">
                {selectedPerson.roles.includes('instructor') && (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full text-violet-600 bg-violet-50">Instructor</span>
                )}
                {selectedPerson.roles.includes('fronthost') && (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full text-blue-600 bg-blue-50">Front Desk</span>
                )}
              </div>
            </div>

            {/* Studio selector — always shown when person is at multiple studios */}
            {selectedPerson.studios.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0">Studio</span>
                <div className="flex gap-1.5 flex-wrap flex-1">
                  {selectedPerson.studios.map(st => {
                    const isActive = selectedKey === st.localKey
                    const stDirty = local[st.localKey] ? isDirty(st.staffEntry, local[st.localKey]) : false
                    return (
                      <button
                        key={st.localKey}
                        onClick={() => setSelectedKey(st.localKey)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                          isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {st.studioName}
                        {stDirty && <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-amber-300' : 'bg-amber-400'}`} />}
                      </button>
                    )
                  })}
                </div>
                {selectedPerson.permissionsVary && (
                  <span className="text-[10px] text-amber-600 font-medium">⚠ permissions differ by studio</span>
                )}
              </div>
            )}

            {/* Single studio — show as context label */}
            {selectedPerson.studios.length === 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Studio</span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                  {selectedPerson.studios[0].studioName}
                </span>
              </div>
            )}

            {/* Permission toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-4">
              {visiblePerms.map(def => {
                const roles = selectedPerson.roles as RoleKey[]
                const instrVal = def.instructor && roles.includes('instructor') ? perms.instructor[def.instructor] : false
                const fhVal    = def.fronthost  && roles.includes('fronthost')  ? perms.fronthost[def.fronthost]  : false
                const val = instrVal || fhVal
                return (
                  <label key={def.label} className="flex items-start gap-2.5 cursor-pointer">
                    <Toggle on={val} onToggle={() => togglePerm(def)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 leading-tight">{def.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-snug">{def.description}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-3">
                {anyDirty
                  ? <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>
                  : <span className="text-xs text-gray-300">All changes saved</span>
                }
                {/* Apply to all — only meaningful for multi-studio instructors */}
                {selectedPerson.studios.length > 1 && selectedPerson.roles.includes('instructor') && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyToAll}
                      onChange={e => setApplyToAll(e.target.checked)}
                      className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-500">Apply to all studios</span>
                  </label>
                )}
              </div>
              <button onClick={save} disabled={saving || !anyDirty}
                className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors whitespace-nowrap">
                {saving ? 'Saving…' : applyToAll && selectedPerson.studios.length > 1 ? 'Save for all studios' : 'Save permissions'}
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
