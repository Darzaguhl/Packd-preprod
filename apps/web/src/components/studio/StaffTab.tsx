'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type StaffMember, type StaffShift, type StaffShiftPattern } from '@/lib/api'
import PhotosTab from './PhotosTab'

interface Props {
  studioId: string
  token: string
  currency?: string
  onOpenPermissions?: () => void
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function StaffAvatar({ name, avatarUrl, size = 9 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const dim = `w-${size} h-${size}`
  return (
    <div className={`${dim} rounded-full relative overflow-hidden shrink-0 bg-gray-100`}>
      {avatarUrl && (
        <img src={avatarUrl} alt={name} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <span className={`absolute ${avatarUrl ? 'bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-white font-bold' : 'inset-0 flex items-center justify-center text-sm font-bold text-gray-600'}`}>
        {initials}
      </span>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = {
  fronthost: 'Front Desk',
  instructor: 'Instructor',
}

const ALL_ROLES = ['fronthost', 'instructor'] as const

export default function StaffTab({ studioId, token, currency = 'USD', onOpenPermissions }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<StaffMember | null>(null)

  // Add-staff form
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('fronthost')
  const [adding, setAdding] = useState(false)
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteRole, setInviteRole] = useState('fronthost')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.staff.list(studioId, token)
      setStaff(list)
      // Keep drawer in sync when re-loading
      setSelected(prev => prev ? (list.find(m => m.id === prev.id) ?? null) : null)
    } finally {
      setLoading(false)
    }
  }, [studioId, token])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setFormMsg(null)
    try {
      await api.staff.assign(studioId, addEmail.trim(), addRole, token)
      setFormMsg({ ok: true, text: `${addEmail.trim()} assigned as ${ROLE_LABEL[addRole] ?? addRole}.` })
      setAddEmail('')
      await load()
    } catch (err) {
      setFormMsg({ ok: false, text: (err as Error).message })
    } finally {
      setAdding(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim() || !inviteFirstName.trim()) return
    setInviting(true)
    setInviteMsg(null)
    try {
      const res = await api.staff.invite(inviteEmail.trim(), inviteFirstName.trim(), inviteRole, studioId, token)
      setInviteMsg({ ok: true, text: res.message })
      setInviteEmail('')
      setInviteFirstName('')
    } catch (err) {
      setInviteMsg({ ok: false, text: (err as Error).message })
    } finally {
      setInviting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return staff
    return staff.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
  }, [staff, search])

  return (
    <div className="flex h-full min-h-0">
      {/* ── Main list ── */}
      <div className={`flex-1 min-w-0 space-y-6 transition-all duration-200 ${selected ? 'mr-4' : ''}`}>

        {/* Add staff */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Add staff member</h3>
          <p className="text-xs text-gray-400 mb-4">
            The user must already have a Packd account. Roles are additive — a person can hold both.
          </p>
          <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
            <input
              type="email" placeholder="user@example.com" value={addEmail}
              onChange={e => setAddEmail(e.target.value)} required
              className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <select value={addRole} onChange={e => setAddRole(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="fronthost">Front Desk</option>
              <option value="instructor">Instructor</option>
            </select>
            <button type="submit" disabled={adding || !addEmail.trim()}
              className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
              {adding ? 'Assigning…' : 'Assign role'}
            </button>
          </form>
          {formMsg && <p className={`mt-3 text-xs ${formMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{formMsg.text}</p>}
        </div>

        {/* Invite */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-900">Invite someone new</h3>
            <button onClick={() => { setShowInvite(v => !v); setInviteMsg(null) }}
              className="text-xs text-gray-500 hover:text-gray-800 transition-colors">
              {showInvite ? 'Hide' : 'Show'}
            </button>
          </div>
          {!showInvite ? (
            <p className="text-xs text-gray-400">Send an invitation email to someone who doesn't have a Packd account yet.</p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-4">They'll receive an email with a link to sign up and join your studio.</p>
              <form onSubmit={handleInvite} className="flex gap-3 flex-wrap">
                <input type="text" placeholder="First name" value={inviteFirstName}
                  onChange={e => setInviteFirstName(e.target.value)} required
                  className="w-36 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <input type="email" placeholder="email@example.com" value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)} required
                  className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="fronthost">Front Desk</option>
                  <option value="instructor">Instructor</option>
                </select>
                <button type="submit" disabled={inviting || !inviteEmail.trim() || !inviteFirstName.trim()}
                  className="text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {inviting ? 'Sending…' : 'Send invite'}
                </button>
              </form>
              {inviteMsg && <p className={`mt-3 text-xs ${inviteMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{inviteMsg.text}</p>}
            </>
          )}
        </div>

        {/* Staff list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Staff · {staff.length} {staff.length === 1 ? 'person' : 'people'}
            </h3>
            {staff.length > 0 && (
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                  <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
                </svg>
                <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white" />
              </div>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
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
              {filtered.map(member => (
                <button
                  key={member.id}
                  data-testid="staff-member-row"
                  data-email={member.email}
                  onClick={() => setSelected(s => s?.id === member.id ? null : member)}
                  className={`w-full text-left bg-white rounded-2xl border px-5 py-4 flex items-center gap-4 transition-all hover:border-gray-300 hover:shadow-sm ${
                    selected?.id === member.id ? 'border-gray-900 shadow-sm' : 'border-gray-100'
                  }`}
                >
                  <StaffAvatar name={member.name} avatarUrl={member.avatarUrl} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
                    <p className="text-xs text-gray-400 truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {member.staffRoles.map(r => (
                      <span key={r} className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r === 'instructor' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {ROLE_LABEL[r] ?? r}
                      </span>
                    ))}
                  </div>
                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                    <path d="M6 4l4 4-4 4" strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Drawer ── */}
      {selected && (
        <StaffDrawer
          member={selected}
          token={token}
          currency={currency}
          studioId={studioId}
          onClose={() => setSelected(null)}
          onRefresh={load}
          onOpenPermissions={onOpenPermissions}
        />
      )}
    </div>
  )
}

// ── Staff drawer ──────────────────────────────────────────────────────────────

function StaffDrawer({
  member,
  token,
  currency,
  studioId,
  onClose,
  onRefresh,
  onOpenPermissions,
}: {
  member: StaffMember
  token: string
  currency: string
  studioId: string
  onClose: () => void
  onRefresh: () => Promise<void>
  onOpenPermissions?: () => void
}) {
  const [addingRole, setAddingRole] = useState<string | null>(null)
  const [removingRole, setRemovingRole] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [showPhotos, setShowPhotos] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const missingRoles = ALL_ROLES.filter(r => !member.staffRoles.includes(r))

  async function handleAddRole(role: string) {
    setAddingRole(role)
    setMsg(null)
    try {
      await api.staff.assign(studioId, member.email, role, token)
      setMsg({ ok: true, text: `${ROLE_LABEL[role] ?? role} role added.` })
      await onRefresh()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setAddingRole(null)
    }
  }

  async function handleRemoveRole(role: string) {
    if (!confirm(`Remove the ${ROLE_LABEL[role] ?? role} role from ${member.name}?`)) return
    setRemovingRole(role)
    setMsg(null)
    try {
      await api.staff.remove(member.id, studioId, token, role)
      setMsg({ ok: true, text: `${ROLE_LABEL[role] ?? role} role removed.` })
      await onRefresh()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setRemovingRole(null)
    }
  }

  async function handleRemoveAll() {
    if (!confirm(`Remove ${member.name} from staff entirely? Their account will revert to a regular member.`)) return
    setRemoving(true)
    try {
      await api.staff.remove(member.id, studioId, token)
      onClose()
      await onRefresh()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
      setRemoving(false)
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    setMsg(null)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      await api.staff.uploadAvatar(member.id, { base64, fileName: file.name, contentType: file.type }, token)
      await onRefresh()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setUploadingAvatar(false)
      e.target.value = ''
    }
  }

  return (
    <div className="w-80 shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <StaffAvatar name={member.name} avatarUrl={member.avatarUrl} size={10} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
          <p className="text-xs text-gray-400 truncate">{member.email}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors p-1 shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {msg && (
          <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
        )}

        {/* Roles */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Roles</p>
          <div className="space-y-1.5">
            {ALL_ROLES.map(role => {
              const has = member.staffRoles.includes(role)
              return (
                <div key={role} className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${has ? 'text-gray-900' : 'text-gray-400'}`}>
                    {ROLE_LABEL[role]}
                  </span>
                  {has ? (
                    <button
                      onClick={() => handleRemoveRole(role)}
                      disabled={removingRole === role || member.staffRoles.length === 1}
                      className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                      title={member.staffRoles.length === 1 ? 'Use "Remove from staff" to remove the last role' : undefined}
                    >
                      {removingRole === role ? '…' : 'Remove'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAddRole(role)}
                      disabled={addingRole === role}
                      className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
                    >
                      {addingRole === role ? '…' : '+ Add'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Photo — all staff */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Profile</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Headshot</span>
            <label className={`text-xs text-indigo-600 hover:text-indigo-800 cursor-pointer transition-colors ${uploadingAvatar ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploadingAvatar ? 'Uploading…' : member.avatarUrl ? 'Change' : 'Upload'}
              <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
            </label>
          </div>
        </div>

        {/* Instructor settings */}
        {member.staffRoles.includes('instructor') && member.instructorId && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Instructor</p>
            <div className="space-y-2">
              <PayRateRow member={member} currency={currency} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Photos</span>
                <button
                  onClick={() => setShowPhotos(v => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {showPhotos ? 'Hide' : 'Manage'}
                </button>
              </div>
              {onOpenPermissions && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Permissions</span>
                  <button
                    onClick={onOpenPermissions}
                    className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    Edit →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showPhotos && member.instructorId && (
          <div className="border-t border-gray-100 pt-4">
            <PhotosTab instructorId={member.instructorId} token={token} isManager={true} />
          </div>
        )}

        {/* Front desk settings */}
        {member.staffRoles.includes('fronthost') && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Front Desk</p>
            <div className="space-y-2">
              <HourlyPayRateRow member={member} currency={currency} />
            </div>
          </div>
        )}

        {/* Shifts — shown for fronthost staff */}
        {member.staffRoles.includes('fronthost') && (
          <ShiftsSection member={member} studioId={studioId} token={token} currency={currency} />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100">
        <button
          onClick={handleRemoveAll}
          disabled={removing}
          className="w-full text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors py-1"
        >
          {removing ? 'Removing…' : 'Remove from staff'}
        </button>
      </div>
    </div>
  )
}

// ── Pay rate row ──────────────────────────────────────────────────────────────

// Pay rates are read-only for studio admins — set by franchise admin only
function PayRateRow({ member, currency }: { member: StaffMember; currency: string }) {
  const symbol = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(0).replace(/[\d,.\s]/g, '').trim() || currency
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">Pay rate / head</span>
      <span className="text-xs text-gray-400">
        {member.payRatePerHeadCents != null
          ? `${symbol}${(member.payRatePerHeadCents / 100).toFixed(2)}`
          : <span className="text-gray-300">not set</span>}
      </span>
    </div>
  )
}

function HourlyPayRateRow({ member, currency }: { member: StaffMember; currency: string }) {
  const symbol = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(0).replace(/[\d,.\s]/g, '').trim() || currency
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">Pay rate / hour</span>
      <span className="text-xs text-gray-400">
        {member.payRateHourlyCents != null
          ? `${symbol}${(member.payRateHourlyCents / 100).toFixed(2)}/hr`
          : <span className="text-gray-300">not set</span>}
      </span>
    </div>
  )
}

// ── Shifts section ────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ShiftsSection({ member, studioId, token, currency }: {
  member: StaffMember
  studioId: string
  token: string
  currency: string
}) {
  const symbol = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(0).replace(/[\d,.\s]/g, '').trim() || currency
  const [shifts, setShifts] = useState<StaffShift[]>([])
  const [patterns, setPatterns] = useState<StaffShiftPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddRecurring, setShowAddRecurring] = useState(false)
  const [editingShift, setEditingShift] = useState<StaffShift | null>(null)
  const [editingPattern, setEditingPattern] = useState<StaffShiftPattern | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = new Date().toISOString()
      const to = new Date(Date.now() + 90 * 86400000).toISOString()
      const [all, pats] = await Promise.all([
        api.shifts.list(studioId, from, to, token),
        api.shiftPatterns.list(studioId, token, member.id),
      ])
      setShifts(all.filter(s => s.memberId === member.id && !s.patternId))
      setPatterns(pats)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [member.id, studioId, token])

  useEffect(() => { load() }, [load])

  async function handleDeleteShift(id: string) {
    await api.shifts.remove(id, token)
    load()
  }

  async function handleDeletePattern(id: string) {
    const res = await api.shiftPatterns.remove(id, token)
    if (res.futureShiftsDeleted > 0) load()
    else setPatterns(p => p.filter(x => x.id !== id))
  }

  function shiftPay(shift: StaffShift): string | null {
    if (!member.payRateHourlyCents) return null
    const hrs = (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3600000
    return `${symbol}${((hrs * member.payRateHourlyCents) / 100).toFixed(2)}`
  }

  function patternPay(p: StaffShiftPattern): string | null {
    if (!member.payRateHourlyCents) return null
    const [sh, sm] = p.startTime.split(':').map(Number)
    const [eh, em] = p.endTime.split(':').map(Number)
    const hrs = (eh * 60 + em - sh * 60 - sm) / 60
    return `${symbol}${((hrs * member.payRateHourlyCents) / 100).toFixed(2)}/shift`
  }

  return (
    <div className="space-y-3">
      {/* Recurring patterns */}
      {patterns.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recurring</p>
          <div className="space-y-1.5">
            {patterns.map(p => {
              const days = p.daysOfWeek.sort().map(d => DAY_LABELS[d]).join(', ')
              const pay = patternPay(p)
              const intervalLabel = p.intervalWeeks === 1 ? 'Every week' : `Every ${p.intervalWeeks} weeks`
              return (
                <div key={p.id} data-testid="pattern-row" className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span data-testid="pattern-interval" className="text-[9px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded uppercase tracking-wide">{intervalLabel}</span>
                      <p data-testid="pattern-days" className="text-xs font-medium text-gray-800">{days}</p>
                    </div>
                    <p className="text-xs text-gray-500">{p.startTime} – {p.endTime}{pay ? ` · ${pay}` : ''}</p>
                    {p.validUntil && <p className="text-[10px] text-gray-400">Until {new Date(p.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <button data-testid="edit-pattern-btn" onClick={() => setEditingPattern(p)} className="text-gray-300 hover:text-indigo-500 transition-colors" title="Edit pattern">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M11 2l3 3-8 8H3v-3L11 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button data-testid="delete-pattern-btn" onClick={() => handleDeletePattern(p.id)} className="text-gray-300 hover:text-red-400 transition-colors" title="Delete pattern">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* One-off shifts */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            {patterns.length > 0 ? 'One-off shifts' : 'Shifts'}
          </p>
          <div className="flex items-center gap-2">
            <button data-testid="add-recurring-btn" onClick={() => setShowAddRecurring(true)} className="text-[10px] text-violet-600 hover:text-violet-800 transition-colors">+ Recurring</button>
            <button data-testid="add-shift-btn" onClick={() => setShowAdd(true)} className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors">+ Add</button>
          </div>
        </div>

        {loading ? (
          <div className="h-8 bg-gray-50 rounded-lg animate-pulse" />
        ) : shifts.length === 0 ? (
          <p className="text-xs text-gray-400">No upcoming one-off shifts.</p>
        ) : (
          <div className="space-y-1.5">
            {shifts.slice(0, 6).map(shift => {
              const start = new Date(shift.startsAt)
              const end = new Date(shift.endsAt)
              const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
              const pay = shiftPay(shift)
              return (
                <div key={shift.id} data-testid="shift-row" className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800">{dateStr}</p>
                    <p data-testid="shift-time" className="text-xs text-gray-500">{fmt(start)} – {fmt(end)}{pay ? ` · ${pay}` : ''}</p>
                    {shift.note && <p className="text-[10px] text-gray-400 truncate">{shift.note}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <button data-testid="edit-shift-btn" onClick={() => setEditingShift(shift)} className="text-gray-300 hover:text-indigo-500 transition-colors" title="Edit shift">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M11 2l3 3-8 8H3v-3L11 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button data-testid="delete-shift-btn" onClick={() => handleDeleteShift(shift.id)} className="text-gray-300 hover:text-red-400 transition-colors" title="Delete shift">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <AddShiftModal member={member} studioId={studioId} token={token}
          onSaved={() => { setShowAdd(false); load() }} onClose={() => setShowAdd(false)} />
      )}
      {showAddRecurring && (
        <AddRecurringModal member={member} studioId={studioId} token={token}
          onSaved={() => { setShowAddRecurring(false); load() }} onClose={() => setShowAddRecurring(false)} />
      )}
      {editingShift && (
        <EditShiftModal shift={editingShift} token={token}
          onSaved={() => { setEditingShift(null); load() }} onClose={() => setEditingShift(null)} />
      )}
      {editingPattern && (
        <EditRecurringModal pattern={editingPattern} token={token}
          onSaved={() => { setEditingPattern(null); load() }} onClose={() => setEditingPattern(null)} />
      )}
    </div>
  )
}

// ── Add shift modal ───────────────────────────────────────────────────────────

function AddShiftModal({ member, studioId, token, onSaved, onClose }: {
  member: StaffMember
  studioId: string
  token: string
  onSaved: () => void
  onClose: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    const start = new Date(`${date}T${startTime}`)
    const end = new Date(`${date}T${endTime}`)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) { setError('Invalid date or time'); return }
    if (end <= start) { setError('End must be after start'); return }
    setSaving(true)
    setError('')
    try {
      await api.shifts.create({
        studioId,
        memberId: member.id,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        note: note || undefined,
      }, token)
      onSaved()
    } catch {
      setError('Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Add shift · {member.name.split(' ')[0]}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Start</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">End</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Opening shift"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 text-sm font-medium py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button data-testid="shift-save-btn" onClick={handleSave} disabled={saving}
            className="flex-1 text-sm font-medium py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit shift modal ──────────────────────────────────────────────────────────

function EditShiftModal({ shift, token, onSaved, onClose }: {
  shift: StaffShift
  token: string
  onSaved: () => void
  onClose: () => void
}) {
  const toHHMM = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
  const toDateStr = (iso: string) => new Date(iso).toISOString().slice(0, 10)

  const [date, setDate] = useState(toDateStr(shift.startsAt))
  const [startTime, setStartTime] = useState(toHHMM(shift.startsAt))
  const [endTime, setEndTime] = useState(toHHMM(shift.endsAt))
  const [note, setNote] = useState(shift.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    const startsAt = new Date(`${date}T${startTime}`)
    const endsAt = new Date(`${date}T${endTime}`)
    if (endsAt <= startsAt) { setError('End must be after start'); return }
    setSaving(true); setError('')
    try {
      await api.shifts.update(shift.id, { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note: note || null }, token)
      onSaved()
    } catch {
      setError('Failed to save')
      setSaving(false)
    }
  }

  const dateLabel = new Date(shift.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Edit shift</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Start</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">End</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Opening shift"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 text-sm font-medium py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button data-testid="shift-save-btn" onClick={handleSave} disabled={saving}
            className="flex-1 text-sm font-medium py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit recurring pattern modal ──────────────────────────────────────────────

function EditRecurringModal({ pattern, token, onSaved, onClose }: {
  pattern: StaffShiftPattern
  token: string
  onSaved: () => void
  onClose: () => void
}) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(pattern.daysOfWeek)
  const [startTime, setStartTime] = useState(pattern.startTime)
  const [endTime, setEndTime] = useState(pattern.endTime)
  const [intervalWeeks, setIntervalWeeks] = useState(pattern.intervalWeeks)
  const [validFrom, setValidFrom] = useState(pattern.validFrom.slice(0, 10))
  const [validUntil, setValidUntil] = useState(pattern.validUntil?.slice(0, 10) ?? '')
  const [note, setNote] = useState(pattern.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  async function handleSave() {
    if (daysOfWeek.length === 0) { setError('Select at least one day'); return }
    if (endTime <= startTime) { setError('End must be after start'); return }
    setSaving(true); setError('')
    try {
      await api.shiftPatterns.update(pattern.id, {
        daysOfWeek,
        startTime,
        endTime,
        intervalWeeks,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        note: note || null,
      }, token)
      onSaved()
    } catch {
      setError('Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Edit recurring shift</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <p className="text-[10px] text-gray-400">Future shifts will be regenerated from the new settings. Past shifts are kept as-is.</p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Repeat on</label>
          <div className="flex gap-1 flex-wrap">
            {([1, 2, 3, 4, 5, 6, 0] as const).map(d => (
              <button key={d} onClick={() => toggleDay(d)}
                className={`w-8 h-8 text-[11px] font-semibold rounded-full border transition-colors ${
                  daysOfWeek.includes(d) ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200 hover:border-gray-400'
                }`}>
                {DAY_LABELS[d].slice(0, 2)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Repeat every</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[1, 2, 3, 4].map(w => (
              <button key={w} onClick={() => setIntervalWeeks(w)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  intervalWeeks === w ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}>
                {w === 1 ? '1 week' : `${w} weeks`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Start</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">End</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">From</label>
            <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Until (opt.)</label>
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Opening shift"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 text-sm font-medium py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 text-sm font-medium py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save pattern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add recurring shift modal ─────────────────────────────────────────────────

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0] as const  // Mon first

function AddRecurringModal({ member, studioId, token, onSaved, onClose }: {
  member: StaffMember
  studioId: string
  token: string
  onSaved: () => void
  onClose: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1])  // Monday default
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [intervalWeeks, setIntervalWeeks] = useState(1)
  const [validFrom, setValidFrom] = useState(today)
  const [validUntil, setValidUntil] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(d: number) {
    setDaysOfWeek(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    )
  }

  async function handleSave() {
    if (daysOfWeek.length === 0) { setError('Select at least one day'); return }
    if (endTime <= startTime) { setError('End must be after start'); return }
    if (!validFrom) { setError('Start date is required'); return }
    setSaving(true); setError('')
    try {
      const res = await api.shiftPatterns.create({
        studioId,
        memberId: member.id,
        daysOfWeek,
        startTime,
        endTime,
        intervalWeeks,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        note: note || undefined,
      }, token)
      onSaved()
      // Brief toast-style feedback via alert — could be improved later
      if (res.shiftsGenerated > 0) {
        // success handled by parent reload
      }
    } catch {
      setError('Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recurring shift · {member.name.split(' ')[0]}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M12 4L4 12M4 4l8 8" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Day picker */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Repeat on</label>
          <div className="flex gap-1 flex-wrap">
            {ALL_DAYS.map(d => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className={`w-8 h-8 text-[11px] font-semibold rounded-full border transition-colors ${
                  daysOfWeek.includes(d)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {DAY_LABELS[d].slice(0, 2)}
              </button>
            ))}
          </div>
        </div>

        {/* Repeat interval */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Repeat every</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[1, 2, 3, 4].map(w => (
              <button
                key={w}
                onClick={() => setIntervalWeeks(w)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  intervalWeeks === w ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {w === 1 ? '1 week' : `${w} weeks`}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Start</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">End</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        {/* Date range */}
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">From</label>
            <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-gray-600">Until (opt.)</label>
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Opening shift"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 text-sm font-medium py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 text-sm font-medium py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Create pattern'}
          </button>
        </div>
      </div>
    </div>
  )
}
