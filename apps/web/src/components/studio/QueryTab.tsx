'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { api, type QueryResult } from '@/lib/api'

// ─── Example queries ─────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    label: 'Class fill rate',
    sql: (studioId: string) => `SELECT
  ct.name AS class,
  COUNT(DISTINCT cs.id)                          AS sessions,
  SUM(b.confirmed)                               AS total_bookings,
  ROUND(AVG(b.confirmed::float / NULLIF(cs.capacity, 0)) * 100, 1) AS fill_pct
FROM "ClassTemplate" ct
JOIN "ClassSession" cs ON cs."templateId" = ct.id
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed
  FROM "Booking" WHERE "sessionId" = cs.id
) b ON true
WHERE cs."studioId" = '${studioId}'
  AND cs."startsAt" < NOW()
  AND cs.status != 'CANCELLED'
GROUP BY ct.name
ORDER BY fill_pct DESC`,
  },
  {
    label: 'Top members by visits',
    sql: (studioId: string) => `SELECT
  u."firstName" || ' ' || u."lastName" AS member,
  u.email,
  COUNT(*) AS total_visits,
  COUNT(*) FILTER (WHERE b."checkedIn") AS checked_in
FROM "Booking" b
JOIN "Member" m ON m.id = b."memberId"
JOIN "User" u ON u.id = m."userId"
JOIN "ClassSession" cs ON cs.id = b."sessionId"
WHERE cs."studioId" = '${studioId}'
  AND b.status = 'CONFIRMED'
GROUP BY u.id, u."firstName", u."lastName", u.email
ORDER BY total_visits DESC
LIMIT 50`,
  },
  {
    label: 'Weekly revenue (credits)',
    sql: (studioId: string) => `SELECT
  DATE_TRUNC('week', ct."createdAt") AS week_start,
  COUNT(*) FILTER (WHERE ct.amount > 0)  AS credit_events,
  SUM(ct.amount)  FILTER (WHERE ct.amount > 0)  AS issued,
  ABS(SUM(ct.amount) FILTER (WHERE ct.amount < 0 AND ct.type = 'CLASS_DEBIT'))  AS consumed,
  ABS(SUM(ct.amount) FILTER (WHERE ct.type IN ('LATE_CANCEL_FEE','NO_SHOW_FEE'))) AS fees
FROM "CreditTransaction" ct
JOIN "Member" m ON m.id = ct."memberId"
WHERE m."studioId" = '${studioId}'
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 24`,
  },
  {
    label: 'Cancellation rate by class',
    sql: (studioId: string) => `SELECT
  ct.name AS class,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED')      AS confirmed,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED')      AS cancelled,
  COUNT(*) FILTER (WHERE b.status = 'LATE_CANCELLED') AS late_cancelled,
  ROUND(
    COUNT(*) FILTER (WHERE b.status IN ('CANCELLED','LATE_CANCELLED'))::float
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS cancel_pct
FROM "Booking" b
JOIN "ClassSession" cs ON cs.id = b."sessionId"
JOIN "ClassTemplate" ct ON ct.id = cs."templateId"
WHERE cs."studioId" = '${studioId}'
GROUP BY ct.name
ORDER BY cancel_pct DESC`,
  },
  {
    label: 'Inactive members (no visit in 30 days)',
    sql: (studioId: string) => `SELECT
  u."firstName" || ' ' || u."lastName" AS member,
  u.email,
  MAX(cs."startsAt") AS last_visit,
  NOW() - MAX(cs."startsAt") AS days_since_visit
FROM "Member" m
JOIN "User" u ON u.id = m."userId"
LEFT JOIN "Booking" b ON b."memberId" = m.id AND b.status = 'CONFIRMED'
LEFT JOIN "ClassSession" cs ON cs.id = b."sessionId"
WHERE m."studioId" = '${studioId}'
GROUP BY m.id, u.id, u."firstName", u."lastName", u.email
HAVING MAX(cs."startsAt") < NOW() - INTERVAL '30 days'
    OR MAX(cs."startsAt") IS NULL
ORDER BY last_visit ASC NULLS FIRST
LIMIT 100`,
  },
  {
    label: 'Instructor stats',
    sql: (studioId: string) => `SELECT
  u."firstName" || ' ' || u."lastName" AS instructor,
  COUNT(DISTINCT cs.id)          AS sessions_taught,
  SUM(b.confirmed)               AS total_bookings,
  SUM(b.checked_in)              AS checked_in,
  ROUND(SUM(b.confirmed)::float / NULLIF(SUM(cs.capacity),0)*100,1) AS fill_pct,
  ROUND(SUM(b.checked_in)::float / NULLIF(SUM(b.confirmed),0)*100,1) AS attendance_pct
FROM "Instructor" i
JOIN "User" u ON u.id = i."userId"
JOIN "ClassSession" cs ON cs."instructorId" = i.id
  AND cs."studioId" = '${studioId}'
  AND cs."startsAt" < NOW()
  AND cs.status != 'CANCELLED'
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed,
    COUNT(*) FILTER (WHERE "checkedIn" = true)   AS checked_in
  FROM "Booking" WHERE "sessionId" = cs.id
) b ON true
GROUP BY i.id, u."firstName", u."lastName"
ORDER BY fill_pct DESC`,
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportCsv(columns: string[], rows: unknown[][], filename = 'query-result.csv') {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const lines = [
    columns.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  }
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

function isCellNull(v: unknown) { return v === null || v === undefined }

// ─── LocalStorage query history ──────────────────────────────────────────────

const HISTORY_KEY = 'packd-query-history'
const MAX_HISTORY = 10

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(sql: string) {
  try {
    const h = [sql, ...loadHistory().filter(q => q !== sql)].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
  } catch { /* ignore */ }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { studioId: string; token: string }

export default function QueryTab({ studioId, token }: Props) {
  const [sql, setSql]             = useState('')
  const [result, setResult]       = useState<QueryResult | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [running, setRunning]     = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]     = useState<string[]>([])
  const textareaRef               = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setHistory(loadHistory()) }, [])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`
  }, [sql])

  const runQuery = useCallback(async () => {
    if (!sql.trim() || running) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.admin.query(sql, studioId, token)
      setResult(res)
      saveHistory(sql)
      setHistory(loadHistory())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setRunning(false)
    }
  }, [sql, studioId, token, running])

  // Cmd/Ctrl + Enter to run
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery()
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Custom Query</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Run read-only SQL against the live database. SELECT and WITH…SELECT only.
            Results capped at 500 rows.
          </p>
        </div>
        {/* Example queries dropdown */}
        <div className="flex items-center gap-2 flex-wrap">
          {EXAMPLES.map(ex => (
            <button
              key={ex.label}
              onClick={() => { setSql(ex.sql(studioId)); setResult(null); setError(null) }}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">SQL</span>
          <div className="flex items-center gap-2">
            {/* History button */}
            {history.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  History
                </button>
                {showHistory && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowHistory(false)} />
                    <div className="absolute right-0 top-6 z-20 bg-white border border-gray-200 rounded-xl shadow-lg w-80 max-h-64 overflow-y-auto py-1">
                      {history.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => { setSql(q); setShowHistory(false); setResult(null); setError(null) }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs font-mono text-gray-600 truncate border-b border-gray-50 last:border-0"
                        >
                          {q.trim().split('\n')[0].slice(0, 80)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span className="text-[10px] text-gray-300">⌘↵ to run</span>
          </div>
        </div>
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
          <button
            onClick={() => { setSql(''); setResult(null); setError(null) }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={runQuery}
            disabled={!sql.trim() || running}
            className="flex items-center gap-1.5 bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {running ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                </svg>
                Running…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3l8 5-8 5V3z"/>
                </svg>
                Run query
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-red-600 mb-0.5">Query error</p>
          <p className="text-xs text-red-500 font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-3">
          {/* Results header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-900">
                {result.rowCount === 0 ? 'No rows returned' :
                  `${result.rowCount.toLocaleString()} row${result.rowCount !== 1 ? 's' : ''}`}
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
                onClick={() => exportCsv(result.columns, result.rows)}
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

          {/* Table */}
          {result.rowCount > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="overflow-auto max-h-[520px]">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {/* Row number column */}
                      <th className="text-right text-[10px] font-medium text-gray-300 px-3 py-2.5 w-10 select-none border-r border-gray-100">
                        #
                      </th>
                      {result.columns.map(col => (
                        <th
                          key={col}
                          className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5 whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                      >
                        <td className="text-right text-[10px] text-gray-300 px-3 py-2 tabular-nums select-none border-r border-gray-50">
                          {ri + 1}
                        </td>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className={`px-3 py-2 max-w-xs truncate font-mono text-xs ${
                              isCellNull(cell)
                                ? 'text-gray-300 italic'
                                : typeof cell === 'number'
                                  ? 'text-right tabular-nums text-gray-700'
                                  : 'text-gray-800'
                            }`}
                            title={cell === null || cell === undefined ? 'NULL' : String(cell)}
                          >
                            {isCellNull(cell) ? 'NULL' : formatCell(cell)}
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
      )}

      {/* ── Schema reference ── */}
      <details className="group">
        <summary className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer select-none list-none flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none">
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Schema reference
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            { table: 'ClassTemplate',         cols: ['id', 'name', 'sport', 'studioId'] },
            { table: 'ClassSession',           cols: ['id', 'templateId', 'instructorId', 'studioId', 'roomId', 'startsAt', 'endsAt', 'capacity', 'status'] },
            { table: 'Booking',                cols: ['id', 'sessionId', 'memberId', 'status', 'checkedIn', 'checkedInAt', 'bookedAt', 'stationId'] },
            { table: 'Member',                 cols: ['id', 'userId', 'studioId', 'joinedAt', 'notes'] },
            { table: 'User',                   cols: ['id', 'firstName', 'lastName', 'email'] },
            { table: 'CreditTransaction',      cols: ['id', 'memberId', 'amount', 'type', 'note', 'createdAt'] },
            { table: 'CreditBalance',          cols: ['id', 'memberId', 'balance'] },
            { table: 'MembershipSubscription', cols: ['id', 'memberId', 'planId', 'status', 'startDate', 'endDate'] },
            { table: 'MembershipPlan',         cols: ['id', 'studioId', 'name', 'priceInCents', 'intervalMonths', 'creditsPerCycle'] },
            { table: 'Instructor',             cols: ['id', 'userId', 'studioId'] },
            { table: 'WaitlistEntry',          cols: ['id', 'sessionId', 'memberId', 'status', 'joinedAt'] },
            { table: 'Room',                   cols: ['id', 'studioId', 'name', 'capacity'] },
          ].map(({ table, cols }) => (
            <div key={table} className="bg-gray-50 rounded-xl px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-700 font-mono mb-1">"{table}"</p>
              <p className="text-[10px] text-gray-400 font-mono leading-relaxed">
                {cols.join(', ')}
              </p>
            </div>
          ))}
        </div>
      </details>

    </div>
  )
}
