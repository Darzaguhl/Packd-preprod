'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type PlatformBrand } from '@/lib/api-client'
import NavBar from '@/components/NavBar'

// ── New Brand Modal ──────────────────────────────────────────────────────────

function NewBrandModal({
  onClose,
  onCreated,
  token,
}: {
  onClose: () => void
  onCreated: (brand: PlatformBrand) => void
  token: string
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-generate slug from name
  function handleNameChange(v: string) {
    setName(v)
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  }

  async function handleSubmit() {
    if (!name.trim() || !slug.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.brands.create({ name: name.trim(), slug: slug.trim(), description: description.trim() || undefined }, token)
      if (res.success) {
        // The create endpoint returns brand without studios[]
        onCreated({ ...res.data, studios: [], createdAt: new Date().toISOString() } as PlatformBrand)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create brand')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900">New Brand</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Brand name</label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Barry's"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
            <input
              type="text"
              placeholder="e.g. barrys"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            />
            <p className="text-[11px] text-gray-400 mt-1">Lowercase letters, numbers and hyphens only.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              placeholder="Short description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !slug.trim() || saving}
            className="flex-1 py-2.5 bg-violet-600 text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-violet-700 transition-colors"
          >
            {saving ? 'Creating…' : 'Create brand'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Brand Row ────────────────────────────────────────────────────────────────

function BrandRow({
  brand,
  token,
  onDelete,
  onFranchiseCreated,
  onFranchiseAdminAssigned,
}: {
  brand: PlatformBrand
  token: string
  onDelete: (id: string) => void
  onFranchiseCreated: (brandId: string) => void
  onFranchiseAdminAssigned: (brandId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showNewFranchise, setShowNewFranchise] = useState(false)
  const [showAssignAdmin, setShowAssignAdmin] = useState<string | null>(null) // franchiseId
  const [franchiseForm, setFranchiseForm] = useState({ name: '', slug: '', description: '' })
  const [creatingFranchise, setCreatingFranchise] = useState(false)
  const [franchiseError, setFranchiseError] = useState<string | null>(null)
  const [adminForm, setAdminForm] = useState({ email: '', firstName: '', lastName: '' })
  const [assigningAdmin, setAssigningAdmin] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Fetch full brand with franchises when expanded
  const [franchises, setFranchises] = useState<Array<{
    id: string; name: string; slug: string; description: string | null;
    admin: { id: string; email: string; firstName: string; lastName: string } | null;
    studios: Array<{ id: string; name: string; timezone: string }>
  }>>([])
  const [loadingFranchises, setLoadingFranchises] = useState(false)

  async function loadFranchises() {
    setLoadingFranchises(true)
    try {
      const res = await api.brands.get(brand.id, token)
      if (res.success && res.data.franchises) setFranchises(res.data.franchises)
    } catch { /* ignore */ }
    finally { setLoadingFranchises(false) }
  }

  function handleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && franchises.length === 0) loadFranchises()
  }

  async function handleCreateFranchise() {
    if (!franchiseForm.name || !franchiseForm.slug) return
    setCreatingFranchise(true)
    setFranchiseError(null)
    try {
      await api.brands.createFranchise(brand.id, franchiseForm, token)
      await loadFranchises()
      setFranchiseForm({ name: '', slug: '', description: '' })
      setShowNewFranchise(false)
      onFranchiseCreated(brand.id)
    } catch (e) {
      setFranchiseError(e instanceof Error ? e.message : 'Failed to create franchise')
    } finally {
      setCreatingFranchise(false)
    }
  }

  async function handleAssignAdmin(franchiseId: string) {
    if (!adminForm.email.trim()) return
    setAssigningAdmin(true)
    setAdminError(null)
    setAdminSuccess(null)
    try {
      const res = await api.brands.promoteFranchiseAdmin(brand.id, {
        email: adminForm.email.trim(),
        franchiseId,
        firstName: adminForm.firstName.trim() || undefined,
        lastName: adminForm.lastName.trim() || undefined,
      }, token)
      setAdminSuccess(res.message ?? 'Done')
      setAdminForm({ email: '', firstName: '', lastName: '' })
      setShowAssignAdmin(null)
      await loadFranchises()
      onFranchiseAdminAssigned(brand.id)
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to assign admin')
    } finally {
      setAssigningAdmin(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.brands.delete(brand.id, token)
      onDelete(brand.id)
    } catch { /* ignore */ }
    finally { setDeleting(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Brand header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm shrink-0">
          {brand.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{brand.name}</h3>
            <span className="text-xs text-gray-400 font-mono">{brand.slug}</span>
          </div>
          {brand.description && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{brand.description}</p>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-gray-900">{brand.studios.length}</p>
            <p className="text-xs text-gray-400">studio{brand.studios.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={handleExpand}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
          >
            {expanded ? 'Collapse' : 'Expand'}
            <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs text-red-600 hover:text-red-700 font-medium"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600 ml-1">
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-300 hover:text-red-500 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {loadingFranchises ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              Loading franchises…
            </div>
          ) : (
            <>
              {franchises.length === 0 ? (
                <p className="text-sm text-gray-400">No franchises yet.</p>
              ) : (
                <div className="space-y-3">
                  {franchises.map(f => (
                    <div key={f.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold text-gray-800">{f.name}</span>
                          <span className="ml-2 text-xs text-gray-400 font-mono">{f.slug}</span>
                          {f.description && <p className="text-xs text-gray-400 mt-0.5">{f.description}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{f.studios.length} studio{f.studios.length !== 1 ? 's' : ''}</p>
                        </div>

                        {/* Assign admin button / admin display */}
                        {showAssignAdmin === f.id ? (
                          <button
                            onClick={() => { setShowAssignAdmin(null); setAdminError(null); setAdminForm({ email: '', firstName: '', lastName: '' }) }}
                            className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                          >
                            Cancel
                          </button>
                        ) : f.admin ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <p className="text-xs font-medium text-gray-700">{f.admin.firstName} {f.admin.lastName}</p>
                              <p className="text-[10px] text-gray-400">{f.admin.email}</p>
                            </div>
                            <button
                              onClick={() => { setShowAssignAdmin(f.id); setAdminSuccess(null) }}
                              className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0"
                            >
                              Change
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowAssignAdmin(f.id)}
                            className="text-xs text-violet-600 hover:text-violet-700 shrink-0 font-medium"
                          >
                            + Assign admin
                          </button>
                        )}
                      </div>

                      {/* Assign admin inline form */}
                      {showAssignAdmin === f.id && (
                        <div className="space-y-2 pt-1">
                          <input
                            autoFocus
                            type="email"
                            placeholder="Email address"
                            value={adminForm.email}
                            onChange={e => setAdminForm(v => ({ ...v, email: e.target.value }))}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="First name (if new user)"
                              value={adminForm.firstName}
                              onChange={e => setAdminForm(v => ({ ...v, firstName: e.target.value }))}
                              className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                            <input
                              type="text"
                              placeholder="Last name"
                              value={adminForm.lastName}
                              onChange={e => setAdminForm(v => ({ ...v, lastName: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleAssignAdmin(f.id)}
                              className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <button
                              onClick={() => handleAssignAdmin(f.id)}
                              disabled={!adminForm.email.trim() || assigningAdmin}
                              className="px-3 py-1.5 bg-violet-600 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-violet-700 transition-colors"
                            >
                              {assigningAdmin ? '…' : 'Assign'}
                            </button>
                            {adminError && <p className="text-xs text-red-500">{adminError}</p>}
                          </div>
                        </div>
                      )}

                      {/* Studios list */}
                      {f.studios.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {f.studios.map(s => (
                            <span key={s.id} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {s.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Admin success toast */}
              {adminSuccess && (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-emerald-700">{adminSuccess}</p>
                  <button onClick={() => setAdminSuccess(null)} className="text-emerald-400 hover:text-emerald-600 ml-2">✕</button>
                </div>
              )}

              {/* Add franchise */}
              {showNewFranchise ? (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Add franchise</p>
                  <input
                    autoFocus
                    placeholder="Franchise name (e.g. Barry's Norway)"
                    value={franchiseForm.name}
                    onChange={e => {
                      const v = e.target.value
                      setFranchiseForm(f => ({
                        ...f,
                        name: v,
                        slug: v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                      }))
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <input
                    placeholder="Slug (e.g. barrys-norway)"
                    value={franchiseForm.slug}
                    onChange={e => setFranchiseForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                  />
                  <input
                    placeholder="Description (optional)"
                    value={franchiseForm.description}
                    onChange={e => setFranchiseForm(f => ({ ...f, description: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleCreateFranchise()}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  {franchiseError && <p className="text-xs text-red-500">{franchiseError}</p>}
                  <div className="flex gap-2">
                    <button
                      disabled={!franchiseForm.name || !franchiseForm.slug || creatingFranchise}
                      onClick={handleCreateFranchise}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
                    >
                      {creatingFranchise ? 'Creating…' : 'Create'}
                    </button>
                    <button onClick={() => { setShowNewFranchise(false); setFranchiseError(null) }} className="text-sm text-gray-400 hover:text-gray-600 px-2">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFranchise(true)}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors font-medium"
                >
                  + Add franchise
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── PlatformDashboard ────────────────────────────────────────────────────────

export default function PlatformDashboard() {
  const [token, setToken] = useState<string | null>(null)
  const [brands, setBrands] = useState<PlatformBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function loadBrands(t: string) {
    try {
      const res = await api.brands.listAll(t)
      if (res.success) setBrands(res.data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (t) await loadBrands(t)
      setLoading(false)
    })
  }, [])

  const totalStudios = brands.reduce((n, b) => n + b.studios.length, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar title="Platform Admin" subtitle="Manage brands and franchise admins" />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Brands', value: brands.length },
            { label: 'Studios', value: totalStudios },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Brands list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Brands{brands.length > 0 ? ` (${brands.length})` : ''}
            </h2>
            <button
              onClick={() => setShowNewBrand(true)}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700 transition-colors"
            >
              + New Brand
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse h-20" />
              ))}
            </div>
          ) : brands.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
              <p className="text-sm text-gray-400">No brands yet.</p>
              <p className="text-xs text-gray-300 mt-1">Create a brand, then add franchises and assign franchise admins.</p>
              <button
                onClick={() => setShowNewBrand(true)}
                className="mt-4 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700 transition-colors"
              >
                Create first brand
              </button>
            </div>
          ) : (
            brands.map(brand => (
              <BrandRow
                key={brand.id}
                brand={brand}
                token={token!}
                onDelete={id => {
                  setBrands(prev => prev.filter(b => b.id !== id))
                  showToast('Brand deleted')
                }}
                onFranchiseCreated={() => {
                  if (token) loadBrands(token)
                  showToast('Franchise created')
                }}
                onFranchiseAdminAssigned={() => showToast('Admin assigned')}
              />
            ))
          )}
        </div>
      </div>

      {/* New brand modal */}
      {showNewBrand && token && (
        <NewBrandModal
          token={token}
          onClose={() => setShowNewBrand(false)}
          onCreated={brand => {
            setBrands(prev => [brand, ...prev])
            setShowNewBrand(false)
            showToast(`Brand "${brand.name}" created`)
          }}
        />
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
