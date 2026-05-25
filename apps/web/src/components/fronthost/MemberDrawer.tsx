'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type AdminSession, type AdminBooking, type Product } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import { useTimeFormat } from '@/lib/time-format-context'
import { fmtTime } from '@/lib/fmt-time'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberResult {
  id: string
  name: string
  email: string
  creditBalance: number
  membershipStatus: string | null
}

interface CartItem {
  product: Product
  qty: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function fmtPrice(cents: number, currency: string) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isFree(product: Product) {
  return product.priceInCents === 0 && product.creditsRequired === 0
}

// Group products by category
function groupByCategory(products: Product[]): [string, Product[]][] {
  const map = new Map<string, Product[]>()
  for (const p of products) {
    if (!map.has(p.category)) map.set(p.category, [])
    map.get(p.category)!.push(p)
  }
  return Array.from(map.entries())
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MembershipBadge({ status }: { status: string | null }) {
  if (!status) return null
  const active = status === 'ACTIVE'
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
      active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {active ? 'Member' : status.toLowerCase()}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  studioId: string
  currency: string
  selectedSession: AdminSession | null
  onClose: () => void
  /** Called when a booking is created so the parent can refresh session counts */
  onBookingChanged: () => void
}

export default function MemberDrawer({ studioId, currency, selectedSession, onClose, onBookingChanged }: Props) {
  const timeFormat = useTimeFormat()

  // Member search
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<MemberResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [member, setMember]         = useState<MemberResult | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Session booking status for selected member
  const [sessionBookings, setSessionBookings] = useState<AdminBooking[]>([])
  const [bookingLoading, setBookingLoading]   = useState(false)
  const [booking, setBooking] = useState<AdminBooking | null>(null)

  // Products & cart
  const [products, setProducts]   = useState<Product[]>([])
  const [cart, setCart]           = useState<CartItem[]>([])

  // Action states
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function getFreshToken() {
    const { data } = await createClient().auth.getSession()
    return data.session?.access_token ?? ''
  }

  // Load products once on mount
  useEffect(() => {
    getFreshToken().then(t => {
      if (t) api.products.list(studioId, t).then(setProducts).catch(() => {})
    })
  }, [studioId])

  // Debounced member search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    if (searchRef.current) clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      try {
        const t = await getFreshToken()
        const res = await api.admin.searchMembers(studioId, query, t)
        setResults(res)
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [query, studioId])

  // When member is selected, load their booking status for this session
  useEffect(() => {
    if (!member || !selectedSession) { setBooking(null); return }
    setBookingLoading(true)
    getFreshToken().then(t =>
      api.admin.bookings(selectedSession.id, t)
    ).then(bookings => {
      setSessionBookings(bookings)
      setBooking(bookings.find(b => b.memberId === member.id) ?? null)
    }).catch(() => setBooking(null))
    .finally(() => setBookingLoading(false))
  }, [member?.id, selectedSession?.id])

  function selectMember(m: MemberResult) {
    setMember(m)
    setQuery(m.name)
    setResults([])
    setCart([])
  }

  function clearMember() {
    setMember(null)
    setQuery('')
    setResults([])
    setCart([])
    setBooking(null)
  }

  // Cart helpers
  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev
      .map(i => i.product.id === productId ? { ...i, qty: i.qty - 1 } : i)
      .filter(i => i.qty > 0)
    )
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.product.creditsRequired * i.qty, 0)
  const cartLabel = cart.map(i => `${i.product.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleBook() {
    if (!member || !selectedSession) return
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      await api.bookings.create(selectedSession.id, t, member.id)
      // Refresh booking status
      const bookings = await api.admin.bookings(selectedSession.id, t)
      setSessionBookings(bookings)
      setBooking(bookings.find(b => b.memberId === member.id) ?? null)
      // Refresh member credit balance
      const fresh = await api.admin.searchMembers(studioId, member.name, t)
      const updated = fresh.find(r => r.id === member.id)
      if (updated) setMember(updated)
      onBookingChanged()
      showToast(`${member.name} booked into ${selectedSession.templateName}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Booking failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleCheckin() {
    if (!booking || !selectedSession) return
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      await api.admin.checkin(selectedSession.id, booking.id, t)
      setBooking(prev => prev ? { ...prev, checkedIn: !prev.checkedIn } : null)
      showToast(booking.checkedIn ? 'Check-in reversed' : 'Checked in ✓')
      onBookingChanged()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Check-in failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleChargeProducts() {
    if (!member || cart.length === 0) return
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      if (cartTotal > 0) {
        await api.admin.adjustCredits(member.id, -cartTotal, `Products: ${cartLabel}`, t)
        setMember(prev => prev ? { ...prev, creditBalance: prev.creditBalance - cartTotal } : null)
      }
      setCart([])
      showToast(cartTotal > 0
        ? `Charged ${cartTotal} credit${cartTotal !== 1 ? 's' : ''} for ${cartLabel}`
        : `Recorded: ${cartLabel}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Charge failed', false)
    } finally { setActionLoading(false) }
  }

  const categorised = groupByCategory(products)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Walk-in / Member</h2>
            {selectedSession && (
              <p className="text-xs text-gray-400 mt-0.5">
                {selectedSession.templateName} · {fmtTime(selectedSession.startsAt, timeFormat)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1">×</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Member search ── */}
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Find member</label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); if (!e.target.value) clearMember() }}
                placeholder="Search by name or email…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:ring-1 focus:ring-gray-400"
                autoFocus
              />
              {(query || member) && (
                <button onClick={clearMember} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
              )}
            </div>

            {/* Search results dropdown */}
            {results.length > 0 && (
              <div className="mt-1.5 border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                {results.map(r => (
                  <button
                    key={r.id}
                    onClick={() => selectMember(r)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                      {initials(r.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                      <p className="text-xs text-gray-400 truncate">{r.email}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-semibold text-gray-700">{r.creditBalance} cr</p>
                      <MembershipBadge status={r.membershipStatus} />
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searching && <p className="text-xs text-gray-400 mt-2">Searching…</p>}
          </div>

          {/* ── Member card + session actions ── */}
          {member && (
            <div className="px-5 py-4 border-b border-gray-100 space-y-4">
              {/* Member summary */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {initials(member.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                    <MembershipBadge status={member.membershipStatus} />
                  </div>
                  <p className="text-xs text-gray-400 truncate">{member.email}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-gray-900">{member.creditBalance}</p>
                  <p className="text-[10px] text-gray-400">credits</p>
                </div>
              </div>

              {/* Session actions */}
              {selectedSession && (
                <div className="bg-gray-50 rounded-xl p-3.5 space-y-2.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {selectedSession.templateName}
                  </p>

                  {bookingLoading ? (
                    <div className="h-8 bg-gray-200 rounded-lg animate-pulse" />
                  ) : booking ? (
                    <div className="flex items-center gap-2">
                      <span className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-lg ${
                        booking.checkedIn
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {booking.checkedIn ? '✓ Checked in' : 'Booked — not yet checked in'}
                      </span>
                      <button
                        onClick={handleCheckin}
                        disabled={actionLoading}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                          booking.checkedIn
                            ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            : 'bg-gray-900 text-white hover:bg-gray-700'
                        }`}
                      >
                        {actionLoading ? '…' : booking.checkedIn ? 'Undo' : 'Check in'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-gray-400">Not booked for this class</span>
                      <button
                        onClick={handleBook}
                        disabled={actionLoading || member.creditBalance < selectedSession.creditsRequired}
                        className="text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                      >
                        {actionLoading ? '…' : `Book (${selectedSession.creditsRequired} cr)`}
                      </button>
                    </div>
                  )}

                  {!booking && member.creditBalance < selectedSession.creditsRequired && (
                    <p className="text-[10px] text-red-500">
                      Insufficient credits — needs {selectedSession.creditsRequired}, has {member.creditBalance}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Products / extras ── */}
          {member && (
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extras</p>

              {products.length === 0 ? (
                <p className="text-xs text-gray-400">No products configured — add them in Studio Settings.</p>
              ) : (
                categorised.map(([category, items]) => (
                  <div key={category} className="space-y-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{category}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {items.map(product => {
                        const cartItem = cart.find(i => i.product.id === product.id)
                        const qty = cartItem?.qty ?? 0
                        return (
                          <div
                            key={product.id}
                            className={`border rounded-xl p-3 flex flex-col gap-1.5 transition-colors ${
                              qty > 0 ? 'border-gray-900 bg-gray-50' : 'border-gray-100 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-xs font-semibold text-gray-800 leading-snug">{product.name}</p>
                              <span className="text-[10px] text-gray-400 shrink-0">
                                {isFree(product) ? 'Free' : product.creditsRequired > 0 ? `${product.creditsRequired} cr` : null}
                              </span>
                            </div>
                            {product.priceInCents > 0 && (
                              <p className="text-[10px] text-gray-400">{fmtPrice(product.priceInCents, currency)}</p>
                            )}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {qty > 0 ? (
                                <>
                                  <button
                                    onClick={() => removeFromCart(product.id)}
                                    className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 text-sm font-bold flex items-center justify-center hover:bg-gray-300 transition-colors"
                                  >−</button>
                                  <span className="text-xs font-semibold tabular-nums w-4 text-center">{qty}</span>
                                </>
                              ) : null}
                              <button
                                onClick={() => addToCart(product)}
                                className={`${qty > 0 ? '' : 'w-full'} flex-1 text-[10px] font-semibold py-1 rounded-lg transition-colors ${
                                  qty > 0
                                    ? 'bg-gray-900 text-white hover:bg-gray-700'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {qty > 0 ? '+' : 'Add'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Cart footer ── */}
        {member && cart.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 bg-white shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0 flex-1 mr-3">
                <p className="text-xs font-medium text-gray-700 truncate">{cartLabel}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {cartTotal > 0
                    ? `${cartTotal} credit${cartTotal !== 1 ? 's' : ''} · member has ${member.creditBalance}`
                    : 'No charge'}
                </p>
              </div>
              <button
                onClick={handleChargeProducts}
                disabled={actionLoading || (cartTotal > 0 && member.creditBalance < cartTotal)}
                className="shrink-0 text-sm font-semibold bg-gray-900 text-white px-4 py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {actionLoading ? '…' : cartTotal > 0 ? `Charge ${cartTotal} cr` : 'Record sale'}
              </button>
            </div>
            {cartTotal > 0 && member.creditBalance < cartTotal && (
              <p className="text-[10px] text-red-500">Insufficient credits for this purchase</p>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-[60] transition-all ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
