'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, FULL_LIVE_PERMISSIONS } from '@/lib/api-client'
import type { AdminSession, AdminBooking, LivePermissions } from '@/lib/api-client'
import NavBar from '@/components/NavBar'
import RoomMapView, { type RoomMapViewHandle } from '@/components/room/RoomMapView'
import MemberDrawer from './MemberDrawer'

type DrawerMember = { id: string; name: string; creditBalance: number; membershipStatus: string | null }
import { TimeFormatProvider } from '@/lib/time-format-context'
import { fmtTime, type TimeFormat } from '@/lib/fmt-time'

interface Studio {
  id: string
  name: string
  timezone: string
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface FronthostProps {
  defaultStudioId?: string
  modeSwitch?: React.ReactNode
  /** When true, only show sessions where the current user is the instructor */
  myClassesOnly?: boolean
}

export default function LiveDashboard({ defaultStudioId, modeSwitch, myClassesOnly }: FronthostProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [token, setToken] = useState<string | null>(null)
  const [studios, setStudios] = useState<Studio[]>([])
  const [studioId, setStudioId] = useState<string | null>(
    searchParams.get('studio') ?? defaultStudioId ?? null,
  )
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null)
  const [date, setDate] = useState(searchParams.get('date') ?? isoDate(new Date()))
  const initialSessionId = searchParams.get('session')
  const [showDrawer, setShowDrawer] = useState(false)
  const [drawerMember, setDrawerMember] = useState<DrawerMember | null>(null)
  const [drawerStation, setDrawerStation] = useState<{ id: string; label: string } | null>(null)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)
  const mapRef = useRef<RoomMapViewHandle>(null)
  const [orderedMemberIds, setOrderedMemberIds] = useState<Set<string>>(new Set())
  const [attendees, setAttendees] = useState<AdminBooking[]>([])
  const [attendeesLoading, setAttendeesLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('member')
  const [perms, setPerms] = useState<LivePermissions>(FULL_LIVE_PERMISSIONS)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h')
  const [currency, setCurrency] = useState('USD')
  const [now, setNow] = useState(() => new Date())

  // Push current view state into the URL so browser refresh restores it
  function updateUrl(opts: { studio?: string | null; date?: string; session?: string | null }) {
    const params = new URLSearchParams(searchParams.toString())
    if (opts.studio !== undefined) {
      if (opts.studio) params.set('studio', opts.studio)
      else params.delete('studio')
    }
    if (opts.date !== undefined) params.set('date', opts.date)
    if (opts.session !== undefined) {
      if (opts.session) params.set('session', opts.session)
      else params.delete('session')
    }
    router.replace(`?${params.toString()}`)
  }

  // Load token + role, then fetch assigned studios
  useEffect(() => {
    createClient().auth.getSession().then(async ({ data }) => {
      const t = data.session?.access_token ?? null
      const role = (data.session?.user?.app_metadata?.role as string | undefined) ?? 'member'
      setToken(t)
      setCurrentUserId(data.session?.user?.id ?? null)
      setUserRole(role)
      if (!t) return

      try {
        const list = await api.staff.myStudios(t)
        setStudios(list)
        if (!studioId && list.length > 0) {
          setStudioId(list[0].id)
          updateUrl({ studio: list[0].id })
        }
      } catch {
        // Fallback: keep defaultStudioId if provided
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch permissions whenever studio or role changes.
  // Admins get full access; fronthost and instructor fetch their stored permissions.
  useEffect(() => {
    if (!token || !studioId) return
    const elevated = ['admin', 'brand_admin', 'franchise_admin', 'studio_admin']
    if (elevated.includes(userRole)) {
      setPerms(FULL_LIVE_PERMISSIONS)
      return
    }
    if (userRole === 'fronthost') {
      api.franchise.myFronthostPermissions(studioId, token)
        .then(({ permissions: p }) => setPerms({
          canCheckInMembers: p.canCheckInMembers,
          canManageBookings: p.canManageBookings,
          canManageWaitlist: p.canManageWaitlist,
          canViewMemberContact: p.canViewMemberContact,
          canGrantCredits: p.canGrantCredits,
          canAdjustCredits: p.canAdjustCredits,
          canIssueRefunds: p.canIssueRefunds,
          canOverrideBookingRestrictions: p.canOverrideBookingRestrictions,
        }))
        .catch(() => {}) // non-fatal — leave full access
      return
    }
    if (userRole === 'instructor') {
      api.franchise.myInstructor(studioId, token)
        .then(({ permissions: p }) => setPerms({
          canCheckInMembers: p.canCheckInMembers,
          canManageBookings: p.canManageBookings,
          canManageWaitlist: p.canManageWaitlist,
          canViewMemberContact: p.canViewMemberContact,
          canGrantCredits: p.canGrantCredits,
          canAdjustCredits: false,
          canIssueRefunds: false,
          canOverrideBookingRestrictions: p.canOverrideBookingRestrictions ?? false,
        }))
        .catch(() => {})
    }
  }, [token, studioId, userRole])

  // Load sessions whenever studio or date changes
  useEffect(() => {
    if (!token || !studioId) return
    setLoading(true)
    setSelectedSession(null)
    setOrderedMemberIds(new Set())
    Promise.all([
      api.admin.sessions(studioId, date, token),
      api.admin.stats(studioId, token).catch(() => null),
      api.admin.productSaleMemberIds(studioId, token, date).catch(() => ({ memberIds: [] as string[] })),
    ]).then(([data, stats, sales]) => {
      setSessions(data)
      // Restore the previously selected session from the URL, else pick the first visible one.
      // For instructors with myClassesOnly, only consider their own sessions so they don't
      // auto-land on a session that won't be in their filtered list.
      const visible = myClassesOnly && currentUserId
        ? data.filter(s => s.instructorUserId === currentUserId || s.substituteInstructorId === currentUserId)
        : data
      const restored = initialSessionId ? (visible.find(s => s.id === initialSessionId) ?? visible[0]) : visible[0]
      setSelectedSession(restored ?? null)
      if (stats) {
        setTimeFormat((stats.timeFormat ?? '24h') as TimeFormat)
        setCurrency(stats.currency ?? 'USD')
      }
      if (sales.memberIds.length > 0) {
        setOrderedMemberIds(new Set(sales.memberIds))
      }
    }).catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [token, studioId, date])

  // Re-fetch sessions when the AI assistant makes a mutating change
  useEffect(() => {
    if (!token || !studioId) return
    function handleAiChange() {
      // Refresh the room map immediately — both spot data and full layout
      mapRef.current?.refresh()
      setMapRefreshKey(k => k + 1)
      // Then sync session list (booking counts, check-in totals)
      api.admin.sessions(studioId!, date, token!).then(data => {
        setSessions(data)
        setSelectedSession(prev => data.find(s => s.id === prev?.id) ?? prev)
      }).catch(() => {})
    }
    window.addEventListener('ai:data-changed', handleAiChange)
    return () => window.removeEventListener('ai:data-changed', handleAiChange)
  }, [token, studioId, date])

  // Load attendees (confirmed bookings) whenever the selected session changes.
  // This powers the flat list fallback view for sessions without a room map.
  useEffect(() => {
    if (!selectedSession || !token) { setAttendees([]); return }
    setAttendeesLoading(true)
    api.admin.bookings(selectedSession.id, token)
      .then(setAttendees)
      .catch(() => setAttendees([]))
      .finally(() => setAttendeesLoading(false))
  }, [selectedSession?.id, token])

  // Tick every 30 seconds so LIVE/NEXT badges update without a page refresh
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const currentStudio = studios.find(s => s.id === studioId)

  // Instructors only see their own sessions (where they are lead or substitute)
  const displaySessions = myClassesOnly && currentUserId
    ? sessions.filter(s => s.instructorUserId === currentUserId || s.substituteInstructorUserId === currentUserId)
    : sessions

  const canCheckIn = perms.canCheckInMembers
  const canManageBookings = perms.canManageBookings

  const activeSession = displaySessions.find(s => new Date(s.startsAt) <= now && new Date(s.endsAt) >= now)
  const nextSession   = displaySessions.find(s => new Date(s.startsAt) > now)

  // When a session goes live, auto-select it if the user hasn't manually picked one
  const prevActiveIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (activeSession && activeSession.id !== prevActiveIdRef.current) {
      setSelectedSession(activeSession)
      updateUrl({ session: activeSession.id })
    }
    prevActiveIdRef.current = activeSession?.id
  }, [activeSession?.id])

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="flex flex-col h-screen bg-gray-50">
      <NavBar title="Live" subtitle={currentStudio?.name ?? 'Live'} action={modeSwitch}>
        <div className="flex items-center gap-3 pb-3 flex-wrap">
          {/* Studio switcher — only shown when assigned to more than one studio */}
          {studios.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Studio</span>
              <select
                value={studioId ?? ''}
                onChange={e => { setStudioId(e.target.value); updateUrl({ studio: e.target.value }) }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {studios.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); updateUrl({ date: e.target.value }) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          {canManageBookings && (
            <button
              onClick={() => { setDrawerMember(null); setShowDrawer(true) }}
              className="text-xs font-medium border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:border-gray-500 hover:text-gray-900 transition-colors"
            >
              Find member
            </button>
          )}
        </div>
      </NavBar>

      <div className="flex flex-1 min-h-0">
        {/* Session list sidebar */}
        <div className="w-72 shrink-0 bg-white border-r border-gray-100 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Sessions · {displaySessions.length} today{myClassesOnly ? ' (my classes)' : ''}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-gray-50 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : displaySessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12 px-4">
                {myClassesOnly ? 'No classes assigned to you today' : 'No sessions scheduled'}
              </p>
            ) : (
              <div className="p-2 space-y-1">
                {displaySessions.map(s => {
                  const isActive = s.id === activeSession?.id
                  const isNext   = !isActive && s.id === nextSession?.id
                  const isSelected = s.id === selectedSession?.id
                  const start = new Date(s.startsAt)
                  const fillPct = s.capacity > 0 ? Math.round((s.bookedCount / s.capacity) * 100) : 0

                  return (
                    <button
                      key={s.id}
                      data-testid="session-row"
                      onClick={() => { setSelectedSession(s); updateUrl({ session: s.id }) }}
                      className={`w-full text-left px-3 py-3 rounded-xl transition-colors ${
                        isSelected
                          ? 'bg-gray-900 text-white'
                          : 'hover:bg-gray-50 text-gray-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                          {fmtTime(start, timeFormat)}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white animate-pulse">
                            LIVE
                          </span>
                        )}
                        {isNext && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-gray-900">
                            NEXT
                          </span>
                        )}
                        <span className={`text-[10px] font-medium ml-auto ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                          {s.bookedCount}/{s.capacity}
                        </span>
                      </div>
                      <p className={`text-xs font-semibold mt-0.5 truncate flex items-center gap-1.5 ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                        {s.templateName}
                        {s.isPrivate && (
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-600'}`}>
                            PRIVATE
                          </span>
                        )}
                      </p>
                      <p className={`text-[11px] truncate ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                        {s.roomName} · {s.instructorName}
                      </p>
                      {/* Fill bar */}
                      <div className={`mt-2 h-1 rounded-full ${isSelected ? 'bg-white/20' : 'bg-gray-100'}`}>
                        <div
                          className={`h-1 rounded-full transition-all ${
                            fillPct >= 90 ? 'bg-red-400' : fillPct >= 70 ? 'bg-amber-400' : isSelected ? 'bg-white/60' : 'bg-emerald-400'
                          }`}
                          style={{ width: `${fillPct}%` }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main content — room map + attendee list */}
        <div className="flex-1 overflow-auto p-6">
          {token && studioId && selectedSession ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">{selectedSession.templateName}</h2>
                <p className="text-xs text-gray-500">
                  {fmtTime(selectedSession.startsAt, timeFormat)}
                  {' – '}
                  {fmtTime(selectedSession.endsAt, timeFormat)}
                  {' · '}{selectedSession.roomName}
                  {' · '}{selectedSession.instructorName}
                </p>
              </div>
              <RoomMapView
                ref={mapRef}
                roomId={selectedSession.roomId}
                token={token}
                session={selectedSession}
                variant="checkin"
                refreshKey={mapRefreshKey}
                orderedMemberIds={orderedMemberIds}
                allowRemoveBooking={canManageBookings}
                onMemberClick={a => {
                  setDrawerMember({ id: a.memberId, name: a.memberName, creditBalance: a.creditBalance, membershipStatus: a.membershipStatus })
                  setDrawerStation(null)
                  setShowDrawer(true)
                }}
                onEmptyStationClick={canManageBookings ? s => {
                  setDrawerMember(null)
                  setDrawerStation(s)
                  setShowDrawer(true)
                } : undefined}
              />

              {/* Attendee list — always shown; primary check-in surface when no room layout */}
              <div className="bg-white rounded-2xl border border-gray-100">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Attendees
                  </p>
                  {!attendeesLoading && (
                    <p className="text-xs text-gray-400">
                      {attendees.filter(a => a.checkedIn).length} / {attendees.length} checked in
                    </p>
                  )}
                </div>
                {attendeesLoading ? (
                  <div className="p-3 space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-9 bg-gray-50 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : attendees.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No bookings yet</p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {attendees.map(a => (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{a.memberName}</p>
                          {a.memberNote && (
                            <p className="text-xs text-amber-600 truncate">{a.memberNote}</p>
                          )}
                        </div>
                        {a.checkedIn ? (
                          <span className="shrink-0 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Checked in
                          </span>
                        ) : canCheckIn ? (
                          <button
                            onClick={async () => {
                              if (!token) return
                              try {
                                const res = await api.admin.checkin(selectedSession.id, a.id, token)
                                setAttendees(prev => prev.map(x => x.id === a.id ? { ...x, checkedIn: res.checkedIn } : x))
                                mapRef.current?.refresh()
                              } catch { /* ignore — map will show state */ }
                            }}
                            className="shrink-0 text-xs font-medium text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                          >
                            Check in
                          </button>
                        ) : (
                          <span className="shrink-0 text-xs text-gray-300">Booked</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : !loading && (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              {studioId ? 'Select a session to start check-in' : 'No studio assigned — contact your administrator.'}
            </div>
          )}
        </div>
      </div>

      {showDrawer && studioId && (
        <MemberDrawer
          studioId={studioId}
          currency={currency}
          selectedSession={selectedSession}
          permissions={perms}
          initialMember={drawerMember ?? undefined}
          targetStation={drawerStation ?? undefined}
          onAssigned={() => {
              // Call refresh() directly on the map — bypasses the refreshKey →
              // useCallback → useEffect chain which can miss renders under concurrency.
              mapRef.current?.refresh()
              setMapRefreshKey(k => k + 1) // keep for any other consumers
            }}
          onPatchCheckin={(bookingId, checkedIn) => mapRef.current?.patchCheckin(bookingId, checkedIn)}
          onProductsCharged={memberId => setOrderedMemberIds(prev => new Set([...prev, memberId]))}
          onClose={() => { setShowDrawer(false); setDrawerMember(null); setDrawerStation(null) }}
          onBookingChanged={() => {
            // Re-fetch sessions so booked counts stay accurate
            if (!token || !studioId) return
            api.admin.sessions(studioId, date, token)
              .then(data => {
                setSessions(data)
                // Keep selectedSession in sync
                setSelectedSession(prev =>
                  prev ? (data.find(s => s.id === prev.id) ?? prev) : null
                )
              })
              .catch(() => {})
          }}
        />
      )}
    </div>
    </TimeFormatProvider>
  )
}
