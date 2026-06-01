'use client'

import { useState, useEffect } from 'react'
import { api, type Brand } from '@/lib/api-client'

interface Props {
  token: string
  showToast: (msg: string, ok?: boolean) => void
}

export default function BrandsTab({ token, showToast }: Props) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [form, setForm] = useState({ name: '', slug: '', description: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    api.brands.list(token).then(res => { if (res.success) setBrands(res.data) }).catch(() => {})
  }, [token])

  async function reload() {
    const res = await api.brands.list(token)
    if (res.success) setBrands(res.data)
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Brands</h2>
          <p className="text-sm text-gray-500 mt-0.5">Group studios under a brand (e.g. Barry&apos;s). Assign a brand_admin to view cross-franchise analytics and members.</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} className="text-sm font-medium px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 transition-colors">
          {showAdd ? 'Cancel' : '+ New brand'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
          <input placeholder="Brand name (e.g. Barry's Bootcamp)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          <input placeholder="Slug (e.g. barrys)" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          <input placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black" />
          <button
            disabled={!form.name || !form.slug || adding}
            onClick={async () => {
              setAdding(true)
              try {
                await api.brands.create(form, token)
                await reload()
                setForm({ name: '', slug: '', description: '' }); setShowAdd(false)
              } finally { setAdding(false) }
            }}
            className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >{adding ? 'Creating…' : 'Create brand'}</button>
        </div>
      )}

      {brands.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400 py-8 text-center">No brands yet. Create one to group studios for a brand_admin.</p>
      )}

      {brands.map(brand => (
        <div key={brand.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div>
              <span className="font-semibold text-gray-900">{brand.name}</span>
              <span className="ml-2 text-xs text-gray-400">{brand.slug}</span>
              {brand.description && <p className="text-xs text-gray-400 mt-0.5">{brand.description}</p>}
            </div>
            <button
              onClick={async () => {
                await api.brands.delete(brand.id, token)
                await reload()
                showToast('Brand deleted')
              }}
              className="text-xs text-red-500 hover:text-red-700 transition-colors"
            >Delete</button>
          </div>
          <div className="px-4 py-3">
            {brand.franchises.length === 0 ? (
              <p className="text-xs text-gray-400">No franchises yet — the brand admin can create them from their dashboard.</p>
            ) : (
              <div className="space-y-1">
                {brand.franchises.map(f => (
                  <div key={f.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{f.name}</span>
                    <span className="text-xs text-gray-400">{f.studios.length} studio{f.studios.length !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
