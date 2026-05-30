'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api } from '@/lib/api'
import LiveDashboard from '@/components/live/LiveDashboard'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'management' | 'live'

interface StudioOption {
  id: string
  name: string
}

// ─── Mode switcher pill ───────────────────────────────────────────────────────

function ModeSwitcher({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => onSwitch('management')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'management'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Management
      </button>
      <button
        onClick={() => onSwitch('live')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'live'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Live
      </button>
    </div>
  )
}

// ─── Studio switcher dropdown ─────────────────────────────────────────────────

function StudioSwitcher({
  studios,
  selectedId,
  onSelect,
}: {
  studios: StudioOption[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = studios.find(s => s.id === selectedId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        {selected?.name ?? 'Select studio'}
        <svg className="w-3 h-3 text-gray-400" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
            {studios.map(s => (
              <button
                key={s.id}
                onClick={() => { onSelect(s.id); setOpen(false) }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  s.id === selectedId
                    ? 'bg-gray-50 font-medium text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s.name}
                {s.id === selectedId && (
                  <svg className="inline-block ml-2 w-3.5 h-3.5 text-emerald-500" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Primary studio ID (first/only studio for single-studio admins) */
  studioId: string
  studioName?: string
  /** All studio IDs the user has access to. If >1, a studio switcher is shown. */
  studioIds?: string[]
  /** Called when navigating back (franchise drill-in only) */
  onBack?: () => void
  /** Called after studio settings are saved */
  onStudioUpdate?: (data: { name: string; timezone: string; currency: string; timeFormat: string }) => void
  /** Role to pass down for permission-filtered tabs ('instructor' shows reduced tab set) */
  role?: string
  /** All roles the user holds — used to determine Live mode behavior (e.g. fronthost bypass) */
  roles?: string[]
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function AdminShell({ studioId: initialStudioId, studioName: initialStudioName, studioIds, onBack, onStudioUpdate, role, roles }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get('mode') === 'live' ? 'live' : 'management'
  )
  // Restore selected studio from URL on refresh; fall back to the primary studio.
  const [selectedStudioId, setSelectedStudioId] = useState(() => {
    const fromUrl = searchParams.get('studio')
    return (studioIds && fromUrl && studioIds.includes(fromUrl)) ? fromUrl : initialStudioId
  })
  const [studios, setStudios] = useState<StudioOption[]>(
    initialStudioName ? [{ id: initialStudioId, name: initialStudioName }] : [],
  )
  // Ensure the admin has a member record on first dashboard load (idempotent)
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token
      if (t) api.members.ensure(t, initialStudioId).catch(() => {})
    })
  }, [initialStudioId])

  // Fetch studio names for the switcher.
  // Instructors use /staff/studios (requireAuth) — always fetch so they get their full list
  // even if app_metadata.studioIds is stale or missing. Admins use /franchise/my-studios.
  useEffect(() => {
    const isInstructor = role === 'instructor'
    if (!isInstructor && (!studioIds || studioIds.length <= 1)) return
    createClient().auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token
      if (!t) return
      const fetch = isInstructor ? api.staff.myStudios(t) : api.franchise.myStudios(t)
      fetch.then(list => {
        if (list.length <= 1 && !isInstructor) return
        setStudios(list)
        // Ensure selected is in the list (pick first if not)
        if (!list.find(s => s.id === selectedStudioId) && list.length > 0) {
          setSelectedStudioId(list[0].id)
        }
      }).catch(() => {})
    })
  }, [role, studioIds?.join(',')])

  const isMultiStudio = studioIds && studioIds.length > 1
  const selectedName = studios.find(s => s.id === selectedStudioId)?.name

  const switcher = (
    <div className="flex items-center gap-2">
      {/* Studio switcher shown for admins with multiple studios; instructors get per-tab studio pills instead */}
      {isMultiStudio && studios.length > 1 && role !== 'instructor' && (
        <StudioSwitcher
          studios={studios}
          selectedId={selectedStudioId}
          onSelect={id => {
            setSelectedStudioId(id)
            setMode('management')
            const p = new URLSearchParams(searchParams.toString())
            p.set('studio', id)
            p.delete('tab')
            router.replace(`?${p.toString()}`)
          }}
        />
      )}
      <ModeSwitcher mode={mode} onSwitch={next => {
        setMode(next)
        const p = new URLSearchParams(searchParams.toString())
        if (next === 'management') p.delete('mode')
        else p.set('mode', next)
        router.replace(`?${p.toString()}`)
      }} />
    </div>
  )

  // Instructors see only their own classes in Live mode unless they also hold fronthost
  const liveMyClassesOnly = role === 'instructor' && !roles?.includes('fronthost')

  if (mode === 'live') {
    return (
      <LiveDashboard
        defaultStudioId={selectedStudioId}
        modeSwitch={switcher}
        myClassesOnly={liveMyClassesOnly || undefined}
      />
    )
  }

  return (
    <StudioManagerDashboard
      studioId={selectedStudioId}
      studioName={selectedName ?? initialStudioName}
      onBack={onBack}
      role={role}
      studios={studios.length > 1 ? studios : undefined}
      onStudioUpdate={data => {
        setStudios(prev => prev.map(s => s.id === selectedStudioId ? { ...s, name: data.name } : s))
        onStudioUpdate?.(data)
      }}
      modeSwitch={switcher}
    />
  )
}
