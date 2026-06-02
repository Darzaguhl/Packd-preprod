'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, platform, type PlatformBrand } from '@/lib/api-client'
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
        onCreated({ ...res.data, studios: [], admin: null, createdAt: new Date().toISOString() } as PlatformBrand)
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
  onReload,
}: {
  brand: PlatformBrand
  token: string
  onDelete: (id: string) => void
  onReload: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showAssignAdmin, setShowAssignAdmin] = useState<string | null>(null) // franchiseId
  const [adminForm, setAdminForm] = useState({ email: '', firstName: '', lastName: '' })
  const [assigningAdmin, setAssigningAdmin] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: brand.name, slug: brand.slug, description: brand.description ?? '' })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editForm.name.trim() || !editForm.slug.trim()) return
    setSaving(true)
    setEditError(null)
    try {
      await api.brands.update(brand.id, {
        name: editForm.name.trim(),
        slug: editForm.slug.trim(),
        description: editForm.description.trim() || undefined,
      }, token)
      setEditing(false)
      onReload()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Brand admin state
  const [showBrandAdminForm, setShowBrandAdminForm] = useState(false)
  const [brandAdminForm, setBrandAdminForm] = useState({ email: '', firstName: '', lastName: '' })
  const [assigningBrandAdmin, setAssigningBrandAdmin] = useState(false)
  const [removingBrandAdmin, setRemovingBrandAdmin] = useState(false)
  const [brandAdminError, setBrandAdminError] = useState<string | null>(null)
  const [brandAdminSuccess, setBrandAdminSuccess] = useState<string | null>(null)

  async function handleAssignBrandAdmin() {
    if (!brandAdminForm.email.trim()) return
    setAssigningBrandAdmin(true)
    setBrandAdminError(null)
    try {
      const res = await api.brands.assignBrandAdmin(brand.id, {
        email: brandAdminForm.email.trim(),
        firstName: brandAdminForm.firstName.trim() || undefined,
        lastName: brandAdminForm.lastName.trim() || undefined,
      }, token)
      setBrandAdminSuccess(res.message ?? 'Done')
      setBrandAdminForm({ email: '', firstName: '', lastName: '' })
      setShowBrandAdminForm(false)
      onReload()
    } catch (e) {
      setBrandAdminError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setAssigningBrandAdmin(false)
    }
  }

  async function handleRemoveBrandAdmin() {
    if (!brand.admin) return
    if (!confirm(`Remove ${brand.admin.firstName} ${brand.admin.lastName} as brand admin? They will lose access immediately.`)) return
    setRemovingBrandAdmin(true)
    setBrandAdminError(null)
    try {
      await api.brands.removeBrandAdmin(brand.id, brand.admin.id, token)
      setBrandAdminSuccess('Brand admin removed.')
      onReload()
    } catch (e) {
      setBrandAdminError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setRemovingBrandAdmin(false)
    }
  }

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
      {editing ? (
        <form onSubmit={handleSaveEdit} className="px-5 py-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm shrink-0 mt-0.5">
            {editForm.name.charAt(0).toUpperCase() || brand.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <input
                autoFocus
                value={editForm.name}
                onChange={e => {
                  const v = e.target.value
                  setEditForm(f => ({
                    ...f, name: v,
                    slug: f.slug === brand.slug
                      ? v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
                      : f.slug,
                  }))
                }}
                placeholder="Brand name"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <input
                value={editForm.slug}
                onChange={e => setEditForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                placeholder="slug"
                className="w-36 text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <input
              value={editForm.description}
              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {editError && <p className="text-xs text-red-500">{editError}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            <button type="submit" disabled={saving || !editForm.name.trim() || !editForm.slug.trim()}
              className="text-xs font-medium px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setEditError(null); setEditForm({ name: brand.name, slug: brand.slug, description: brand.description ?? '' }) }}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
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
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => setEditing(true)}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
              Edit
            </button>
            <button
              onClick={handleExpand}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
            >
              {expanded ? 'Collapse' : 'Expand'}
              <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={handleDelete} disabled={deleting}
                  className="text-xs text-red-600 hover:text-red-700 font-medium">
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600 ml-1">✕</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs text-gray-300 hover:text-red-500 transition-colors">
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Brand admin section */}
      <div className="border-t border-gray-50 px-5 py-4 space-y-3">

        {/* Current admin + remove/add-another */}
        {brand.admin && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-[10px] font-bold shrink-0">
                {(brand.admin.firstName?.[0] ?? brand.admin.email[0]).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-800">{brand.admin.firstName} {brand.admin.lastName}</p>
                <p className="text-[10px] text-gray-400">{brand.admin.email}</p>
              </div>
              <span className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-medium">Brand admin</span>
            </div>
            <button onClick={handleRemoveBrandAdmin} disabled={removingBrandAdmin}
              className="text-[10px] text-red-400 hover:text-red-600 transition-colors disabled:opacity-50 shrink-0">
              {removingBrandAdmin ? 'Removing…' : 'Remove'}
            </button>
          </div>
        )}

        {/* Invite someone new — collapsible */}
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-gray-900">
              {brand.admin ? 'Invite another brand admin' : 'Invite brand admin'}
            </p>
            <button
              onClick={() => { setShowBrandAdminForm(v => !v); setBrandAdminError(null) }}
              className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              {showBrandAdminForm ? 'Hide' : 'Show'}
            </button>
          </div>
          {!showBrandAdminForm ? (
            <p className="text-xs text-gray-400">
              {brand.admin
                ? 'Add another person as brand admin for a transition.'
                : 'Assign someone to manage this brand and its franchises.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-3">
                If they don't have a Packd account yet, provide their name — an account will be created and they can set their password via "Forgot password".
              </p>
              <form onSubmit={e => { e.preventDefault(); handleAssignBrandAdmin() }} className="flex gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="First name"
                  value={brandAdminForm.firstName}
                  onChange={e => setBrandAdminForm(v => ({ ...v, firstName: e.target.value }))}
                  className="w-28 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={brandAdminForm.lastName}
                  onChange={e => setBrandAdminForm(v => ({ ...v, lastName: e.target.value }))}
                  className="w-28 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                />
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={brandAdminForm.email}
                  onChange={e => setBrandAdminForm(v => ({ ...v, email: e.target.value }))}
                  required
                  className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={assigningBrandAdmin || !brandAdminForm.email.trim()}
                  className="text-sm font-medium bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-500 disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {assigningBrandAdmin ? 'Assigning…' : 'Assign'}
                </button>
              </form>
              {brandAdminError && <p className="mt-2 text-xs text-red-500">{brandAdminError}</p>}
              {brandAdminSuccess && <p className="mt-2 text-xs text-emerald-600">{brandAdminSuccess}</p>}
            </>
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
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Franchise admin</p>
                            <p className="text-xs font-medium text-gray-700">{f.admin.firstName} {f.admin.lastName}</p>
                            <p className="text-[10px] text-gray-400">{f.admin.email}</p>
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

              {/* Franchise admin success toast */}
              {adminSuccess && (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-emerald-700">{adminSuccess}</p>
                  <button onClick={() => setAdminSuccess(null)} className="text-emerald-400 hover:text-emerald-600 ml-2">✕</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── PlatformDashboard ────────────────────────────────────────────────────────

// ── System tab types ─────────────────────────────────────────────────────────
type ServiceStatus = { status: string; error?: string }
type HealthData = {
  latencyMs: number
  services: Record<string, ServiceStatus>
  system: {
    uptimeSeconds: number
    memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number }
    database: { db_size: string; connections: number } | null
    queue24h: Record<string, number>
  }
  timestamp: string
}
type JobStat = { name: string; state: string; count: number }
type FailedJob = { id: string; name: string; data: unknown; output: unknown; createdon: string; completedon: string | null; retrycount: number }
type AuditEntry = { id: string; actorId: string; actorRole: string; action: string; targetId: string | null; meta: unknown; createdAt: string }

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' ? 'bg-green-400' : status === 'unconfigured' ? 'bg-gray-300' : status === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

function SystemTab({ token }: { token: string }) {
  const [sub, setSub] = useState<'health' | 'jobs' | 'audit'>('health')
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [jobs, setJobs] = useState<{ stats: JobStat[]; failed: FailedJob[] } | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [purging, setPurging] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditCursor, setAuditCursor] = useState<string | null>(null)
  const [auditHasMore, setAuditHasMore] = useState(false)

  async function loadHealth() {
    setHealthLoading(true)
    try { setHealth(await platform.health(token)) } catch { /* ignore */ }
    finally { setHealthLoading(false) }
  }

  async function loadJobs() {
    setJobsLoading(true)
    try { setJobs(await platform.jobs(token)) } catch { /* ignore */ }
    finally { setJobsLoading(false) }
  }

  async function loadAudit(cursor?: string) {
    setAuditLoading(true)
    try {
      const res = await platform.auditLog(token, { cursor, take: 50 })
      setAudit(prev => cursor ? [...prev, ...res.items] : res.items)
      setAuditCursor(res.nextCursor)
      setAuditHasMore(res.hasMore)
    } catch { /* ignore */ }
    finally { setAuditLoading(false) }
  }

  useEffect(() => {
    if (sub === 'health') loadHealth()
    else if (sub === 'jobs') loadJobs()
    else if (sub === 'audit' && audit.length === 0) loadAudit()
  }, [sub])

  // Auto-refresh health every 30s
  useEffect(() => {
    if (sub !== 'health') return
    const id = setInterval(loadHealth, 30_000)
    return () => clearInterval(id)
  }, [sub])

  async function handleRetry(jobId: string) {
    setRetrying(jobId)
    try {
      await platform.retryJob(jobId, token)
      await loadJobs()
    } catch { /* ignore */ }
    finally { setRetrying(null) }
  }

  async function handlePurge(jobId: string) {
    if (!confirm('Permanently delete this failed job?')) return
    setPurging(jobId)
    try {
      await platform.purgeJob(jobId, token)
      setJobs(prev => prev ? { ...prev, failed: prev.failed.filter(j => j.id !== jobId) } : null)
    } catch { /* ignore */ }
    finally { setPurging(null) }
  }

  const SERVICE_LABELS: Record<string, string> = { api: 'API', database: 'Database', jobs: 'Job queue', stripe: 'Stripe', resend: 'Resend' }

  // Group job stats by queue name
  const jobQueues = jobs?.stats.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (!acc[row.name]) acc[row.name] = {}
    acc[row.name][row.state] = row.count
    return acc
  }, {}) ?? {}

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['health', 'jobs', 'audit'] as const).map(s => (
          <button key={s} onClick={() => setSub(s)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all capitalize ${sub === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {s === 'health' ? 'Health' : s === 'jobs' ? 'Job queue' : 'Audit log'}
          </button>
        ))}
      </div>

      {/* ── Health ── */}
      {sub === 'health' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{health ? `Last checked ${new Date(health.timestamp).toLocaleTimeString()} · ${health.latencyMs}ms` : 'Checking…'}</p>
            <button onClick={loadHealth} disabled={healthLoading} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">↻ Refresh</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {health ? Object.entries(health.services).map(([key, svc]) => (
              <div key={key} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <StatusDot status={svc.status} />
                <div>
                  <p className="text-sm font-medium text-gray-800">{SERVICE_LABELS[key] ?? key}</p>
                  <p className={`text-xs ${svc.status === 'ok' ? 'text-gray-400' : svc.status === 'unconfigured' ? 'text-gray-400' : 'text-red-500'}`}>
                    {svc.error ?? svc.status}
                  </p>
                </div>
              </div>
            )) : [1,2,3,4,5].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 h-16 animate-pulse" />
            ))}
          </div>

          {/* System metrics */}
          {health && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'API uptime',
                  value: (() => {
                    const s = health.system.uptimeSeconds
                    if (s < 60) return `${s}s`
                    if (s < 3600) return `${Math.floor(s / 60)}m`
                    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
                    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
                  })(),
                  sub: 'since last restart',
                },
                {
                  label: 'Heap memory',
                  value: `${health.system.memory.heapUsedMb} MB`,
                  sub: `of ${health.system.memory.heapTotalMb} MB · RSS ${health.system.memory.rssMb} MB`,
                },
                {
                  label: 'DB size',
                  value: health.system.database?.db_size ?? '—',
                  sub: `${health.system.database?.connections ?? '—'} connections`,
                },
                {
                  label: 'Queue (24h)',
                  value: (health.system.queue24h.failed ?? 0) > 0
                    ? `${health.system.queue24h.failed} failed`
                    : `${health.system.queue24h.completed ?? 0} done`,
                  sub: `${health.system.queue24h.active ?? 0} active · ${health.system.queue24h.created ?? 0} pending`,
                  alert: (health.system.queue24h.failed ?? 0) > 0,
                },
              ].map(m => (
                <div key={m.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                  <p className={`text-lg font-bold ${(m as any).alert ? 'text-red-500' : 'text-gray-900'}`}>{m.value}</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">{m.label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.sub}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Jobs ── */}
      {sub === 'jobs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Last 7 days</p>
            <button onClick={loadJobs} disabled={jobsLoading} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">↻ Refresh</button>
          </div>

          {/* Queue stats */}
          {Object.keys(jobQueues).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-medium">Queue</th>
                    {['created','active','completed','failed','expired'].map(s => (
                      <th key={s} className="text-right px-3 py-2.5 font-medium capitalize">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(jobQueues).map(([name, states]) => (
                    <tr key={name} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{name}</td>
                      {['created','active','completed','failed','expired'].map(s => (
                        <td key={s} className={`px-3 py-2.5 text-right text-xs ${s === 'failed' && (states[s] ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                          {states[s] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Failed jobs */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Failed jobs {jobs && `(${jobs.failed.length})`}
            </p>
            {jobsLoading ? (
              <div className="bg-white rounded-xl border border-gray-100 h-24 animate-pulse" />
            ) : !jobs?.failed.length ? (
              <div className="bg-white rounded-xl border border-gray-100 py-8 text-center">
                <p className="text-sm text-gray-400">No failed jobs.</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
                {jobs.failed.map(job => (
                  <div key={job.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 font-mono">{job.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {job.completedon ? new Date(job.completedon).toLocaleString() : new Date(job.createdon).toLocaleString()} · {job.retrycount} retries
                      </p>
                      {!!job.output && (
                        <p className="text-xs text-red-500 mt-1 font-mono truncate">{String(JSON.stringify(job.output))}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => handleRetry(job.id)} disabled={retrying === job.id}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40">
                        {retrying === job.id ? '…' : 'Retry'}
                      </button>
                      <button onClick={() => handlePurge(job.id)} disabled={purging === job.id}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">
                        {purging === job.id ? '…' : 'Purge'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Audit log ── */}
      {sub === 'audit' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Platform-level events only — brand and franchise administration.</p>
          {auditLoading && audit.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 h-32 animate-pulse" />
          ) : audit.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 py-12 text-center">
              <p className="text-sm text-gray-400">No platform events yet.</p>
            </div>
          ) : (
            <>
              <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
                {audit.map(entry => (
                  <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{entry.action}</span>
                        <span className="text-xs text-gray-400">{entry.actorRole}</span>
                      </div>
                      {!!entry.meta && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {Object.entries(entry.meta as Record<string, unknown>)
                            .filter(([k]) => !['userId'].includes(k))
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 shrink-0">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              {auditHasMore && (
                <button onClick={() => loadAudit(auditCursor ?? undefined)} disabled={auditLoading}
                  className="w-full py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-xl disabled:opacity-40">
                  {auditLoading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlatformDashboard() {
  type PlatformStats = {
    brands: number; franchises: number; studios: number; members: number
    bookings30d: number; revenueThisMonth: number; activeStudios30d: number
  }

  const [token, setToken] = useState<string | null>(null)
  const [brands, setBrands] = useState<PlatformBrand[]>([])
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [activeTab, setActiveTab] = useState<'brands' | 'system'>('brands')
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
      if (t) {
        await loadBrands(t)
        platform.stats(t).then(setStats).catch(() => {})
      }
      setLoading(false)
    })
  }, [])

  const totalStudios = brands.reduce((n, b) => n + b.studios.length, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar title="Platform Admin" subtitle="Manage brands and franchise admins" />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Platform stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Brands', value: stats?.brands, sub: `${stats?.franchises ?? '—'} franchises` },
            { label: 'Studios', value: stats?.studios, sub: `${stats?.activeStudios30d ?? '—'} active 30d` },
            { label: 'Members', value: stats?.members?.toLocaleString(), sub: 'registered' },
            { label: 'Bookings', value: stats?.bookings30d?.toLocaleString(), sub: 'last 30 days' },
          ].map(kpi => (
            <div key={kpi.label} className={`bg-white rounded-2xl border border-gray-100 px-5 py-4 ${!stats ? 'animate-pulse' : ''}`}>
              <p className="text-2xl font-bold text-gray-900">{stats ? kpi.value : <span className="text-gray-200">——</span>}</p>
              <p className="text-xs font-medium text-gray-500 mt-0.5">{kpi.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{stats ? kpi.sub : ''}</p>
            </div>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['brands', 'system'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-5 py-1.5 text-sm font-medium rounded-lg transition-all capitalize ${activeTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'brands' ? 'Brands' : 'System'}
            </button>
          ))}
        </div>

        {activeTab === 'brands' && <>
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
                  onReload={() => token && loadBrands(token)}
                />
              ))
            )}
          </div>
        </>}

        {activeTab === 'system' && token && <SystemTab token={token} />}
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
