'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { StudioSummary } from '@/lib/api'

type Admin = { id: string; userId: string; name: string; email: string; joinedAt: string }

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

interface Props {
  studios: StudioSummary[]
  token: string
}

export default function StudioAdminsTab({ studios, token }: Props) {
  const [selectedStudioId, setSelectedStudioId] = useState<string>(studios[0]?.id ?? '')
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    if (!selectedStudioId) return
    setLoading(true)
    setAdmins([])
    api.franchise.listAdmins(selectedStudioId, token)
      .then(setAdmins)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedStudioId, token])

  async function handleAdd() {
    if (!selectedStudioId || !email.trim()) return
    setAddError(null)
    setAdding(true)
    try {
      await api.franchise.addAdmin(selectedStudioId, email.trim(), token)
      const fresh = await api.franchise.listAdmins(selectedStudioId, token)
      setAdmins(fresh)
      setEmail('')
      showToast(`Studio admin added`)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add admin')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(admin: Admin) {
    if (!confirm(`Remove ${admin.name} as studio admin? They will lose management access.`)) return
    setRemovingId(admin.userId)
    try {
      await api.franchise.removeAdmin(selectedStudioId, admin.userId, token)
      setAdmins(prev => prev.filter(a => a.userId !== admin.userId))
      showToast(`${admin.name} removed`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to remove admin', false)
    } finally {
      setRemovingId(null)
    }
  }

  const selectedStudio = studios.find(s => s.id === selectedStudioId)

  return (
    <div className="space-y-5">
      {/* Studio selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-700 shrink-0">Studio</span>
        <select
          value={selectedStudioId}
          onChange={e => setSelectedStudioId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
        >
          {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {selectedStudio && (
        <>
          <p className="text-sm text-gray-500">
            Studio admins can manage schedules, staff, rooms, and settings for <strong>{selectedStudio.name}</strong>.
            They cannot manage other studios or franchise-level settings.
          </p>

          {/* Add admin form */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-900">Add studio admin</p>
            <p className="text-xs text-gray-500">The user must already have a Packd account. Enter their email address.</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setAddError(null) }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="admin@example.com"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !email.trim()}
                className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
              >
                {adding ? 'Adding…' : 'Add admin'}
              </button>
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
          </div>

          {/* Current admins list */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50">
              <p className="text-sm font-semibold text-gray-900">
                Current admins
                {!loading && admins.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">{admins.length}</span>
                )}
              </p>
            </div>

            {loading ? (
              <div className="p-5 space-y-3">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : admins.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-gray-400">No studio admins yet</p>
                <p className="text-xs text-gray-300 mt-1">Add one using the form above</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {admins.map(admin => (
                  <div key={admin.userId} className="flex items-center gap-3 px-5 py-3">
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-semibold shrink-0 select-none">
                      {initials(admin.name)}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{admin.name}</p>
                      <p className="text-xs text-gray-400 truncate">{admin.email}</p>
                    </div>

                    {/* Admin badge */}
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0">
                      Studio admin
                    </span>

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemove(admin)}
                      disabled={removingId === admin.userId}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
                      title="Remove admin"
                    >
                      {removingId === admin.userId ? (
                        <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                      ) : (
                        'Remove'
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Toast */}
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
