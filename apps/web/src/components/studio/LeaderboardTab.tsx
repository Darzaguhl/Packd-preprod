'use client'

import React, { useState, useEffect } from 'react'
import { api, type Leaderboard } from '@/lib/api-client'

const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'alltime', label: 'All time' },
]

const MEDALS = ['🥇', '🥈', '🥉']

export default function LeaderboardTab({ studioId, token }: { studioId: string; token: string }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'alltime'>('month')
  const [data, setData] = useState<Leaderboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.admin.leaderboard(studioId, period, token)
      .then(setData)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [studioId, period, token])

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id as 'week' | 'month' | 'alltime')}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              period === p.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 h-64 bg-white rounded-2xl animate-pulse border border-gray-100" />
          <div className="lg:col-span-2 h-64 bg-white rounded-2xl animate-pulse border border-gray-100" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Members leaderboard */}
          <div className="lg:col-span-3 bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">Top members by visits</h3>
              <p className="text-xs text-gray-400 mt-0.5">{data.members.length} members ranked</p>
            </div>
            {data.members.length === 0 ? (
              <div className="px-5 py-12 text-center text-gray-400 text-sm">No visits in this period</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {data.members.map((m) => (
                  <div key={m.memberId} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 text-center shrink-0">
                      {m.rank <= 3 ? (
                        <span className="text-lg">{MEDALS[m.rank - 1]}</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400 tabular-nums">#{m.rank}</span>
                      )}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-gray-600">
                        {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                      <p className="text-xs text-gray-400">
                        {m.checkIns} checked in · Last: {new Date(m.lastVisit).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-gray-900 tabular-nums">{m.visits}</p>
                      <p className="text-xs text-gray-400">visits</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top instructors */}
          <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">Top instructors</h3>
              <p className="text-xs text-gray-400 mt-0.5">By total attendees</p>
            </div>
            {data.topInstructors.length === 0 ? (
              <div className="px-5 py-12 text-center text-gray-400 text-sm">No data for this period</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {data.topInstructors.map((instr) => (
                  <div key={instr.instructorId} className="flex items-center gap-3 px-5 py-4">
                    <div className="w-8 text-center shrink-0">
                      {instr.rank <= 3 ? (
                        <span className="text-lg">{MEDALS[instr.rank - 1]}</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400">#{instr.rank}</span>
                      )}
                    </div>
                    <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-indigo-600">
                        {instr.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{instr.name}</p>
                      <p className="text-xs text-gray-400">{instr.totalBookings} confirmed attendees</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
