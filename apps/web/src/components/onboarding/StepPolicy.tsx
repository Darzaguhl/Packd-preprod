'use client'

import { useState } from 'react'
import type { OnboardingData } from './OnboardingFlow'
import { api } from '@/lib/api'

export default function StepPolicy({
  data,
  onNext,
  onBack,
  token,
}: {
  data: OnboardingData
  onNext: (patch: Partial<OnboardingData>) => void
  onBack: () => void
  token: string
}) {
  const [form, setForm] = useState(data.policy)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await api.studios.create(
        { ...data.studio, policy: form, location: data.location, rooms: data.rooms },
        token,
      )
      if (res.success) {
        onNext({ policy: form, studioId: res.data.id })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create studio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Cancellation policy</h2>
        <p className="text-sm text-gray-500 mt-1">Set the rules for late cancellations and no-shows.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Late cancel window
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={form.lateCancelWindowHours}
            onChange={(e) => setForm((f) => ({ ...f, lateCancelWindowHours: Number(e.target.value) }))}
            min={1}
            max={72}
            className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
          <span className="text-sm text-gray-500">hours before class</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">Cancellations within this window incur a fee.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Late cancel fee</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={form.lateCancelFeeCredits}
              onChange={(e) => setForm((f) => ({ ...f, lateCancelFeeCredits: Number(e.target.value) }))}
              min={0}
              className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <span className="text-sm text-gray-500">credit{form.lateCancelFeeCredits !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">No-show fee</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={form.noShowFeeCredits}
              onChange={(e) => setForm((f) => ({ ...f, noShowFeeCredits: Number(e.target.value) }))}
              min={0}
              className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <span className="text-sm text-gray-500">credit{form.noShowFeeCredits !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating studio...' : 'Create studio'}
        </button>
      </div>
    </form>
  )
}
