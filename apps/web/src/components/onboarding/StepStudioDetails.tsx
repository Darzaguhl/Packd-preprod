'use client'

import { useState } from 'react'
import type { OnboardingData } from './OnboardingFlow'

const TIMEZONES = [
  'UTC', 'Europe/Stockholm', 'Europe/London', 'Europe/Paris',
  'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'Asia/Tokyo', 'Australia/Sydney',
]

const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
  { code: 'GBP', label: 'GBP — British Pound' },
]

export default function StepStudioDetails({
  data,
  onNext,
}: {
  data: OnboardingData
  onNext: (patch: Partial<OnboardingData>) => void
}) {
  const [form, setForm] = useState(data.studio)

  function slugify(name: string) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name, slug: slugify(name) }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onNext({ studio: form })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Tell us about your studio</h2>
        <p className="text-sm text-gray-500 mt-1">This is what your members will see.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Studio name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Barry's Stockholm"
          required
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">URL slug</label>
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-black">
          <span className="px-3 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">
            packd.com/
          </span>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
            placeholder="barrys-stockholm"
            required
            className="flex-1 px-3 py-2 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
          <select
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        className="w-full bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        Continue
      </button>
    </form>
  )
}
