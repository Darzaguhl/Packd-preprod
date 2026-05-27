'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminMemberProfile, type AdminMemberHistory, type MembershipPlan } from '@/lib/api'
import NavBar from '@/components/NavBar'
import MemberHistoryView from './MemberHistoryView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import type { UpcomingBooking, PastBooking, CreditTransaction } from '@/lib/api'

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
        setUpcoming(history.upcoming as UpcomingBooking[])
        setPastBookings(history.pastBookings)
        setTransactions(history.transactions)

        if (sid) {
          api.admin.stats(sid, t).then(s => setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')).catch(() => {})
          api.memberships.listPlans(sid, t).then(setPlans).catch(() => {})
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
                    <div className="flex gap-2 shrink-0">
                      {(sub.status === 'ACTIVE' || sub.status === 'PAUSED') && (
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
                            onClick={() => cancelSubscription(sub.id)}
                            className="text-xs px-3 py-1.5 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

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
