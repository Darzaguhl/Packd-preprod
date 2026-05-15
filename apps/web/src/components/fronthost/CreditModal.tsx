'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

interface Props {
  studioId: string
  token: string
  onClose: () => void
}

type MemberResult = { id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }

const PRESET_AMOUNTS = [5, 10, 20, 30]

export default function CreditModal({ studioId: _studioId, token, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<MemberResult | null>(null)
  const [amount, setAmount] = useState(10)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    if (query.trim().length < 2) return
    setSearching(true)
    setError(null)
    try {
      const data = await api.admin.searchMembers(_studioId, query.trim(), token)
      setResults(data)
      if (data.length === 0) setError('No members found')
    } catch {
      setError('Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function handleAdjust() {
    if (!selected || amount === 0) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.admin.adjustCredits(selected.id, amount, note || 'Manual adjustment by front desk', token)
      setSuccess(res.newBalance)
      setSelected(prev => prev ? { ...prev, creditBalance: res.newBalance } : prev)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to adjust credits')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">Adjust Credits</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Member search */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Find Member
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Name or email…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <button
                onClick={search}
                disabled={searching}
                className="text-xs font-medium bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                {searching ? '…' : 'Search'}
              </button>
            </div>
          </div>

          {/* Results */}
          {results.length > 0 && !selected && (
            <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelected(r); setResults([]); setSuccess(null) }}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.email}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-500">{r.creditBalance} cr</span>
                </button>
              ))}
            </div>
          )}

          {/* Selected member + adjust */}
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
                  <p className="text-xs text-gray-400">{selected.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Balance</p>
                  <p className="text-base font-bold text-gray-900">{selected.creditBalance} cr</p>
                </div>
                <button
                  onClick={() => { setSelected(null); setSuccess(null); setQuery('') }}
                  className="ml-3 text-xs text-gray-400 hover:text-gray-700"
                >
                  ×
                </button>
              </div>

              {success !== null && (
                <div className="bg-emerald-50 text-emerald-700 text-xs font-medium px-4 py-2.5 rounded-xl">
                  Done — new balance: {success} credits
                </div>
              )}

              {/* Quick amount presets */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                  Amount
                </label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {PRESET_AMOUNTS.map(p => (
                    <button
                      key={p}
                      onClick={() => setAmount(p)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        amount === p ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      +{p}
                    </button>
                  ))}
                  <button
                    onClick={() => setAmount(a => -Math.abs(a))}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                      amount < 0 ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    Deduct
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2 text-center focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={handleAdjust}
                disabled={saving || amount === 0}
                className="w-full text-sm font-semibold bg-gray-900 text-white py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : `Apply ${amount > 0 ? '+' : ''}${amount} credits`}
              </button>
            </div>
          )}

          {error && !selected && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
