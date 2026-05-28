'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type StudioSummary, type NetworkWithStudios } from '@/lib/api'
import PermissionsTab from '@/components/studio/PermissionsTab'
import StaffTab from '@/components/studio/StaffTab'
import StudioAdminsTab from './StudioAdminsTab'
import AdminShell from '@/components/admin/AdminShell'
import NavBar from '@/components/NavBar'
import AnalyticsTab from '@/components/studio/AnalyticsTab'

type Tab = 'studios' | 'admins' | 'staff' | 'permissions' | 'analytics' | 'networks'

const TIMEZONES = [
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Stockholm', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Rome', 'Europe/Madrid',
  'Europe/Warsaw', 'Europe/Athens', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City',
  'America/Buenos_Aires', 'Pacific/Honolulu',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
  'Pacific/Auckland', 'UTC',
]

const CURRENCIES = [
  'AED', 'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'QAR', 'RON', 'SAR', 'SEK', 'SGD', 'THB', 'TRY',
  'TWD', 'UAH', 'USD', 'ZAR',
]

function FillBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden w-full">
      <div
        className={`h-full rounded-full ${pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

interface AddStudioForm {
  name: string; slug: string; timezone: string; currency: string
  locationName: string; address: string; city: string; country: string
}

const EMPTY_FORM: AddStudioForm = {
  name: '', slug: '', timezone: 'Europe/Stockholm', currency: 'SEK',
  locationName: 'Main Location', address: '', city: '', country: '',
}

export default function FranchiseDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab) ?? 'studios')
  const [token, setToken] = useState<string | null>(null)
  const [studios, setStudios] = useState<StudioSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [permStudio, setPermStudio] = useState<StudioSummary | null>(null)

  // Drill-in state: when set, renders StudioManagerDashboard for this studio
  const [activeStudio, setActiveStudio] = useState<StudioSummary | null>(null)
  // Restore activeStudio from URL after studios load
  const [pendingStudioId] = useState<string | null>(() => searchParams.get('studio'))

  function changeTab(next: Tab, studioId?: string) {
    setTab(next)
    const p = new URLSearchParams()
    p.set('tab', next)
    if (studioId) p.set('studio', studioId)
    router.replace(`?${p.toString()}`)
  }

  // Add studio modal
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddStudioForm>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // ── Networks state ───────────────────────────────────────────────────────────
  const [networks, setNetworks] = useState<NetworkWithStudios[]>([])
  const [networkForm, setNetworkForm] = useState({ name: '', slug: '' })
  const [showNetworkAdd, setShowNetworkAdd] = useState(false)
  const [networkAdding, setNetworkAdding] = useState(false)
  // studioId being added to a specific network
  const [addingStudio, setAddingStudio] = useState<{ networkId: string; studioId: string } | null>(null)

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const t = session?.access_token ?? null
        setToken(t)
        if (!t) return
        // Ensure the franchise admin has a Member record so they can be booked into
        // classes and appear in member search. Fire-and-forget — non-blocking.
        api.members.ensure(t).catch(() => {})
        // Load studios + networks in parallel
        api.networks.list(t).then(setNetworks).catch(() => {})
        return api.franchise.studios(t)
      })
      .then(data => {
        if (data) {
          setStudios(data)
          // Restore drilled-in studio from URL on refresh
          if (pendingStudioId) {
            const match = data.find(s => s.id === pendingStudioId)
            if (match) setActiveStudio(match)
          }
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Auto-generate slug from name
  function handleNameChange(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setForm(f => ({ ...f, name, slug }))
  }

  async function handleAddStudio() {
    if (!token) return
    setAddError(null)
    if (!form.name || !form.slug || !form.city || !form.country) {
      setAddError('Name, slug, city and country are required')
      return
    }
    setAdding(true)
    try {
      const res = await api.studios.create({
        name: form.name,
        slug: form.slug,
        timezone: form.timezone,
        currency: form.currency,
        location: { name: form.locationName, address: form.address, city: form.city, country: form.country },
      }, token)
      if (res.success) {
        // Reload studios list
        const fresh = await api.franchise.studios(token)
        setStudios(fresh)
        setShowAdd(false)
        setForm(EMPTY_FORM)
        showToast(`Studio "${form.name}" created`)
      }
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to create studio')
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteStudio(studioId: string) {
    if (!token) return
    try {
      await api.studios.delete(studioId, token)
      setStudios(prev => prev.filter(s => s.id !== studioId))
      if (activeStudio?.id === studioId) { setActiveStudio(null); changeTab('studios') }
      showToast('Studio deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete studio', false)
    } finally {
      setDeleteConfirm(null)
    }
  }

  // If a studio is active (drilled in), show the admin shell with mode switcher
  if (activeStudio && token) {
    return (
      <AdminShell
        studioId={activeStudio.id}
        studioName={activeStudio.name}
        onBack={() => { setActiveStudio(null); changeTab('studios') }}
        onStudioUpdate={(data) => {
          setStudios(prev => prev.map(s =>
            s.id === activeStudio.id ? { ...s, ...data } : s
          ))
          setActiveStudio(prev => prev ? { ...prev, ...data } : prev)
        }}
      />
    )
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'studios', label: 'Studios' },
    { id: 'networks', label: 'Networks' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'admins', label: 'Studio Admins' },
    { id: 'staff', label: 'Staff' },
    { id: 'permissions', label: 'Permissions' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar title="Franchise Dashboard" subtitle="All studios">
        <div className="flex gap-1 -mb-px">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </NavBar>

      {/* Studios tab */}
      {tab === 'studios' && (
        <div className="max-w-6xl mx-auto w-full px-6 py-6 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{studios.length} studio{studios.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => setShowAdd(v => !v)}
              className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
            >
              + Add studio
            </button>
          </div>

          {/* Add studio form */}
          {showAdd && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
              <p className="text-sm font-semibold text-gray-900">New studio</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-medium">Studio name *</label>
                  <input value={form.name} onChange={e => handleNameChange(e.target.value)}
                    placeholder="e.g. Packd Stockholm"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-medium">Slug (URL) *</label>
                  <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="e.g. packd-stockholm"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-medium">Timezone</label>
                  <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white">
                    {TIMEZONES.map(tz => <option key={tz}>{tz}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-medium">Currency</label>
                  <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white">
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-1">
                <p className="text-xs font-medium text-gray-500">Location</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="City *"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                  <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="Country *"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                  <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Address"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 sm:col-span-2" />
                </div>
              </div>

              {addError && <p className="text-xs text-red-500">{addError}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setAddError(null) }}
                  className="text-xs text-gray-500 hover:text-gray-800 px-3 py-2">
                  Cancel
                </button>
                <button onClick={handleAddStudio} disabled={adding}
                  className="text-xs font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
                  {adding ? 'Creating…' : 'Create studio'}
                </button>
              </div>
            </div>
          )}

          {/* Studio cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-48 bg-white rounded-2xl animate-pulse border border-gray-100" />
              ))}
            </div>
          ) : studios.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-sm">No studios yet. Create one above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {studios.map(studio => (
                <div key={studio.id} className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-200 hover:shadow-sm transition-all">
                  {/* Studio name + timezone */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-gray-900 truncate">{studio.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{studio.timezone} · {studio.currency}</p>
                    </div>
                    {/* Delete */}
                    {deleteConfirm === studio.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500">Delete?</span>
                        <button onClick={() => handleDeleteStudio(studio.id)} className="text-xs text-red-600 font-medium hover:text-red-800">Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(studio.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0 p-1" title="Delete studio">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xl font-bold tabular-nums text-gray-900">{studio.memberCount}</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Members</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold tabular-nums text-gray-900">{studio.todaySessionCount}</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Classes today</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold tabular-nums text-gray-900">{studio.staffCount}</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Staff</p>
                    </div>
                  </div>

                  {/* Fill rate */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">Fill rate today</span>
                      <span className="text-xs font-semibold text-gray-700">{studio.fillRateToday}%</span>
                    </div>
                    <FillBar pct={studio.fillRateToday} />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setActiveStudio(studio); changeTab('studios', studio.id) }}
                      className="flex-1 text-xs font-medium text-white bg-gray-900 rounded-lg px-3 py-2 hover:bg-gray-700 transition-colors"
                    >
                      Manage studio
                    </button>
                    <button
                      onClick={() => { setPermStudio(studio); changeTab('permissions') }}
                      className="text-xs font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-400 hover:text-gray-800 transition-colors"
                    >
                      Permissions
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Networks tab */}
      {tab === 'networks' && token && (
        <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Studio Networks</h2>
              <p className="text-sm text-gray-500 mt-0.5">Group studios so members can book across locations with shared credits.</p>
            </div>
            <button
              onClick={() => setShowNetworkAdd(v => !v)}
              className="text-sm font-medium px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 transition-colors"
            >+ New network</button>
          </div>

          {showNetworkAdd && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Create network</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                  <input
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="Packd Network"
                    value={networkForm.name}
                    onChange={e => setNetworkForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Slug (URL-safe)</label>
                  <input
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="packd-network"
                    value={networkForm.slug}
                    onChange={e => setNetworkForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowNetworkAdd(false); setNetworkForm({ name: '', slug: '' }) }}
                  className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
                >Cancel</button>
                <button
                  disabled={!networkForm.name || !networkForm.slug || networkAdding}
                  onClick={async () => {
                    if (!token || !networkForm.name || !networkForm.slug) return
                    setNetworkAdding(true)
                    try {
                      await api.networks.create(networkForm, token)
                      const updated = await api.networks.list(token)
                      setNetworks(updated)
                      setShowNetworkAdd(false)
                      setNetworkForm({ name: '', slug: '' })
                      showToast('Network created')
                    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
                    finally { setNetworkAdding(false) }
                  }}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-50"
                >{networkAdding ? 'Creating…' : 'Create'}</button>
              </div>
            </div>
          )}

          {networks.length === 0 && !showNetworkAdd && (
            <p className="text-sm text-gray-400 py-8 text-center">No networks yet. Create one to link studios together.</p>
          )}

          {networks.map(network => (
            <div key={network.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{network.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">/{network.slug} · {network.studios.length} studio{network.studios.length !== 1 ? 's' : ''}</p>
                </div>
                <button
                  onClick={async () => {
                    if (!token) return
                    if (!confirm(`Delete network "${network.name}"? Studios will be unlinked.`)) return
                    try {
                      await api.networks.delete(network.id, token)
                      setNetworks(prev => prev.filter(n => n.id !== network.id))
                      showToast('Network deleted')
                    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
                  }}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded"
                >Delete</button>
              </div>

              {/* Member studios */}
              <div className="divide-y divide-gray-50">
                {network.studios.map(m => (
                  <div key={m.studioId} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{m.studio.name}</p>
                      <p className="text-xs text-gray-400">{m.studio.slug}</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!token) return
                        try {
                          await api.networks.removeStudio(network.id, m.studioId, token)
                          setNetworks(prev => prev.map(n =>
                            n.id === network.id ? { ...n, studios: n.studios.filter(s => s.studioId !== m.studioId) } : n
                          ))
                          showToast('Studio removed from network')
                        } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
                      }}
                      className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded transition-colors"
                    >Remove</button>
                  </div>
                ))}
              </div>

              {/* Add studio to network */}
              <div className="px-5 py-3 bg-gray-50 flex items-center gap-3">
                <select
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white flex-1"
                  value={addingStudio?.networkId === network.id ? (addingStudio?.studioId ?? '') : ''}
                  onChange={e => setAddingStudio(e.target.value ? { networkId: network.id, studioId: e.target.value } : null)}
                >
                  <option value="">— add a studio —</option>
                  {studios
                    .filter(s => !network.studios.some(m => m.studioId === s.id))
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                  }
                </select>
                <button
                  disabled={!addingStudio || addingStudio.networkId !== network.id}
                  onClick={async () => {
                    if (!token || !addingStudio || addingStudio.networkId !== network.id) return
                    try {
                      await api.networks.addStudio(network.id, addingStudio.studioId, token)
                      const updated = await api.networks.list(token)
                      setNetworks(updated)
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
      )}

      {/* Analytics tab — franchise-wide with studio picker */}
      {tab === 'analytics' && token && (
        <AnalyticsTab
          studioId="all"
          token={token}
          canQuery={false}
          studios={studios.map(s => ({ id: s.id, name: s.name }))}
        />
      )}

      {/* Studio Admins tab */}
      {tab === 'admins' && token && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6">
          {studios.length === 0 ? (
            <p className="text-sm text-gray-400">No studios yet. Create a studio first.</p>
          ) : (
            <StudioAdminsTab studios={studios} token={token} />
          )}
        </div>
      )}

      {/* Staff tab */}
      {tab === 'staff' && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-700">Studio</span>
            <select
              value={permStudio?.id ?? ''}
              onChange={e => setPermStudio(studios.find(s => s.id === e.target.value) ?? null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            >
              <option value="">— select a studio —</option>
              {studios.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {permStudio && token ? (
            <>
              <p className="text-sm text-gray-500">
                Manage instructors and front-desk staff for <strong>{permStudio.name}</strong>.
              </p>
              <StaffTab
                studioId={permStudio.id}
                token={token}
                onOpenPermissions={() => changeTab('permissions')}
              />
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a studio above to manage staff.</p>
          )}
        </div>
      )}

      {/* Permissions tab */}
      {tab === 'permissions' && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-700">Studio</span>
            <select
              value={permStudio?.id ?? ''}
              onChange={e => setPermStudio(studios.find(s => s.id === e.target.value) ?? null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            >
              <option value="">— select a studio —</option>
              {studios.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {permStudio && token ? (
            <>
              <p className="text-sm text-gray-500">
                Configure what each instructor can do in <strong>{permStudio.name}</strong>.
              </p>
              <PermissionsTab studioId={permStudio.id} token={token} />
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a studio above to manage instructor permissions.</p>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
