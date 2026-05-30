'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminSession } from '@/lib/api'
import NavBar from '@/components/NavBar'
import RoomMapView, { type RoomMapViewHandle } from '@/components/room/RoomMapView'
import PhotosTab from '@/components/studio/PhotosTab'
import MemberDrawer from './MemberDrawer'
import type { SpotAssignment } from '@/lib/api'

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

export default function FronthostDashboard({ defaultStudioId, modeSwitch }: { defaultStudioId?: string; modeSwitch?: React.ReactNode }) {
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
  const [showPhotos, setShowPhotos] = useState(searchParams.get('view') === 'photos')
  const [showDrawer, setShowDrawer] = useState(false)
  const [drawerMember, setDrawerMember] = useState<DrawerMember | null>(null)
  const [drawerStation, setDrawerStation] = useState<{ id: string; label: string } | null>(null)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)
  const mapRef = useRef<RoomMapViewHandle>(null)
  const [orderedMemberIds, setOrderedMemberIds] = useState<Set<string>>(new Set())
  // Set if this user also has an instructor record (dual-role)
  const [myInstructorId, setMyInstructorId] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h')
  const [currency, setCurrency] = useState('USD')

  // Push current view state into the URL so browser refresh restores it
  function updateUrl(opts: { studio?: string | null; date?: string; view?: 'photos' | null }) {
    const params = new URLSearchParams(searchParams.toString())
    if (opts.studio !== undefined) {
      if (opts.studio) params.set('studio', opts.studio)
      else params.delete('studio')
    }
    if (opts.date !== undefined) params.set('date', opts.date)
    if (opts.view !== undefined) {
      if (opts.view) params.set('view', opts.view)
      else params.delete('view')
    }
    router.replace(`?${params.toString()}`)
  }

  function togglePhotos() {
    const next = !showPhotos
    setShowPhotos(next)
    updateUrl({ view: next ? 'photos' : null })
  }

  // Load token, then fetch assigned studios
  useEffect(() => {
    createClient().auth.getSession().then(async ({ data }) => {
      const t = data.session?.access_token ?? null
      setToken(t)
      if (!t) return

      try {
        const list = await api.staff.myStudios(t)
        setStudios(list)
        // If we don't have a studioId yet, pick the first assigned studio
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

  // Try to resolve instructor record — succeeds for dual-role users
  useEffect(() => {
    if (!token || !studioId) return
    api.franchise.myInstructor(studioId, token)
      .then(r => setMyInstructorId(r.id))
      .catch(() => { /* pure fronthost — no instructor record */ })
  }, [token, studioId])

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
      setSelectedSession(data[0] ?? null)
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

  const now = new Date()
  const activeSession = sessions.find(s => new Date(s.startsAt) <= now && new Date(s.endsAt) >= now)

  const currentStudio = studios.find(s => s.id === studioId)

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="flex flex-col h-screen bg-gray-50">
      <NavBar title="Front Desk" subtitle={currentStudio?.name ?? 'Check-in & customer management'} action={modeSwitch}>
        <div className="flex items-center gap-3 pb-3 flex-wrap">
          {/* Studio switcher — only shown when assigned to more than one studio */}
          {studios.length > 1 && (
            <select
              value={studioId ?? ''}
              onChange={e => { setStudioId(e.target.value); updateUrl({ studio: e.target.value }) }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {studios.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); updateUrl({ date: e.target.value }) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          {myInstructorId && (
            <button
              onClick={togglePhotos}
              className={`text-xs font-medium px-4 py-2 rounded-lg transition-colors ${
                showPhotos
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900'
              }`}
            >
              My Photos
            </button>
          )}
          <button
            onClick={() => { setDrawerMember(null); setShowDrawer(true) }}
            className="text-xs font-medium border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:border-gray-500 hover:text-gray-900 transition-colors"
          >
            Find member
          </button>
        </div>
      </NavBar>

      <div className="flex flex-1 min-h-0">
        {/* Session list sidebar */}
        <div className="w-72 shrink-0 bg-white border-r border-gray-100 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Sessions · {sessions.length} today
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-gray-50 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12 px-4">No sessions scheduled</p>
            ) : (
              <div className="p-2 space-y-1">
                {sessions.map(s => {
                  const isActive = s.id === activeSession?.id
                  const isSelected = s.id === selectedSession?.id
                  const start = new Date(s.startsAt)
                  const fillPct = s.capacity > 0 ? Math.round((s.bookedCount / s.capacity) * 100) : 0

                  return (
                    <button
                      key={s.id}
                      data-testid="session-row"
                      onClick={() => setSelectedSession(s)}
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
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">
                            LIVE
                          </span>
                        )}
                        <span className={`text-[10px] font-medium ml-auto ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                          {s.bookedCount}/{s.capacity}
                        </span>
                      </div>
                      <p className={`text-xs font-semibold mt-0.5 truncate ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                        {s.templateName}
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

        {/* Main content — photos or room map */}
        <div className="flex-1 overflow-auto p-6">
          {showPhotos && token && myInstructorId ? (
            <PhotosTab instructorId={myInstructorId} token={token} isManager={false} />
          ) : token && studioId && selectedSession ? (
            <div className="space-y-3">
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
                allowRemoveBooking
                onMemberClick={a => {
                  setDrawerMember({ id: a.memberId, name: a.memberName, creditBalance: a.creditBalance, membershipStatus: a.membershipStatus })
                  setDrawerStation(null)
                  setShowDrawer(true)
                }}
                onEmptyStationClick={s => {
                  setDrawerMember(null)
                  setDrawerStation(s)
                  setShowDrawer(true)
                }}
              />
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
