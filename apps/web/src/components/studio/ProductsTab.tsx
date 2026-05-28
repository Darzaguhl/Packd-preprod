'use client'

import { useState, useEffect } from 'react'
import { api, type Product } from '@/lib/api'
import PromoCodesTab from './PromoCodesTab'

const CATEGORIES = ['Drinks', 'Food', 'Merchandise', 'Services', 'Other']

type FormState = {
  name: string
  category: string
  priceInCents: string   // raw input, e.g. "12.50"
  creditsRequired: string
}

const EMPTY: FormState = { name: '', category: 'Drinks', priceInCents: '', creditsRequired: '0' }

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    category: p.category,
    priceInCents: (p.priceInCents / 100).toFixed(2),
    creditsRequired: String(p.creditsRequired),
  }
}

function fmtPrice(cents: number, currency: string) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isFree(p: Product) {
  return p.priceInCents === 0 && p.creditsRequired === 0
}

// Group products by category for display
function grouped(products: Product[]): [string, Product[]][] {
  const map = new Map<string, Product[]>()
  for (const p of products) {
    if (!map.has(p.category)) map.set(p.category, [])
    map.get(p.category)!.push(p)
  }
  return Array.from(map.entries())
}

interface Props {
  studioId: string
  token: string
  currency: string
}

export default function ProductsTab({ studioId, token, currency }: Props) {
  const [section, setSection] = useState<'products' | 'promos'>('products')
  const [products, setProducts]   = useState<Product[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [editId, setEditId]       = useState<string | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function f(key: keyof FormState, val: string) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function load() {
    try {
      setProducts(await api.products.list(studioId, token, true))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [studioId, token])

  function openNew() {
    setEditId(null); setForm(EMPTY); setError(''); setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditId(p.id); setForm(productToForm(p)); setError(''); setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    const cents = Math.round(parseFloat(form.priceInCents) * 100)
    if (!cents || cents < 0) { setError('Enter a valid price'); return }
    const credits = parseInt(form.creditsRequired)
    if (isNaN(credits) || credits < 0) { setError('Credits must be 0 or more'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        priceInCents: cents,
        creditsRequired: credits,
      }
      if (editId) {
        const updated = await api.products.update(editId, payload, token)
        setProducts(prev => prev.map(p => p.id === editId ? updated : p))
      } else {
        const created = await api.products.create({ studioId, ...payload }, token)
        setProducts(prev => [...prev, created])
      }
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  async function handleToggleStock(product: Product) {
    try {
      const updated = await api.products.update(product.id, { inStock: !product.inStock }, token)
      setProducts(prev => prev.map(p => p.id === product.id ? updated : p))
    } catch { /* silent */ }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await api.products.delete(id, token)
      setProducts(prev => prev.filter(p => p.id !== id))
    } catch { /* silent */ }
    finally { setDeletingId(null) }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    )
  }

  const groups = grouped(products)

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {([['products', 'Products'], ['promos', 'Promo Codes']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`text-xs font-medium px-4 py-1.5 rounded-md transition-colors ${
              section === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'promos' && <PromoCodesTab studioId={studioId} token={token} />}

      {section === 'products' && <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-500">
          Products available for purchase at the front desk. Each product has a credit cost used when selling via the Walk-in drawer.
        </p>
      </div>

      {/* Product list grouped by category */}
      {products.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">No products yet. Add one below.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([category, items]) => (
            <div key={category} className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{category}</p>
              {items.map(product => (
                <div key={product.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
                      {!product.inStock && (
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Out of stock</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {isFree(product)
                        ? 'Free'
                        : [
                            product.priceInCents > 0 ? fmtPrice(product.priceInCents, currency) : null,
                            product.creditsRequired > 0 ? `${product.creditsRequired} credit${product.creditsRequired !== 1 ? 's' : ''}` : null,
                          ].filter(Boolean).join(' · ')
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleStock(product)}
                      className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-md px-2.5 py-1 transition-colors"
                    >
                      {product.inStock ? 'Mark out of stock' : 'Mark in stock'}
                    </button>
                    <button
                      onClick={() => openEdit(product)}
                      className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded-md px-2.5 py-1 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(product.id)}
                      disabled={deletingId === product.id}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-100 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40"
                    >
                      {deletingId === product.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">{editId ? 'Edit product' : 'New product'}</h4>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Name *</label>
            <input
              type="text"
              placeholder="e.g. Protein Shake"
              value={form.name}
              onChange={e => f('name', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Category</label>
              <select
                value={form.category}
                onChange={e => f('category', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">{currency}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.priceInCents}
                  onChange={e => f('priceInCents', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Credits</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="1"
                value={form.creditsRequired}
                onChange={e => f('creditsRequired', e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : editId ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={openNew}
          className="text-sm font-medium text-gray-600 border border-dashed border-gray-300 rounded-xl px-4 py-2.5 w-full hover:border-gray-500 hover:text-gray-900 transition-colors"
        >
          + Add product
        </button>
      )}
      </div>}
    </div>
  )
}
