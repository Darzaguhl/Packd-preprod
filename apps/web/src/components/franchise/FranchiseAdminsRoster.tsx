'use client'

import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import type { StudioSummary } from '@/lib/api'

type Admin = {
  userId: string
  name: string
  email: string
  studios: { id: string; name: string }[]
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

interface Props {
  studios: StudioSummary[]
  token: string
}

export default function FranchiseAdminsRoster({ studios, token }: Props) {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addStudioId, setAddStudioId] = useState(studios[0]?.id ?? '')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  function reload() {
    return api.franchise.allAdmins(token).then(setAdmins).catch(() => {})
  }

  useEffect(() => {
    reload().finally(() => setLoading(false))
  }, [token])

  async function handleAdd() {
    if (!addEmail.trim() || !addStudioId) return
    setAddError(null)
    setAdding(true)
    try {
      await api.franchise.addAdmin(addStudioId, addEmail.trim(), token)
      await reload()
      setAddEmail('')
      showToast('Studio admin added')
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add admin')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemoveFromStudio(admin: Admin, studioId: string) {
    const studio = studios.find(s => s.id === studioId)
    if (!confirm(`Remove ${admin.name} as admin of ${studio?.name ?? studioId}?`)) return
    try {
      await api.franchise.removeAdmin(studioId, admin.userId, token)
      await reload()
      showToast(`Removed from ${studio?.name ?? studioId}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return admins
    return admins.filter(a => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
  }, [admins, search])

  return (
    <div className="space-y-5">
      {/* Add admin */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Add studio admin</p>
        <p className="text-xs text-gray-500">The user must already have a Packd account.</p>
        <div className="flex gap-2">
          <select
            value={addStudioId}
            onChange={e => setAddStudioId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 shrink-0"
          >
            {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input
            type="email"
            value={addEmail}
            onChange={e => { setAddEmail(e.target.value); setAddError(null) }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="admin@example.com"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !addEmail.trim() || !addStudioId}
            className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && <p className="text-xs text-red-500">{addError}</p>}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
          <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search admins…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
        />
      </div>

      {/* Roster */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">
          {admins.length === 0 ? 'No studio admins yet.' : 'No results.'}
        </p>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
          {filtered.map(admin => (
            <div key={admin.userId} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                {initials(admin.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{admin.name}</p>
                <p className="text-xs text-gray-400 truncate">{admin.email}</p>
              </div>
              {/* Studio chips — click to remove from that studio */}
              <div className="flex flex-wrap gap-1 justify-end max-w-[240px]">
                {admin.studios.map(st => (
                  <button
                    key={st.id}
                    onClick={() => handleRemoveFromStudio(admin, st.id)}
                    title={`Remove from ${st.name}`}
                    className="group flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    {st.name}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">×</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
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
