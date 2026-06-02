'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'

type Promo = { code: string; description: string | null; type: string; value: number; maxUses: number | null; usageCount: number; studios: string[]; isActive: boolean; validUntil: string | null }

interface Props {
  studioCount: number
  token: string
  showToast: (msg: string, ok?: boolean) => void
}

export default function PromosTab({ studioCount, token, showToast }: Props) {
  const [promos, setPromos] = useState<Promo[]>([])
  const [form, setForm] = useState({ code: '', description: '', type: 'CREDIT_GRANT', value: 0, maxUses: '', validUntil: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    api.franchise.listPromos(token).then(r => setPromos(r.items)).catch(() => {})
  }, [token])

  return (
    <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Franchise promo codes</h2>
          <p className="text-sm text-gray-500 mt-0.5">Codes created here are applied to every studio in your franchise simultaneously.</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} className="text-sm font-medium px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 transition-colors">
          {showAdd ? 'Cancel' : '+ New promo'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Code</label>
              <input placeholder="SUMMER20" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black">
                <option value="CREDIT_GRANT">Credit grant</option>
                <option value="FREE_CLASS">Free class</option>
                <option value="MEMBERSHIP_PCT">Membership % off</option>
                <option value="MEMBERSHIP_FLAT">Membership flat off</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Value</label>
              <input type="number" min={0} value={form.value} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Max uses (blank = unlimited)</label>
              <input type="number" min={1} placeholder="∞" value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Expires (optional)</label>
              <input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Description (optional)</label>
              <input placeholder="Summer campaign 20% off" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
            </div>
          </div>
          <button
            disabled={!form.code || !form.type || adding}
            onClick={async () => {
              setAdding(true)
              try {
                await api.franchise.createPromo({
                  code: form.code,
                  description: form.description || undefined,
                  type: form.type,
                  value: form.value,
                  maxUses: form.maxUses ? Number(form.maxUses) : null,
                  validUntil: form.validUntil || null,
                }, token)
                setPromos((await api.franchise.listPromos(token)).items)
                setForm({ code: '', description: '', type: 'CREDIT_GRANT', value: 0, maxUses: '', validUntil: '' })
                setShowAdd(false)
                showToast('Promo created across all studios')
              } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
              finally { setAdding(false) }
            }}
            className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >
            {adding ? 'Creating…' : `Create across ${studioCount} studio${studioCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {promos.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 py-8 text-center">No franchise promos yet.</p>
      )}

      <div className="space-y-2">
        {promos.map(p => (
          <div key={p.code} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-sm text-gray-900">{p.code}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                  {p.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {p.type.replace(/_/g, ' ')} · value {p.value}
                {p.maxUses ? ` · ${p.usageCount}/${p.maxUses} uses` : ` · ${p.usageCount} uses`}
                {' · '}{p.studios.length} studio{p.studios.length !== 1 ? 's' : ''}
                {p.validUntil ? ` · expires ${new Date(p.validUntil).toLocaleDateString()}` : ''}
              </p>
              {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Delete "${p.code}" from all studios?`)) return
                try {
                  await api.franchise.deletePromo(p.code, token)
                  setPromos(prev => prev.filter(x => x.code !== p.code))
                  showToast('Promo deleted')
                } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false) }
              }}
              className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0"
            >Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
