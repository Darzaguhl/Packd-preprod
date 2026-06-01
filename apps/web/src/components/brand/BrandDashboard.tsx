'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type Brand, type BrandStats, type BrandMember, type BrandSession, type BrandFranchise } from '@/lib/api-client'

type Tab = 'overview' | 'members' | 'classes' | 'franchises'
type Period = '7d' | '30d' | '90d'

const PERIOD_LABELS: Record<Period, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

function SportDot({ sport }: { sport: string }) {
  const colors: Record<string, string> = {
    Cycling: 'bg-orange-400', Yoga: 'bg-purple-400', HIIT: 'bg-red-400',
    Pilates: 'bg-pink-400', Boxing: 'bg-yellow-400', Running: 'bg-green-400',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[sport] ?? 'bg-gray-400'}`} />
}

function FranchiseCard({
  franchise,
  brandId,
  token,
  stats,
  onAdminPromoted,
}: {
  franchise: BrandFranchise
  brandId: string
  token: string
  stats: BrandStats | null
  onAdminPromoted: () => void
}) {
  const [showAdminForm, setShowAdminForm] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminFirstName, setAdminFirstName] = useState('')
  const [adminLastName, setAdminLastName] = useState('')
  const [promoting, setPromoting] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null)

  const franchiseStats = stats?.perStudio.filter(s =>
    franchise.studios.some(fs => fs.id === s.id)
  ) ?? []
  const totalMembers = franchiseStats.reduce((n, s) => n + s.members, 0)
  const totalBookings = franchiseStats.reduce((n, s) => n + s.bookings, 0)

  async function handlePromote() {
    if (!adminEmail.trim()) return
    setPromoting(true)
    setAdminError(null)
    setAdminSuccess(null)
    try {
      const res = await api.brands.promoteFranchiseAdmin(brandId, {
        email: adminEmail.trim(),
        franchiseId: franchise.id,
        firstName: adminFirstName.trim() || undefined,
        lastName: adminLastName.trim() || undefined,
      }, token)
      setAdminEmail('')
      setAdminFirstName('')
      setAdminLastName('')
      setShowAdminForm(false)
      setAdminSuccess(res.message ?? 'Done')
      onAdminPromoted()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to assign franchise admin')
    } finally {
      setPromoting(false)
    }
  }

  function closeAdminForm() {
    setShowAdminForm(false)
    setAdminError(null)
    setAdminSuccess(null)
    setAdminEmail('')
    setAdminFirstName('')
    setAdminLastName('')
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Franchise header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-50">
        <div>
          <h3 className="font-semibold text-gray-900">{franchise.name}</h3>
          {franchise.description && <p className="text-xs text-gray-400 mt-0.5">{franchise.description}</p>}
          <p className="text-xs text-gray-400 mt-0.5">{franchise.studios.length} studio{franchise.studios.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-3 text-xs text-gray-500 text-right">
          <div>
            <p className="font-semibold text-gray-900 text-sm">{totalMembers.toLocaleString()}</p>
            <p>members</p>
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">{totalBookings.toLocaleString()}</p>
            <p>bookings</p>
          </div>
        </div>
      </div>

      {/* Studios */}
      {franchise.studios.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
          {franchise.studios.map(studio => (
            <div key={studio.id} className="border border-gray-100 rounded-lg px-3 py-2 flex items-center gap-2">
              {studio.primaryColor && (
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: studio.primaryColor }} />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{studio.name}</p>
                <p className="text-xs text-gray-400">{studio.timezone}</p>
              </div>
              {studio.memberCount !== undefined && (
                <span className="ml-auto text-xs text-gray-400 shrink-0">{studio.memberCount} members</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Franchise admin section */}
      <div className="border-t border-gray-50 px-4 py-3">
        {adminSuccess && !showAdminForm ? (
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-emerald-600">{adminSuccess}</p>
            <button onClick={() => setAdminSuccess(null)} className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">×</button>
          </div>
        ) : !showAdminForm && franchise.admin ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-semibold shrink-0">
                {(franchise.admin.firstName?.[0] ?? franchise.admin.email[0]).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-700">
                  {franchise.admin.firstName} {franchise.admin.lastName}
                </p>
                <p className="text-[10px] text-gray-400">{franchise.admin.email}</p>
              </div>
            </div>
            <button
              onClick={() => setShowAdminForm(true)}
              className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
            >
              Change
            </button>
          </div>
        ) : showAdminForm ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Assign franchise admin</p>
            <p className="text-xs text-gray-400">
              Enter their email address. If they don't have a Packd account yet, also provide their name — an account will be created and they can set their password via "Forgot password".
            </p>
            <input
              type="email"
              placeholder="Email address"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="First name (if new account)"
                value={adminFirstName}
                onChange={e => setAdminFirstName(e.target.value)}
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
              <input
                type="text"
                placeholder="Last name"
                value={adminLastName}
                onChange={e => setAdminLastName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePromote()}
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePromote}
                disabled={!adminEmail.trim() || promoting}
                className="px-3 py-1.5 bg-black text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-800 transition-colors"
              >
                {promoting ? '…' : 'Assign'}
              </button>
              <button onClick={closeAdminForm} className="text-xs text-gray-400 hover:text-gray-600 px-2">
                Cancel
              </button>
            </div>
            {adminError && <p className="text-xs text-red-500">{adminError}</p>}
          </div>
        ) : (
          <button
            onClick={() => setShowAdminForm(true)}
            className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            + Assign franchise admin
          </button>
        )}
      </div>
    </div>
  )
}

export default function BrandDashboard() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [stats, setStats] = useState<BrandStats | null>(null)
  const [members, setMembers] = useState<BrandMember[]>([])
  const [sessions, setSessions] = useState<BrandSession[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [period, setPeriod] = useState<Period>('30d')
  const [memberSearch, setMemberSearch] = useState('')
  const [franchiseFilter, setFranchiseFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(false)

  // New franchise form
  const [showNewFranchise, setShowNewFranchise] = useState(false)
  const [franchiseForm, setFranchiseForm] = useState({ name: '', slug: '', description: '' })
  const [creatingFranchise, setCreatingFranchise] = useState(false)

  const allStudios = brand?.franchises.flatMap(f => f.studios) ?? []
  const filteredStudioIds = franchiseFilter === 'ALL'
    ? allStudios.map(s => s.id)
    : brand?.franchises.find(f => f.id === franchiseFilter)?.studios.map(s => s.id) ?? []

  async function loadBrand(t: string) {
    try {
      const res = await api.brands.my(t)
      if (res.success) setBrand(res.data)
    } catch { /* no brand configured */ }
  }

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) return setLoading(false)
      await loadBrand(t)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!brand || !token) return
    setStatsLoading(true)
    api.brands.stats(brand.id, period, token)
      .then(res => { if (res.success) setStats(res.data) })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [brand, period, token])

  useEffect(() => {
    if (tab !== 'classes' || !brand || !token) return
    const studioId = filteredStudioIds.length === 1 ? filteredStudioIds[0] : undefined
    api.brands.sessions(brand.id, { studioId }, token)
      .then(res => { if (res.success) setSessions(res.data) })
      .catch(() => {})
  }, [tab, brand, token, franchiseFilter])

  useEffect(() => {
    if (tab !== 'members' || !brand || !token) return
    const tid = setTimeout(() => {
      const studioId = filteredStudioIds.length === 1 ? filteredStudioIds[0] : undefined
      api.brands.members(brand.id, { q: memberSearch || undefined, studioId }, token)
        .then(res => { if (res.success) setMembers(res.data) })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(tid)
  }, [tab, brand, token, memberSearch, franchiseFilter])

  async function handleLogout() {
    await createClient().auth.signOut()
    router.push('/login')
  }

  async function handleCreateFranchise() {
    if (!brand || !token || !franchiseForm.name || !franchiseForm.slug) return
    setCreatingFranchise(true)
    try {
      await api.brands.createFranchise(brand.id, franchiseForm, token)
      await loadBrand(token)
      setFranchiseForm({ name: '', slug: '', description: '' })
      setShowNewFranchise(false)
    } finally {
      setCreatingFranchise(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!brand) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-gray-500 text-sm">No brand configured for your account.</p>
          <p className="text-gray-400 text-xs">Contact your Packd administrator.</p>
          <button onClick={handleLogout} className="mt-4 text-xs text-gray-400 hover:text-gray-700 underline">
            Log out
          </button>
        </div>
      </div>
    )
  }

  const totalStudios = brand.franchises.reduce((n, f) => n + f.studios.length, 0)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'franchises', label: `Franchises (${brand.franchises.length})` },
    { id: 'members', label: 'Members' },
    { id: 'classes', label: 'Classes' },
  ]

  const FranchiseFilter = () => (
    <select
      value={franchiseFilter}
      onChange={e => setFranchiseFilter(e.target.value)}
      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
    >
      <option value="ALL">All franchises</option>
      {brand.franchises.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white font-bold text-sm">
                {brand.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">{brand.name}</h1>
              <p className="text-xs text-gray-400">
                {brand.franchises.length} franchise{brand.franchises.length !== 1 ? 's' : ''} · {totalStudios} studio{totalStudios !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
          >
            Log out
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 flex gap-1 -mb-px">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Performance</h2>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {statsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse h-20" />)}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total members', value: stats.totals.members.toLocaleString() },
                  { label: `Bookings (${PERIOD_LABELS[period]})`, value: stats.totals.bookings.toLocaleString() },
                  { label: 'Sessions scheduled', value: stats.totals.sessions.toLocaleString() },
                  { label: 'Credits issued', value: stats.totals.creditsIssued.toLocaleString() },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-4">
                    <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{kpi.label}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-3">
              {brand.franchises.map(franchise => {
                const franchiseStats = stats?.perStudio.filter(s => franchise.studios.some(fs => fs.id === s.id)) ?? []
                const totalMem = franchiseStats.reduce((n, s) => n + s.members, 0)
                const totalBook = franchiseStats.reduce((n, s) => n + s.bookings, 0)
                return (
                  <div key={franchise.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                      <span className="font-semibold text-gray-900">{franchise.name}
                        <span className="ml-2 text-xs font-normal text-gray-400">{franchise.studios.length} studio{franchise.studios.length !== 1 ? 's' : ''}</span>
                      </span>
                      <div className="flex gap-4 text-xs text-gray-500">
                        <span><span className="font-semibold text-gray-900">{totalMem.toLocaleString()}</span> members</span>
                        <span><span className="font-semibold text-gray-900">{totalBook.toLocaleString()}</span> bookings</span>
                      </div>
                    </div>
                    {franchise.studios.map(studio => (
                      <div key={studio.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2">
                          {studio.primaryColor && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: studio.primaryColor }} />}
                          <span className="text-sm text-gray-700">{studio.name}</span>
                          <span className="text-xs text-gray-400">{studio.timezone}</span>
                        </div>
                        {(() => { const s = stats?.perStudio.find(ps => ps.id === studio.id); return s ? (
                          <div className="flex gap-4 text-xs text-gray-400">
                            <span>{s.members.toLocaleString()} members</span>
                            <span>{s.bookings.toLocaleString()} bookings</span>
                          </div>
                        ) : null })()}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Franchises ── */}
        {tab === 'franchises' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Franchises</h2>
              <button
                onClick={() => setShowNewFranchise(v => !v)}
                className="text-sm font-medium px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 transition-colors"
              >
                {showNewFranchise ? 'Cancel' : '+ New franchise'}
              </button>
            </div>

            {showNewFranchise && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
                <input
                  placeholder="Franchise name (e.g. Barry's Norway)"
                  value={franchiseForm.name}
                  onChange={e => setFranchiseForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                <input
                  placeholder="Slug (e.g. barrys-norway)"
                  value={franchiseForm.slug}
                  onChange={e => setFranchiseForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                <input
                  placeholder="Description (optional)"
                  value={franchiseForm.description}
                  onChange={e => setFranchiseForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                <button
                  disabled={!franchiseForm.name || !franchiseForm.slug || creatingFranchise}
                  onClick={handleCreateFranchise}
                  className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
                >
                  {creatingFranchise ? 'Creating…' : 'Create franchise'}
                </button>
              </div>
            )}

            {brand.franchises.length === 0 && !showNewFranchise && (
              <div className="bg-white rounded-xl border border-gray-100 py-12 text-center">
                <p className="text-sm text-gray-400">No franchises yet.</p>
                <p className="text-xs text-gray-300 mt-1">Create a franchise, then assign a franchise admin to manage its studios.</p>
              </div>
            )}

            {brand.franchises.map(franchise => (
              <FranchiseCard
                key={franchise.id}
                franchise={franchise}
                brandId={brand.id}
                token={token!}
                stats={stats}
                onAdminPromoted={() => loadBrand(token!)}
              />
            ))}
          </div>
        )}

        {/* ── Members ── */}
        {tab === 'members' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input type="search" placeholder="Search name or email…" value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <FranchiseFilter />
            </div>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">
                  {memberSearch ? 'No members found' : 'Start typing to search members'}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 font-medium">Member</th>
                      <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Studio</th>
                      <th className="text-right px-4 py-2.5 font-medium">Credits</th>
                      <th className="text-right px-4 py-2.5 font-medium">Bookings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-900">{m.firstName} {m.lastName}</p>
                          <p className="text-xs text-gray-400">{m.email}</p>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m.studioName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{m.creditBalance}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{m.bookingCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Classes ── */}
        {tab === 'classes' && (
          <div className="space-y-4">
            <div className="flex justify-end"><FranchiseFilter /></div>
            <div className="space-y-2">
              {sessions.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 py-12 text-center">
                  <p className="text-sm text-gray-400">No upcoming classes</p>
                </div>
              ) : sessions.map(s => (
                <div key={s.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SportDot sport={s.sport} />
                      <span className="font-medium text-gray-900 text-sm">{s.name}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{s.studioName}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(s.startsAt).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{new Date(s.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}{s.instructorName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-gray-900">{s.bookedCount}/{s.capacity}</p>
                    <p className="text-xs text-gray-400">booked</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
