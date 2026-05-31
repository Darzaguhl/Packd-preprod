'use client'

import { useState } from 'react'
import { api, type StudioSummary } from '@/lib/api'

interface Props {
  studios: StudioSummary[]
  token: string
  showToast: (msg: string, ok?: boolean) => void
}

export default function BroadcastTab({ studios, token, showToast }: Props) {
  const [form, setForm] = useState({ subject: '', message: '' })
  const [studioIds, setStudioIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ estimatedRecipients: number } | null>(null)

  if (result) {
    return (
      <div className="max-w-2xl mx-auto w-full px-6 py-6">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-8 text-center space-y-2">
          <p className="text-2xl font-bold text-emerald-700">Queued ✓</p>
          <p className="text-sm text-emerald-600">
            Sending to ~{result.estimatedRecipients} member{result.estimatedRecipients !== 1 ? 's' : ''} in the background.
          </p>
          <button
            onClick={() => { setResult(null); setForm({ subject: '', message: '' }); setStudioIds([]) }}
            className="mt-2 text-sm text-emerald-700 underline"
          >
            Send another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Broadcast message</h2>
        <p className="text-sm text-gray-500 mt-0.5">Send an email to all members across selected studios. Delivered in the background in batches.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Studios to reach</label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-black"
                checked={studioIds.length === studios.length && studios.length > 0}
                onChange={e => setStudioIds(e.target.checked ? studios.map(s => s.id) : [])} />
              <span className="font-medium text-gray-700">All studios</span>
            </label>
            {studios.map(s => (
              <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer pl-5">
                <input type="checkbox" className="accent-black"
                  checked={studioIds.includes(s.id)}
                  onChange={e => setStudioIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))} />
                <span className="text-gray-600">{s.name}</span>
                <span className="text-xs text-gray-400">{s.memberCount} members</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            placeholder="Exciting news from our studios"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
          <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Write your message here…" rows={6}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {studioIds.length > 0
              ? `${studios.filter(s => studioIds.includes(s.id)).reduce((n, s) => n + s.memberCount, 0)} members across ${studioIds.length} studio${studioIds.length !== 1 ? 's' : ''}`
              : 'Select studios above'}
          </p>
          <button
            disabled={!studioIds.length || !form.subject.trim() || !form.message.trim() || sending}
            onClick={async () => {
              setSending(true)
              try {
                const res = await api.franchise.broadcast({ studioIds, subject: form.subject, message: form.message }, token)
                setResult({ estimatedRecipients: res.estimatedRecipients })
              } catch (e) { showToast(e instanceof Error ? e.message : 'Broadcast failed', false) }
              finally { setSending(false) }
            }}
            className="bg-black text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Queuing…' : 'Send broadcast'}
          </button>
        </div>
      </div>
    </div>
  )
}
