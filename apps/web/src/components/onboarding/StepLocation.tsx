'use client'

import { useState } from 'react'
import type { OnboardingData } from './OnboardingFlow'

export default function StepLocation({
  data,
  onNext,
  onBack,
}: {
  data: OnboardingData
  onNext: (patch: Partial<OnboardingData>) => void
  onBack: () => void
}) {
  const [form, setForm] = useState(data.location)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onNext({ location: form })
  }

  function field(key: keyof typeof form, label: string, placeholder: string) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type="text"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder}
          required
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Your first location</h2>
        <p className="text-sm text-gray-500 mt-1">You can add more locations later.</p>
      </div>

      {field('name', 'Location name', 'Stockholm City')}
      {field('address', 'Street address', 'Drottninggatan 1')}

      <div className="grid grid-cols-2 gap-4">
        {field('city', 'City', 'Stockholm')}
        {field('country', 'Country', 'Sweden')}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Continue
        </button>
      </div>
    </form>
  )
}
