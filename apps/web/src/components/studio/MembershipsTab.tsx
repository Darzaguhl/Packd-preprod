'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type MembershipPlan, type MembershipSubscription } from '@/lib/api-client'

interface Props {
  studioId: string
  token: string
  currency?: string
}

function fmtPrice(cents: number, currency = 'USD') {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}

function statusColor(status: string) {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-700'
    case 'PAUSED': return 'bg-amber-100 text-amber-700'
    case 'CANCELLED': return 'bg-red-100 text-red-600'
    case 'EXPIRED': return 'bg-gray-100 text-gray-500'
    default: return 'bg-gray-100 text-gray-500'
  }
}

function addMonths(date: string, months: number) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

const BLANK_PLAN = { name: '', description: '', priceInCents: 0, intervalMonths: 1, creditsPerCycle: 10 as number | null, guestPassesPerCycle: 0, creditExpiryDays: null as number | null, isIntroOffer: false, maxRedemptionsPerMember: 1 }

export default function MembershipsTab({ studioId, token, currency = 'USD' }: Props) {
  const [tab, setTab] = useState<'plans' | 'subscriptions'>('plans')
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [subscriptions, setSubscriptions] = useState<MembershipSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Plan form
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null)
  const [planForm, setPlanForm] = useState(BLANK_PLAN)

  // Assign subscription form
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignResults, setAssignResults] = useState<{ id: string; name: string; email: string; membershipStatus: string | null }[]>([])
  const [selectedMember, setSelectedMember] = useState<{ id: string; name: string } | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [assignStartDate, setAssignStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [assignError, setAssignError] = useState<string | null>(null)

  const loadPlans = useCallback(async () => {
    try {
      const data = await api.memberships.listPlans(studioId, token)
      setPlans(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plans')
    }
  }, [studioId, token])

  const loadSubscriptions = useCallback(async () => {
    try {
      const data = await api.memberships.listSubscriptions({ studioId }, token)
      setSubscriptions(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions')
    }
  }, [studioId, token])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadPlans(), loadSubscriptions()]).finally(() => setLoading(false))
  }, [loadPlans, loadSubscriptions])

  // Debounced member search for assign form
  useEffect(() => {
    if (assignSearch.length < 2) { setAssignResults([]); return }
    const t = setTimeout(async () => {
      try {
        const results = await api.admin.searchMembers(studioId, assignSearch, token)
        setAssignResults(results)
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [assignSearch, studioId, token])

  function openNewPlan() {
    setEditingPlan(null)
    setPlanForm(BLANK_PLAN)
    setShowPlanForm(true)
  }

  function openEditPlan(plan: MembershipPlan) {
    setEditingPlan(plan)
    setPlanForm({
      name: plan.name,
      description: plan.description ?? '',
      priceInCents: plan.priceInCents,
      intervalMonths: plan.intervalMonths,
      creditsPerCycle: plan.creditsPerCycle,
      guestPassesPerCycle: plan.guestPassesPerCycle ?? 0,
      creditExpiryDays: plan.creditExpiryDays ?? null,
      isIntroOffer: plan.isIntroOffer ?? false,
      maxRedemptionsPerMember: plan.maxRedemptionsPerMember ?? 1,
    })
    setShowPlanForm(true)
  }

  async function savePlan() {
    setSaving(true)
    setError(null)
    try {
      if (editingPlan) {
        await api.memberships.updatePlan(editingPlan.id, planForm, token)
      } else {
        await api.memberships.createPlan({ studioId, ...planForm }, token)
      }
      setShowPlanForm(false)
      await loadPlans()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save plan')
    } finally {
      setSaving(false)
    }
  }

  async function syncPlan(plan: MembershipPlan) {
    setSyncingPlanId(plan.id)
    setError(null)
    try {
      const res = await api.memberships.updatePlan(plan.id, {
        name: plan.name,
        description: plan.description ?? undefined,
        priceInCents: plan.priceInCents,
        intervalMonths: plan.intervalMonths,
      }, token)
      if (!res.data.stripePriceId) {
        setError('Stripe sync failed — check that your Stripe key is valid and the plan price is greater than 0')
      } else {
        setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, ...res.data } : p))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stripe sync failed')
    } finally {
      setSyncingPlanId(null)
    }
  }

  async function deletePlan(plan: MembershipPlan) {
    if (!confirm(`Delete "${plan.name}"? This cannot be undone.`)) return
    try {
      await api.memberships.deletePlan(plan.id, token)
      await loadPlans()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete plan')
    }
  }

  async function assignPlan() {
    if (!selectedMember || !selectedPlanId) return
    setSaving(true)
    setAssignError(null)
    try {
      await api.memberships.assign({
        memberId: selectedMember.id,
        planId: selectedPlanId,
        startDate: assignStartDate,
        grantCredits: true,
      }, token)
      setShowAssignForm(false)
      setSelectedMember(null)
      setAssignSearch('')
      setSelectedPlanId('')
      await loadSubscriptions()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Failed to assign plan')
    } finally {
      setSaving(false)
    }
  }


  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Tab pills */}
      <div className="flex gap-2">
        {(['plans', 'subscriptions'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'plans' ? 'Plans' : 'Subscriptions'}
            {t === 'subscriptions' && subscriptions.length > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{subscriptions.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Plans ── */}
      {tab === 'plans' && (
        <div className="space-y-3">
          {plans.length === 0 && !showPlanForm && (
            <div className="text-center py-10 text-sm text-gray-400">
              No plans yet. Create your first membership plan.
            </div>
          )}

          {plans.map(plan => (
            <div key={plan.id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900">{plan.name}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    {plan.intervalMonths === 0 ? 'ongoing' : `${plan.intervalMonths}mo`}
                  </span>
                  {plan.activeSubscriptions !== undefined && plan.activeSubscriptions > 0 && (
                    <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
                      {plan.activeSubscriptions} active
                    </span>
                  )}
                  {plan.priceInCents > 0 && (
                    plan.stripePriceId
                      ? <span title={plan.stripePriceId} className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Stripe
                        </span>
                      : <span className="text-xs bg-amber-50 text-amber-600 rounded-full px-2 py-0.5 flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 4v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="6" cy="8.5" r="0.5" fill="currentColor"/></svg>
                          Not synced
                        </span>
                  )}
                </div>
                {plan.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{plan.description}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  <span className="font-medium text-gray-900">{fmtPrice(plan.priceInCents, currency)}</span>
                  <span>·</span>
                  <span>{plan.creditsPerCycle === null ? 'Unlimited credits' : `${plan.creditsPerCycle} cr / cycle`}</span>
                  {(plan.guestPassesPerCycle ?? 0) > 0 && (
                    <>
                      <span>·</span>
                      <span>{plan.guestPassesPerCycle} guest pass{plan.guestPassesPerCycle !== 1 ? 'es' : ''} / cycle</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {plan.priceInCents > 0 && !plan.stripePriceId && (
                  <button
                    onClick={() => syncPlan(plan)}
                    disabled={syncingPlanId === plan.id}
                    className="text-xs px-3 py-1.5 rounded-xl border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncingPlanId === plan.id ? 'Syncing…' : 'Sync'}
                  </button>
                )}
                <button
                  onClick={() => openEditPlan(plan)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deletePlan(plan)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {/* Plan form */}
          {showPlanForm && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {editingPlan ? 'Edit plan' : 'New plan'}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Plan name</label>
                  <input
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.name}
                    onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Monthly Unlimited"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Description (optional)</label>
                  <input
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.description}
                    onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Short description shown to members"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Price ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={(planForm.priceInCents / 100).toFixed(2)}
                    onChange={e => setPlanForm(f => ({ ...f, priceInCents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                    <span>Duration (months)</span>
                    <span className="text-gray-400 font-normal">0 = ongoing</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.intervalMonths}
                    onChange={e => setPlanForm(f => ({ ...f, intervalMonths: Math.max(0, parseInt(e.target.value) || 0) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                    <span>Credits per cycle</span>
                    <span className="text-gray-400 font-normal">Blank = unlimited</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.creditsPerCycle ?? ''}
                    onChange={e => setPlanForm(f => ({
                      ...f,
                      creditsPerCycle: e.target.value === '' ? null : parseInt(e.target.value) || 0,
                    }))}
                    placeholder="e.g. 8"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Guest passes / cycle</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.guestPassesPerCycle}
                    onChange={e => setPlanForm(f => ({ ...f, guestPassesPerCycle: parseInt(e.target.value) || 0 }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Credit expiry (days)</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={planForm.creditExpiryDays ?? ''}
                    onChange={e => setPlanForm(f => ({ ...f, creditExpiryDays: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="Never expire"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={planForm.isIntroOffer}
                      onChange={e => setPlanForm(f => ({ ...f, isIntroOffer: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">Intro offer</span>
                  </label>
                  {planForm.isIntroOffer && (
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Max uses per member</label>
                      <input
                        type="number"
                        min="1"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                        value={planForm.maxRedemptionsPerMember}
                        onChange={e => setPlanForm(f => ({ ...f, maxRedemptionsPerMember: parseInt(e.target.value) || 1 }))}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={savePlan}
                  disabled={saving || !planForm.name}
                  className="px-4 py-2 bg-black text-white text-sm rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Saving…' : editingPlan ? 'Update plan' : 'Create plan'}
                </button>
                <button
                  onClick={() => setShowPlanForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showPlanForm && (
            <button
              onClick={openNewPlan}
              className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
            >
              + Add plan
            </button>
          )}
        </div>
      )}

      {/* ── Subscriptions ── */}
      {tab === 'subscriptions' && (
        <div className="space-y-3">
          {subscriptions.length === 0 && !showAssignForm && (
            <div className="text-center py-10 text-sm text-gray-400">
              No subscriptions yet. Assign a plan to a member to get started.
            </div>
          )}

          {subscriptions.map(sub => {
            const memberName = [sub.memberFirstName, sub.memberLastName].filter(Boolean).join(' ') || sub.memberEmail || sub.memberId
            const endDate = sub.endDate ? new Date(sub.endDate).toLocaleDateString() : '—'
            return (
              <div key={sub.id} className="bg-white border border-gray-100 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/members/${sub.memberId}`}
                        className="font-medium text-sm text-gray-900 hover:underline truncate"
                      >
                        {memberName}
                      </a>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${statusColor(sub.status)}`}>
                        {sub.status.toLowerCase()}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {sub.plan.name}
                      {sub.endDate && ` · expires ${endDate}`}
                    </div>
                    {sub.memberEmail && (
                      <div className="text-xs text-gray-400 mt-0.5">{sub.memberEmail}</div>
                    )}
                  </div>
                  <a
                    href={`/members/${sub.memberId}`}
                    className="shrink-0 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Manage →
                  </a>
                </div>
              </div>
            )
          })}

          {/* Assign form */}
          {showAssignForm && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Assign membership plan</h3>

              {/* Member search */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Search member</label>
                {selectedMember ? (
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-sm font-medium text-gray-900">{selectedMember.name}</span>
                    <button
                      onClick={() => { setSelectedMember(null); setAssignSearch('') }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ✕ change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                      value={assignSearch}
                      onChange={e => setAssignSearch(e.target.value)}
                      placeholder="Name or email…"
                    />
                    {assignResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-sm z-10 overflow-hidden">
                        {assignResults.map(r => (
                          <button
                            key={r.id}
                            onClick={() => { setSelectedMember({ id: r.id, name: r.name }); setAssignResults([]) }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                          >
                            <span className="font-medium">{r.name}</span>
                            <span className="text-gray-400 ml-2 text-xs">{r.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Plan picker */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Plan</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 bg-white"
                  value={selectedPlanId}
                  onChange={e => setSelectedPlanId(e.target.value)}
                >
                  <option value="">Select a plan…</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmtPrice(p.priceInCents, currency)} / {p.intervalMonths}mo
                    </option>
                  ))}
                </select>
              </div>

              {/* Start date */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Start date</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={assignStartDate}
                  onChange={e => setAssignStartDate(e.target.value)}
                />
                {selectedPlanId && assignStartDate && (
                  <p className="text-xs text-gray-400 mt-1">
                    Expires {addMonths(assignStartDate, plans.find(p => p.id === selectedPlanId)?.intervalMonths ?? 1)}
                  </p>
                )}
              </div>

              {assignError && (
                <p className="text-xs text-red-500">{assignError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={assignPlan}
                  disabled={saving || !selectedMember || !selectedPlanId}
                  className="px-4 py-2 bg-black text-white text-sm rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Assigning…' : 'Assign plan'}
                </button>
                <button
                  onClick={() => { setShowAssignForm(false); setSelectedMember(null); setAssignSearch(''); setSelectedPlanId('') }}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showAssignForm && (
            <button
              onClick={() => setShowAssignForm(true)}
              className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
            >
              + Assign plan to member
            </button>
          )}
        </div>
      )}
    </div>
  )
}
