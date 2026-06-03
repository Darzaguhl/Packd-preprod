'use client'

import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api-client'
import type { StudioSummary } from '@/lib/api-client'
import LoginLinkButton from '@/components/LoginLinkButton'

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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [assignStudioId, setAssignStudioId] = useState<Record<string, string>>({})
  const [assigning, setAssigning] = useState<string | null>(null)

  // Invite form
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteStudioId, setInviteStudioId] = useState(studios[0]?.id ?? '')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  function reload() {
    return api.franchise.allAdmins(token).then(r => setAdmins(r.items)).catch(() => {})
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

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim() || !inviteFirstName.trim() || !inviteStudioId) return
    setInviting(true)
    setInviteMsg(null)
    try {
      const res = await api.staff.invite(inviteEmail.trim(), inviteFirstName.trim(), 'studio_admin', inviteStudioId, token)
      setInviteMsg({ ok: true, text: res.message })
      setInviteEmail('')
      setInviteFirstName('')
    } catch (e) {
      setInviteMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to send invite' })
    } finally {
      setInviting(false)
    }
  }

  async function handleAssignToStudio(admin: Admin, studioId: string) {
    if (!studioId) return
    setAssigning(admin.userId)
    try {
      await api.franchise.addAdmin(studioId, admin.email, token)
      await reload()
      showToast(`Assigned to ${studios.find(s => s.id === studioId)?.name ?? studioId}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to assign', false)
    } finally {
      setAssigning(null)
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

      {/* Invite someone new */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-gray-900">Invite someone new</p>
          <button
            onClick={() => { setShowInvite(v => !v); setInviteMsg(null) }}
            className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            {showInvite ? 'Hide' : 'Show'}
          </button>
        </div>
        {!showInvite ? (
          <p className="text-xs text-gray-400">Send an invitation email to someone who doesn't have a Packd account yet.</p>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-4">They'll receive an email with a link to sign up and join as a studio admin.</p>
            <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="First name"
                value={inviteFirstName}
                onChange={e => setInviteFirstName(e.target.value)}
                required
                className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <input
                type="email"
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                required
                className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <select
                value={inviteStudioId}
                onChange={e => setInviteStudioId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shrink-0"
              >
                {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim() || !inviteFirstName.trim()}
                className="text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {inviteMsg && (
              <p className={`mt-3 text-xs ${inviteMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{inviteMsg.text}</p>
            )}
          </>
        )}
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
          {filtered.map(admin => {
            const isExpanded = expandedId === admin.userId
            const unassignedStudios = studios.filter(s => !admin.studios.find(a => a.id === s.id))
            const currentAssignId = assignStudioId[admin.userId] ?? unassignedStudios[0]?.id ?? ''
            return (
              <div key={admin.userId}>
                {/* Summary row — click to expand */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : admin.userId)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(admin.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{admin.name}</p>
                    <p className="text-xs text-gray-400 truncate">{admin.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[200px]">
                    {admin.studios.map(st => (
                      <span key={st.id} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                        {st.name}
                      </span>
                    ))}
                    {admin.studios.length === 0 && (
                      <span className="text-[10px] text-gray-400">No studios</span>
                    )}
                  </div>
                  <LoginLinkButton
                    onGenerate={() => api.franchise.loginLink(admin.email, token).then(r => r.link)}
                    className="text-[10px] text-gray-400 hover:text-indigo-600 transition-colors shrink-0"
                  />
                  <svg
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                {/* Expanded management panel */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-1 bg-gray-50 border-t border-gray-100 space-y-3">
                    {/* Current studios */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Studio access</p>
                      {admin.studios.length === 0 ? (
                        <p className="text-xs text-gray-400">Not assigned to any studio.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {admin.studios.map(st => (
                            <div key={st.id} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700">
                              {st.name}
                              <button
                                onClick={() => handleRemoveFromStudio(admin, st.id)}
                                title={`Remove from ${st.name}`}
                                className="text-gray-300 hover:text-red-500 transition-colors font-bold leading-none"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Assign to another studio */}
                    {unassignedStudios.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2">Assign to another studio</p>
                        <div className="flex gap-2">
                          <select
                            value={currentAssignId}
                            onChange={e => setAssignStudioId(prev => ({ ...prev, [admin.userId]: e.target.value }))}
                            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                          >
                            {unassignedStudios.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignToStudio(admin, currentAssignId)}
                            disabled={assigning === admin.userId || !currentAssignId}
                            className="text-xs font-medium bg-gray-900 text-white px-4 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
                          >
                            {assigning === admin.userId ? 'Assigning…' : 'Assign'}
                          </button>
                        </div>
                      </div>
                    )}
                    {unassignedStudios.length === 0 && (
                      <p className="text-xs text-gray-400">Assigned to all studios in the franchise.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
