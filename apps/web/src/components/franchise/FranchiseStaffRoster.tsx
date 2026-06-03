'use client'

import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api-client'
import LoginLinkButton from '@/components/LoginLinkButton'

// ── Payroll date helpers ──────────────────────────────────────────────────────

type Preset = 'this_month' | 'last_month' | 'custom'

function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function monthEnd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}
function toDateInput(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtRange(from: string, to: string) {
  const fmt = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(from)} – ${fmt(to)}`
}

type InstructorRate = {
  instructorId: string
  studioId: string
  studioName: string
  payRatePerHeadCents: number | null
}

type StaffMember = {
  id: string
  userId: string
  name: string
  email: string
  roles: string[]
  studios: { id: string; name: string }[]
  payRateHourlyCents: number | null
  instructorRates: InstructorRate[]
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function roleColor(role: string) {
  if (role === 'instructor') return 'bg-violet-50 text-violet-700'
  if (role === 'fronthost') return 'bg-blue-50 text-blue-700'
  return 'bg-gray-100 text-gray-500'
}

function roleLabel(role: string) {
  if (role === 'instructor') return 'Instructor'
  if (role === 'fronthost') return 'Front Desk'
  return role
}

// ── Inline pay rate editor ────────────────────────────────────────────────────

function PayInput({ label, initialCents, onSave }: {
  label: string
  initialCents: number | null
  onSave: (cents: number | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialCents != null ? (initialCents / 100).toFixed(2) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync displayed value when the parent reloads with fresh data
  useEffect(() => {
    if (!editing) setValue(initialCents != null ? (initialCents / 100).toFixed(2) : '')
  }, [initialCents, editing])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const cents = value.trim() === '' ? null : Math.round(parseFloat(value) * 100)
      await onSave(cents)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number" min="0" step="0.01" value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setEditing(false); setError(null) } }}
              className="w-24 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-900"
              autoFocus
            />
            <button onClick={handleSave} disabled={saving}
              className="text-xs font-medium text-white bg-gray-900 px-2.5 py-1 rounded hover:bg-gray-700 disabled:opacity-50 transition-colors">
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setError(null) }}
              className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="text-xs font-medium text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded transition-colors tabular-nums">
            {initialCents != null ? (initialCents / 100).toFixed(2) : 'Set rate'}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 mt-1 text-right">{error}</p>}
    </div>
  )
}

interface Props { token: string }

export default function FranchiseStaffRoster({ token }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'instructor' | 'fronthost'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Payroll export
  const now = new Date()
  const [preset, setPreset] = useState<Preset>('this_month')
  const [payFrom, setPayFrom] = useState(toDateInput(monthStart(now)))
  const [payTo, setPayTo] = useState(toDateInput(monthEnd(now)))
  const [downloading, setDownloading] = useState(false)

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'this_month') {
      const n = new Date()
      setPayFrom(toDateInput(monthStart(n)))
      setPayTo(toDateInput(monthEnd(n)))
    } else if (p === 'last_month') {
      const n = new Date()
      const lastMonth = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      setPayFrom(toDateInput(monthStart(lastMonth)))
      setPayTo(toDateInput(monthEnd(lastMonth)))
    }
  }

  async function downloadPayroll() {
    setDownloading(true)
    try {
      const from = new Date(payFrom + 'T00:00:00').toISOString()
      const to   = new Date(payTo   + 'T23:59:59').toISOString()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
      const res = await fetch(
        `${apiUrl}/admin/export/staff-pay?studioId=all&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `staff-pay_${payFrom}_${payTo}.csv`
      a.click()
    } catch {
      showToast('Failed to download payroll', false)
    } finally {
      setDownloading(false)
    }
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function reload() {
    return api.franchise.allStaff(token).then(res => {
      setStaff(res.items)
      setNextCursor(res.nextCursor)
      setHasMore(res.hasMore)
    }).catch(() => {})
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await api.franchise.allStaff(token, nextCursor)
      setStaff(prev => [...prev, ...res.items])
      setNextCursor(res.nextCursor)
      setHasMore(res.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    reload().finally(() => setLoading(false))
  }, [token])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return staff.filter(s => {
      if (roleFilter !== 'all' && !s.roles.includes(roleFilter)) return false
      if (q) return s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      return true
    })
  }, [staff, search, roleFilter])

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  if (!staff.length) {
    return <p className="text-sm text-gray-400 py-12 text-center">No staff members yet. Add instructors or front-desk staff to individual studios first.</p>
  }

  return (
    <div className="space-y-4">

      {/* Payroll export */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Download payroll</p>
          <span className="text-xs text-gray-400">{fmtRange(payFrom, payTo)}</span>
        </div>

        {/* Preset buttons */}
        <div className="flex gap-1.5 flex-wrap">
          {(['this_month', 'last_month', 'custom'] as Preset[]).map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                preset === p
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p === 'this_month' ? 'This month' : p === 'last_month' ? 'Last month' : 'Custom range'}
            </button>
          ))}
        </div>

        {/* Custom date inputs — only shown when custom is selected */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-8 shrink-0">From</label>
              <input
                type="date"
                value={payFrom}
                max={payTo}
                onChange={e => setPayFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-8 shrink-0">To</label>
              <input
                type="date"
                value={payTo}
                min={payFrom}
                onChange={e => setPayTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
          </div>
        )}

        <button
          onClick={downloadPayroll}
          disabled={downloading || !payFrom || !payTo}
          className="flex items-center gap-2 text-xs font-semibold bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
            <path d="M8 2v8M5 7l3 3 3-3M2 12h12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {downloading ? 'Downloading…' : `Download CSV (${fmtRange(payFrom, payTo)})`}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
            <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'instructor', 'fronthost'] as const).map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                roleFilter === r ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {r === 'all' ? 'All' : r === 'instructor' ? 'Instructors' : 'Front Desk'}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">{filtered.length} of {staff.length} staff</p>

      {/* Roster */}
      <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No results</p>
        ) : (
          filtered.map(s => {
            const isExpanded = expandedId === s.id
            return (
              <div key={s.id}>
                {/* Main row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : s.id)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400 truncate">{s.email}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {s.roles.map(r => (
                      <span key={r} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${roleColor(r)}`}>
                        {roleLabel(r)}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0 max-w-[180px] justify-end">
                    {s.studios.map(st => (
                      <span key={st.id} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {st.name}
                      </span>
                    ))}
                  </div>
                  <LoginLinkButton
                    onGenerate={() => api.franchise.loginLink(s.email, token).then(r => r.link)}
                    className="text-[10px] text-gray-400 hover:text-indigo-600 transition-colors shrink-0"
                  />
                  <svg className={`w-3.5 h-3.5 text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                {/* Expanded pay panel */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-1 bg-gray-50 border-t border-gray-100 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Pay rates</p>

                    {/* Hourly rate — fronthosts and studio admins */}
                    {(s.roles.includes('fronthost') || s.roles.includes('studio_admin')) && (
                      <PayInput
                        label={s.roles.includes('studio_admin') ? 'Hourly rate (admin)' : 'Hourly rate (front desk)'}
                        initialCents={s.payRateHourlyCents}
                        onSave={async cents => {
                          await api.staff.updateHourlyPayRate(s.id, cents, token)
                          await reload()
                          showToast('Hourly rate updated')
                        }}
                      />
                    )}

                    {/* Instructor: per-head rate per studio */}
                    {s.roles.includes('instructor') && s.instructorRates.length === 0 && (
                      <p className="text-xs text-gray-400">No instructor records found.</p>
                    )}
                    {s.roles.includes('instructor') && s.instructorRates.map(rate => (
                      <PayInput
                        key={rate.instructorId}
                        label={`Per-head rate — ${rate.studioName}`}
                        initialCents={rate.payRatePerHeadCents}
                        onSave={async cents => {
                          await api.staff.updateInstructorPayRate(rate.instructorId, cents, token)
                          await reload()
                          showToast('Per-head rate updated')
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

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
