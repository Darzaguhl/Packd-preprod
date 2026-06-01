'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type AdminSession, type AdminBooking, type Product, type CartSaleItem } from '@/lib/api-client'
import { bookings as bookingsClient } from '@/lib/api-client'
import { createClient } from '@/lib/supabase/client'
import { useTimeFormat } from '@/lib/time-format-context'
import { fmtTime } from '@/lib/fmt-time'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberResult {
  id: string
  name: string
  email?: string
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
  permissions?: import('@/lib/api').LivePermissions
  onClose: () => void
  /** Called when a booking is created so the parent can refresh session counts */
  onBookingChanged: () => void
  /** Pre-select a member when opening from the room map */
  initialMember?: { id: string; name: string; email?: string; creditBalance: number; membershipStatus: string | null }
  /** Target station — when set, booking auto-assigns + auto-checks in */
  targetStation?: { id: string; label: string }
  /** Called after a booking is created and (if applicable) assigned+checked in */
  onAssigned?: () => void
  /** Called after check-in is toggled — passes the exact change so the map can update instantly */
  onPatchCheckin?: (bookingId: string, checkedIn: boolean) => void
  /** Called after products are successfully charged, with the member's ID */
  onProductsCharged?: (memberId: string) => void
}

export default function MemberDrawer({ studioId, currency, selectedSession, permissions, onClose, onBookingChanged, initialMember, targetStation, onAssigned, onPatchCheckin, onProductsCharged }: Props) {
  // Treat missing permissions as full access (admin context)
  const canViewContact    = permissions?.canViewMemberContact  ?? true
  const canAdjustCredits  = permissions?.canAdjustCredits      ?? true
  const canGrantCredits   = permissions?.canGrantCredits       ?? true
  const canIssueRefunds   = permissions?.canIssueRefunds       ?? true
  const timeFormat = useTimeFormat()

  // Member search
  const [query, setQuery]           = useState(initialMember?.name ?? '')
  const [results, setResults]       = useState<MemberResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [member, setMember]         = useState<MemberResult | null>(initialMember ?? null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Session booking status for selected member
  const [sessionBookings, setSessionBookings] = useState<AdminBooking[]>([])
  const [bookingLoading, setBookingLoading]   = useState(false)
  const [booking, setBooking] = useState<AdminBooking | null>(null)

  // Member's upcoming bookings (for cancel-on-behalf)
  const [memberUpcoming, setMemberUpcoming] = useState<import('@/lib/api').UpcomingBooking[]>([])
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)

  // Products & cart
  const [products, setProducts]   = useState<Product[]>([])
  const [cart, setCart]           = useState<CartItem[]>([])
  const [savedCard, setSavedCard] = useState<{ last4: string; brand: string } | null | undefined>(undefined)

  // Action states
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null)

  // Credit adjustment
  const [creditPreset, setCreditPreset]   = useState<number | null>(null)
  const [creditCustom, setCreditCustom]   = useState('')
  const [creditDeduct, setCreditDeduct]   = useState(false)
  const [creditNote, setCreditNote]       = useState('')

  // Extended profile fields (read-only in drawer — edit on member profile page)
  const [memberBirthday, setMemberBirthday] = useState<string | null>(null)
  const [memberEmergencyName, setMemberEmergencyName] = useState<string | null>(null)
  const [memberEmergencyPhone, setMemberEmergencyPhone] = useState<string | null>(null)

  // Promo code redemption
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)

  // Guest check-in
  const [memberGuestPassBalance, setMemberGuestPassBalance] = useState<number | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestCheckinLoading, setGuestCheckinLoading] = useState(false)

  // Purchase history
  const [memberPurchases, setMemberPurchases] = useState<import('@/lib/api').ProductSale[]>([])
  const [refundingId, setRefundingId] = useState<string | null>(null)

  const creditAmount = creditPreset ?? (creditCustom ? parseInt(creditCustom, 10) : null)

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

  // Load member's upcoming bookings when member is selected
  useEffect(() => {
    if (!member) { setMemberUpcoming([]); return }
    getFreshToken().then(t => api.admin.memberUpcoming(member.id, t))
      .then(setMemberUpcoming).catch(() => setMemberUpcoming([]))
  }, [member?.id])

  function selectMember(m: MemberResult) {
    setMember(m)
    setQuery(m.name)
    setResults([])
    setCart([])
    setPromoCode('')
    setMemberBirthday(null)
    setMemberEmergencyName(null)
    setMemberEmergencyPhone(null)
  }

  // Load extended profile fields + saved card when a member is selected
  useEffect(() => {
    if (!member) {
      setMemberBirthday(null); setMemberEmergencyName(null); setMemberEmergencyPhone(null)
      setMemberGuestPassBalance(null); setGuestName(''); setSavedCard(undefined)
      setMemberPurchases([])
      return
    }
    getFreshToken().then(async t => {
      const [profile, card, purchases] = await Promise.all([
        api.admin.memberProfile(member.id, t),
        api.stripe.customerCard(member.id, t).catch(() => ({ hasCard: false as const })),
        api.admin.memberPurchases(member.id, t, studioId).catch(() => [] as import('@/lib/api').ProductSale[]),
      ])
      setMemberBirthday(profile.birthday ?? null)
      setMemberEmergencyName(profile.emergencyContactName ?? null)
      setMemberEmergencyPhone(profile.emergencyContactPhone ?? null)
      setMemberGuestPassBalance(profile.guestPassBalance ?? 0)
      setSavedCard(card.hasCard && card.last4 && card.brand ? { last4: card.last4, brand: card.brand } : null)
      setMemberPurchases(purchases)
    }).catch(() => {})
  }, [member?.id])

  /** When the drawer was opened from an empty station click, clicking a member
   *  name in the search results immediately books them into the session and
   *  assigns them to the station — same behaviour as drag-and-drop on the map.
   *  The drawer then shows their booking card with the Check in button. */
  async function handleAddToStation(m: MemberResult) {
    if (!selectedSession || !targetStation) return
    setActionLoading(true)
    selectMember(m)
    try {
      const t = await getFreshToken()
      let bookingId: string | undefined
      try {
        // Try to create a new booking
        const createRes = await bookingsClient.create({ sessionId: selectedSession.id, memberId: m.id }, t)
        bookingId = (createRes as { success: boolean; data?: { id: string } })?.data?.id
        onBookingChanged()
      } catch {
        // Member is already booked — find their existing booking
        const existingBookings = await api.admin.bookings(selectedSession.id, t)
        const existing = existingBookings.find(b => b.memberId === m.id)
        bookingId = existing?.id
        setBooking(existing ?? null)
        // Reuse the already-fetched list to avoid a second round-trip
        setSessionBookings(existingBookings)
      }
      if (bookingId) {
        await api.rooms.assignSpot(selectedSession.roomId, selectedSession.id, bookingId, targetStation.id, t)
        // Refresh once after spot assignment
        const bookings = await api.admin.bookings(selectedSession.id, t)
        setSessionBookings(bookings)
        setBooking(bookings.find(b => b.memberId === m.id) ?? null)
      }
      // Refresh the map to show the new assignment
      onAssigned?.()
      showToast(`${m.name} added to ${targetStation.label}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add member', false)
    } finally { setActionLoading(false) }
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
      await bookingsClient.create({ sessionId: selectedSession.id, memberId: member.id }, t)
      onBookingChanged()
      // Refresh the map so the newly-booked member appears in the unassigned list
      onAssigned?.()

      // Refresh booking status for drawer display (background, non-blocking)
      api.admin.bookings(selectedSession.id, t).then(bookings => {
        setSessionBookings(bookings)
        setBooking(bookings.find(bk => bk.memberId === member.id) ?? null)
      }).catch(() => {})

      // Refresh member credit balance (best-effort)
      api.admin.searchMembers(studioId, member.name, t).then(fresh => {
        const updated = fresh.find(r => r.id === member.id)
        if (updated) setMember(updated)
      }).catch(() => {})

      showToast(`${member.name} booked into ${selectedSession.templateName}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Booking failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleCheckin() {
    if (!booking || !selectedSession) return
    setActionLoading(true)
    const newCheckedIn = !booking.checkedIn
    try {
      const t = await getFreshToken()
      await api.admin.checkin(selectedSession.id, booking.id, t)
      setBooking(prev => prev ? { ...prev, checkedIn: newCheckedIn } : null)
      // Patch the map instantly — no server round-trip needed since we have the data
      onPatchCheckin?.(booking.id, newCheckedIn)
      showToast(booking.checkedIn ? 'Check-in reversed' : 'Checked in ✓')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Check-in failed', false)
    } finally { setActionLoading(false) }
  }

  const cartItems: CartSaleItem[] = cart.map(i => ({
    productId: i.product.id,
    name: i.product.name,
    qty: i.qty,
    priceInCents: i.product.priceInCents,
    creditsRequired: i.product.creditsRequired,
  }))
  const cartCashTotal = cart.reduce((sum, i) => sum + i.product.priceInCents * i.qty, 0)

  async function handleChargeCard() {
    if (!member || cart.length === 0) return
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      await api.stripe.chargeMember({
        memberId: member.id, studioId, items: cartItems,
        totalCents: cartCashTotal, totalCredits: cartTotal,
      }, t)
      if (cartTotal > 0) setMember(prev => prev ? { ...prev, creditBalance: prev.creditBalance - cartTotal } : null)
      setCart([])
      onProductsCharged?.(member.id)
      showToast(`Charged to card: ${cartLabel}`)
      api.admin.memberPurchases(member.id, t, studioId).then(setMemberPurchases).catch(() => {})
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Card charge failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleMarkAsPaid(method: 'cash' | 'credits' | 'free') {
    if (!member || cart.length === 0) return
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      await api.admin.recordProductSale({
        memberId: member.id, studioId, items: cartItems,
        totalCents: cartCashTotal, totalCredits: cartTotal, paymentMethod: method,
      }, t)
      if (method === 'credits' && cartTotal > 0) {
        setMember(prev => prev ? { ...prev, creditBalance: prev.creditBalance - cartTotal } : null)
      }
      setCart([])
      onProductsCharged?.(member.id)
      showToast(method === 'cash' ? `Recorded as cash: ${cartLabel}` : method === 'credits' ? `Charged ${cartTotal} cr: ${cartLabel}` : `Recorded: ${cartLabel}`)
      api.admin.memberPurchases(member.id, t, studioId).then(setMemberPurchases).catch(() => {})
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Charge failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleAdjustCredit() {
    if (!member || !creditAmount || isNaN(creditAmount) || creditAmount <= 0) return
    const delta = creditDeduct ? -creditAmount : creditAmount
    setActionLoading(true)
    try {
      const t = await getFreshToken()
      await api.admin.adjustCredits(member.id, delta, creditNote.trim(), t)
      setMember(prev => prev ? { ...prev, creditBalance: prev.creditBalance + delta } : null)
      setCreditPreset(null)
      setCreditCustom('')
      setCreditNote('')
      showToast(`${delta > 0 ? '+' : ''}${delta} credits for ${member.name}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Credit adjustment failed', false)
    } finally { setActionLoading(false) }
  }

  async function handleRedeemPromo() {
    if (!member || !promoCode.trim()) return
    setPromoLoading(true)
    try {
      const t = await getFreshToken()
      const result = await api.promos.redeem(promoCode.trim(), studioId, t, member.id)
      if (result.creditsAdded > 0) {
        setMember(prev => prev ? { ...prev, creditBalance: prev.creditBalance + result.creditsAdded } : null)
      }
      setPromoCode('')
      showToast(result.message)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Invalid promo code', false)
    } finally { setPromoLoading(false) }
  }

  async function handleGuestCheckin() {
    if (!member || !guestName.trim()) return
    setGuestCheckinLoading(true)
    try {
      const t = await getFreshToken()
      const res = await api.admin.guestCheckin(member.id, guestName.trim(), studioId, selectedSession?.id, t)
      setMemberGuestPassBalance(res.guestPassBalance)
      setGuestName('')
      showToast(`Guest "${guestName.trim()}" checked in`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Guest check-in failed', false)
    } finally { setGuestCheckinLoading(false) }
  }

  async function handleRefund(saleId: string) {
    if (!confirm('Refund this sale to the member\'s card?')) return
    setRefundingId(saleId)
    try {
      const t = await getFreshToken()
      await api.stripe.refund(saleId, t)
      setMemberPurchases(prev => prev.map(s => s.id === saleId ? { ...s, refundedAt: new Date().toISOString(), refundedCents: s.totalCents } : s))
      showToast('Refund issued successfully')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Refund failed', false)
    } finally { setRefundingId(null) }
  }

  const categorised = groupByCategory(products)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div data-testid="member-drawer" className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {targetStation ? `Add to ${targetStation.label}` : 'Find member'}
            </h2>
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
                    data-testid="member-row"
                    onClick={() => targetStation ? handleAddToStation(r) : selectMember(r)}
                    disabled={actionLoading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0 disabled:opacity-40"
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                      {initials(r.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                      <p className="text-xs text-gray-400 truncate">{r.email}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {targetStation ? (
                        <>
                          <p className={`text-xs font-semibold ${r.creditBalance < (selectedSession?.creditsRequired ?? 1) ? 'text-amber-500' : 'text-gray-500'}`}>
                            {r.creditBalance} cr
                          </p>
                          <p className="text-[10px] text-gray-400">+ add</p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-gray-700">{r.creditBalance} cr</p>
                          <MembershipBadge status={r.membershipStatus} />
                        </>
                      )}
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
                    <a
                      href={`/members/${member.id}`}
                      className="text-sm font-semibold text-gray-900 hover:underline"
                    >
                      {member.name}
                    </a>
                    <MembershipBadge status={member.membershipStatus} />
                    {savedCard && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        💳 <span className="capitalize">{savedCard.brand}</span> ••{savedCard.last4}
                      </span>
                    )}
                    {savedCard === null && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">
                        No card
                      </span>
                    )}
                  </div>
                  {canViewContact && member.email && <p className="text-xs text-gray-400 truncate">{member.email}</p>}
                  {memberBirthday && (
                    <p className="text-xs text-gray-400">
                      🎂 {new Date(memberBirthday).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}
                      {Math.floor((Date.now() - new Date(memberBirthday).getTime()) / (365.25 * 24 * 3600 * 1000))} yo
                    </p>
                  )}
                  {(memberEmergencyName || memberEmergencyPhone) && (
                    <p className="text-xs text-amber-600 truncate">
                      🚨 {[memberEmergencyName, memberEmergencyPhone].filter(Boolean).join(' · ')}
                    </p>
                  )}
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
                        data-testid="checkin-btn"
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
                    <p className="text-[10px] text-amber-600">
                      ⚠ Only {member.creditBalance} cr — booking will go negative. Add credits below.
                    </p>
                  )}
                </div>
              )}

              {/* ── Credit adjustment — gated by canAdjustCredits / canGrantCredits ── */}
              {(canAdjustCredits || canGrantCredits) && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Adjust credits</p>
                    <button
                      onClick={() => setCreditDeduct(d => !d)}
                      className={`text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${
                        creditDeduct ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {creditDeduct ? '− Deduct' : '+ Add'}
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {[5, 10, 20, 30].map(n => (
                      <button
                        key={n}
                        onClick={() => { setCreditPreset(creditPreset === n ? null : n); setCreditCustom('') }}
                        className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                          creditPreset === n
                            ? creditDeduct ? 'bg-red-500 text-white' : 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {creditDeduct ? `−${n}` : `+${n}`}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number" min={1} value={creditCustom}
                      onChange={e => { setCreditCustom(e.target.value); setCreditPreset(null) }}
                      placeholder="Custom…"
                      className="w-24 shrink-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                    <input
                      type="text" value={creditNote}
                      onChange={e => setCreditNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    />
                  </div>
                  <button
                    onClick={handleAdjustCredit}
                    disabled={actionLoading || !creditAmount || creditAmount <= 0}
                    className={`w-full text-sm font-semibold py-2 rounded-xl transition-colors disabled:opacity-40 ${
                      creditDeduct ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-900 text-white hover:bg-gray-700'
                    }`}
                  >
                    {actionLoading ? '…' : creditAmount && creditAmount > 0
                      ? `${creditDeduct ? 'Deduct' : 'Add'} ${creditAmount} credit${creditAmount !== 1 ? 's' : ''}`
                      : 'Select amount'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Promo code redemption ── */}
          {member && (
            <div className="px-5 py-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Apply promo code</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={e => setPromoCode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') handleRedeemPromo() }}
                  placeholder="Enter code…"
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 font-mono"
                />
                <button
                  onClick={handleRedeemPromo}
                  disabled={promoLoading || !promoCode.trim()}
                  className="text-sm font-medium px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {promoLoading ? '…' : 'Apply'}
                </button>
              </div>
            </div>
          )}

          {/* ── Guest check-in ── */}
          {member && memberGuestPassBalance !== null && (
            <div className="px-5 py-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Guest check-in</p>
                <span className="text-xs text-gray-400">{memberGuestPassBalance} pass{memberGuestPassBalance !== 1 ? 'es' : ''} remaining</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleGuestCheckin() }}
                  placeholder="Guest name…"
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <button
                  onClick={handleGuestCheckin}
                  disabled={guestCheckinLoading || !guestName.trim() || memberGuestPassBalance < 1}
                  className="text-sm font-medium px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {guestCheckinLoading ? '…' : 'Check in'}
                </button>
              </div>
              {memberGuestPassBalance < 1 && (
                <p className="text-xs text-amber-600 mt-1">No guest passes remaining</p>
              )}
            </div>
          )}

          {/* ── Upcoming bookings (cancel on behalf) ── */}
          {member && memberUpcoming.length > 0 && (
            <div className="px-5 py-4 space-y-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Upcoming bookings</p>
              {memberUpcoming.map(b => (
                <div key={b.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{b.templateName}</p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(b.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' · '}{fmtTime(b.startsAt, timeFormat)}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setCancellingBookingId(b.id)
                      try {
                        const t = await getFreshToken()
                        await bookingsClient.cancel(b.id, t)
                        setMemberUpcoming(prev => prev.filter(x => x.id !== b.id))
                        showToast('Booking cancelled')
                        onBookingChanged()
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : 'Failed to cancel', false)
                      } finally {
                        setCancellingBookingId(null)
                      }
                    }}
                    disabled={cancellingBookingId === b.id}
                    className="shrink-0 text-[10px] text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {cancellingBookingId === b.id ? '…' : 'Cancel'}
                  </button>
                </div>
              ))}
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
          <div className="px-5 py-4 border-t border-gray-100 bg-white shrink-0 space-y-3">
            {/* Summary */}
            <div>
              <p className="text-xs font-medium text-gray-700 truncate">{cartLabel}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {cartCashTotal > 0 && cartTotal > 0
                  ? `${cartCashTotal / 100} cash + ${cartTotal} cr`
                  : cartCashTotal > 0
                  ? `${cartCashTotal / 100} cash`
                  : cartTotal > 0
                  ? `${cartTotal} credit${cartTotal !== 1 ? 's' : ''} · balance: ${member.creditBalance}`
                  : 'Free'}
              </p>
            </div>

            {/* Payment buttons */}
            <div className="flex flex-col gap-2">
              {/* Card on file */}
              {savedCard && (cartCashTotal > 0 || cartTotal > 0) && (
                <button
                  onClick={handleChargeCard}
                  disabled={actionLoading}
                  className="w-full text-sm font-semibold bg-gray-900 text-white px-4 py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                >
                  {actionLoading ? '…' : (
                    <>
                      <span>Charge {savedCard.brand} ••{savedCard.last4}</span>
                      {cartCashTotal > 0 && <span className="text-gray-300 text-xs">({cartCashTotal / 100})</span>}
                    </>
                  )}
                </button>
              )}

              {/* Credits only (no cash) */}
              {cartCashTotal === 0 && cartTotal > 0 && (
                <button
                  onClick={() => handleMarkAsPaid('credits')}
                  disabled={actionLoading || member.creditBalance < cartTotal}
                  className="w-full text-sm font-semibold bg-gray-900 text-white px-4 py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : `Charge ${cartTotal} cr`}
                </button>
              )}

              {/* Cash / terminal */}
              {cartCashTotal > 0 && (
                <button
                  onClick={() => handleMarkAsPaid('cash')}
                  disabled={actionLoading}
                  className="w-full text-sm font-medium bg-gray-100 text-gray-700 px-4 py-2.5 rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : 'Mark as paid (cash / terminal)'}
                </button>
              )}

              {/* Free items */}
              {cartCashTotal === 0 && cartTotal === 0 && (
                <button
                  onClick={() => handleMarkAsPaid('free')}
                  disabled={actionLoading}
                  className="w-full text-sm font-medium bg-gray-100 text-gray-700 px-4 py-2.5 rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  {actionLoading ? '…' : 'Record (free)'}
                </button>
              )}
            </div>

            {cartTotal > 0 && member.creditBalance < cartTotal && cartCashTotal === 0 && (
              <p className="text-[10px] text-red-500">Insufficient credits for this purchase</p>
            )}
          </div>
        )}
      </div>

      {/* ── Purchase history ── */}
      {member && memberPurchases.length > 0 && (
        <div className="px-5 py-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent purchases</p>
          <div className="space-y-2">
            {memberPurchases.slice(0, 5).map(sale => (
              <div key={sale.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-700 font-medium truncate">
                    {(sale.items as import('@/lib/api').CartSaleItem[]).map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}
                  </p>
                  <p className="text-gray-400">
                    {new Date(sale.soldAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {' · '}
                    <span className="capitalize">{sale.paymentMethod}</span>
                    {sale.failedAt && <span className="text-red-400 ml-1">· Failed</span>}
                    {sale.refundedAt && <span className="text-red-400 ml-1">· Refunded</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {sale.totalCents > 0 && (
                    <span className={`font-semibold tabular-nums ${sale.refundedAt ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {(sale.totalCents / 100).toFixed(2)}
                    </span>
                  )}
                  {sale.totalCredits > 0 && !sale.totalCents && (
                    <span className="text-gray-500">{sale.totalCredits} cr</span>
                  )}
                  {canIssueRefunds && sale.paymentMethod === 'card' && !sale.refundedAt && !sale.failedAt && sale.stripePaymentIntentId && (
                    <button
                      onClick={() => handleRefund(sale.id)}
                      disabled={refundingId === sale.id}
                      className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-40 font-medium"
                    >
                      {refundingId === sale.id ? '…' : 'Refund'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
