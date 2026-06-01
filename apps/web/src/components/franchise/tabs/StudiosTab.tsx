'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type StudioSummary } from '@/lib/api-client'

function FillBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden w-full">
      <div
        className={`h-full rounded-full ${pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

interface Props {
  studios: StudioSummary[]
  loading: boolean
  token: string
  showToast: (msg: string, ok?: boolean) => void
  onManageStudio: (studio: StudioSummary) => void
  onStudioDeleted: (studioId: string) => void
}

export default function StudiosTab({ studios, loading, token, showToast, onManageStudio, onStudioDeleted }: Props) {
  const router = useRouter()
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function handleDelete(studioId: string) {
    try {
      await api.studios.delete(studioId, token)
      onStudioDeleted(studioId)
      showToast('Studio deleted')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete studio', false)
    } finally {
      setDeleteConfirm(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto w-full px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{studios.length} studio{studios.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => router.push('/onboarding')}
          className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
        >
          + Add studio
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-white rounded-2xl animate-pulse border border-gray-100" />)}
        </div>
      ) : studios.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 text-sm">No studios yet.</p>
          <button onClick={() => router.push('/onboarding')} className="mt-3 text-sm font-medium text-gray-700 underline">
            Create your first studio →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {studios.map(studio => (
            <div key={studio.id} className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-200 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 truncate">{studio.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{studio.timezone} · {studio.currency}</p>
                </div>
                {deleteConfirm === studio.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">Delete?</span>
                    <button onClick={() => handleDelete(studio.id)} className="text-xs text-red-600 font-medium hover:text-red-800">Yes</button>
                    <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(studio.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0 p-1" title="Delete studio">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { value: studio.memberCount, label: 'Members' },
                  { value: studio.todaySessionCount, label: 'Today' },
                  { value: studio.staffCount, label: 'Staff' },
                  { value: new Intl.NumberFormat('en', { style: 'currency', currency: studio.currency, maximumFractionDigits: 0 }).format((studio.revenueThisMonthCents ?? 0) / 100), label: 'This month' },
                ].map(({ value, label }) => (
                  <div key={label}>
                    <p className="text-lg font-bold tabular-nums text-gray-900">{value}</p>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">Fill rate today</span>
                  <span className="text-xs font-semibold text-gray-700">{studio.fillRateToday}%</span>
                </div>
                <FillBar pct={studio.fillRateToday} />
              </div>

              <button
                onClick={() => onManageStudio(studio)}
                className="flex-1 text-xs font-medium text-white bg-gray-900 rounded-lg px-3 py-2 hover:bg-gray-700 transition-colors"
              >
                Manage studio
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
