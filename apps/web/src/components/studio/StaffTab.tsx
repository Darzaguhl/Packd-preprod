'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type StaffMember } from '@/lib/api'

interface Props {
  studioId: string
  token: string
  onOpenPermissions?: () => void
}

const ROLE_LABEL: Record<string, string> = {
  fronthost: 'Front Desk',
  instructor: 'Instructor',
}

const ALL_ROLES = ['fronthost', 'instructor'] as const

export default function StaffTab({ studioId, token, onOpenPermissions }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Add-staff form
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('fronthost')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Per-member adding-role state  { memberId: roleBeingAdded }
  const [addingRole, setAddingRole] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStaff(await api.staff.list(studioId, token))
    } finally {
      setLoading(false)
    }
  }, [studioId, token])

  useEffect(() => { load() }, [load])

  // ── Add new staff ──────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setError(null)
    setSuccess(null)
    try {
      await api.staff.assign(studioId, addEmail.trim(), addRole, token)
      setSuccess(`${addEmail.trim()} assigned as ${ROLE_LABEL[addRole] ?? addRole}.`)
      setAddEmail('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  // ── Add role to existing member ────────────────────────────────────────────

  async function handleAddRole(member: StaffMember, role: string) {
    setAddingRole(prev => ({ ...prev, [member.id]: role }))
    setError(null)
    setSuccess(null)
    try {
      await api.staff.assign(studioId, member.email, role, token)
      setSuccess(`${ROLE_LABEL[role] ?? role} role added to ${member.name}.`)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAddingRole(prev => { const n = { ...prev }; delete n[member.id]; return n })
    }
  }

  // ── Remove role / member ───────────────────────────────────────────────────

  async function handleRemoveRole(member: StaffMember, role?: string) {
    const label = role ? ROLE_LABEL[role] ?? role : 'all roles'
    const msg = role
      ? `Remove the ${label} role from ${member.name}?`
      : `Remove ${member.name} from staff entirely? Their account will revert to a regular member.`
    if (!confirm(msg)) return
    setError(null)
    setSuccess(null)
    try {
      await api.staff.remove(member.id, studioId, token, role)
      setSuccess(role ? `${label} role removed from ${member.name}.` : `${member.name} removed from staff.`)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return staff
    return staff.filter(m =>
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    )
  }, [staff, search])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Add staff form ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Add staff member</h3>
        <p className="text-xs text-gray-400 mb-4">
          The user must already have a Packd account. Roles are additive — a person can hold both Instructor and Front Desk.
        </p>
        <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
          <input
            type="email"
            placeholder="user@example.com"
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            required
            className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <select
            value={addRole}
            onChange={e => setAddRole(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="fronthost">Front Desk</option>
            <option value="instructor">Instructor</option>
          </select>
          <button
            type="submit"
            disabled={adding || !addEmail.trim()}
            className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {adding ? 'Assigning…' : 'Assign role'}
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        {success && <p className="mt-3 text-xs text-emerald-600">{success}</p>}
      </div>

      {/* ── Staff list ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Current staff · {staff.length} {staff.length === 1 ? 'person' : 'people'}
          </h3>
          {staff.length > 0 && (
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-10 text-center text-sm text-gray-400">
            No staff members yet. Add someone above.
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-8 text-center text-sm text-gray-400">
            No staff match &ldquo;{search}&rdquo;
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(member => {
              const missingRoles = ALL_ROLES.filter(r => !member.staffRoles.includes(r))
              return (
                <div
                  key={member.id}
                  className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4"
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-gray-600">
                      {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
                    <p className="text-xs text-gray-400 truncate">{member.email}</p>
                  </div>

                  {/* Role badges */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {member.staffRoles.map(r => (
                      <span
                        key={r}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                          r === 'instructor' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {ROLE_LABEL[r] ?? r}
                        {member.staffRoles.length > 1 && (
                          <button
                            onClick={() => handleRemoveRole(member, r)}
                            className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                            title={`Remove ${ROLE_LABEL[r] ?? r} role`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}

                    {/* Add missing role button */}
                    {missingRoles.map(r => (
                      <button
                        key={r}
                        onClick={() => handleAddRole(member, r)}
                        disabled={addingRole[member.id] === r}
                        title={`Also assign ${ROLE_LABEL[r]} role`}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${
                          r === 'instructor'
                            ? 'border-violet-200 text-violet-400 hover:bg-violet-50 hover:text-violet-600'
                            : 'border-blue-200 text-blue-400 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                      >
                        {addingRole[member.id] === r ? '…' : `+ ${ROLE_LABEL[r]}`}
                      </button>
                    ))}
                  </div>

                  {/* Permissions shortcut for instructors */}
                  {member.staffRoles.includes('instructor') && onOpenPermissions && (
                    <button
                      onClick={onOpenPermissions}
                      className="text-xs text-gray-400 hover:text-violet-600 transition-colors shrink-0"
                      title="Edit instructor permissions"
                    >
                      Permissions
                    </button>
                  )}

                  {/* Remove all */}
                  <button
                    onClick={() => handleRemoveRole(member)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    title="Remove from staff"
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
