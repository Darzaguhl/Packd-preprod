'use client'

import { useState } from 'react'
import type { OnboardingData } from './OnboardingFlow'
import { api } from '@/lib/api-client'

export default function StepInviteAdmin({
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
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!data.studioId) return
    setLoading(true)
    setError(null)
    try {
      await api.staff.invite(email, firstName, 'studio_admin', data.studioId, token)
      setSent(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send invitation')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Invitation sent</h2>
          <p className="text-sm text-gray-500 mt-1">
            {firstName} will receive a signup link for <span className="font-medium">{data.studio.name}</span>.
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
          They'll be prompted to set a password and will get studio admin access once they sign in.
        </div>
        <button
          onClick={() => onNext({})}
          className="w-full bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Finish setup
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Invite a studio admin</h2>
        <p className="text-sm text-gray-500 mt-1">
          Who will manage <span className="font-medium">{data.studio.name}</span> day-to-day? They'll get a signup email.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="Alex"
          required
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alex@studio.com"
          required
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={loading} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Back
        </button>
        <button type="button" onClick={() => onNext({})} disabled={loading} className="py-2.5 px-4 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Skip
        </button>
        <button type="submit" disabled={loading} className="flex-1 bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
          {loading ? 'Sending…' : 'Send invite'}
        </button>
      </div>
    </form>
  )
}
