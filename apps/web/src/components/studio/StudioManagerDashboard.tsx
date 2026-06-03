'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminSession } from '@/lib/api-client'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import SessionPanel from '@/components/admin/SessionPanel'
import PermissionsTab from './PermissionsTab'
import StaffTab from './StaffTab'
import RoomsTab from './RoomsTab'
import SettingsTab from './SettingsTab'
import PhotosTab from './PhotosTab'
import SocialPhotosTab from './SocialPhotosTab'
import ProductsTab from './ProductsTab'
import MembersTab from './MembersTab'
import MembershipsTab from './MembershipsTab'
import AnalyticsTab from './AnalyticsTab'
import AuditLogTab from './AuditLogTab'
import NavBar from '@/components/NavBar'
import RoomMapView from '@/components/room/RoomMapView'
import CalendarView from '@/components/calendar/CalendarView'
import { TimeFormatProvider } from '@/lib/time-format-context'
import { fmtTime, type TimeFormat } from '@/lib/fmt-time'

type Tab = 'today' | 'calendar' | 'analytics' | 'rooms' | 'room' | 'permissions' | 'staff' | 'members' | 'memberships' | 'settings' | 'photos' | 'social' | 'products' | 'audit'

function toIsoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface Stats {
  todaySessions: number
  totalMembers: number
  totalBookingsToday: number
  waitlistToday: number
}

const INSTRUCTOR_TABS: Tab[] = ['today', 'calendar', 'room', 'photos']

type TaggedSession = AdminSession & { studioId: string; studioName: string }

export default function StudioManagerDashboard({ studioId, studioName: initialStudioName, onBack, onStudioUpdate, role, modeSwitch, studios: studioList }: { studioId: string; studioName?: string; onBack?: () => void; onStudioUpdate?: (data: { name: string; timezone: string; currency: string; timeFormat: string }) => void; role?: string; modeSwitch?: React.ReactNode; studios?: { id: string; name: string }[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [studioName, setStudioName] = useState(initialStudioName)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h')
  const [currency, setCurrency] = useState('USD')
  const VALID_TABS: Tab[] = ['today', 'calendar', 'analytics', 'rooms', 'room', 'permissions', 'staff', 'members', 'memberships', 'settings', 'photos', 'social', 'products', 'audit']
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab
    return VALID_TABS.includes(t) ? t : 'today'
  })

  function changeTab(next: Tab) {
    setTab(next)
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', next)
    router.replace(`?${p.toString()}`)
  }
  const [token, setToken] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [sessionRole, setSessionRole] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [sessions, setSessions] = useState<TaggedSession[]>([])
  const [studioFilter, setStudioFilter] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()))
  const [selectedSession, setSelectedSession] = useState<TaggedSession | null>(null)
  const [loading, setLoading] = useState(true)
  // Instructors default to seeing only their own classes; persisted in URL so tab switches don't reset it
  const [myClassesOnly, setMyClassesOnly] = useState<boolean>(() => {
    const param = searchParams.get('myClasses')
    return param !== null ? param === '1' : role === 'instructor'
  })

  function toggleMyClasses(next: boolean) {
    setMyClassesOnly(next)
    const p = new URLSearchParams(searchParams.toString())
    p.set('myClasses', next ? '1' : '0')
    router.replace(`?${p.toString()}`)
  }
  // For instructors: own Instructor record ID + resolved permissions
  const [myInstructorId, setMyInstructorId] = useState<string | null>(null)
  const [myMemberId, setMyMemberId] = useState<string | null>(null)
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null)
  const [myPermissions, setMyPermissions] = useState<import('@/lib/api').InstructorPermissions | null>(null)

  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      const t = session?.access_token ?? null
      const uid = session?.user?.id ?? null
      setToken(t)
      setCurrentUserId(uid)
      setSessionRole((session?.user?.app_metadata as { role?: string } | undefined)?.role ?? null)
      if (!t) return
      // Always load studio settings (name, timeFormat, currency) on mount —
      // not just when the Today tab is active — so all tabs have the right values.
      try {
        const st = await api.admin.stats(studioId, t)
        if (!initialStudioName && st.studioName) setStudioName(st.studioName)
        setTimeFormat((st.timeFormat ?? '24h') as TimeFormat)
        setCurrency(st.currency ?? 'USD')
      } catch { /* non-fatal */ }
      // Instructors: resolve own Instructor record + permissions
      if (role === 'instructor') {
        try {
          const mine = await api.franchise.myInstructor(studioId, t)
          setMyInstructorId(mine.id)
          setMyMemberId(mine.memberId)
          setMyAvatarUrl(mine.avatarUrl)
          setMyPermissions(mine.permissions)
        } catch { /* non-fatal */ }
      }
    })
  }, [role, studioId])

  const isMultiStudioInstructor = role === 'instructor' && !!studioList && studioList.length > 1

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      if (isMultiStudioInstructor && studioList) {
        // Fetch all studios in parallel and tag each session with its studio
        const results = await Promise.all(
          studioList.map(s =>
            api.admin.sessions(s.id, selectedDate, token)
              .then(rows => rows.map(r => ({ ...r, studioId: s.id, studioName: s.name })))
          )
        )
        setSessions(results.flat())
        setStats(null)
      } else {
        const [s, st] = await Promise.all([
          api.admin.sessions(studioId, selectedDate, token),
          api.admin.stats(studioId, token),
        ])
        setSessions(s.map(r => ({ ...r, studioId, studioName: studioName ?? st.studioName ?? '' })))
        setStats(st)
        if (!studioName && st.studioName) setStudioName(st.studioName)
        setTimeFormat((st.timeFormat ?? '24h') as TimeFormat)
        setCurrency(st.currency ?? 'USD')
      }
    } catch {
      // network/auth failure — leave existing data
    } finally {
      setLoading(false)
    }
  }, [token, studioId, selectedDate, studioName, isMultiStudioInstructor, studioList])

  useEffect(() => { if (tab === 'today') refresh() }, [refresh, tab])

  function formatTime(iso: string) {
    return fmtTime(iso, timeFormat)
  }

  function fillPct(s: AdminSession) {
    return Math.min((s.bookedCount / s.capacity) * 100, 100)
  }

  // Primary: high-frequency daily operations
  const PRIMARY_TAB_IDS: Tab[] = ['today', 'calendar', 'members', 'analytics']
  // Secondary: configuration and management (used less frequently)
  const SECONDARY_TAB_IDS: Tab[] = ['staff', 'memberships', 'products', 'rooms', 'permissions']
  // Archival: rarely needed
  const ARCHIVE_TAB_IDS: Tab[] = ['social', 'audit', 'settings']

  const ALL_TABS: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'members', label: 'Members' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'staff', label: 'Staff' },
    { id: 'memberships', label: 'Memberships' },
    { id: 'products', label: 'Products' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'room', label: 'Room map' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'social', label: 'Photos' },
    { id: 'audit', label: 'Audit' },
    { id: 'settings', label: 'Settings' },
    // 'photos' is instructor-only — not in the admin tab bar
    { id: 'photos', label: 'My Photos' },
  ]
  // Instructors see Today, Calendar, Photos. Room map is a hidden tab opened via session click.
  // Use the prop when explicitly set (e.g. DualRoleDashboard passes 'instructor'); otherwise
  // fall back to the role read from the Supabase session JWT.
  const effectiveRole = role ?? sessionRole
  const isAdminRole = effectiveRole === 'studio_admin' || effectiveRole === 'admin' || effectiveRole === 'franchise_admin'
  const TABS = effectiveRole === 'instructor'
    ? ALL_TABS.filter(t => INSTRUCTOR_TABS.includes(t.id) && t.id !== 'room')
    : ALL_TABS.filter(t => t.id !== 'room' && t.id !== 'photos')

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="h-screen overflow-hidden bg-gray-50 flex flex-col">
      <NavBar
        title={effectiveRole === 'instructor' ? 'Management' : (studioName ?? 'Studio Dashboard')}
        subtitle={effectiveRole === 'instructor' ? undefined : 'Studio management'}
        action={modeSwitch}
        leading={onBack ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mr-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
              <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All studios
          </button>
        ) : undefined}
      >
        {/* Tab bar — three visual groups separated by dividers */}
        <div className="flex items-stretch gap-0.5 pb-0 -mb-px overflow-x-auto scrollbar-none">
          {TABS.map((t, i) => {
            const prev = TABS[i - 1]
            const isFirstSecondary = prev && PRIMARY_TAB_IDS.includes(prev.id) && SECONDARY_TAB_IDS.includes(t.id)
            const isFirstArchive = prev && SECONDARY_TAB_IDS.includes(prev.id) && ARCHIVE_TAB_IDS.includes(t.id)
            const isSecondary = SECONDARY_TAB_IDS.includes(t.id)
            const isArchive = ARCHIVE_TAB_IDS.includes(t.id)
            return (
              <React.Fragment key={t.id}>
                {(isFirstSecondary || isFirstArchive) && (
                  <div className="self-center mx-1.5 w-px h-4 bg-gray-200 shrink-0" />
                )}
                <button
                  onClick={() => changeTab(t.id)}
                  className={`shrink-0 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-gray-900 text-gray-900'
                      : isArchive
                      ? 'border-transparent text-gray-300 hover:text-gray-500'
                      : isSecondary
                      ? 'border-transparent text-gray-400 hover:text-gray-600'
                      : 'border-transparent text-gray-400 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </NavBar>

      {tab === 'today' && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 space-y-6">
            {/* Stat cards — hidden for multi-studio instructor (stats are per-studio) */}
            {stats && !isMultiStudioInstructor && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Today's classes" value={stats.todaySessions} />
                <StatCard label="Bookings today" value={stats.totalBookingsToday} />
                <StatCard label="On waitlist" value={stats.waitlistToday} accent />
                <StatCard label="Total members" value={stats.totalMembers} />
              </div>
            )}

            {/* Studio filter pills — instructor with multiple studios */}
            {isMultiStudioInstructor && studioList && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setStudioFilter(null)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    studioFilter === null
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  All studios
                </button>
                {studioList.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStudioFilter(s.id)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      studioFilter === s.id
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* Date picker */}
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-700">Classes for</h2>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <button
                onClick={() => setSelectedDate(toIsoDate(new Date()))}
                className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
              >
                Today
              </button>
            </div>

            {/* My classes filter — instructors only */}
            {role === 'instructor' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleMyClasses(!myClassesOnly)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    myClassesOnly
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {myClassesOnly ? (
                    <>
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      My classes
                    </>
                  ) : 'My classes'}
                </button>
                {myClassesOnly && (
                  <button onClick={() => toggleMyClasses(false)} className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2">
                    Show all
                  </button>
                )}
              </div>
            )}

            {/* Session list */}
            {(() => {
              // Filter by instructor record ID (most reliable) with userId as fallback.
              // Also includes sessions where the instructor is the substitute.
              let visible = myClassesOnly && (myInstructorId || currentUserId)
                ? sessions.filter(s =>
                    (myInstructorId
                      ? s.instructorId === myInstructorId || s.substituteInstructorId === myInstructorId
                      : s.instructorUserId === currentUserId || s.substituteInstructorUserId === currentUserId
                    )
                  )
                : sessions
              if (studioFilter) visible = visible.filter(s => s.studioId === studioFilter)

              return loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-20 bg-white rounded-2xl animate-pulse border border-gray-100" />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {myClassesOnly ? 'No classes assigned to you on this day' : 'No classes scheduled for this day'}
                </div>
              ) : (
                <div className="space-y-2">
                  {visible.map((s) => {
                    const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
                    const pct = fillPct(s)
                    const isFull = s.bookedCount >= s.capacity
                    const isSelected = selectedSession?.id === s.id

                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (role === 'instructor') { setSelectedSession(s); changeTab('room') }
                          else setSelectedSession(isSelected ? null : s)
                        }}
                        onKeyDown={e => {
                          if (e.key !== 'Enter') return
                          if (role === 'instructor') { setSelectedSession(s); changeTab('room') }
                          else setSelectedSession(isSelected ? null : s)
                        }}
                        className={`w-full text-left flex items-stretch bg-white border rounded-2xl overflow-hidden transition-all duration-150 cursor-pointer ${
                          isSelected ? 'border-gray-900 shadow-md' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                        } ${s.status === 'CANCELLED' ? 'opacity-50' : ''}`}
                      >
                        <div className={`w-1 shrink-0 ${cfg.accent}`} />
                        <div className="flex-1 px-4 py-3 flex items-center gap-4">
                          <div className="w-20 shrink-0">
                            <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatTime(s.startsAt)}</p>
                            <p className="text-xs text-gray-400">
                              {Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000)}m
                            </p>
                          </div>
                          <div className="w-px h-8 bg-gray-100 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-gray-900 truncate">{s.templateName}</p>
                              {s.status === 'CANCELLED' && (
                                <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Cancelled</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate">
                              {s.instructorName} · {s.roomName}
                              {isMultiStudioInstructor && (
                                <span className="ml-1.5 inline-flex items-center text-[10px] font-medium bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                                  {s.studioName}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 text-right w-28">
                            <p className={`text-sm font-semibold tabular-nums ${isFull ? 'text-red-500' : 'text-gray-900'}`}>
                              {s.bookedCount}/{s.capacity}
                            </p>
                            <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden w-full">
                              <div
                                className={`h-full rounded-full ${isFull ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <svg className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isSelected ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                            <path d="M6 4l4 4-4 4" strokeLinecap="round" />
                          </svg>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* Slide-in session panel */}
          <div className={`border-l border-gray-100 bg-white transition-all duration-200 ${selectedSession ? 'w-96' : 'w-0 overflow-hidden'}`}>
            {selectedSession && token && (
              <SessionPanel
                session={selectedSession}
                token={token}
                canCancel={role !== 'instructor'}
                onClose={() => setSelectedSession(null)}
                onSessionUpdate={(updated) => {
                  setSessions(prev => prev.map(s => s.id === updated.id ? { ...updated, studioId: s.studioId, studioName: s.studioName } : s))
                  setSelectedSession(prev => prev ? { ...updated, studioId: prev.studioId, studioName: prev.studioName } : null)
                }}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'calendar' && token && (
        <div className="flex-1 flex flex-col min-h-0">
          {isMultiStudioInstructor && studioList && (
            <div className="flex items-center gap-2 px-6 pt-4 flex-wrap">
              {studioList.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStudioFilter(s.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    (studioFilter ?? studioList[0]?.id) === s.id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <CalendarView
            studioId={isMultiStudioInstructor ? (studioFilter ?? studioList?.[0]?.id ?? studioId) : studioId}
            token={token}
            canCreateSchedules={role === 'instructor' ? (myPermissions?.canCreateSchedules ?? false) : true}
            canSetSubstitute={role === 'instructor' ? (myPermissions?.canSetSubstitute ?? false) : true}
            filterInstructorId={role === 'instructor' ? (myInstructorId ?? undefined) : undefined}
            canReschedule={isAdminRole}
          />
        </div>
      )}

      {tab === 'analytics' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <AnalyticsTab studioId={studioId} token={token} canQuery={isAdminRole} />
        </div>
      )}

      {tab === 'rooms' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-4xl mx-auto w-full px-6 py-6">
            <RoomsTab studioId={studioId} token={token} canEdit={isAdminRole} />
          </div>
        </div>
      )}

      {tab === 'room' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto w-full px-6 py-6 space-y-4">
          <button
            onClick={() => { changeTab('today'); setSelectedSession(null) }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to today
          </button>

          {sessions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">Session</span>
              <select
                value={selectedSession?.id ?? ''}
                onChange={e => setSelectedSession(sessions.find(s => s.id === e.target.value) ?? null)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                <option value="">— no session selected —</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {s.templateName} · {s.roomName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <RoomMapView
            roomId={selectedSession?.roomId ?? sessions[0]?.roomId ?? ''}
            token={token}
            session={selectedSession}
            variant="checkin"
          />
        </div>
        </div>
      )}

      {tab === 'permissions' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <p className="text-sm text-gray-500 mb-4">
              Configure what each staff member is allowed to do within this studio.
            </p>
            <PermissionsTab studioId={studioId} token={token} />
          </div>
        </div>
      )}

      {tab === 'staff' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <p className="text-sm text-gray-500 mb-4">
              Manage staff for this studio. Assign instructor and front-desk roles — staff can hold both.
            </p>
            <StaffTab studioId={studioId} token={token} currency={currency} onOpenPermissions={() => changeTab('permissions')} />
          </div>
        </div>
      )}

      {tab === 'members' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <MembersTab studioId={studioId} token={token} />
          </div>
        </div>
      )}

      {tab === 'photos' && token && myInstructorId && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-5xl mx-auto w-full px-6 py-6">
            <p className="text-sm text-gray-500 mb-4">
              Your photo repository. Mark photos as approved for social media so the studio can use them for promotions.
            </p>
            <PhotosTab
            instructorId={myInstructorId}
            token={token}
            isManager={false}
            memberId={myMemberId ?? undefined}
            avatarUrl={myAvatarUrl}
            onAvatarChange={url => setMyAvatarUrl(url)}
          />
          </div>
        </div>
      )}

      {tab === 'social' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-5xl mx-auto w-full px-6 py-6">
            <SocialPhotosTab studioId={studioId} token={token} />
          </div>
        </div>
      )}

      {tab === 'products' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <ProductsTab studioId={studioId} token={token} currency={currency} />
          </div>
        </div>
      )}

      {tab === 'memberships' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <MembershipsTab studioId={studioId} token={token} currency={currency} />
          </div>
        </div>
      )}

      {tab === 'audit' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <AuditLogTab studioId={studioId} token={token} />
          </div>
        </div>
      )}

      {tab === 'settings' && token && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto w-full px-6 py-6">
            <SettingsTab
              studioId={studioId}
              token={token}
              onNameChange={setStudioName}
              onStudioUpdate={data => {
                setTimeFormat((data.timeFormat ?? '24h') as TimeFormat)
                setCurrency(data.currency ?? 'USD')
                onStudioUpdate?.(data)
              }}
            />
          </div>
        </div>
      )}
    </div>
    </TimeFormatProvider>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent ? 'text-amber-500' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
