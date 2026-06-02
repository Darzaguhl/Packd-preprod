'use client'

import { useState, useEffect } from 'react'
import { api, type NetworkWithStudios, type StudioSummary } from '@/lib/api-client'

interface Props {
  studios: StudioSummary[]
  token: string
  showToast: (msg: string, ok?: boolean) => void
}

export default function NetworksTab({ studios, token, showToast }: Props) {
  const [networks, setNetworks] = useState<NetworkWithStudios[]>([])
  const [form, setForm] = useState({ name: '', slug: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addingStudio, setAddingStudio] = useState<{ networkId: string; studioId: string } | null>(null)

  useEffect(() => {
    api.networks.list(token).then(setNetworks).catch(() => {})
  }, [token])

  return (
    <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Studio Networks</h2>
          <p className="text-sm text-gray-500 mt-0.5">Group studios so members can book across locations with shared credits.</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} className="text-sm font-medium px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 transition-colors">
          + New network
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Create network</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="Packd Network" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Slug (URL-safe)</label>
              <input className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                placeholder="packd-network" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAdd(false); setForm({ name: '', slug: '' }) }} className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              disabled={!form.name || !form.slug || adding}
              onClick={async () => {
                setAdding(true)
                try {
                  await api.networks.create(form, token)
                  setNetworks(await api.networks.list(token))
                  setShowAdd(false); setForm({ name: '', slug: '' })
                  showToast('Network created')
                } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
                finally { setAdding(false) }
              }}
              className="text-sm font-medium px-4 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-50"
            >{adding ? 'Creating…' : 'Create'}</button>
          </div>
        </div>
      )}

      {networks.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 py-8 text-center">No networks yet. Create one to link studios together.</p>
      )}

      {networks.map(network => (
        <div key={network.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Network header */}
          <div className="px-5 py-4 bg-gray-900 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
                  <path d="M12 7v4M12 11l-5 6M12 11l5 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-tight">{network.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">/{network.slug}</p>
              </div>
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Delete network "${network.name}"? Studios will be unlinked.`)) return
                try {
                  await api.networks.delete(network.id, token)
                  setNetworks(prev => prev.filter(n => n.id !== network.id))
                  showToast('Network deleted')
                } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
              }}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors"
            >Delete</button>
          </div>

          {/* Studios section */}
          <div className="px-5 pt-3 pb-1">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Member studios · {network.studios.length}
            </p>
          </div>

          <div className="divide-y divide-gray-50 mx-5 mb-3 border border-gray-100 rounded-xl overflow-hidden">
            {network.studios.length === 0 && (
              <p className="text-xs text-gray-400 px-4 py-3">No studios in this network yet.</p>
            )}
            {network.studios.map(m => (
              <div key={m.studioId} className="flex items-center justify-between px-4 py-3 bg-white">
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{m.studio.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{m.studio.slug}</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api.networks.removeStudio(network.id, m.studioId, token)
                      setNetworks(prev => prev.map(n => n.id === network.id ? { ...n, studios: n.studios.filter(s => s.studioId !== m.studioId) } : n))
                      showToast('Studio removed from network')
                    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded transition-colors"
                >Remove</button>
              </div>
            ))}
          </div>

          {/* Add studio row */}
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
            <select
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white flex-1"
              value={addingStudio?.networkId === network.id ? (addingStudio?.studioId ?? '') : ''}
              onChange={e => setAddingStudio(e.target.value ? { networkId: network.id, studioId: e.target.value } : null)}
            >
              <option value="">— add a studio —</option>
              {studios.filter(s => !network.studios.some(m => m.studioId === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              disabled={!addingStudio || addingStudio.networkId !== network.id}
              onClick={async () => {
                if (!addingStudio || addingStudio.networkId !== network.id) return
                try {
                  await api.networks.addStudio(network.id, addingStudio.studioId, token)
                  setNetworks(await api.networks.list(token))
                  setAddingStudio(null)
                  showToast('Studio added to network')
                } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
              }}
              className="text-sm font-medium px-4 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
            >Add</button>
          </div>
        </div>
      ))}
    </div>
  )
}
