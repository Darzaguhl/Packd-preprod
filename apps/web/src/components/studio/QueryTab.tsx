'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { api, type QueryResult } from '@/lib/api'

// ─── Report definitions ───────────────────────────────────────────────────────

type WeeksOption = 4 | 8 | 12 | 52

const WEEKS_LABELS: Record<WeeksOption, string> = {
  4: 'Last 4 weeks',
  8: 'Last 8 weeks',
  12: 'Last 12 weeks',
  52: 'All time (1 year)',
}

interface Report {
  id: string
  icon: string
  label: string
  description: string
  sql: (studioId: string, weeks: WeeksOption) => string
}

const REPORTS: Report[] = [
  {
    id: 'instructor-stats',
    icon: '👤',
    label: 'Instructor Performance',
    description: 'Fill rate, loyalty rate, repeat visitors, and check-in rate per instructor',
    sql: (studioId, weeks) => `
WITH session_bookings AS (
  SELECT
    cs.id          AS session_id,
    cs."instructorId",
    cs."startsAt",
    cs.capacity,
    b."memberId",
    b.status,
    b."checkedIn"
  FROM "ClassSession" cs
  JOIN "Booking" b ON b."sessionId" = cs.id
  WHERE cs."studioId" = '${studioId}'
    AND cs."startsAt" < NOW()
    AND cs."startsAt" > NOW() - INTERVAL '${weeks} weeks'
    AND cs.status    != 'CANCELLED'
),
-- For each session: confirmed count, check-ins, and how many were returning visitors
session_stats AS (
  SELECT
    sb."session_id",
    sb."instructorId",
    sb.capacity,
    COUNT(*) FILTER (WHERE sb.status = 'CONFIRMED')                          AS confirmed,
    COUNT(*) FILTER (WHERE sb."checkedIn" = true)                            AS checked_in,
    COUNT(*) FILTER (WHERE sb.status = 'CONFIRMED' AND EXISTS (
      SELECT 1 FROM session_bookings prev
      WHERE prev."instructorId" = sb."instructorId"
        AND prev."memberId"     = sb."memberId"
        AND prev.status         = 'CONFIRMED'
        AND prev."startsAt"     < sb."startsAt"
    ))                                                                       AS prior_visitors
  FROM session_bookings sb
  GROUP BY sb."session_id", sb."instructorId", sb.capacity
),
-- Loyalty rate: average per-session fraction of returning attendees (sessions with bookings only)
loyalty AS (
  SELECT
    "instructorId",
    ROUND(AVG(prior_visitors::numeric / NULLIF(confirmed, 0)) * 100, 1) AS loyalty_rate_pct
  FROM session_stats
  WHERE confirmed > 0
  GROUP BY "instructorId"
),
-- Unique and repeat members per instructor
member_visits AS (
  SELECT "instructorId", "memberId", COUNT(*) AS visits
  FROM session_bookings
  WHERE status = 'CONFIRMED'
  GROUP BY "instructorId", "memberId"
),
member_stats AS (
  SELECT
    "instructorId",
    COUNT(*)                               AS unique_members,
    COUNT(*) FILTER (WHERE visits > 1)     AS repeat_members
  FROM member_visits
  GROUP BY "instructorId"
)
SELECT
  u."firstName" || ' ' || u."lastName"                                           AS instructor,
  COUNT(DISTINCT ss.session_id)                                                   AS sessions,
  SUM(ss.confirmed)                                                               AS bookings,
  ms.unique_members,
  ROUND(ms.repeat_members::numeric / NULLIF(ms.unique_members, 0) * 100, 1)     AS repeat_pct,
  COALESCE(l.loyalty_rate_pct, 0)                                                AS loyalty_pct,
  ROUND(SUM(ss.confirmed)::numeric / NULLIF(SUM(ss.capacity), 0) * 100, 1)      AS fill_pct,
  ROUND(SUM(ss.checked_in)::numeric / NULLIF(SUM(ss.confirmed), 0) * 100, 1)    AS checkin_pct
FROM session_stats ss
JOIN "Instructor" i  ON i.id  = ss."instructorId"
JOIN "User" u        ON u.id  = i."userId"
LEFT JOIN loyalty l  ON l."instructorId" = ss."instructorId"
LEFT JOIN member_stats ms ON ms."instructorId" = ss."instructorId"
GROUP BY i.id, u."firstName", u."lastName", l.loyalty_rate_pct,
         ms.unique_members, ms.repeat_members
ORDER BY loyalty_pct DESC NULLS LAST`.trim(),
  },
  {
    id: 'class-fill',
    icon: '📊',
    label: 'Class Fill Rates',
    description: 'Bookings, capacity, and fill % by class type',
    sql: (studioId, weeks) => `
SELECT
  ct.name                                                                    AS class,
  ct.sport,
  COUNT(DISTINCT cs.id)                                                      AS sessions,
  SUM(b.confirmed)                                                           AS total_bookings,
  ROUND(AVG(b.confirmed::numeric / NULLIF(cs.capacity, 0)) * 100, 1)        AS avg_fill_pct
FROM "ClassTemplate" ct
JOIN "ClassSession" cs
  ON  cs."templateId" = ct.id
  AND cs."studioId"   = '${studioId}'
  AND cs."startsAt"   < NOW()
  AND cs."startsAt"   > NOW() - INTERVAL '${weeks} weeks'
  AND cs.status      != 'CANCELLED'
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed
  FROM "Booking" WHERE "sessionId" = cs.id
) b ON true
GROUP BY ct.id, ct.name, ct.sport
ORDER BY avg_fill_pct DESC NULLS LAST`.trim(),
  },
  {
    id: 'top-members',
    icon: '🏆',
    label: 'Top Members',
    description: 'Most active members by visit count',
    sql: (studioId, weeks) => `
SELECT
  u."firstName" || ' ' || u."lastName"                        AS member,
  u.email,
  COUNT(*)           FILTER (WHERE b."checkedIn")              AS check_ins,
  COUNT(*)           FILTER (WHERE b.status = 'CONFIRMED')     AS confirmed_bookings,
  MAX(cs."startsAt")                                           AS last_visit
FROM "Booking" b
JOIN "Member" m  ON m.id = b."memberId"
JOIN "User" u    ON u.id = m."userId"
JOIN "ClassSession" cs
  ON  cs.id          = b."sessionId"
  AND cs."studioId"  = '${studioId}'
  AND cs."startsAt"  > NOW() - INTERVAL '${weeks} weeks'
WHERE b.status = 'CONFIRMED'
GROUP BY u.id, u."firstName", u."lastName", u.email
ORDER BY check_ins DESC
LIMIT 50`.trim(),
  },
  {
    id: 'cancellations',
    icon: '❌',
    label: 'Cancellation Rates',
    description: 'Cancel and late-cancel rates per class type',
    sql: (studioId, weeks) => `
SELECT
  ct.name                                                                         AS class,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED')                                 AS confirmed,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED')                                 AS cancelled,
  COUNT(*) FILTER (WHERE b.status = 'LATE_CANCELLED')                            AS late_cancelled,
  COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')                                   AS no_show,
  ROUND(
    COUNT(*) FILTER (WHERE b.status IN ('CANCELLED','LATE_CANCELLED'))::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                                               AS cancel_pct
FROM "Booking" b
JOIN "ClassSession" cs  ON cs.id = b."sessionId"
JOIN "ClassTemplate" ct ON ct.id = cs."templateId"
WHERE cs."studioId" = '${studioId}'
  AND cs."startsAt" > NOW() - INTERVAL '${weeks} weeks'
GROUP BY ct.id, ct.name
ORDER BY cancel_pct DESC NULLS LAST`.trim(),
  },
  {
    id: 'weekly-trend',
    icon: '📈',
    label: 'Weekly Bookings',
    description: 'Confirmed bookings and check-ins per week',
    sql: (studioId, weeks) => `
SELECT
  DATE_TRUNC('week', cs."startsAt")                           AS week_start,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED')              AS confirmed_bookings,
  COUNT(*) FILTER (WHERE b."checkedIn" = true)                AS check_ins,
  COUNT(DISTINCT cs.id)                                       AS sessions,
  ROUND(
    COUNT(*) FILTER (WHERE b."checkedIn" = true)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE b.status = 'CONFIRMED'), 0) * 100, 1
  )                                                           AS checkin_pct
FROM "Booking" b
JOIN "ClassSession" cs ON cs.id = b."sessionId"
WHERE cs."studioId" = '${studioId}'
  AND cs."startsAt" > NOW() - INTERVAL '${weeks} weeks'
  AND cs."startsAt" < NOW()
GROUP BY week_start
ORDER BY week_start DESC`.trim(),
  },
  {
    id: 'at-risk',
    icon: '💤',
    label: 'At-Risk Members',
    description: 'Members with no visit in the last 30 days',
    sql: (studioId, _weeks) => `
SELECT
  u."firstName" || ' ' || u."lastName"  AS member,
  u.email,
  MAX(cs."startsAt")                     AS last_visit,
  COUNT(b.id)                            AS total_visits
FROM "Member" m
JOIN "User" u ON u.id = m."userId"
LEFT JOIN "Booking" b
  ON  b."memberId" = m.id
  AND b.status     = 'CONFIRMED'
LEFT JOIN "ClassSession" cs ON cs.id = b."sessionId"
WHERE m."studioId" = '${studioId}'
GROUP BY m.id, u.id, u."firstName", u."lastName", u.email
HAVING MAX(cs."startsAt") < NOW() - INTERVAL '30 days'
    OR MAX(cs."startsAt") IS NULL
ORDER BY last_visit ASC NULLS FIRST
LIMIT 100`.trim(),
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportCsv(columns: string[], rows: unknown[][], filename = 'report.csv') {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(
    [[columns.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n')],
    { type: 'text/csv;charset=utf-8;' },
  )
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v))
    return new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({ result, filename }: { result: QueryResult; filename: string }) {
  // Detect which columns are numeric by checking the first non-null value per column
  const isNumericCol = result.columns.map((_, ci) => {
    const firstVal = result.rows.find(r => r[ci] !== null && r[ci] !== undefined)?.[ci]
    return typeof firstVal === 'number'
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">
            {result.rowCount === 0 ? 'No rows returned'
              : `${result.rowCount.toLocaleString()} row${result.rowCount !== 1 ? 's' : ''}`}
          </span>
          <span className="text-xs text-gray-400">{result.duration}ms</span>
          {result.rowCount >= 500 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              Capped at 500 rows
            </span>
          )}
        </div>
        {result.rowCount > 0 && (
          <button
            onClick={() => exportCsv(result.columns, result.rows, filename)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Export CSV
          </button>
        )}
      </div>
      {result.rowCount > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[480px]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-right text-[10px] font-medium text-gray-300 px-3 py-2.5 w-10 select-none border-r border-gray-100">#</th>
                  {result.columns.map((col, ci) => (
                    <th
                      key={col}
                      className={`text-xs font-semibold text-gray-500 px-3 py-2.5 whitespace-nowrap ${
                        isNumericCol[ci] ? 'text-center' : 'text-left'
                      }`}
                    >
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="text-right text-[10px] text-gray-300 px-3 py-2 tabular-nums select-none border-r border-gray-50">
                      {ri + 1}
                    </td>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-3 py-2 max-w-xs truncate text-xs ${
                          cell === null || cell === undefined
                            ? 'text-gray-300 italic text-center'
                            : isNumericCol[ci]
                              ? 'text-center tabular-nums text-gray-700 font-mono'
                              : 'text-gray-800'
                        }`}
                        title={cell === null || cell === undefined ? 'NULL' : String(cell)}
                      >
                        {cell === null || cell === undefined ? '—' : formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { studioId: string; token: string }

export default function QueryTab({ studioId, token }: Props) {
  const [weeks, setWeeks]           = useState<WeeksOption>(12)
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [result, setResult]         = useState<QueryResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [running, setRunning]       = useState(false)

  // Advanced SQL state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sql, setSql]               = useState('')
  const [sqlResult, setSqlResult]   = useState<QueryResult | null>(null)
  const [sqlError, setSqlError]     = useState<string | null>(null)
  const [sqlRunning, setSqlRunning] = useState(false)
  const textareaRef                 = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`
  }, [sql])

  const runReport = useCallback(async (report: Report) => {
    setActiveReport(report)
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.admin.query(report.sql(studioId, weeks), studioId, token)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setRunning(false)
    }
  }, [studioId, token, weeks])

  // Re-run active report when weeks changes
  useEffect(() => {
    if (activeReport) runReport(activeReport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks])

  const runCustom = useCallback(async () => {
    if (!sql.trim() || sqlRunning) return
    setSqlRunning(true)
    setSqlError(null)
    setSqlResult(null)
    try {
      const res = await api.admin.query(sql, studioId, token)
      setSqlResult(res)
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setSqlRunning(false)
    }
  }, [sql, studioId, token, sqlRunning])

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runCustom() }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* ── Header + time filter ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Reports</h2>
          <p className="text-xs text-gray-400 mt-0.5">Click any report to run it instantly.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Period:</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {([4, 8, 12, 52] as WeeksOption[]).map(w => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {w === 52 ? '1y' : `${w}w`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Report tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {REPORTS.map(report => {
          const isActive = activeReport?.id === report.id
          return (
            <button
              key={report.id}
              onClick={() => runReport(report)}
              disabled={running && isActive}
              className={`text-left rounded-2xl border p-4 transition-all ${
                isActive
                  ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm text-gray-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xl leading-none">{report.icon}</span>
                {isActive && running && (
                  <svg className="w-3.5 h-3.5 animate-spin text-white/60 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                  </svg>
                )}
              </div>
              <p className={`text-sm font-semibold mt-2 ${isActive ? 'text-white' : 'text-gray-900'}`}>
                {report.label}
              </p>
              <p className={`text-xs mt-0.5 leading-snug ${isActive ? 'text-white/70' : 'text-gray-400'}`}>
                {report.description}
              </p>
            </button>
          )
        })}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-red-600 mb-0.5">Failed to run report</p>
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      {/* ── Results ── */}
      {result && activeReport && !error && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{activeReport.icon}</span>
            <h3 className="text-sm font-semibold text-gray-900">{activeReport.label}</h3>
            <span className="text-xs text-gray-400">· {WEEKS_LABELS[weeks]}</span>
          </div>
          <ResultsTable result={result} filename={`${activeReport.id}.csv`} />
        </div>
      )}

      {/* ── Advanced: Custom SQL ── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        >
          <div>
            <span className="text-xs font-semibold text-gray-600">Advanced: Custom SQL</span>
            <span className="text-xs text-gray-400 ml-2">Write your own SELECT query</span>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none"
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {showAdvanced && (
          <div className="border-t border-gray-100">
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              placeholder={`SELECT ct.name, COUNT(b.id) AS bookings\nFROM "ClassTemplate" ct\nJOIN "ClassSession" cs ON cs."templateId" = ct.id\nJOIN "Booking" b ON b."sessionId" = cs.id\nWHERE cs."studioId" = '${studioId}'\nGROUP BY ct.name`}
              className="w-full px-4 py-4 font-mono text-sm text-gray-800 resize-none bg-white placeholder:text-gray-300 focus:outline-none min-h-[120px]"
              style={{ lineHeight: '1.6' }}
            />
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setSql(''); setSqlResult(null); setSqlError(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Clear
                </button>
                <span className="text-[10px] text-gray-300">⌘↵ to run</span>
              </div>
              <button
                onClick={runCustom}
                disabled={!sql.trim() || sqlRunning}
                className="flex items-center gap-1.5 bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {sqlRunning
                  ? <><svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/></svg>Running…</>
                  : <><svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3l8 5-8 5V3z"/></svg>Run query</>}
              </button>
            </div>

            {sqlError && (
              <div className="mx-4 mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-red-600 mb-0.5">Query error</p>
                <p className="text-xs text-red-500 font-mono whitespace-pre-wrap">{sqlError}</p>
              </div>
            )}

            {sqlResult && !sqlError && (
              <div className="px-4 pb-4">
                <ResultsTable result={sqlResult} filename="custom-query.csv" />
              </div>
            )}

            {/* Schema reference */}
            <details className="group border-t border-gray-100">
              <summary className="px-4 py-2.5 text-xs text-gray-400 hover:text-gray-600 cursor-pointer select-none list-none flex items-center gap-1 bg-gray-50">
                <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Schema reference
              </summary>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {[
                  { table: 'ClassTemplate',    cols: ['id', 'name', 'sport', 'studioId'] },
                  { table: 'ClassSession',     cols: ['id', 'templateId', 'instructorId', 'studioId', 'startsAt', 'capacity', 'status'] },
                  { table: 'Booking',          cols: ['id', 'sessionId', 'memberId', 'status', 'checkedIn', 'bookedAt'] },
                  { table: 'Member',           cols: ['id', 'userId', 'studioId', 'joinedAt'] },
                  { table: 'User',             cols: ['id', 'firstName', 'lastName', 'email'] },
                  { table: 'Instructor',       cols: ['id', 'userId', 'studioId'] },
                  { table: 'CreditTransaction',cols: ['id', 'memberId', 'amount', 'type', 'createdAt'] },
                  { table: 'CreditBalance',    cols: ['id', 'memberId', 'balance'] },
                  { table: 'Room',             cols: ['id', 'studioId', 'name', 'capacity'] },
                ].map(({ table, cols }) => (
                  <div key={table} className="bg-gray-50 rounded-xl px-3 py-2.5">
                    <p className="text-xs font-semibold text-gray-700 font-mono mb-1">"{table}"</p>
                    <p className="text-[10px] text-gray-400 font-mono leading-relaxed">{cols.join(', ')}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
