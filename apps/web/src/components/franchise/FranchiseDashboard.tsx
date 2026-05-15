'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type StudioSummary } from '@/lib/api'
import PermissionsTab from '@/components/studio/PermissionsTab'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'
import NavBar from '@/components/NavBar'

type Tab = 'studios' | 'permissions'

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
  const [tab, setTab] = useState<Tab>('studios')
  const [token, setToken] = useState<string | null>(null)
  const [studios, setStudios] = useState<StudioSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [permStudio, setPermStudio] = useState<StudioSummary | null>(null)

  // Drill-in state: when set, renders StudioManagerDashboard for this studio
  const [activeStudio, setActiveStudio] = useState<StudioSummary | null>(null)

  // Add studio modal
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddStudioForm>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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
        return api.franchise.studios(t)
      })
      .then(data => { if (data) setStudios(data) })
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
      if (activeStudio?.id === studioId) setActiveStudio(null)
      showToast('Studio deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete studio', false)
    } finally {
      setDeleteConfirm(null)
    }
  }

  // If a studio is active (drilled in), show StudioManagerDashboard
  if (activeStudio && token) {
    return (
      <StudioManagerDashboard
        studioId={activeStudio.id}
        studioName={activeStudio.name}
        onBack={() => setActiveStudio(null)}
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
    { id: 'permissions', label: 'Permissions' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar title="Franchise Dashboard" subtitle="All studios">
        <div className="flex gap-1 -mb-px">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
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
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Today</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold tabular-nums text-gray-900">{studio.instructorCount}</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Instructors</p>
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
                      onClick={() => setActiveStudio(studio)}
                      className="flex-1 text-xs font-medium text-white bg-gray-900 rounded-lg px-3 py-2 hover:bg-gray-700 transition-colors"
                    >
                      Manage studio
                    </button>
                    <button
                      onClick={() => { setPermStudio(studio); setTab('permissions') }}
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
