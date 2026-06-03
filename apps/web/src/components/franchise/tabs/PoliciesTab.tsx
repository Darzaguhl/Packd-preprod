'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'

interface Props {
  token: string
  showToast: (msg: string, ok?: boolean) => void
}

export default function PoliciesTab({ token, showToast }: Props) {
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState<number | null>(null)

  useEffect(() => {
    api.franchise.getWaiver(token)
      .then(({ waiver }) => {
        if (waiver) {
          setEnabled(true)
          setTitle(waiver.title)
          setBody(waiver.body)
          setVersion(waiver.version)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function handleSave() {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    try {
      await api.franchise.setWaiver(title.trim(), body.trim(), token)
      showToast('Waiver saved for all studios')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(next: boolean) {
    setSaving(true)
    try {
      if (next) {
        // Enabling — save current content (must have something)
        if (!title.trim() || !body.trim()) {
          setEnabled(true)
          setSaving(false)
          return
        }
        await api.franchise.setWaiver(title.trim(), body.trim(), token)
        showToast('Waiver enabled for all studios')
      } else {
        await api.franchise.removeWaiver(token)
        setEnabled(false)
        showToast('Waiver disabled for all studios')
      }
      setEnabled(next)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {[1, 2].map(i => <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Policies</h2>
        <p className="text-sm text-gray-500 mt-0.5">Applied to all studios in this franchise.</p>
      </div>

      {/* Waiver */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <div>
            <p className="text-sm font-semibold text-gray-900">Member waiver</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Members must sign once before their first booking.
              {version != null && <span className="ml-1 text-gray-300">v{version}</span>}
            </p>
          </div>
          {/* Toggle */}
          <button
            onClick={() => handleToggle(!enabled)}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-gray-900' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {enabled && (
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Liability Waiver"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Waiver text</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={8}
                placeholder="Enter the full waiver text members must agree to…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <p className="text-xs text-gray-400">
              Saving creates a new version — members who already signed will need to sign again.
              This waiver applies to all {' '}
              <strong className="text-gray-600">studios in this franchise</strong>.
            </p>
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving || !title.trim() || !body.trim()}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Save waiver'}
              </button>
            </div>
          </div>
        )}

        {!enabled && (
          <div className="px-5 py-4">
            <p className="text-xs text-gray-400">
              No active waiver. Members can book without signing anything.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
