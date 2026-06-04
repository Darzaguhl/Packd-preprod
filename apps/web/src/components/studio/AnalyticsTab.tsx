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
    const timer = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(timer)
  }, [series])

  const W = 600, H = 160
  const PAD = { t: 8, r: 8, b: 28, l: 36 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b
  const n = series[0]?.values.length ?? 0

  function toX(i: number) { return PAD.l + (n > 1 ? (i / (n - 1)) * iW : iW / 2) }
  function toY(v: number) { return PAD.t + iH - Math.min(v / yMax, 1) * iH }

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
  const step = Math.max(1, Math.ceil(n / 8))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
      {gridLines.map(v => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={toY(v)} y2={toY(v)} stroke="#f3f4f6" strokeWidth="1" />
          <text x={PAD.l - 4} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">{yFormat(v)}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={toY(0)} y2={toY(0)} stroke="#e5e7eb" strokeWidth="1" />
      {series.map((s, si) => {
        const d = smoothPath(s.values)
        if (!d) return null
        const pathLen = 9999
        return (
          <path
            key={s.name}
            ref={el => { if (el) ref.current[si] = el }}
            d={d} fill="none" stroke={s.color} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={drawn ? undefined : `${pathLen}`}
            strokeDashoffset={drawn ? 0 : pathLen}
            style={{ transition: drawn ? 'stroke-dashoffset 0.8s ease' : undefined }}
          />
        )
      })}
      {series.map(s =>
        s.values.map((v, i) => (
          <circle key={`${s.name}-${i}`} cx={toX(i)} cy={toY(v)} r={i === n - 1 ? 4 : 2.5}
            fill="white" stroke={s.color} strokeWidth={i === n - 1 ? 2 : 1.5} opacity={i === n - 1 ? 1 : 0.5}
          />
        ))
      )}
      {xLabels.map((label, i) =>
        i % step === 0 ? (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{label}</text>
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
  studios?: StudioOption[]
}

export default function AnalyticsTab({ studioId: initialStudioId, token, canQuery = false, studios }: Props) {
  const [view, setView] = useState<'analytics' | 'leaderboard' | 'query' | 'retention' | 'revenue' | 'churn' | 'membership'>('analytics')
  const [selectedStudio, setSelectedStudio] = useState(initialStudioId)
  const [data, setData]       = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [weeks, setWeeks]     = useState(12)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => { setSelectedStudio(initialStudioId) }, [initialStudioId])

  useEffect(() => {
    setLoading(true)
    setPermissionDenied(false)
    api.admin.analytics(selectedStudio, token, weeks)
      .then(setData)
      .catch((e: Error) => { if (e.message?.includes('403') || (e as Error & { statusCode?: number }).statusCode === 403) setPermissionDenied(true) })
      .finally(() => setLoading(false))
  }, [selectedStudio, token, weeks])

  const studioPicker = studios && studios.length > 0 ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-400 shrink-0">Studio:</span>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => { setSelectedStudio('all'); setView('analytics') }}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${selectedStudio === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          All studios
        </button>
        {studios.map(s => (
          <button key={s.id} onClick={() => setSelectedStudio(s.id)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${selectedStudio === s.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  ) : null

  const isPerStudio = selectedStudio !== 'all'

  const heatmapGrid = useMemo(() => {
    if (!data) return new Map<string, { fillRate: number; count: number }>()
    const m = new Map<string, { fillRate: number; count: number }>()
    for (const cell of data.heatmap) m.set(`${cell.dow}_${cell.hour}`, cell)
    return m
  }, [data])

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

  const canShowQuery = canQuery && isPerStudio

  type RetentionData = { cohorts: { month: string; size: number; offsets: { offset: number; pct: number }[] }[] }
  type RevenueData = {
    monthly: { month: string; revenue: number; orders: number; forecast: boolean }[]
    mrr: { month: string; mrr: number }[]
    forecast: { month: string; revenue: number; forecast: boolean }[]
    breakdown?: { month: string; subscriptions: number; products: number }[]
  }
  type ChurnMember = { memberId: string; name: string; email: string; totalBookings: number; lastBookedAt: string | null; avgDaysBetween: number | null; daysSinceLast: number | null }
  type ClassTrendsData = { classes: { templateId: string; name: string; sport: string; weeklyFill: number[] }[]; weekStarts: string[] }
  type MembershipFunnelData = { months: { month: string; active: number; paused: number; cancelled: number; newSubs: number }[] }

  const [retentionData, setRetentionData]           = useState<RetentionData | null>(null)
  const [revenueData, setRevenueData]               = useState<RevenueData | null>(null)
  const [churnData, setChurnData]                   = useState<{ members: ChurnMember[] } | null>(null)
  const [classTrendsData, setClassTrendsData]       = useState<ClassTrendsData | null>(null)
  const [membershipFunnelData, setMembershipFunnelData] = useState<MembershipFunnelData | null>(null)
  const [deepLoading, setDeepLoading]               = useState(false)

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
    } else if (v === 'membership' && !membershipFunnelData) {
      setDeepLoading(true)
      api.admin.membershipFunnel(selectedStudio, token).then(setMembershipFunnelData).catch(() => {}).finally(() => setDeepLoading(false))
    }
  }, [selectedStudio, token, retentionData, revenueData, churnData, membershipFunnelData])

  useEffect(() => {
    if (!isPerStudio || classTrendsData) return
    api.admin.classTrends(selectedStudio, token).then(setClassTrendsData).catch(() => {})
  }, [selectedStudio, token, isPerStudio, classTrendsData])

  useEffect(() => {
    setRetentionData(null); setRevenueData(null); setChurnData(null)
    setClassTrendsData(null); setMembershipFunnelData(null)
  }, [selectedStudio])

  type SubView = 'analytics' | 'leaderboard' | 'query' | 'retention' | 'revenue' | 'churn' | 'membership'
  const subViews: { id: SubView; label: string; perStudio: boolean; hidden: boolean }[] = [
    { id: 'analytics',   label: 'Overview',     perStudio: false, hidden: false },
    { id: 'retention',   label: 'Retention',    perStudio: false, hidden: false },
    { id: 'revenue',     label: 'Revenue',      perStudio: false, hidden: false },
    { id: 'membership',  label: 'Membership',   perStudio: false, hidden: false },
    { id: 'churn',       label: 'Churn risk',   perStudio: false, hidden: false },
    { id: 'leaderboard', label: 'Leaderboard',  perStudio: true,  hidden: false },
    { id: 'query',       label: 'Custom Query', perStudio: true,  hidden: !canShowQuery },
  ]

  const subNav = (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
      {subViews.filter(v => !v.hidden).map(v => {
        const disabled = v.perStudio && !isPerStudio
        const active = view === v.id
        return (
          <button
            key={v.id}
            onClick={() => { if (!disabled) { setView(v.id); loadDeep(v.id) } }}
            title={disabled ? 'Select a specific studio to view this' : undefined}
            className={`text-xs font-medium px-4 py-1.5 rounded-md transition-colors ${
              active ? 'bg-white text-gray-900 shadow-sm' : disabled ? 'text-gray-300 cursor-default' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )

  // ── Null-safe computed values ────────────────────────────────────────────────
  const weeklyTrend = data?.weeklyTrend ?? []
  const totalSessions = weeklyTrend.reduce((s, w) => s + w.sessions, 0)

  const retentionCohorts = retentionData?.cohorts ?? []
  const retentionMaxOffset = retentionCohorts.length > 0
    ? Math.max(...retentionCohorts.flatMap(c => c.offsets.map(o => o.offset)), 0) : 11
  const retentionOffsets = Array.from({ length: retentionMaxOffset + 1 }, (_, i) => i)

  const revenueAllMonths = [...(revenueData?.monthly ?? []), ...(revenueData?.forecast ?? [])]
  const revenueMaxRev = Math.max(...revenueAllMonths.map(m => m.revenue), 1)

  const funnelMonths = membershipFunnelData?.months ?? []
  const funnelMaxVal = Math.max(...funnelMonths.map(m => m.active + m.paused + m.cancelled), 1)

  // ── Chrome — always the same position regardless of sub-view ────────────────
  const chrome = (
    <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-gray-100">
      <div className="max-w-6xl mx-auto space-y-3">
        {studioPicker}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {subNav}
          {view === 'analytics' && (
            <div className="flex items-center gap-3 flex-wrap">
              {data && (
                <p className="text-sm text-gray-500">
                  <span className="font-semibold text-gray-900">{totalSessions}</span> sessions · {weeks}w window
                </p>
              )}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {[4, 8, 12, 24].map(w => (
                  <button key={w} onClick={() => setWeeks(w)}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {w}w
                  </button>
                ))}
              </div>
              {isPerStudio && data && (
                <div className="flex gap-1">
                  {(['members', 'attendance', 'revenue', 'instructor-pay', 'staff-pay'] as const).map(type => (
                    <button key={type}
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
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {chrome}

      {/* ── Loading skeleton ── */}
      {loading && !data && (() => {
        const pulse = 'bg-gray-100 animate-pulse rounded-xl'
        const card = 'bg-white rounded-2xl border border-gray-100 animate-pulse'
        return (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className={`h-24 ${card}`} />)}
            </div>
            <div><div className={`h-4 w-32 mb-3 ${pulse}`} /><div className={`h-72 ${card}`} /></div>
            <div><div className={`h-4 w-28 mb-3 ${pulse}`} /><div className={`h-40 ${card}`} /></div>
            <div><div className={`h-4 w-48 mb-3 ${pulse}`} /><div className={`h-52 ${card}`} /></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div><div className={`h-4 w-28 mb-3 ${pulse}`} /><div className={`h-64 ${card}`} /></div>
              <div><div className={`h-4 w-36 mb-3 ${pulse}`} /><div className={`h-64 ${card}`} /></div>
            </div>
            <div>
              <div className={`h-4 w-36 mb-3 ${pulse}`} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`h-52 ${card}`} /><div className={`h-52 ${card}`} />
              </div>
            </div>
            <div>
              <div className={`h-4 w-44 mb-3 ${pulse}`} />
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[...Array(4)].map((_, i) => <div key={i} className={`h-24 ${card}`} />)}
                </div>
                <div className={`h-44 ${card}`} />
                <div className={`h-12 ${card}`} />
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Permission denied ── */}
      {permissionDenied && (
        <div className="text-center py-16 space-y-2">
          <p className="text-sm font-medium text-gray-700">Analytics access required</p>
          <p className="text-sm text-gray-400">Ask a studio admin to enable the <strong>View analytics</strong> permission for your account.</p>
        </div>
      )}

      {/* ── Error ── */}
      {!loading && !data && !permissionDenied && (
        <p className="text-sm text-gray-400 text-center py-16">Failed to load analytics.</p>
      )}

      {/* ── Retention cohort ── */}
      {view === 'retention' && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Member retention by cohort</h3>
            <p className="text-xs text-gray-400 mb-4">% of members from each signup month still booking in subsequent months.</p>
            {deepLoading ? (
              <div className="min-h-[480px] bg-white rounded-xl border border-gray-100 animate-pulse" />
            ) : !retentionCohorts.length ? (
              <p className="text-sm text-gray-400 py-8 text-center">Not enough data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">Cohort</th>
                      <th className="px-2 py-2 text-gray-500 font-medium">Size</th>
                      {retentionOffsets.map(o => <th key={o} className="px-2 py-2 text-gray-500 font-medium">M+{o}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {retentionCohorts.map(c => {
                      const pctMap = new Map(c.offsets.map(o => [o.offset, o.pct]))
                      return (
                        <tr key={c.month}>
                          <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap font-medium">
                            {new Date(c.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{c.size}</td>
                          {retentionOffsets.map(o => {
                            const v = pctMap.get(o)
                            const bg = v == null ? 'bg-gray-50' : v >= 70 ? 'bg-emerald-600 text-white' : v >= 40 ? 'bg-emerald-200 text-emerald-900' : v >= 20 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-50 text-red-700'
                            return <td key={o} className={`px-2 py-1.5 text-center rounded ${bg}`}>{v == null ? '—' : `${v}%`}</td>
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
      )}

      {/* ── Revenue ── */}
      {view === 'revenue' && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-6">
          {deepLoading ? (
            <div className="min-h-[480px] bg-white rounded-xl border border-gray-100 animate-pulse" />
          ) : !revenueData ? null : (
            <>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly revenue</h3>
                <div className="flex items-end gap-1 h-40">
                  {revenueAllMonths.map(m => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className={`w-full rounded-t transition-all ${m.forecast ? 'bg-indigo-200' : 'bg-gray-800'}`}
                        style={{ height: `${Math.round((m.revenue / revenueMaxRev) * 100)}%`, minHeight: m.revenue > 0 ? 4 : 0 }}
                      />
                      <span className="text-[9px] text-gray-400 truncate w-full text-center">
                        {new Date(m.month).toLocaleDateString('en-GB', { month: 'short' })}{m.forecast ? '*' : ''}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2">* Forecast based on 3-month average</p>
              </div>

              {(revenueData.breakdown?.length ?? 0) > 0 && (() => {
                const bd = revenueData.breakdown!
                const maxBd = Math.max(...bd.map(m => m.subscriptions + m.products), 1)
                return (
                  <div className="bg-white rounded-xl border border-gray-100 p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-1">Revenue by type</h3>
                    <p className="text-xs text-gray-400 mb-4">Subscriptions vs. one-time product sales.</p>
                    <div className="flex items-end gap-1 h-32">
                      {bd.map(m => {
                        const subH = Math.round((m.subscriptions / maxBd) * 100)
                        const proH = Math.round((m.products / maxBd) * 100)
                        return (
                          <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 min-w-0 group relative">
                            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                              <div className="bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap">
                                {new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}<br/>
                                Subs: {(m.subscriptions / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}<br/>
                                Products: {(m.products / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                              </div>
                            </div>
                            <div className="w-full flex flex-col-reverse gap-0.5" style={{ height: '100%' }}>
                              <div className="w-full bg-gray-800 rounded-t" style={{ height: `${proH}%`, minHeight: m.products > 0 ? 2 : 0 }} />
                              <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${subH}%`, minHeight: m.subscriptions > 0 ? 2 : 0 }} />
                            </div>
                            <span className="text-[9px] text-gray-400 truncate w-full text-center mt-1">
                              {new Date(m.month).toLocaleDateString('en-GB', { month: 'short' })}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex gap-4 mt-3">
                      {[['bg-indigo-400', 'Subscriptions'], ['bg-gray-800', 'Products']].map(([cls, label]) => (
                        <span key={label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          <span className={`w-3 h-2 rounded-sm ${cls}`} />{label}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}

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
      )}

      {/* ── Churn risk ── */}
      {view === 'churn' && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">At-risk members</h3>
            <p className="text-xs text-gray-400 mb-4">Members with 3+ bookings whose last visit was 2.5× longer ago than their usual cadence.</p>
            {deepLoading ? (
              <div className="min-h-[480px] bg-white rounded-xl border border-gray-100 animate-pulse" />
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
                      <p className="text-xs text-gray-400">usual: every {m.avgDaysBetween}d · {m.totalBookings} total bookings</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Membership funnel ── */}
      {view === 'membership' && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-6">
          {deepLoading ? (
            <div className="min-h-[480px] bg-white rounded-xl border border-gray-100 animate-pulse" />
          ) : !funnelMonths.length ? (
            <p className="text-sm text-gray-400 text-center py-16">No subscription data yet.</p>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Subscription base over time</h3>
                <p className="text-xs text-gray-400 mb-4">Active, paused, and cancelled subscriptions per month.</p>
                {(() => {
                  const W = 560; const H = 160; const PAD = { l: 8, r: 8, t: 8, b: 24 }
                  const innerW = W - PAD.l - PAD.r; const innerH = H - PAD.t - PAD.b
                  const n = funnelMonths.length
                  const xStep = n > 1 ? innerW / (n - 1) : innerW
                  const y = (v: number) => PAD.t + innerH - (v / funnelMaxVal) * innerH
                  function polyPoints(vals: number[], offset: number[]): string {
                    const top = vals.map((v, i) => `${PAD.l + i * xStep},${y(offset[i] + v)}`)
                    const bot = offset.map((v, i) => `${PAD.l + (n - 1 - i) * xStep},${y(v)}`).reverse()
                    return [...top, ...bot].join(' ')
                  }
                  const zeros = funnelMonths.map(() => 0)
                  const cancelled = funnelMonths.map(m => m.cancelled)
                  const paused = funnelMonths.map(m => m.paused)
                  const active = funnelMonths.map(m => m.active)
                  const pausedOffset = cancelled
                  const activeOffset = cancelled.map((v, i) => v + paused[i])
                  return (
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                      <polygon points={polyPoints(cancelled, zeros)} fill="#fca5a5" opacity="0.8" />
                      <polygon points={polyPoints(paused, pausedOffset)} fill="#fcd34d" opacity="0.8" />
                      <polygon points={polyPoints(active, activeOffset)} fill="#6ee7b7" opacity="0.8" />
                      {funnelMonths.map((m, i) => i % 2 === 0 ? (
                        <text key={m.month} x={PAD.l + i * xStep} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
                          {new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                        </text>
                      ) : null)}
                    </svg>
                  )
                })()}
                <div className="flex gap-4 mt-2">
                  {[['#6ee7b7', 'Active'], ['#fcd34d', 'Paused'], ['#fca5a5', 'Cancelled']].map(([color, label]) => (
                    <span key={label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />{label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Month</th>
                      <th className="text-right px-4 py-2.5 text-gray-400 font-medium">New</th>
                      <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Active</th>
                      <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Paused</th>
                      <th className="text-right px-4 py-2.5 text-gray-400 font-medium">Cancelled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...funnelMonths].reverse().map(m => (
                      <tr key={m.month} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600 font-medium">
                          {new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                        </td>
                        <td className="px-4 py-2 text-right text-indigo-600 font-semibold">{m.newSubs > 0 ? `+${m.newSubs}` : '—'}</td>
                        <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{m.active}</td>
                        <td className="px-4 py-2 text-right text-amber-500">{m.paused || '—'}</td>
                        <td className="px-4 py-2 text-right text-red-400">{m.cancelled || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Leaderboard ── */}
      {view === 'leaderboard' && isPerStudio && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          <LeaderboardTab studioId={selectedStudio} token={token} />
        </div>
      )}

      {/* ── Custom query ── */}
      {view === 'query' && canShowQuery && (
        <QueryTab studioId={selectedStudio} token={token} />
      )}

      {/* ── Analytics overview ── */}
      {view === 'analytics' && data && (() => {
        const { funnel, weeklyTrend: wt, classStats, instructors, recurrence } = data
        const ts = wt.reduce((s, w) => s + w.sessions, 0)
        const overallFill = wt.length > 0 ? wt.reduce((s, w) => s + w.avgFillRate * w.sessions, 0) / Math.max(ts, 1) : 0
        const overallCheckIn = funnel.confirmed > 0 ? funnel.checkedIn / funnel.confirmed : 0
        const trendSeries: ChartSeries[] = [
          { name: 'Fill rate',     color: '#1f2937', values: wt.map(w => w.avgFillRate) },
          { name: 'Check-in rate', color: '#059669', values: wt.map(w => w.checkInRate) },
        ]
        const xLabels = wt.map(w => weekLabel(w.weekStart))
        return (
          <div className={`max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8 transition-opacity duration-200 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Avg fill rate"       value={pct(overallFill)}                          sub="confirmed / capacity"  delta={deltas?.fill} />
              <StatCard label="Check-in rate"       value={pct(overallCheckIn)}                       sub="of confirmed bookings" delta={deltas?.checkIn} />
              <StatCard label="Return rate"         value={pct(recurrence.monthOverMonth)}             sub="month-over-month" />
              <StatCard label="Avg visits / member" value={recurrence.avgBookingsPerMember.toFixed(1)} sub={`over ${weeks} weeks`} />
            </div>

            <Section title="Weekly trend — fill rate & check-in rate">
              <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
                {wt.length < 2 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Not enough data yet</p>
                ) : (
                  <>
                    <SvgLineChart series={trendSeries} xLabels={xLabels} />
                    <div className="flex gap-5 mt-3 justify-end">
                      {trendSeries.map(s => (
                        <span key={s.name} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          <span className="w-4 h-0.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />{s.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Section>

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
                            <div className={`h-full rounded-full transition-all ${b.color}`} style={{ width: `${(b.value / maxVal) * 100}%` }} />
                          </div>
                          <p className={`text-xs font-semibold tabular-nums w-10 text-right ${b.text}`}>{b.value.toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </Section>

            <Section title="Utilisation heatmap — fill rate by day & time">
              <div className="bg-white rounded-2xl border border-gray-100 px-4 sm:px-6 py-5 overflow-x-auto">
                <div className="min-w-[340px]">
                  <div className="inline-grid gap-0.5 w-full" style={{ gridTemplateColumns: `2rem repeat(${DAYS.length}, 1fr)` }}>
                    <div />
                    {DAYS.map(d => <p key={d} className="text-[10px] font-medium text-gray-400 text-center pb-1">{d}</p>)}
                    {HOURS.map(hour => (
                      <React.Fragment key={hour}>
                        <p className="text-[10px] text-gray-400 text-right pr-1 leading-none self-center">{String(hour).padStart(2, '0')}</p>
                        {DAYS.map((_, dow) => {
                          const cell = heatmapGrid.get(`${dow}_${hour}`)
                          const fill = cell?.fillRate ?? 0
                          const bg   = cell ? lerpColor(EMPTY, FULL, fill) : `rgb(${EMPTY.join(',')})`
                          return (
                            <div key={`${dow}_${hour}`} className="h-6 rounded-sm group relative cursor-default" style={{ backgroundColor: bg }}>
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
                  <div className="flex items-center gap-2 mt-4">
                    <p className="text-[10px] text-gray-400">0%</p>
                    <div className="h-2 w-32 rounded-full" style={{ background: `linear-gradient(to right, rgb(${EMPTY.join(',')}), rgb(${FULL.join(',')}))` }} />
                    <p className="text-[10px] text-gray-400">100%</p>
                  </div>
                </div>
              </div>
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                          <th className="text-right text-xs font-medium text-gray-400 px-4 py-2.5 hidden sm:table-cell">Trend</th>
                          <th className="text-right text-xs font-medium text-gray-400 px-4 py-2.5">#</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classStats.map(c => {
                          const trend = classTrendsData?.classes.find(t => t.templateId === c.templateId)
                          const sparkVals = trend?.weeklyFill.filter(v => v >= 0) ?? []
                          return (
                            <tr key={c.templateId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                                <p className="text-[10px] text-gray-400">{c.sport}</p>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className={`text-sm font-semibold tabular-nums ${c.avgFillRate >= 0.9 ? 'text-emerald-600' : c.avgFillRate >= 0.6 ? 'text-amber-600' : 'text-red-500'}`}>{pct(c.avgFillRate)}</span>
                              </td>
                              <td className="px-4 py-3 text-right"><span className="text-sm tabular-nums text-gray-600">{pct(c.checkInRate)}</span></td>
                              <td className="px-4 py-3 text-right hidden sm:table-cell">
                                {sparkVals.length >= 2 ? (
                                  <svg width="56" height="20" className="inline-block">
                                    <polyline
                                      points={sparkVals.map((v, i) => `${(i / (sparkVals.length - 1)) * 52 + 2},${18 - (v / 100) * 16}`).join(' ')}
                                      fill="none"
                                      stroke={sparkVals[sparkVals.length - 1] > sparkVals[0] ? '#059669' : sparkVals[sparkVals.length - 1] < sparkVals[0] ? '#ef4444' : '#9ca3af'}
                                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                    />
                                  </svg>
                                ) : <span className="text-[10px] text-gray-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right"><span className="text-xs tabular-nums text-gray-400">{c.sessions}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Section>

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
                              <span className={`text-sm font-semibold tabular-nums ${instr.avgFillRate >= 0.9 ? 'text-emerald-600' : instr.avgFillRate >= 0.6 ? 'text-amber-600' : 'text-red-500'}`}>{pct(instr.avgFillRate)}</span>
                            </td>
                            <td className="px-3 py-3 text-right"><span className="text-sm tabular-nums text-gray-600">{pct(instr.checkInRate)}</span></td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-10 bg-gray-100 rounded-full h-1">
                                  <div className="h-1 rounded-full bg-violet-500" style={{ width: pct(instr.loyaltyRate) }} />
                                </div>
                                <span className="text-xs tabular-nums text-gray-600 w-7 text-right">{pct(instr.loyaltyRate)}</span>
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

            <Section title="Member recurrence">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                            <div className="h-full rounded-full bg-gray-800 transition-all" style={{ width: `${(b.count / maxCount) * 100}%` }} />
                          </div>
                          <p className="text-xs font-semibold tabular-nums text-gray-700 w-6 text-right">{b.count}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-0.5">Month-over-month return rate</p>
                    <p className="text-[10px] text-gray-400 mb-4">Of members who booked last month, how many booked again this month</p>
                  </div>
                  <div className="flex items-end gap-4">
                    <div>
                      <p className="text-4xl font-bold tabular-nums text-gray-900">{pct(recurrence.monthOverMonth)}</p>
                      <p className="text-xs text-gray-400 mt-1">avg return rate</p>
                    </div>
                    <div className="relative w-20 h-10 overflow-hidden mb-1">
                      <svg viewBox="0 0 80 40" className="w-full">
                        <path d="M4 40 A36 36 0 0 1 76 40" fill="none" stroke="#f3f4f6" strokeWidth="8" strokeLinecap="round" />
                        <path d="M4 40 A36 36 0 0 1 76 40" fill="none"
                          stroke={recurrence.monthOverMonth >= 0.7 ? '#059669' : recurrence.monthOverMonth >= 0.4 ? '#d97706' : '#ef4444'}
                          strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={`${recurrence.monthOverMonth * 113} 113`}
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
                    <div>
                      <p className="text-xs text-gray-400">Avg visits / member</p>
                      <p className="text-base font-semibold tabular-nums text-gray-900">{recurrence.avgBookingsPerMember.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Credit & revenue summary">
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Credits issued"   value={data.revenue.creditsIssued.toLocaleString()}   sub="memberships + adjustments" />
                  <StatCard label="Credits consumed" value={data.revenue.creditsConsumed.toLocaleString()} sub="class bookings" />
                  <StatCard label="Late-cancel fees" value={data.revenue.lateCancelFees.toLocaleString()}  sub="credits charged" />
                  <StatCard label="No-show fees"     value={data.revenue.noShowFees.toLocaleString()}      sub="credits charged" />
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <p className="text-xs font-medium text-gray-500">Weekly credit flow</p>
                    <div className="flex gap-4">
                      {[{ color: 'bg-emerald-500', label: 'Issued' }, { color: 'bg-gray-400', label: 'Consumed' }, { color: 'bg-amber-400', label: 'Fees' }].map(l => (
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
                                {weekLabel(w.weekStart)}<br />Issued {w.issued} · Used {w.consumed} · Fees {w.fees}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 bg-white rounded-2xl border border-gray-100 px-5 py-4">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="font-semibold tabular-nums text-gray-900">{data.revenue.activeSubscriptions}</span>
                  <span>active membership subscription{data.revenue.activeSubscriptions !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </Section>

          </div>
        )
      })()}
    </div>
  )
}
