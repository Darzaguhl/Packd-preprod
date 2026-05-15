'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { api, type UpcomingBooking } from '@/lib/api'
import type { MemberProfile } from '@packd/types'
import { sportConfig } from '@/components/schedule/constants'
import NavBar from '@/components/NavBar'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function durationMin(startsAt: string, endsAt: string) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000)
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Global Admin',
  franchise_admin: 'Franchise Admin',
  studio_admin: 'Studio Admin',
  instructor: 'Instructor',
  member: 'Member',
}


export default function AccountView() {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [bookings, setBookings] = useState<UpcomingBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelLoading, setCancelLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const t = session?.access_token ?? null
        setToken(t)
        if (session?.user) setAuthUser(session.user)
        if (!t) return Promise.resolve(null)
        // Fetch member profile + bookings — may 404 for non-member roles, that's fine
        return Promise.allSettled([api.members.me(t), api.members.bookings(t)])
      })
      .then((results) => {
        if (!results) return
        const [profileResult, bookingsResult] = results
        if (profileResult.status === 'fulfilled') setProfile(profileResult.value)
        if (bookingsResult.status === 'fulfilled') setBookings(bookingsResult.value)
      })
      .finally(() => setLoading(false))
  }, [])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleCancel(bookingId: string) {
    if (!token) return
    setCancelLoading(bookingId)
    try {
      const res = await api.bookings.cancel(bookingId, token)
      if (res.success) {
        setBookings((prev) => prev.filter((b) => b.id !== bookingId))
        showToast(
          res.data.isLateCancel ? 'Cancelled — late cancel fee applied' : 'Booking cancelled',
          !res.data.isLateCancel,
        )
        if (profile && res.data.isLateCancel) {
          setProfile({ ...profile, creditBalance: profile.creditBalance - 1 })
        }
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to cancel', false)
    } finally {
      setCancelLoading(null)
    }
  }

  const role = (authUser?.app_metadata as { role?: string } | undefined)?.role
  const roleLabel = ROLE_LABELS[role ?? ''] ?? 'Member'

  // Display name: prefer member profile, fall back to email prefix
  const displayName = profile
    ? `${profile.firstName} ${profile.lastName}`
    : authUser?.email?.split('@')[0] ?? ''

  const displayEmail = profile?.email ?? authUser?.email ?? ''

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
          <div className="h-28 bg-white rounded-2xl animate-pulse border border-gray-100" />
          <div className="h-20 bg-white rounded-2xl animate-pulse border border-gray-100" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar title="My Account" />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Profile card — always shown */}
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-900 text-white flex items-center justify-center text-lg font-bold shrink-0 select-none">
            {initials(displayName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-gray-900">{displayName}</p>
            <p className="text-sm text-gray-400 truncate">{displayEmail}</p>
            <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-100 rounded-md px-1.5 py-0.5">
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Credits + subscription — only when member profile exists */}
        {profile && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400 font-medium mb-1">Credits</p>
              <p className="text-3xl font-bold tabular-nums text-gray-900">{profile.creditBalance}</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
              <p className="text-xs text-gray-400 font-medium mb-1">Membership</p>
              {profile.activeSubscription ? (
                <>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{profile.activeSubscription.planName}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-xs text-gray-400">
                      {profile.activeSubscription.endDate
                        ? `Renews ${new Date(profile.activeSubscription.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : 'Active'}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400 mt-1">No active plan</p>
              )}
            </div>
          </div>
        )}

        {/* Upcoming bookings — only when member profile exists */}
        {profile ? (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Upcoming classes</h2>

            {bookings.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">No upcoming bookings</p>
                <a href="/schedule" className="mt-2 inline-block text-sm text-gray-500 underline underline-offset-2">
                  Browse the schedule
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                {bookings.map((b) => {
                  const cfg = sportConfig(b.sport)
                  const isCancelling = cancelLoading === b.id

                  return (
                    <div
                      key={b.id}
                      className="bg-white border border-gray-100 rounded-2xl overflow-hidden flex items-stretch"
                    >
                      <div className={`w-1 shrink-0 ${cfg.accent}`} />

                      <div className="flex-1 px-4 py-3 flex items-center gap-4">
                        <div className="shrink-0 w-24">
                          <p className="text-xs font-medium text-gray-500">{formatDate(b.startsAt)}</p>
                          <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatTime(b.startsAt)}</p>
                          <p className="text-xs text-gray-400">{durationMin(b.startsAt, b.endsAt)}m</p>
                        </div>

                        <div className="w-px h-10 bg-gray-100 shrink-0" />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{b.templateName}</p>
                          <p className="text-xs text-gray-500 truncate">{b.instructorName} · {b.roomName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{b.creditsRequired} credit{b.creditsRequired !== 1 ? 's' : ''}</p>
                        </div>

                        <button
                          onClick={() => handleCancel(b.id)}
                          disabled={isCancelling || b.sessionStatus === 'CANCELLED'}
                          className="shrink-0 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1"
                        >
                          {isCancelling ? (
                            <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                          ) : (
                            'Cancel'
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* Non-member role — no credits/bookings section */
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 text-center">
            <p className="text-sm text-gray-400">
              This account doesn't have a member profile.
            </p>
            <p className="text-xs text-gray-300 mt-1">
              Member credits, subscriptions and bookings are not available for this role.
            </p>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-all ${
            toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
