'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

interface Props {
  studioId: string
  token: string
}

interface AuditEntry {
  id: string
  actorId: string
  actorRole: string
  action: string
  targetId: string | null
  meta: unknown
  createdAt: string
}

function fmtAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase())
}

function fmtMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Object.keys(meta as object).length === 0) return null
  const m = meta as Record<string, unknown>
  return Object.entries(m)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

const ROLE_COLOURS: Record<string, string> = {
  admin:         'bg-red-100 text-red-700',
  franchise_admin: 'bg-purple-100 text-purple-700',
  studio_admin:  'bg-blue-100 text-blue-700',
  instructor:    'bg-teal-100 text-teal-700',
  fronthost:     'bg-amber-100 text-amber-700',
  member:        'bg-gray-100 text-gray-500',
}

export default function AuditLogTab({ studioId, token }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.admin.auditLog(studioId, token).then(res => {
      setEntries(res.entries)
      setCursor(res.nextCursor)
      setHasMore(!!res.nextCursor)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [studioId, token])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const res = await api.admin.auditLog(studioId, token, cursor)
      setEntries(prev => [...prev, ...res.entries])
      setCursor(res.nextCursor)
      setHasMore(!!res.nextCursor)
    } catch { /* silent */ } finally { setLoadingMore(false) }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Audit Log</h3>
        <p className="text-xs text-gray-400 mt-0.5">Staff actions recorded in the last 90 days</p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No audit events yet</p>
      ) : (
        <div className="space-y-1">
          {entries.map(e => {
            const meta = fmtMeta(e.meta)
            const date = new Date(e.createdAt)
            const roleCls = ROLE_COLOURS[e.actorRole] ?? 'bg-gray-100 text-gray-500'
            return (
              <div key={e.id} data-testid="audit-entry" data-action={e.action} className="flex items-start gap-3 px-3 py-3 bg-white rounded-xl border border-gray-100">
                {/* Role badge */}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${roleCls}`}>
                  {e.actorRole.replace('_', ' ')}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{fmtAction(e.action)}</span>
                    {e.targetId && (
                      <span className="text-gray-400 font-mono text-xs ml-1.5">{e.targetId.slice(-8)}</span>
                    )}
                  </p>
                  {meta && <p className="text-xs text-gray-400 truncate mt-0.5">{meta}</p>}
                </div>

                {/* Time */}
                <time className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                  {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {' '}
                  {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl py-2.5 transition-colors disabled:opacity-40"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
