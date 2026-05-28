'use client'

import React, { useState, useEffect } from 'react'
import { api, type PromoCode } from '@/lib/api'

const TYPE_LABELS: Record<string, string> = {
  CREDIT_GRANT: 'Credit top-up',
  FREE_CLASS: 'Free class',
  MEMBERSHIP_PCT: 'Membership % off',
  MEMBERSHIP_FLAT: 'Membership flat off',
}

const TYPE_BADGE: Record<string, string> = {
  CREDIT_GRANT: 'bg-emerald-100 text-emerald-700',
  FREE_CLASS: 'bg-blue-100 text-blue-700',
  MEMBERSHIP_PCT: 'bg-purple-100 text-purple-700',
  MEMBERSHIP_FLAT: 'bg-amber-100 text-amber-700',
}

function valueLabel(code: PromoCode) {
  if (code.type === 'FREE_CLASS') return '1 class'
  if (code.type === 'CREDIT_GRANT') return `${code.value} credits`
  if (code.type === 'MEMBERSHIP_PCT') return `${code.value}% off`
  if (code.type === 'MEMBERSHIP_FLAT') return `${(code.value / 100).toFixed(2)} off`
  return String(code.value)
}

interface FormState {
  code: string
  description: string
  type: string
  value: string
  maxUses: string
  validFrom: string
  validUntil: string
}

const BLANK_FORM: FormState = {
  code: '', description: '', type: 'CREDIT_GRANT', value: '1', maxUses: '', validFrom: '', validUntil: '',
}

export default function PromoCodesTab({ studioId, token }: { studioId: string; token: string }) {
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api.promos.list(studioId, token)
      setCodes(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [studioId, token])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await api.promos.create({
        studioId,
        code: form.code,
        description: form.description || undefined,
        type: form.type,
        value: Number(form.value),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        validFrom: form.validFrom || undefined,
        validUntil: form.validUntil || null,
      }, token)
      setCodes(prev => [created, ...prev])
      setForm(BLANK_FORM)
      setShowForm(false)
      showToast('Promo code created')
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(code: PromoCode) {
    try {
      const updated = await api.promos.update(code.id, { isActive: !code.isActive }, token)
      setCodes(prev => prev.map(c => c.id === updated.id ? updated : c))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this promo code?')) return
    try {
      await api.promos.delete(id, token)
      setCodes(prev => prev.filter(c => c.id !== id))
      showToast('Deleted')
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const typeNeedsFloat = form.type === 'MEMBERSHIP_FLAT'

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Promo codes</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create discount codes for members</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setForm(BLANK_FORM) }}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New code'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">New promo code</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code *</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 uppercase"
                placeholder="SUMMER25"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type *</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value, value: '1' }))}
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Value * {form.type === 'CREDIT_GRANT' ? '(credits)' : form.type === 'MEMBERSHIP_PCT' ? '(%)' : form.type === 'MEMBERSHIP_FLAT' ? '(cents)' : ''}
              </label>
              {form.type === 'FREE_CLASS' ? (
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400" value="1 class (fixed)" disabled />
              ) : (
                <input
                  type="number"
                  min={typeNeedsFloat ? 1 : 1}
                  step={typeNeedsFloat ? 1 : 1}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max uses (blank = unlimited)</label>
              <input
                type="number"
                min={1}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                placeholder="unlimited"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valid from</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.validFrom}
                onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Valid until</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={form.validUntil}
                onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="Optional description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create code'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-white rounded-xl animate-pulse border border-gray-100" />)}
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : codes.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No promo codes yet. Create one above.
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Value</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Uses</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Valid until</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {codes.map(c => (
                <tr key={c.id} className={`${!c.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900">{c.code}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[c.type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {TYPE_LABELS[c.type] ?? c.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{valueLabel(c)}</td>
                  <td className="px-4 py-3 text-gray-500 tabular-nums">
                    {c.usageCount}{c.maxUses !== null ? `/${c.maxUses}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.validUntil ? new Date(c.validUntil).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(c)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.isActive ? 'bg-emerald-500' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${c.isActive ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
