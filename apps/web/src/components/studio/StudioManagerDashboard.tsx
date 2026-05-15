'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminSession } from '@/lib/api'
import { SPORT_CONFIG } from '@/components/schedule/constants'
import SessionPanel from '@/components/admin/SessionPanel'
import PermissionsTab from './PermissionsTab'
import RoomsTab from './RoomsTab'
import SettingsTab from './SettingsTab'
import NavBar from '@/components/NavBar'
import RoomMapView from '@/components/room/RoomMapView'
import CalendarView from '@/components/calendar/CalendarView'

type Tab = 'today' | 'calendar' | 'rooms' | 'room' | 'permissions' | 'settings'

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

export default function StudioManagerDashboard({ studioId, studioName: initialStudioName, onBack, onStudioUpdate }: { studioId: string; studioName?: string; onBack?: () => void; onStudioUpdate?: (data: { name: string; timezone: string; currency: string }) => void }) {
  const [studioName, setStudioName] = useState(initialStudioName)
  const [tab, setTab] = useState<Tab>('today')
  const [token, setToken] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()))
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? null)
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [s, st] = await Promise.all([
        api.admin.sessions(studioId, selectedDate, token),
        api.admin.stats(studioId, token),
      ])
      setSessions(s)
      setStats(st)
    } catch {
      // network/auth failure — leave existing data
    } finally {
      setLoading(false)
    }
  }, [token, studioId, selectedDate])

  useEffect(() => { if (tab === 'today') refresh() }, [refresh, tab])

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  function fillPct(s: AdminSession) {
    return Math.min((s.bookedCount / s.capacity) * 100, 100)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'room', label: 'Room map' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar
        title={studioName ?? 'Studio Dashboard'}
        subtitle="Studio management"
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
        {/* Tab bar */}
        <div className="flex gap-1 pb-0 -mb-px">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </NavBar>

      {tab === 'today' && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 space-y-6">
            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Today's classes" value={stats.todaySessions} />
                <StatCard label="Bookings today" value={stats.totalBookingsToday} />
                <StatCard label="On waitlist" value={stats.waitlistToday} accent />
                <StatCard label="Total members" value={stats.totalMembers} />
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

            {/* Session list */}
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 bg-white rounded-2xl animate-pulse border border-gray-100" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No classes scheduled for this day</div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => {
                  const cfg = SPORT_CONFIG[s.sport] ?? SPORT_CONFIG.OTHER
                  const pct = fillPct(s)
                  const isFull = s.bookedCount >= s.capacity
                  const isSelected = selectedSession?.id === s.id

                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSession(isSelected ? null : s)}
                      onKeyDown={e => e.key === 'Enter' && setSelectedSession(isSelected ? null : s)}
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
                          <p className="text-xs text-gray-500 truncate">{s.instructorName} · {s.roomName}</p>
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
                        <button
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); setSelectedSession(s); setTab('room') }}
                          className="text-[10px] font-medium text-gray-400 border border-gray-200 rounded-md px-2 py-1 hover:border-gray-400 hover:text-gray-700 transition-colors shrink-0"
                        >
                          Map
                        </button>
                        <svg className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isSelected ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                          <path d="M6 4l4 4-4 4" strokeLinecap="round" />
                        </svg>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Slide-in session panel */}
          <div className={`border-l border-gray-100 bg-white transition-all duration-200 ${selectedSession ? 'w-96' : 'w-0 overflow-hidden'}`}>
            {selectedSession && token && (
              <SessionPanel
                session={selectedSession}
                token={token}
                onClose={() => setSelectedSession(null)}
                onSessionUpdate={(updated) => {
                  setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
                  setSelectedSession(updated)
                }}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'calendar' && token && (
        <div className="flex-1 flex flex-col min-h-0">
          <CalendarView studioId={studioId} token={token} />
        </div>
      )}

      {tab === 'rooms' && token && (
        <div className="max-w-4xl mx-auto w-full px-6 py-6">
          <RoomsTab studioId={studioId} token={token} />
        </div>
      )}

      {tab === 'room' && token && (
        <div className="max-w-5xl mx-auto w-full px-6 py-6 space-y-4">
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
      )}

      {tab === 'permissions' && token && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6">
          <p className="text-sm text-gray-500 mb-4">
            Configure what each instructor is allowed to do within this studio.
          </p>
          <PermissionsTab studioId={studioId} token={token} />
        </div>
      )}

      {tab === 'settings' && token && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6">
          <SettingsTab
            studioId={studioId}
            token={token}
            onNameChange={setStudioName}
            onStudioUpdate={onStudioUpdate}
          />
        </div>
      )}
    </div>
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
