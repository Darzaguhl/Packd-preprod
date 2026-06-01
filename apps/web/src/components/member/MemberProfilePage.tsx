'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminMemberProfile, type AdminMemberHistory, type MembershipPlan, type GuestPassEntry } from '@/lib/api-client'
import NavBar from '@/components/NavBar'
import MemberHistoryView from './MemberHistoryView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import type { UpcomingBooking, PastBooking, CreditTransaction } from '@/lib/api-client'

interface Props {
  memberId: string
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

export default function MemberProfilePage({ memberId }: Props) {
  const router = useRouter()
  const [profile, setProfile] = useState<AdminMemberProfile | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([])
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('24h')
  const [token, setToken] = useState<string | null>(null)
  const [studioId, setStudioId] = useState<string | null>(null)

  // Subscription management
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [showAssignPlan, setShowAssignPlan] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [subSaving, setSubSaving] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)

  // Notes
  const [notes, setNotes] = useState<string>('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  // Guest passes
  const [guestPasses, setGuestPasses] = useState<GuestPassEntry[]>([])
  const [guestPassBalance, setGuestPassBalance] = useState(0)
  const [showGrantForm, setShowGrantForm] = useState(false)
  const [grantAmount, setGrantAmount] = useState('1')
  const [grantNote, setGrantNote] = useState('')
  const [granting, setGranting] = useState(false)

  // Pause / resume
  const [showPauseForm, setShowPauseForm] = useState(false)
  const [pauseUntilDate, setPauseUntilDate] = useState('')
  const [subActioning, setSubActioning] = useState(false)
  const [subActionError, setSubActionError] = useState<string | null>(null)
  const [purchases, setPurchases] = useState<import('@/lib/api').ProductSale[]>([])
  const [refundingId, setRefundingId] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      if (!t) { router.replace('/login'); return }
      setToken(t)

      const sid = (session?.user?.app_metadata as { studioId?: string })?.studioId ?? null
      setStudioId(sid)

      try {
        const [prof, history] = await Promise.all([
          api.admin.memberProfile(memberId, t),
          api.admin.memberHistory(memberId, t),
        ])
        setProfile(prof)
        setNotes(prof.notes ?? '')
        setGuestPassBalance(prof.guestPassBalance ?? 0)
        setUpcoming(history.upcoming as UpcomingBooking[])
        setPastBookings(history.pastBookings)
        setTransactions(history.transactions)
        api.admin.guestPassLog(memberId, t).then(setGuestPasses).catch(() => {})
        api.admin.memberPurchases(memberId, t).then(setPurchases).catch(() => {})

        // Use the member's studioId (always present) rather than the viewer's app_metadata
        const effectiveStudioId = prof.studioId ?? sid
        if (effectiveStudioId) {
          setStudioId(effectiveStudioId)
          api.admin.stats(effectiveStudioId, t).then(s => setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')).catch(() => {})
          api.memberships.listPlans(effectiveStudioId, t).then(setPlans).catch(() => {})
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load member')
      } finally {
        setLoading(false)
      }
    })
  }, [memberId, router])

  async function cancelSubscription(subId: string) {
    if (!token || !confirm('Cancel this member\'s subscription?')) return
    try {
      await api.memberships.update(subId, { status: 'CANCELLED' }, token)
      const updated = await api.admin.memberProfile(memberId, token)
      setProfile(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel subscription')
    }
  }

  async function assignPlan() {
    if (!token || !selectedPlanId) return
    setSubSaving(true)
    setSubError(null)
    try {
      await api.memberships.assign({ memberId, planId: selectedPlanId, grantCredits: true }, token)
      const updated = await api.admin.memberProfile(memberId, token)
      setProfile(updated)
      setShowAssignPlan(false)
      setSelectedPlanId('')
    } catch (e) {
      setSubError(e instanceof Error ? e.message : 'Failed to assign plan')
    } finally {
      setSubSaving(false)
    }
  }

  async function grantGuestPasses() {
    if (!token) return
    const n = parseInt(grantAmount)
    if (!n || n < 1) return
    setGranting(true)
    try {
      const res = await api.admin.grantGuestPasses(memberId, n, grantNote.trim() || undefined, token)
      setGuestPassBalance(res.guestPassBalance)
      const log = await api.admin.guestPassLog(memberId, token)
      setGuestPasses(log)
      setShowGrantForm(false); setGrantAmount('1'); setGrantNote('')
    } catch { /* silent */ }
    finally { setGranting(false) }
  }

  async function pauseSubscription() {
    if (!token || !profile?.activeSubscription) return
    setSubActioning(true); setSubActionError(null)
    try {
      await api.memberships.pauseSubscription(memberId, token, pauseUntilDate || null)
      const updated = await api.admin.memberProfile(memberId, token)
      setProfile(updated)
      setShowPauseForm(false); setPauseUntilDate('')
    } catch (e) {
      setSubActionError(e instanceof Error ? e.message : 'Failed to pause')
    } finally { setSubActioning(false) }
  }

  async function resumeSubscription() {
    if (!token || !profile?.activeSubscription) return
    setSubActioning(true); setSubActionError(null)
    try {
      await api.memberships.resumeSubscription(memberId, token)
      const updated = await api.admin.memberProfile(memberId, token)
      setProfile(updated)
    } catch (e) {
      setSubActionError(e instanceof Error ? e.message : 'Failed to resume')
    } finally { setSubActioning(false) }
  }

  async function saveNotes() {
    if (!token) return
    setNotesSaving(true)
    try {
      await api.admin.updateMember(memberId, { notes: notes.trim() || null }, token)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    } catch { /* silent */ }
    finally { setNotesSaving(false) }
  }

  const backButton = (
    <button
      onClick={() => router.back()}
      className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
    >
      ← Back
    </button>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar title="Member Profile" action={backButton} />
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar title="Member Profile" action={backButton} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-sm text-gray-400">{error ?? 'Member not found'}</p>
        </div>
      </div>
    )
  }

  const sub = profile.activeSubscription

  return (
    <TimeFormatProvider value={timeFormat}>
      <div className="min-h-screen bg-gray-50">
        <NavBar
          title={`${profile.firstName} ${profile.lastName}`}
          subtitle={profile.email}
          action={backButton}
        />
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <MemberHistoryView
            profile={profile}
            upcoming={upcoming}
            pastBookings={pastBookings}
            transactions={transactions}
            showEmail
          />

          {/* Staff notes */}
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Staff notes</h3>
              {notesSaved && (
                <span className="text-xs text-emerald-600 font-medium">Saved</span>
              )}
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add internal notes visible only to staff…"
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={saveNotes}
                disabled={notesSaving}
                className="text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {notesSaving ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>

          {/* Guest passes */}
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Guest passes</h3>
                <p className="text-xs text-gray-400 mt-0.5">{guestPassBalance} remaining</p>
              </div>
              {!showGrantForm && (
                <button
                  onClick={() => setShowGrantForm(true)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Grant passes
                </button>
              )}
            </div>

            {showGrantForm && (
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100">
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={grantAmount}
                  onChange={e => setGrantAmount(e.target.value)}
                  className="w-16 border border-gray-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                />
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={grantNote}
                  onChange={e => setGrantNote(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                />
                <button
                  onClick={grantGuestPasses}
                  disabled={granting}
                  className="px-3 py-1.5 bg-black text-white text-xs rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {granting ? 'Granting…' : 'Grant'}
                </button>
                <button
                  onClick={() => { setShowGrantForm(false); setGrantAmount('1'); setGrantNote('') }}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            )}

            {guestPasses.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {guestPasses.map(p => (
                  <div key={p.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                    <span className={`font-semibold tabular-nums ${p.amount > 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                      {p.amount > 0 ? `+${p.amount}` : p.amount}
                    </span>
                    <span className="flex-1 text-gray-700 truncate">
                      {p.guestName ?? p.note ?? '—'}
                    </span>
                    <span className="text-gray-400 shrink-0">
                      {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {guestPasses.length === 0 && (
              <p className="text-xs text-gray-400">No guest pass history yet.</p>
            )}
          </div>

          {/* Purchase history */}
          {purchases.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Purchase history</h3>
              <div className="space-y-2.5">
                {purchases.map(sale => (
                  <div key={sale.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 font-medium truncate">
                        {(sale.items as import('@/lib/api').CartSaleItem[]).map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}
                      </p>
                      <p className="text-gray-400 mt-0.5">
                        {new Date(sale.soldAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        <span className="capitalize">{sale.paymentMethod}</span>
                        {sale.refundedAt && <span className="text-red-400 ml-1">· Refunded</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {sale.totalCents > 0 && (
                        <span className={`font-semibold tabular-nums ${sale.refundedAt ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {(sale.totalCents / 100).toFixed(2)}
                        </span>
                      )}
                      {sale.totalCredits > 0 && !sale.totalCents && (
                        <span className="text-gray-500">{sale.totalCredits} cr</span>
                      )}
                      {sale.paymentMethod === 'card' && !sale.refundedAt && sale.stripePaymentIntentId && token && (
                        <button
                          onClick={async () => {
                            if (!confirm('Refund this sale to the member\'s card?')) return
                            setRefundingId(sale.id)
                            try {
                              await api.stripe.refund(sale.id, token)
                              setPurchases(prev => prev.map(s => s.id === sale.id ? { ...s, refundedAt: new Date().toISOString(), refundedCents: s.totalCents } : s))
                            } catch (e) {
                              alert(e instanceof Error ? e.message : 'Refund failed')
                            } finally { setRefundingId(null) }
                          }}
                          disabled={refundingId === sale.id}
                          className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-40 font-medium"
                        >
                          {refundingId === sale.id ? '…' : 'Refund'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subscription management (admin only — requires studioId + plans) */}
          {studioId && (
            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Membership</h3>
                {!sub && !showAssignPlan && plans.length > 0 && (
                  <button
                    onClick={() => setShowAssignPlan(true)}
                    className="text-xs px-3 py-1.5 bg-black text-white rounded-xl hover:bg-gray-800 transition-colors"
                  >
                    Assign plan
                  </button>
                )}
              </div>

              {sub ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{sub.planName}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${statusColor(sub.status)}`}>
                          {sub.status.toLowerCase()}
                        </span>
                        {sub.endDate && (
                          <span className="text-xs text-gray-400">
                            expires {new Date(sub.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      {sub.status === 'ACTIVE' && (
                        <>
                          {!showAssignPlan && plans.length > 0 && (
                            <button
                              onClick={() => setShowAssignPlan(true)}
                              className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                            >
                              Change plan
                            </button>
                          )}
                          <button
                            onClick={() => { setShowPauseForm(v => !v); setSubActionError(null) }}
                            className="text-xs px-3 py-1.5 rounded-xl border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            Pause
                          </button>
                          <button
                            onClick={() => cancelSubscription(sub.id)}
                            className="text-xs px-3 py-1.5 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {sub.status === 'PAUSED' && (
                        <>
                          <button
                            onClick={resumeSubscription}
                            disabled={subActioning}
                            className="text-xs px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
                          >
                            {subActioning ? 'Resuming…' : 'Resume'}
                          </button>
                          <button
                            onClick={() => cancelSubscription(sub.id)}
                            className="text-xs px-3 py-1.5 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Pause until date display */}
                  {sub.status === 'PAUSED' && sub.pausedUntil && (
                    <p className="text-xs text-amber-600">
                      Paused until {new Date(sub.pausedUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}

                  {/* Pause form */}
                  {showPauseForm && sub.status === 'ACTIVE' && (
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <p className="text-xs text-gray-500">Optionally set a date when the membership resumes automatically.</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="date"
                          value={pauseUntilDate}
                          onChange={e => setPauseUntilDate(e.target.value)}
                          className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                        />
                        <button
                          onClick={pauseSubscription}
                          disabled={subActioning}
                          className="px-3 py-1.5 bg-amber-500 text-white text-xs rounded-xl hover:bg-amber-600 transition-colors disabled:opacity-40"
                        >
                          {subActioning ? 'Pausing…' : 'Confirm pause'}
                        </button>
                        <button
                          onClick={() => { setShowPauseForm(false); setPauseUntilDate(''); setSubActionError(null) }}
                          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                      {subActionError && <p className="text-xs text-red-500">{subActionError}</p>}
                    </div>
                  )}

                  {/* Assign / change plan inline form */}
                  {showAssignPlan && (
                    <div className="pt-2 border-t border-gray-100 space-y-3">
                      <p className="text-xs text-gray-500">
                        {sub.status === 'ACTIVE' ? 'Switching plan will cancel the current one.' : 'Assign a new plan.'}
                      </p>
                      <select
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                        value={selectedPlanId}
                        onChange={e => setSelectedPlanId(e.target.value)}
                      >
                        <option value="">Select a plan…</option>
                        {plans.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {subError && <p className="text-xs text-red-500">{subError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={assignPlan}
                          disabled={subSaving || !selectedPlanId}
                          className="px-3 py-1.5 bg-black text-white text-xs rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                        >
                          {subSaving ? 'Saving…' : 'Assign'}
                        </button>
                        <button
                          onClick={() => { setShowAssignPlan(false); setSelectedPlanId('') }}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : showAssignPlan ? (
                <div className="space-y-3">
                  <select
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={selectedPlanId}
                    onChange={e => setSelectedPlanId(e.target.value)}
                  >
                    <option value="">Select a plan…</option>
                    {plans.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {subError && <p className="text-xs text-red-500">{subError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={assignPlan}
                      disabled={subSaving || !selectedPlanId}
                      className="px-3 py-1.5 bg-black text-white text-xs rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
                    >
                      {subSaving ? 'Saving…' : 'Assign'}
                    </button>
                    <button
                      onClick={() => { setShowAssignPlan(false); setSelectedPlanId('') }}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  {plans.length === 0 ? 'No plans configured for this studio.' : 'No active plan.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </TimeFormatProvider>
  )
}
