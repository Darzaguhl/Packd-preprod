'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, type AdminSession } from '@/lib/api'
import NavBar from '@/components/NavBar'
import RoomMapView from '@/components/room/RoomMapView'
import CreditModal from './CreditModal'

interface Studio {
  id: string
  name: string
  timezone: string
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function FronthostDashboard({ defaultStudioId }: { defaultStudioId?: string }) {
  const [token, setToken] = useState<string | null>(null)
  const [studios, setStudios] = useState<Studio[]>([])
  const [studioId, setStudioId] = useState<string | null>(defaultStudioId ?? null)
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null)
  const [creditModal, setCreditModal] = useState(false)
  const [date, setDate] = useState(isoDate(new Date()))

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
        if (!studioId && list.length > 0) setStudioId(list[0].id)
      } catch {
        // Fallback: keep defaultStudioId if provided
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load sessions whenever studio or date changes
  useEffect(() => {
    if (!token || !studioId) return
    setLoading(true)
    setSelectedSession(null)
    api.admin.sessions(studioId, date, token)
      .then(data => {
        setSessions(data)
        setSelectedSession(data[0] ?? null)
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [token, studioId, date])

  const now = new Date()
  const activeSession = sessions.find(s => new Date(s.startsAt) <= now && new Date(s.endsAt) >= now)

  const currentStudio = studios.find(s => s.id === studioId)

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <NavBar title="Front Desk" subtitle={currentStudio?.name ?? 'Check-in & customer management'}>
        <div className="flex items-center gap-3 pb-3 flex-wrap">
          {/* Studio switcher — only shown when assigned to more than one studio */}
          {studios.length > 1 && (
            <select
              value={studioId ?? ''}
              onChange={e => setStudioId(e.target.value)}
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
            onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <button
            onClick={() => setCreditModal(true)}
            className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            + Credits
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
                      onClick={() => setSelectedSession(s)}
                      className={`w-full text-left px-3 py-3 rounded-xl transition-colors ${
                        isSelected
                          ? 'bg-gray-900 text-white'
                          : 'hover:bg-gray-50 text-gray-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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

        {/* Main content — room map */}
        <div className="flex-1 overflow-auto p-6">
          {token && studioId && selectedSession ? (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">{selectedSession.templateName}</h2>
                <p className="text-xs text-gray-500">
                  {new Date(selectedSession.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {' – '}
                  {new Date(selectedSession.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {' · '}{selectedSession.roomName}
                  {' · '}{selectedSession.instructorName}
                </p>
              </div>
              <RoomMapView
                roomId={selectedSession.roomId}
                token={token}
                session={selectedSession}
                variant="checkin"
              />
            </div>
          ) : !loading && (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              {studioId ? 'Select a session to start check-in' : 'No studio assigned — contact your administrator.'}
            </div>
          )}
        </div>
      </div>

      {creditModal && token && studioId && (
        <CreditModal
          studioId={studioId}
          token={token}
          onClose={() => setCreditModal(false)}
        />
      )}
    </div>
  )
}
