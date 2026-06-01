'use client'

import { useState, useEffect } from 'react'
import type { OnboardingData } from './OnboardingFlow'
import { api } from '@/lib/api-client'

type CopyOption = 'plans' | 'products' | 'templates' | 'policy'

const COPY_OPTIONS: { key: CopyOption; label: string; description: string }[] = [
  { key: 'plans', label: 'Membership plans', description: 'Pricing, credits per cycle, billing intervals' },
  { key: 'products', label: 'Products', description: 'Retail items and credit-based products' },
  { key: 'templates', label: 'Class templates', description: 'Cycling, HIIT, Yoga etc. class definitions' },
  { key: 'policy', label: 'Cancellation policy', description: 'Late-cancel window and fee settings' },
]

export default function StepImport({
  data,
  token,
  onNext,
  onBack,
}: {
  data: OnboardingData
  token: string
  onNext: (patch: Partial<OnboardingData>) => void
  onBack: () => void
}) {
  const [studios, setStudios] = useState<{ id: string; name: string }[]>([])
  const [sourceId, setSourceId] = useState('')
  const [selected, setSelected] = useState<CopyOption[]>(['plans', 'products', 'templates', 'policy'])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.studios.list(token)
      .then(list => setStudios(list.filter(s => s.id !== data.studioId)))
      .catch(() => setStudios([]))
      .finally(() => setFetching(false))
  }, [token, data.studioId])

  function toggle(key: CopyOption) {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function handleCopy(e: React.FormEvent) {
    e.preventDefault()
    if (!sourceId || !selected.length || !data.studioId) {
      onNext({})
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.studios.copyFrom(data.studioId, sourceId, selected, token)
      onNext({})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  function handleSkip() {
    onNext({})
  }

  if (fetching) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Copy from existing studio</h2>
          <p className="text-sm text-gray-500 mt-1">Loading your studios…</p>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-gray-100 rounded-lg" />
          <div className="h-10 bg-gray-100 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!studios.length) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Copy from existing studio</h2>
          <p className="text-sm text-gray-500 mt-1">No other studios to copy from yet.</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Back
          </button>
          <button type="button" onClick={handleSkip} className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">
            Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleCopy} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Copy from existing studio</h2>
        <p className="text-sm text-gray-500 mt-1">Optionally seed this studio with resources from one of your other locations.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Source studio</label>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="">— Select a studio —</option>
          {studios.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {sourceId && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">What to copy</p>
          <div className="space-y-2">
            {COPY_OPTIONS.map(opt => (
              <label key={opt.key} className="flex items-start gap-3 p-3 border border-gray-100 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.key)}
                  onChange={() => toggle(opt.key)}
                  className="mt-0.5 accent-black"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={loading} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Back
        </button>
        <button type="button" onClick={handleSkip} disabled={loading} className="py-2.5 px-4 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Skip
        </button>
        <button type="submit" disabled={loading || !sourceId || !selected.length} className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
          {loading ? 'Copying…' : 'Copy & continue'}
        </button>
      </div>
    </form>
  )
}
