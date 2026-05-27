'use client'

import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'

type Member = { id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">No plan</span>
  const color = status === 'active'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'past_due'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-500'
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {status === 'active' ? 'Active' : status === 'past_due' ? 'Past due' : status}
    </span>
  )
}

export default function MembersTab({ studioId, token }: { studioId: string; token: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function loadMembers(q?: string) {
    setLoading(true)
    api.admin.listMembers(studioId, token, q || undefined)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSearch(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      loadMembers(val.length >= 2 ? val : undefined)
    }, 300)
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
          <circle cx="6.5" cy="6.5" r="4" />
          <path d="M11 11l3 3" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); loadMembers() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 14 14">
              <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Member count */}
      {!loading && (
        <p className="text-xs text-gray-400">
          {members.length} member{members.length !== 1 ? 's' : ''}{query.length >= 2 ? ` matching "${query}"` : ''}
        </p>
      )}

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            {query.length >= 2 ? 'No members found' : 'No members yet'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {members.map(m => (
              <a
                key={m.id}
                href={`/members/${m.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold shrink-0 select-none">
                  {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>

                {/* Membership badge */}
                <StatusBadge status={m.membershipStatus} />

                {/* Credits */}
                <span className="text-xs text-gray-400 tabular-nums shrink-0 ml-2">{m.creditBalance} cr</span>

                {/* Chevron */}
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                  <path d="M6 4l4 4-4 4" strokeLinecap="round" />
                </svg>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
