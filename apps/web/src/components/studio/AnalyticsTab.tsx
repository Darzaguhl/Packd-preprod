'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { api, type AnalyticsData } from '@/lib/api-client'
import QueryTab from './QueryTab'
import LeaderboardTab from './LeaderboardTab'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%` }

function weekLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Interpolate between two rgb triples
function lerpColor(from: [number, number, number], to: [number, number, number], t: number): string {
  const r = Math.round(from[0] + (to[0] - from[0]) * t)
  const g = Math.round(from[1] + (to[1] - from[1]) * t)
  const b = Math.round(from[2] + (to[2] - from[2]) * t)
  return `rgb(${r},${g},${b})`
}

const EMPTY: [number, number, number] = [243, 244, 246]  // gray-100
const FULL:  [number, number, number] = [6, 78, 59]      // emerald-950

const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6)  // 06:00–21:00

// ─── Delta arrow ──────────────────────────────────────────────────────────────

function Delta({ value, pctFormat = true }: { value: number; pctFormat?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-[10px] text-gray-400">—</span>
  const up = value > 0
  const label = pctFormat
    ? `${up ? '+' : ''}${Math.round(value * 100)}pp`
    : `${up ? '+' : ''}${value.toFixed(1)}`
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      <svg viewBox="0 0 8 8" className={`w-2 h-2 shrink-0 ${up ? '' : 'rotate-180'}`}>
        <path d="M4 1 L7 6 L1 6 Z" fill="currentColor" />
      </svg>
      {label}
    </span>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, delta,
}: {
  label: string; value: string; sub?: string; delta?: number
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold tabular-nums text-gray-900 leading-none">{value}</p>
        {delta !== undefined && <div className="mb-0.5"><Delta value={delta} /></div>}
      </div>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

// ─── SVG line chart ───────────────────────────────────────────────────────────

interface ChartSeries { name: string; color: string; values: number[] }

function SvgLineChart({
  series,
  xLabels,
  yMax = 1,
  yFormat = (v: number) => `${Math.round(v * 100)}%`,
}: {
  series: ChartSeries[]
  xLabels: string[]
  yMax?: number
  yFormat?: (v: number) => string
}) {
  const ref = useRef<SVGPathElement[]>([])
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    // Animate stroke on mount
    const timer = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(timer)
  }, [series])

  const W = 600, H = 160
  const PAD = { t: 8, r: 8, b: 28, l: 36 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b
  const n = series[0]?.values.length ?? 0

  function toX(i: number) {
    return PAD.l + (n > 1 ? (i / (n - 1)) * iW : iW / 2)
  }
  function toY(v: number) {
    return PAD.t + iH - Math.min(v / yMax, 1) * iH
  }

  function smoothPath(values: number[]) {
    if (values.length < 2) return ''
    const pts = values.map((v, i) => ({ x: toX(i), y: toY(v) }))
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 1; i < pts.length; i++) {
      const tension = (pts[i].x - pts[i - 1].x) * 0.35
      d += ` C ${(pts[i - 1].x + tension).toFixed(1)} ${pts[i - 1].y.toFixed(1)},`
      d += ` ${(pts[i].x - tension).toFixed(1)} ${pts[i].y.toFixed(1)},`
      d += ` ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
    }
    return d
  }

  const gridLines = [0.25, 0.5, 0.75, 1.0].map(v => v * yMax)

  // Pick which x-axis labels to show
  const step = Math.max(1, Math.ceil(n / 8))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {gridLines.map(v => (
        <g key={v}>
          <line
            x1={PAD.l} x2={W - PAD.r}
            y1={toY(v)} y2={toY(v)}
            stroke="#f3f4f6" strokeWidth="1"
          />
          <text x={PAD.l - 4} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
            {yFormat(v)}
          </text>
        </g>
      ))}
      {/* Zero line */}
      <line
        x1={PAD.l} x2={W - PAD.r}
        y1={toY(0)} y2={toY(0)}
        stroke="#e5e7eb" strokeWidth="1"
      />

      {/* Series */}
      {series.map((s, si) => {
        const d = smoothPath(s.values)
        if (!d) return null
        const pathLen = 9999 // overestimate; clipping handles animation
        return (
          <path
            key={s.name}
            ref={el => { if (el) ref.current[si] = el }}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={drawn ? undefined : `${pathLen}`}
            strokeDashoffset={drawn ? 0 : pathLen}
            style={{ transition: drawn ? 'stroke-dashoffset 0.8s ease' : undefined }}
          />
        )
      })}

      {/* Dots at data points (last point highlighted) */}
      {series.map(s =>
        s.values.map((v, i) => (
          <circle
            key={`${s.name}-${i}`}
            cx={toX(i)} cy={toY(v)} r={i === n - 1 ? 4 : 2.5}
            fill="white" stroke={s.color}
            strokeWidth={i === n - 1 ? 2 : 1.5}
            opacity={i === n - 1 ? 1 : 0.5}
          />
        ))
      )}

      {/* X-axis labels */}
      {xLabels.map((label, i) =>
        i % step === 0 ? (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {label}
          </text>
        ) : null
      )}
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface StudioOption { id: string; name: string }

interface Props {
  studioId: string
  token: string
  canQuery?: boolean
  /** When provided, shows a studio picker for franchise-wide view. 'all' is prepended automatically. */
  studios?: StudioOption[]
}

export default function AnalyticsTab({ studioId: initialStudioId, token, canQuery = false, studios }: Props) {
  const [view, setView]           = useState<'analytics' | 'leaderboard' | 'query' | 'retention' | 'revenue' | 'churn'>('analytics')
  const [selectedStudio, setSelectedStudio] = useState(initialStudioId)
  const [data, setData]           = useState<AnalyticsData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [weeks, setWeeks]         = useState(12)

  // Sync if parent changes the studioId (e.g. drill-in from franchise)
  useEffect(() => { setSelectedStudio(initialStudioId) }, [initialStudioId])

  useEffect(() => {
    setLoading(true)
    setData(null)
    api.admin.analytics(selectedStudio, token, weeks)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedStudio, token, weeks])

  // Studio picker (franchise admins only)
  const studioPicker = studios && studios.length > 0 ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-400 shrink-0">Studio:</span>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => { setSelectedStudio('all'); setView('analytics') }}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            selectedStudio === 'all'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All studios
        </button>
        {studios.map(s => (
          <button
            key={s.id}
            onClick={() => setSelectedStudio(s.id)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              selectedStudio === s.id
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  ) : null

  // isPerStudio: leaderboard only makes sense for a specific studio
  const isPerStudio = selectedStudio !== 'all'

  // Heatmap lookup map
  const heatmapGrid = useMemo(() => {
    if (!data) return new Map<string, { fillRate: number; count: number }>()
    const m = new Map<string, { fillRate: number; count: number }>()
    for (const cell of data.heatmap) m.set(`${cell.dow}_${cell.hour}`, cell)
    return m
  }, [data])

  // Period-over-period: split weeklyTrend in two halves, compare averages
  const deltas = useMemo(() => {
    if (!data || data.weeklyTrend.length < 4) return null
    const mid   = Math.floor(data.weeklyTrend.length / 2)
    const prior = data.weeklyTrend.slice(0, mid)
    const curr  = data.weeklyTrend.slice(mid)

    function avg(arr: typeof curr, key: keyof typeof curr[0]): number {
      const vals = arr.map(w => w[key] as number)
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
    }

    return {
      fill:    avg(curr, 'avgFillRate')  - avg(prior, 'avgFillRate'),
      checkIn: avg(curr, 'checkInRate')  - avg(prior, 'checkInRate'),
    }
  }, [data])

  // Custom Query is only available when a specific studio is selected
  const canShowQuery = canQuery && isPerStudio

  // ── Deep analytics data ────────────────────────────────────────────────────
  type RetentionData = { cohorts: { month: string; size: number; offsets: { offset: number; pct: number }[] }[] }
  type RevenueData = {
    monthly: { month: string; revenue: number; orders: number; forecast: boolean }[]
    mrr: { month: string; mrr: number }[]
    forecast: { month: string; revenue: number; forecast: boolean }[]
  }
  type ChurnMember = { memberId: string; name: string; email: string; totalBookings: number; lastBookedAt: string | null; avgDaysBetween: number | null; daysSinceLast: number | null }

  const [retentionData, setRetentionData] = useState<RetentionData | null>(null)
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null)
  const [churnData, setChurnData] = useState<{ members: ChurnMember[] } | null>(null)
  const [deepLoading, setDeepLoading] = useState(false)

  const loadDeep = useCallback((v: string) => {
    if (v === 'retention' && !retentionData) {
      setDeepLoading(true)
      api.admin.retention(selectedStudio, token).then(setRetentionData).catch(() => {}).finally(() => setDeepLoading(false))
    } else if (v === 'revenue' && !revenueData) {
      setDeepLoading(true)
      api.admin.revenue(selectedStudio, token).then(setRevenueData).catch(() => {}).finally(() => setDeepLoading(false))
    } else if (v === 'churn' && !churnData) {
      setDeepLoading(true)
      api.admin.churnRisk(selectedStudio, token).then(setChurnData).catch(() => {}).finally(() => setDeepLoading(false))
    }
  }, [selectedStudio, token, retentionData, revenueData, churnData])

  // Reset deep data when studio changes
  useEffect(() => { setRetentionData(null); setRevenueData(null); setChurnData(null) }, [selectedStudio])

  type SubView = 'analytics' | 'leaderboard' | 'query' | 'retention' | 'revenue' | 'churn'
  const subViews: { id: SubView; label: string; show: boolean }[] = [
    { id: 'analytics',   label: 'Overview',      show: true },
    { id: 'retention',   label: 'Retention',     show: isPerStudio },
    { id: 'revenue',     label: 'Revenue',       show: isPerStudio },
    { id: 'churn',       label: 'Churn risk',    show: isPerStudio },
    { id: 'leaderboard', label: 'Leaderboard',   show: isPerStudio },
    { id: 'query',       label: 'Custom Query',  show: canShowQuery },
  ]

  // Sub-nav header (shared between all views)
  const subNav = (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
      {subViews.filter(v => v.show).map(v => (
        <button
          key={v.id}
          onClick={() => { setView(v.id); loadDeep(v.id) }}
          className={`text-xs font-medium px-4 py-1.5 rounded-md transition-colors ${
            view === v.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  )

  // ── Retention cohort view ──────────────────────────────────────────────────
  if (view === 'retention' && isPerStudio) {
    if (!retentionData && !deepLoading) loadDeep('retention')
    const maxOffset = retentionData
      ? Math.max(...retentionData.cohorts.flatMap(c => c.offsets.map(o => o.offset)), 0)
      : 11
    const offsets = Array.from({ length: maxOffset + 1 }, (_, i) => i)

    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {studioPicker}
        {subNav}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Member retention by cohort</h3>
          <p className="text-xs text-gray-400 mb-4">% of members from each signup month still booking in subsequent months.</p>
          {deepLoading ? (
            <div className="h-48 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ) : !retentionData?.cohorts.length ? (
            <p className="text-sm text-gray-400 py-8 text-center">Not enough data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">Cohort</th>
                    <th className="px-2 py-2 text-gray-500 font-medium">Size</th>
                    {offsets.map(o => (
                      <th key={o} className="px-2 py-2 text-gray-500 font-medium">M+{o}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {retentionData.cohorts.map(c => {
                    const pctMap = new Map(c.offsets.map(o => [o.offset, o.pct]))
                    return (
                      <tr key={c.month}>
                        <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap font-medium">
                          {new Date(c.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                        </td>
                        <td className="px-2 py-1.5 text-center text-gray-500">{c.size}</td>
                        {offsets.map(o => {
                          const v = pctMap.get(o)
                          const bg = v == null ? 'bg-gray-50' : v >= 70 ? 'bg-emerald-600 text-white' : v >= 40 ? 'bg-emerald-200 text-emerald-900' : v >= 20 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-50 text-red-700'
                          return (
                            <td key={o} className={`px-2 py-1.5 text-center rounded ${bg}`}>
                              {v == null ? '—' : `${v}%`}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Revenue view ───────────────────────────────────────────────────────────
  if (view === 'revenue' && isPerStudio) {
    if (!revenueData && !deepLoading) loadDeep('revenue')
    const allMonths = [...(revenueData?.monthly ?? []), ...(revenueData?.forecast ?? [])]
    const maxRev = Math.max(...allMonths.map(m => m.revenue), 1)

    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-6">
        {studioPicker}
        {subNav}
        {deepLoading ? (
          <div className="h-64 bg-white rounded-xl border border-gray-100 animate-pulse" />
        ) : !revenueData ? null : (
          <>
            {/* Revenue bar chart */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly revenue</h3>
              <div className="flex items-end gap-1 h-40">
                {allMonths.map(m => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div
                      className={`w-full rounded-t transition-all ${m.forecast ? 'bg-indigo-200' : 'bg-gray-800'}`}
                      style={{ height: `${Math.round((m.revenue / maxRev) * 100)}%`, minHeight: m.revenue > 0 ? 4 : 0 }}
                    />
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">
                      {new Date(m.month).toLocaleDateString('en-GB', { month: 'short' })}
                      {m.forecast ? '*' : ''}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">* Forecast based on 3-month average</p>
            </div>

            {/* MRR */}
            {revenueData.mrr.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription MRR</h3>
                <div className="space-y-2">
                  {revenueData.mrr.slice(-6).map(m => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-16 shrink-0">
                        {new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.round((m.mrr / Math.max(...revenueData.mrr.map(r => r.mrr), 1)) * 100)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-20 text-right shrink-0">
                        {(m.mrr / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Churn risk view ────────────────────────────────────────────────────────
  if (view === 'churn' && isPerStudio) {
    if (!churnData && !deepLoading) loadDeep('churn')
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {studioPicker}
        {subNav}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">At-risk members</h3>
          <p className="text-xs text-gray-400 mb-4">Members with 3+ bookings whose last visit was 2.5× longer ago than their usual cadence.</p>
          {deepLoading ? (
            <div className="h-48 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ) : !churnData?.members.length ? (
            <div className="bg-white rounded-xl border border-gray-100 py-10 text-center">
              <p className="text-sm text-gray-400">No at-risk members right now.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
              {churnData.members.map(m => (
                <div key={m.memberId} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{m.name}</p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-red-500">{m.daysSinceLast}d since last visit</p>
                    <p className="text-xs text-gray-400">
                      usual: every {m.avgDaysBetween}d · {m.totalBookings} total bookings
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view === 'leaderboard' && isPerStudio) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {studioPicker}
        {subNav}
        <LeaderboardTab studioId={selectedStudio} token={token} />
      </div>
    )
  }

  if (view === 'query' && canShowQuery) {
    return (
      <div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 space-y-4">
          {studioPicker}
          {subNav}
        </div>
        <QueryTab studioId={selectedStudio} token={token} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {studioPicker}
        {subNav}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-40 bg-white rounded-2xl animate-pulse border border-gray-100" />
        ))}
      </div>
    )
  }

  if (!data) {
    return <p className="text-sm text-gray-400 text-center py-16">Failed to load analytics.</p>
  }

  const { funnel, weeklyTrend, classStats, instructors, recurrence } = data

  // Aggregate fill + check-in across the full window
  const totalSessions = weeklyTrend.reduce((s, w) => s + w.sessions, 0)
  const overallFill = weeklyTrend.length > 0
    ? weeklyTrend.reduce((s, w) => s + w.avgFillRate * w.sessions, 0) /
      Math.max(totalSessions, 1)
    : 0
  const overallCheckIn = funnel.confirmed > 0 ? funnel.checkedIn / funnel.confirmed : 0

  // SVG chart series
  const trendSeries: ChartSeries[] = [
    { name: 'Fill rate',    color: '#1f2937', values: weeklyTrend.map(w => w.avgFillRate) },
    { name: 'Check-in rate', color: '#059669', values: weeklyTrend.map(w => w.checkInRate) },
  ]
  const xLabels = weeklyTrend.map(w => weekLabel(w.weekStart))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">

      {/* ── Studio picker (franchise admins) ── */}
      {studioPicker}

      {/* ── Sub-nav + window selector ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {subNav}
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{totalSessions}</span> sessions · {weeks}w window
          </p>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {[4, 8, 12, 24].map(w => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                  weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {w}w
              </button>
            ))}
          </div>
          {/* CSV export buttons */}
          {isPerStudio && (
            <div className="flex gap-1">
              {(['members', 'attendance', 'revenue', 'instructor-pay', 'staff-pay'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => api.admin.exportCsv(type, selectedStudio, token).catch(() => alert('Export failed'))}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center gap-1"
                  title={`Download ${type} CSV`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v7M3 5l3 3 3-3M2 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {type === 'instructor-pay' ? 'Instructor Pay' : type === 'staff-pay' ? 'Staff Pay' : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Overview stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Avg fill rate"
          value={pct(overallFill)}
          sub="confirmed / capacity"
          delta={deltas?.fill}
        />
        <StatCard
          label="Check-in rate"
          value={pct(overallCheckIn)}
          sub="of confirmed bookings"
          delta={deltas?.checkIn}
        />
        <StatCard
          label="Return rate"
          value={pct(recurrence.monthOverMonth)}
          sub="month-over-month"
        />
        <StatCard
          label="Avg visits / member"
          value={recurrence.avgBookingsPerMember.toFixed(1)}
          sub={`over ${weeks} weeks`}
        />
      </div>

      {/* ── Weekly trend (SVG line chart) ── */}
      <Section title="Weekly trend — fill rate & check-in rate">
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
          {weeklyTrend.length < 2 ? (
            <p className="text-sm text-gray-400 text-center py-8">Not enough data yet</p>
          ) : (
            <>
              <SvgLineChart series={trendSeries} xLabels={xLabels} />
              <div className="flex gap-5 mt-3 justify-end">
                {trendSeries.map(s => (
                  <span key={s.name} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="w-4 h-0.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── Booking funnel ── */}
      <Section title="Booking funnel">
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
          {(() => {
            const total = funnel.confirmed + funnel.onTimeCancelled + funnel.lateCancelled
            const bars = [
              { label: 'Total bookings',  value: total,                  color: 'bg-gray-200',    text: 'text-gray-600' },
              { label: 'Confirmed',       value: funnel.confirmed,       color: 'bg-gray-800',    text: 'text-gray-900' },
              { label: 'Checked in',      value: funnel.checkedIn,       color: 'bg-emerald-600', text: 'text-emerald-700' },
              { label: 'On-time cancel',  value: funnel.onTimeCancelled, color: 'bg-amber-400',   text: 'text-amber-700' },
              { label: 'Late cancel',     value: funnel.lateCancelled,   color: 'bg-orange-400',  text: 'text-orange-700' },
              { label: 'No-show',         value: funnel.noShow,          color: 'bg-red-400',     text: 'text-red-700' },
            ]
            const maxVal = Math.max(total, 1)
            return (
              <div className="space-y-2.5">
                {bars.map(b => (
                  <div key={b.label} className="flex items-center gap-3">
                    <p className="text-xs text-gray-500 w-28 shrink-0">{b.label}</p>
                    <div className="flex-1 bg-gray-50 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${b.color}`}
                        style={{ width: `${(b.value / maxVal) * 100}%` }}
                      />
                    </div>
                    <p className={`text-xs font-semibold tabular-nums w-10 text-right ${b.text}`}>
                      {b.value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </Section>

      {/* ── Utilisation heatmap ── */}
      <Section title="Utilisation heatmap — fill rate by day & time">
        <div className="bg-white rounded-2xl border border-gray-100 px-4 sm:px-6 py-5 overflow-x-auto">
          <div className="min-w-[340px]">
            <div className="inline-grid gap-0.5 w-full" style={{ gridTemplateColumns: `2rem repeat(${DAYS.length}, 1fr)` }}>
              {/* Header row */}
              <div />
              {DAYS.map(d => (
                <p key={d} className="text-[10px] font-medium text-gray-400 text-center pb-1">{d}</p>
              ))}
              {/* Data rows */}
              {HOURS.map(hour => (
                <React.Fragment key={hour}>
                  <p className="text-[10px] text-gray-400 text-right pr-1 leading-none self-center">
                    {String(hour).padStart(2, '0')}
                  </p>
                  {DAYS.map((_, dow) => {
                    const cell = heatmapGrid.get(`${dow}_${hour}`)
                    const fill = cell?.fillRate ?? 0
                    const bg   = cell ? lerpColor(EMPTY, FULL, fill) : `rgb(${EMPTY.join(',')})`
                    return (
                      <div
                        key={`${dow}_${hour}`}
                        className="h-6 rounded-sm group relative cursor-default"
                        style={{ backgroundColor: bg }}
                      >
                        {cell && (
                          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                            <div className="bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap">
                              {DAYS[dow]} {String(hour).padStart(2, '0')}:00<br />
                              {pct(fill)} fill · {cell.count} session{cell.count !== 1 ? 's' : ''}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
            {/* Colour scale */}
            <div className="flex items-center gap-2 mt-4">
              <p className="text-[10px] text-gray-400">0%</p>
              <div className="h-2 w-32 rounded-full" style={{
                background: `linear-gradient(to right, rgb(${EMPTY.join(',')}), rgb(${FULL.join(',')}))`
              }} />
              <p className="text-[10px] text-gray-400">100%</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Class rankings + Instructor performance side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Class rankings */}
        <Section title="Class fill rate">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {classStats.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No data yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Class</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-4 py-2.5">Fill</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-4 py-2.5">Check-in</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-4 py-2.5">#</th>
                  </tr>
                </thead>
                <tbody>
                  {classStats.map(c => (
                    <tr key={c.templateId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                        <p className="text-[10px] text-gray-400">{c.sport}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold tabular-nums ${
                          c.avgFillRate >= 0.9 ? 'text-emerald-600' :
                          c.avgFillRate >= 0.6 ? 'text-amber-600' : 'text-red-500'
                        }`}>{pct(c.avgFillRate)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm tabular-nums text-gray-600">{pct(c.checkInRate)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs tabular-nums text-gray-400">{c.sessions}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>

        {/* Instructor performance */}
        <Section title="Instructor performance">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {instructors.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No data yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Instructor</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-3 py-2.5">Fill</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-3 py-2.5">Att.</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-3 py-2.5" title="Loyalty: avg % of attendees who have taken a prior class with this instructor">Loyalty</th>
                  </tr>
                </thead>
                <tbody>
                  {instructors.map(instr => (
                    <tr key={instr.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {instr.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{instr.name}</p>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-sm font-semibold tabular-nums ${
                          instr.avgFillRate >= 0.9 ? 'text-emerald-600' :
                          instr.avgFillRate >= 0.6 ? 'text-amber-600' : 'text-red-500'
                        }`}>{pct(instr.avgFillRate)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-sm tabular-nums text-gray-600">{pct(instr.checkInRate)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {/* Loyalty = % of attendees who are returning to this specific instructor */}
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-10 bg-gray-100 rounded-full h-1">
                            <div
                              className="h-1 rounded-full bg-violet-500"
                              style={{ width: pct(instr.loyaltyRate) }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-600 w-7 text-right">
                            {pct(instr.loyaltyRate)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {instructors.length > 0 && (
              <p className="text-[10px] text-gray-400 px-4 py-2 border-t border-gray-50">
                Loyalty = avg % of each class's attendees who had previously attended this instructor
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* ── Member recurrence ── */}
      <Section title="Member recurrence">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Frequency distribution */}
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
            <p className="text-xs font-medium text-gray-500 mb-0.5">Visit frequency distribution</p>
            <p className="text-[10px] text-gray-400 mb-4">Members by number of visits over the period</p>
            <div className="space-y-2">
              {recurrence.frequencyBuckets.map(b => {
                const maxCount = Math.max(...recurrence.frequencyBuckets.map(x => x.count), 1)
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <p className="text-xs text-gray-500 w-10 shrink-0 tabular-nums">{b.label}×</p>
                    <div className="flex-1 bg-gray-50 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gray-800 transition-all"
                        style={{ width: `${(b.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs font-semibold tabular-nums text-gray-700 w-6 text-right">{b.count}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Month-over-month retention */}
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-0.5">Month-over-month return rate</p>
              <p className="text-[10px] text-gray-400 mb-4">
                Of members who booked last month, how many booked again this month
              </p>
            </div>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-4xl font-bold tabular-nums text-gray-900">{pct(recurrence.monthOverMonth)}</p>
                <p className="text-xs text-gray-400 mt-1">avg return rate</p>
              </div>
              {/* Gauge arc */}
              <div className="relative w-20 h-10 overflow-hidden mb-1">
                <svg viewBox="0 0 80 40" className="w-full">
                  <path d="M4 40 A36 36 0 0 1 76 40" fill="none" stroke="#f3f4f6" strokeWidth="8" strokeLinecap="round" />
                  <path
                    d="M4 40 A36 36 0 0 1 76 40"
                    fill="none"
                    stroke={recurrence.monthOverMonth >= 0.7 ? '#059669' : recurrence.monthOverMonth >= 0.4 ? '#d97706' : '#ef4444'}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${recurrence.monthOverMonth * 113} 113`}
                  />
                </svg>
              </div>
            </div>
            <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Avg visits / member</p>
                <p className="text-base font-semibold tabular-nums text-gray-900">
                  {recurrence.avgBookingsPerMember.toFixed(1)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Revenue & credit summary ── */}
      <Section title="Credit & revenue summary">
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Credits issued"   value={data.revenue.creditsIssued.toLocaleString()}   sub="memberships + adjustments" />
            <StatCard label="Credits consumed" value={data.revenue.creditsConsumed.toLocaleString()} sub="class bookings" />
            <StatCard label="Late-cancel fees" value={data.revenue.lateCancelFees.toLocaleString()}  sub="credits charged" />
            <StatCard label="No-show fees"     value={data.revenue.noShowFees.toLocaleString()}      sub="credits charged" />
          </div>

          {/* Weekly credit flow bar chart */}
          <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <p className="text-xs font-medium text-gray-500">Weekly credit flow</p>
              <div className="flex gap-4">
                {[
                  { color: 'bg-emerald-500', label: 'Issued' },
                  { color: 'bg-gray-400',    label: 'Consumed' },
                  { color: 'bg-amber-400',   label: 'Fees' },
                ].map(l => (
                  <span key={l.label} className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span className={`w-3 h-3 rounded-sm shrink-0 ${l.color}`} /> {l.label}
                  </span>
                ))}
              </div>
            </div>
            {(() => {
              const wc = data.revenue.weeklyCredits
              const maxVal = Math.max(...wc.map(w => Math.max(w.issued, w.consumed + w.fees)), 1)
              return (
                <div className="flex items-end gap-1 h-24">
                  {wc.map((w, i) => (
                    <div key={i} className="flex-1 flex items-end gap-px h-full group relative">
                      <div className="flex-1 flex flex-col justify-end h-full">
                        <div className="w-full bg-emerald-500 rounded-t-sm" style={{ height: `${(w.issued / maxVal) * 100}%` }} />
                      </div>
                      <div className="flex-1 flex flex-col justify-end h-full">
                        <div className="w-full bg-amber-400 rounded-t-sm" style={{ height: `${(w.fees / maxVal) * 100}%` }} />
                        <div className="w-full bg-gray-400" style={{ height: `${(w.consumed / maxVal) * 100}%` }} />
                      </div>
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                        <div className="bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap">
                          {weekLabel(w.weekStart)}<br />
                          Issued {w.issued} · Used {w.consumed} · Fees {w.fees}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Active subscriptions pill */}
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-white rounded-2xl border border-gray-100 px-5 py-4">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="font-semibold tabular-nums text-gray-900">{data.revenue.activeSubscriptions}</span>
            <span>active membership subscription{data.revenue.activeSubscriptions !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </Section>

    </div>
  )
}
