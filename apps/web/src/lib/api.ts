import type { ApiResponse, SessionSlot, MemberProfile } from '@packd/types'

export interface AdminSession {
  id: string
  templateName: string
  sport: string
  instructorName: string
  instructorUserId: string
  roomId: string
  roomName: string
  capacity: number
  bookedCount: number
  startsAt: string
  endsAt: string
  status: string
  creditsRequired: number
}

export interface InstructorPermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canViewMemberContact: boolean
  canManageWaitlist: boolean
  canEditSessionDetails: boolean
  canCancelSession: boolean
  canCreateSchedules: boolean
  canSetSubstitute: boolean
}

export const DEFAULT_INSTRUCTOR_PERMISSIONS: InstructorPermissions = {
  canCheckInMembers: false,
  canManageBookings: false,
  canViewMemberContact: false,
  canManageWaitlist: true,
  canEditSessionDetails: false,
  canCancelSession: false,
  canCreateSchedules: false,
  canSetSubstitute: false,
}


export interface FronthostPermissions {
  canCheckInMembers: boolean
  canAdjustCredits: boolean
  canManageBookings: boolean
  canManageWaitlist: boolean
  canViewMemberContact: boolean
}

export const DEFAULT_FRONTHOST_PERMISSIONS: FronthostPermissions = {
  canCheckInMembers: true,
  canAdjustCredits: true,
  canManageBookings: true,
  canManageWaitlist: true,
  canViewMemberContact: true,
}

export interface StaffWithPermissions {
  /** Instructor record id if they are an instructor, otherwise the member id */
  id: string
  memberId: string | null
  userId: string
  name: string
  email: string
  roles: ('instructor' | 'fronthost')[]
  instructorPermissions?: InstructorPermissions
  fronthostPermissions?: FronthostPermissions
}

export interface Product {
  id: string
  studioId: string
  name: string
  category: string
  priceInCents: number
  creditsRequired: number
  imageUrl: string | null
  inStock: boolean
}

export interface CartSaleItem {
  productId: string
  name: string
  qty: number
  priceInCents: number
  creditsRequired: number
}

export interface ProductSale {
  id: string
  memberId: string
  studioId: string
  items: CartSaleItem[]
  totalCents: number
  totalCredits: number
  paymentMethod: 'card' | 'cash' | 'credits' | 'free' | 'terminal'
  stripePaymentIntentId: string | null
  staffUserId: string | null
  soldAt: string
  refundedAt: string | null
  refundedCents: number | null
  stripeRefundId: string | null
  failedAt: string | null
}

export interface InstructorPhoto {
  id: string
  instructorId: string
  studioId: string
  storageKey: string
  url: string
  fileName: string
  approvedForSocial: boolean
  uploadedBy: string
  createdAt: string
}

export interface MembershipPlan {
  id: string
  studioId: string
  name: string
  description?: string | null
  priceInCents: number
  intervalMonths: number
  creditsPerCycle: number | null
  guestPassesPerCycle: number
  creditExpiryDays?: number | null
  isIntroOffer?: boolean
  maxRedemptionsPerMember?: number
  memberRedemptions?: number   // set by GET /memberships/plans/member — how many times this member has used it
  stripePriceId?: string | null
  activeSubscriptions?: number
}

export interface GuestPassEntry {
  id: string
  guestName: string | null
  sessionId: string | null
  amount: number
  note: string | null
  createdAt: string
}

export interface MembershipSubscription {
  id: string
  memberId: string
  memberFirstName?: string
  memberLastName?: string
  memberEmail?: string
  planId: string
  plan: {
    name: string
    creditsPerCycle: number | null
    intervalMonths: number
    priceInCents: number
  }
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED'
  startDate: string
  endDate: string | null
  createdAt?: string
}

export interface StudioSummary {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  memberCount: number
  todaySessionCount: number
  staffCount: number
  fillRateToday: number
}

export interface StudioLocation {
  id: string
  name: string
  address: string
  city: string
  country: string
  timezone: string
}

export interface AnalyticsData {
  heatmap: { dow: number; hour: number; fillRate: number; count: number }[]
  weeklyTrend: {
    weekStart: string
    sessions: number
    avgFillRate: number
    checkInRate: number
    cancelRate: number
  }[]
  classStats: {
    templateId: string
    name: string
    sport: string
    sessions: number
    avgFillRate: number
    checkInRate: number
    totalBookings: number
  }[]
  funnel: {
    confirmed: number
    checkedIn: number
    onTimeCancelled: number
    lateCancelled: number
    noShow: number
  }
  instructors: {
    id: string
    name: string
    sessions: number
    avgFillRate: number
    checkInRate: number
    loyaltyRate: number
  }[]
  recurrence: {
    monthOverMonth: number
    avgBookingsPerMember: number
    frequencyBuckets: { label: string; count: number }[]
  }
  revenue: {
    creditsIssued: number
    creditsConsumed: number
    lateCancelFees: number
    noShowFees: number
    activeSubscriptions: number
    weeklyCredits: { weekStart: string; issued: number; consumed: number; fees: number }[]
  }
  meta: { weeks: number; windowStart: string; generatedAt: string }
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
}

export interface StudioDetail {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  timeFormat: string
  locations: StudioLocation[]
}

export interface RoomSummary {
  id: string
  name: string
  capacity: number
  locationId: string
  locationName: string
  activeLayout: {
    id: string
    name: string
    widthM: number
    lengthM: number
    _count: { stations: number }
  } | null
}

export interface UpcomingBooking {
  id: string
  sessionId: string
  startsAt: string
  endsAt: string
  templateName: string
  sport: string
  instructorName: string
  roomName: string
  locationCity: string
  creditsRequired: number
  sessionStatus: string
  bookedAt: string
  stationLabel: string | null
}

export type StationType = 'BIKE' | 'TREADMILL' | 'BENCH' | 'ROWER' | 'MAT' | 'REFORMER' | 'BARRE' | 'OTHER'

export interface Station {
  id: string
  layoutId: string
  type: StationType
  label: string
  xM: number
  yM: number
  rotation: number
}

export interface RoomLayout {
  id: string
  roomId: string
  name: string
  widthM: number
  lengthM: number
  isActive: boolean
  stations: Station[]
}

export interface LayoutTemplate extends RoomLayout {
  roomName: string
}

export interface SpotAssignment {
  bookingId: string
  memberId: string
  memberName: string
  checkedIn: boolean
  stationId: string | null
  creditBalance: number
  membershipStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED' | null
}

export interface SessionSpots {
  layout: RoomLayout | null
  assignments: SpotAssignment[]
}

export interface CalendarSession {
  id: string
  scheduleId: string | null
  templateId: string
  templateName: string
  sport: string
  instructorId: string
  instructorName: string
  substituteInstructorId: string | null
  substituteInstructorName: string | null
  roomId: string
  roomName: string
  startsAt: string
  endsAt: string
  capacity: number
  creditsRequired: number
  status: string
}

export interface ClassTemplate {
  id: string
  studioId: string
  name: string
  sport: string
  durationMin: number
  description?: string | null
  color: string
  defaultInstructorId?: string | null
  defaultRoomId?: string | null
  defaultCapacity?: number | null
  defaultCreditsRequired?: number | null
  defaultStartTime?: string | null
  defaultStartTime2?: string | null
  defaultDaysOfWeek?: number[]
  defaultIntervalWeeks?: number
}

export interface CalendarTemplate {
  id: string
  name: string
  sport: string
  durationMin: number
  defaultInstructorId?: string | null
  defaultRoomId?: string | null
  defaultCapacity?: number | null
  defaultCreditsRequired?: number | null
  defaultStartTime?: string | null
  defaultStartTime2?: string | null
  defaultDaysOfWeek?: number[]
  defaultIntervalWeeks?: number
}

export interface CalendarInstructor {
  id: string
  name: string
}

export interface CalendarRoom {
  id: string
  name: string
  capacity: number
  locationName: string
}

export interface CalendarWeek {
  weekStart: string
  sessions: CalendarSession[]
  templates: CalendarTemplate[]
  instructors: CalendarInstructor[]
  rooms: CalendarRoom[]
}

export interface ClassSchedule {
  id: string
  templateId: string
  templateName: string
  sport: string
  instructorId: string
  instructorName: string
  roomId: string
  roomName: string
  daysOfWeek: number[]
  startTime: string
  durationMin: number
  intervalWeeks: number
  capacity: number
  creditsRequired: number
  validFrom: string
  validUntil: string | null
}

export interface OrphanedPattern {
  templateId: string
  templateName: string
  sport: string
  instructorId: string
  instructorName: string
  roomId: string
  roomName: string
  startTime: string
  durationMin: number
  sessionCount: number
  nextOccurrence: string
  daysOfWeek: number[]
}

export interface StaffMember {
  id: string
  userId: string
  name: string
  email: string
  staffRoles: string[]   // e.g. ['fronthost'] | ['instructor'] | ['fronthost','instructor']
  joinedAt: string
  instructorId: string | null  // Instructor record id for this studio (null for fronthost-only)
  payRatePerHeadCents?: number | null
}

export interface AdminBooking {
  id: string
  memberId: string
  memberName: string
  memberEmail: string
  checkedIn: boolean
  checkedInAt: string | null
  creditBalance: number
  bookedAt: string
}

export interface PastBooking {
  id: string
  sessionId: string
  startsAt: string
  endsAt: string
  templateName: string
  sport: string
  instructorName: string
  roomName: string
  status: 'CONFIRMED' | 'CANCELLED' | 'LATE_CANCELLED' | 'NO_SHOW'
  checkedIn: boolean
  creditsRequired: number
}

export interface CreditTransaction {
  id: string
  amount: number
  type: 'PURCHASE' | 'CLASS_DEBIT' | 'REFUND' | 'LATE_CANCEL_FEE' | 'NO_SHOW_FEE' | 'MANUAL_ADJUSTMENT' | 'MEMBERSHIP_RENEWAL' | 'EXPIRY'
  note: string | null
  expiresAt?: string | null
  createdAt: string
}

export interface MemberHistory {
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
}

export interface StaffNote {
  id: string
  content: string
  staffName: string
  createdAt: string
}

export interface AdminMemberProfile {
  id: string
  studioId: string
  firstName: string
  lastName: string
  email: string
  creditBalance: number
  guestPassBalance: number
  notes: string | null
  birthday: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  staffNotes: StaffNote[]
  activeSubscription: {
    id: string
    planId: string
    planName: string
    status: string
    pausedUntil: string | null
    startDate: string
    endDate: string | null
    nextBillingDate?: string | null
  } | null
  joinedAt: string
}

export interface AvailabilityBlock {
  id: string
  instructorId: string
  instructorName?: string
  studioId: string
  title: string
  startDate: string
  endDate: string
  createdAt: string
}

export interface PromoCode {
  id: string
  code: string
  description?: string | null
  type: 'CREDIT_GRANT' | 'FREE_CLASS' | 'MEMBERSHIP_PCT' | 'MEMBERSHIP_FLAT'
  value: number
  maxUses: number | null
  usageCount: number
  validFrom: string
  validUntil: string | null
  isActive: boolean
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  memberId: string
  name: string
  visits: number
  checkIns: number
  lastVisit: string
}

export interface LeaderboardInstructor {
  rank: number
  instructorId: string
  name: string
  totalBookings: number
}

export interface Leaderboard {
  members: LeaderboardEntry[]
  topInstructors: LeaderboardInstructor[]
  period: string
  generatedAt: string
}

export interface NetworkStudio {
  id: string
  name: string
  slug: string
  timezone: string
  isHome: boolean
}

export interface StudioNetwork {
  id: string
  name: string
  slug: string
}

export interface MemberNetworkInfo {
  network: StudioNetwork | null
  homeStudioId: string
  studios: NetworkStudio[]
}

// ─── Brand ────────────────────────────────────────────────────────────────────

export interface BrandStudioSummary {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  primaryColor: string
  logoUrl: string | null
  memberCount?: number
  joinedAt: string
}

export interface BrandFranchise {
  id: string
  name: string
  slug: string
  description: string | null
  createdAt: string
  admin: { id: string; email: string; firstName: string; lastName: string } | null
  studios: BrandStudioSummary[]
}

export interface Brand {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  description: string | null
  franchises: BrandFranchise[]
}

export interface BrandStats {
  period: string
  totals: { members: number; bookings: number; sessions: number; creditsIssued: number }
  perStudio: { id: string; name: string; slug: string; members: number; bookings: number }[]
}

export interface BrandMember {
  id: string
  firstName: string
  lastName: string
  email: string
  studioId: string
  studioName: string
  creditBalance: number
  bookingCount: number
  createdAt: string
}

export interface BrandSession {
  id: string
  studioId: string
  studioName: string
  name: string
  sport: string
  instructorName: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  status: string
}

export interface NetworkWithStudios extends StudioNetwork {
  studios: { id: string; studioId: string; networkId: string; joinedAt: string; studio: { id: string; name: string; slug: string; timezone: string } }[]
}

export interface MemberStats {
  visits: number
  rank: number | null
  totalMembers: number
  topInstructors: { instructorId: string; name: string; sessionsTogether: number }[]
}

export interface AdminMemberHistory {
  upcoming: UpcomingBooking[]
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function doFetch(path: string, token: string | undefined, fetchOptions: RequestInit): Promise<Response> {
  const hasBody = fetchOptions.body != null
  return fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchOptions.headers as Record<string, string> | undefined),
    },
  })
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options

  let res = await doFetch(path, token, fetchOptions)

  // If the access token expired, refresh the Supabase session and retry once.
  // Dynamic import keeps this code out of server bundles (supabase browser client
  // uses window/localStorage which don't exist on the server).
  if (res.status === 401 && token) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const { data } = await createClient().auth.getSession()
      const fresh = data.session?.access_token
      if (fresh && fresh !== token) {
        res = await doFetch(path, fresh, fetchOptions)
      }
    } catch {
      // Refresh failed — fall through and throw the 401 error below
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.message ?? error.error ?? 'API error')
  }

  return res.json() as Promise<T>
}

export const api = {
  schedule: {
    list: (studioId: string, from: string, to: string, token: string) =>
      apiFetch<{ timeFormat: string; timezone: string; lateCancelWindowHours: number; lateCancelFeeCredits: number; sessions: SessionSlot[] }>(`/schedule/${studioId}?from=${from}&to=${to}`, { token }),
  },
  bookings: {
    create: (sessionId: string, token: string, memberId?: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId, ...(memberId ? { memberId } : {}) }),
        token,
      }),
    cancel: (bookingId: string, token: string) =>
      apiFetch<{ success: boolean; isLateCancel: boolean }>(`/bookings/${bookingId}`, {
        method: 'DELETE',
        token,
      }),
  },
  waitlist: {
    join: (sessionId: string, token: string) =>
      apiFetch<ApiResponse<{ id: string; position: number }>>('/waitlist', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
        token,
      }),
  },
  members: {
    me: (token: string) => apiFetch<MemberProfile & { birthday: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; guestPassBalance: number }>('/members/me', { token }),
    bookings: (token: string) => apiFetch<UpcomingBooking[]>('/members/me/bookings', { token }),
    history: (token: string) => apiFetch<MemberHistory>('/members/me/history', { token }),
    ensure: (token: string, studioId?: string) =>
      apiFetch<{ success: boolean; memberId: string }>('/members/ensure', {
        method: 'POST', body: JSON.stringify({ studioId }), token,
      }),
    updateMe: (data: { firstName?: string; lastName?: string; birthday?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }, token: string) =>
      apiFetch<{ success: boolean; data: { firstName: string; lastName: string } }>('/members/me', {
        method: 'PATCH', body: JSON.stringify(data), token,
      }),
    stats: (studioId: string, token: string) =>
      apiFetch<MemberStats>(`/members/me/stats?studioId=${studioId}`, { token }),
    purchases: (token: string, studioId?: string) =>
      apiFetch<ProductSale[]>(`/members/me/purchases${studioId ? `?studioId=${studioId}` : ''}`, { token }),
  },
  admin: {
    stats: (studioId: string, token: string) =>
      apiFetch<{ studioName: string | null; timeFormat: string; currency: string; todaySessions: number; totalMembers: number; totalBookingsToday: number; waitlistToday: number }>(
        `/admin/stats?studioId=${studioId}`, { token }),
    sessions: (studioId: string, date: string, token: string) =>
      apiFetch<AdminSession[]>(`/admin/sessions?studioId=${studioId}&date=${date}`, { token }),
    bookings: (sessionId: string, token: string) =>
      apiFetch<AdminBooking[]>(`/admin/sessions/${sessionId}/bookings`, { token }),
    checkin: (sessionId: string, bookingId: string, token: string) =>
      apiFetch<{ success: boolean; checkedIn: boolean }>(`/admin/sessions/${sessionId}/checkin/${bookingId}`, {
        method: 'POST', token,
      }),
    updateSession: (sessionId: string, status: string, token: string) =>
      apiFetch<{ success: boolean; status: string }>(`/admin/sessions/${sessionId}`, {
        method: 'PATCH', body: JSON.stringify({ status }), token,
      }),
    adjustCredits: (memberId: string, amount: number, note: string, token: string) =>
      apiFetch<{ success: boolean; newBalance: number }>(`/admin/members/${memberId}/credits`, {
        method: 'POST', body: JSON.stringify({ amount, note }), token,
      }),
    recordProductSale: (body: { memberId: string; studioId: string; items: CartSaleItem[]; totalCents: number; totalCredits: number; paymentMethod: 'cash' | 'credits' | 'free' }, token: string) =>
      apiFetch<{ success: boolean }>('/admin/product-sales', { method: 'POST', body: JSON.stringify(body), token }),
    productSaleMemberIds: (studioId: string, token: string, date?: string) =>
      apiFetch<{ memberIds: string[] }>(`/admin/product-sales?studioId=${studioId}${date ? `&date=${date}` : ''}`, { token }),
    updateMember: (memberId: string, data: { notes?: string | null }, token: string) =>
      apiFetch<{ success: boolean; data: { id: string; notes: string | null } }>(`/admin/members/${memberId}`, {
        method: 'PATCH', body: JSON.stringify(data), token,
      }),
    searchMembers: (studioId: string, q: string, token: string) =>
      apiFetch<{ id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }[]>(
        `/admin/members/search?studioId=${studioId}&q=${encodeURIComponent(q)}`, { token },
      ),
    memberProfile: (memberId: string, token: string) =>
      apiFetch<AdminMemberProfile>(`/admin/members/${memberId}/profile`, { token }),
    memberHistory: (memberId: string, token: string) =>
      apiFetch<AdminMemberHistory>(`/admin/members/${memberId}/history`, { token }),
    listMembers: (studioId: string, token: string, q?: string) =>
      apiFetch<{ id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }[]>(
        `/admin/members?studioId=${studioId}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { token },
      ),
    analytics: (studioId: string, token: string, weeks = 12) =>
      apiFetch<AnalyticsData>(`/admin/analytics?studioId=${studioId}&weeks=${weeks}`, { token }),
    query: (sql: string, studioId: string, token: string) =>
      apiFetch<QueryResult>('/admin/query', { token, method: 'POST', body: JSON.stringify({ sql, studioId }) }),
    memberUpcoming: (memberId: string, token: string) =>
      apiFetch<UpcomingBooking[]>(`/admin/members/${memberId}/upcoming`, { token }),
    rescheduleSession: (sessionId: string, startsAt: string, endsAt: string, token: string) =>
      apiFetch<{ success: boolean; startsAt: string; endsAt: string }>(
        `/admin/sessions/${sessionId}`,
        { token, method: 'PATCH', body: JSON.stringify({ startsAt, endsAt }) },
      ),
    leaderboard: (studioId: string, period: string, token: string) =>
      apiFetch<Leaderboard>(`/admin/leaderboard?studioId=${studioId}&period=${period}`, { token }),
    bulkPreview: (params: { studioId: string; from: string; to: string; instructorId?: string; templateId?: string }, token: string) => {
      const qs = new URLSearchParams({ studioId: params.studioId, from: params.from, to: params.to })
      if (params.instructorId) qs.set('instructorId', params.instructorId)
      if (params.templateId) qs.set('templateId', params.templateId)
      return apiFetch<{ total: number; sessionIds: string[]; byTemplate: { name: string; count: number }[]; sessions: { id: string; startsAt: string; templateName: string; instructorName: string; confirmedBookings: number }[] }>(`/admin/sessions/bulk?${qs}`, { token })
    },
    bulkExecute: (body: { studioId: string; from: string; to: string; instructorId?: string; templateId?: string; action: 'CANCEL' | 'SUBSTITUTE'; substituteInstructorId?: string }, token: string) =>
      apiFetch<{ affected: number; sessionIds: string[] }>('/admin/sessions/bulk', { method: 'POST', body: JSON.stringify(body), token }),
    memberNotes: (memberId: string, token: string) =>
      apiFetch<StaffNote[]>(`/admin/members/${memberId}/notes`, { token }),
    addNote: (memberId: string, content: string, token: string) =>
      apiFetch<StaffNote>(`/admin/members/${memberId}/notes`, { method: 'POST', body: JSON.stringify({ content }), token }),
    deleteNote: (memberId: string, noteId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/admin/members/${memberId}/notes/${noteId}`, { method: 'DELETE', token }),
    updateMemberProfile: (memberId: string, data: { birthday?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }, token: string) =>
      apiFetch<{ success: boolean }>(`/admin/members/${memberId}/profile`, { method: 'PATCH', body: JSON.stringify(data), token }),
    grantGuestPasses: (memberId: string, amount: number, note: string | undefined, token: string) =>
      apiFetch<{ success: boolean; guestPassBalance: number }>(`/admin/members/${memberId}/guest-passes/grant`, { method: 'POST', body: JSON.stringify({ amount, note }), token }),
    guestCheckin: (memberId: string, guestName: string, studioId: string, sessionId: string | undefined, token: string) =>
      apiFetch<{ success: boolean; guestPassBalance: number }>('/admin/guest-checkin', { method: 'POST', body: JSON.stringify({ memberId, guestName, studioId, sessionId }), token }),
    guestPassLog: (memberId: string, token: string) =>
      apiFetch<GuestPassEntry[]>(`/admin/members/${memberId}/guest-passes`, { token }),
    memberPurchases: (memberId: string, token: string, studioId?: string) =>
      apiFetch<ProductSale[]>(`/admin/members/${memberId}/purchases${studioId ? `?studioId=${studioId}` : ''}`, { token }),
    exportCsv: async (type: 'members' | 'attendance' | 'revenue' | 'instructor-pay', studioId: string, token: string, params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams({ studioId })
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
      const res = await fetch(`${base}/admin/export/${type}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type}.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
  },
  franchise: {
    info: (token: string) =>
      apiFetch<{ id: string | null; name: string | null }>('/franchise/info', { token }) as Promise<{ id: string | null; name: string | null }>,
    myStudios: (token: string) =>
      apiFetch<{ id: string; name: string; slug: string }[]>('/franchise/my-studios', { token }),
    studios: (token: string) =>
      apiFetch<StudioSummary[]>('/franchise/studios', { token }),
    myInstructor: (studioId: string, token: string) =>
      apiFetch<{ id: string; permissions: InstructorPermissions }>(`/franchise/studios/${studioId}/my-instructor`, { token }),
    updatePermissions: (studioId: string, instructorId: string, permissions: Partial<InstructorPermissions>, token: string) =>
      apiFetch<{ success: boolean; permissions: InstructorPermissions }>(
        `/franchise/studios/${studioId}/instructors/${instructorId}/permissions`,
        { method: 'PATCH', body: JSON.stringify(permissions), token },
      ),
    staffPermissions: (studioId: string, token: string) =>
      apiFetch<StaffWithPermissions[]>(`/franchise/studios/${studioId}/staff-permissions`, { token }),
    updateFronthostPermissions: (studioId: string, memberId: string, permissions: Partial<FronthostPermissions>, token: string) =>
      apiFetch<{ success: boolean; permissions: FronthostPermissions }>(
        `/franchise/studios/${studioId}/fronthosts/${memberId}/permissions`,
        { method: 'PATCH', body: JSON.stringify(permissions), token },
      ),
    listAdmins: (studioId: string, token: string) =>
      apiFetch<{ id: string; userId: string; name: string; email: string; joinedAt: string }[]>(
        `/franchise/studios/${studioId}/admins`, { token },
      ),
    addAdmin: (studioId: string, email: string, token: string) =>
      apiFetch<{ success: boolean; roles: string[] }>(`/franchise/studios/${studioId}/admins`, {
        method: 'POST', body: JSON.stringify({ email }), token,
      }),
    removeAdmin: (studioId: string, userId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/franchise/studios/${studioId}/admins/${userId}`, {
        method: 'DELETE', token,
      }),
  },
  photos: {
    list: (instructorId: string, token: string) =>
      apiFetch<InstructorPhoto[]>(`/photos/instructors/${instructorId}`, { token }),
    upload: (instructorId: string, body: { base64: string; fileName: string; contentType: string }, token: string) =>
      apiFetch<InstructorPhoto>(`/photos/instructors/${instructorId}/upload`, {
        method: 'POST', body: JSON.stringify(body), token,
      }),
    toggleApproval: (instructorId: string, photoId: string, approvedForSocial: boolean, token: string) =>
      apiFetch<InstructorPhoto>(`/photos/instructors/${instructorId}/${photoId}`, {
        method: 'PATCH', body: JSON.stringify({ approvedForSocial }), token,
      }),
    delete: (instructorId: string, photoId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/photos/instructors/${instructorId}/${photoId}`, {
        method: 'DELETE', token,
      }),
    approvedByStudio: (studioId: string, token: string) =>
      apiFetch<(InstructorPhoto & { instructorName: string })[]>(`/photos/studios/${studioId}/approved`, { token }),
  },
  templates: {
    list: (studioId: string, token: string) =>
      apiFetch<ClassTemplate[]>(`/templates?studioId=${studioId}`, { token }),
    create: (body: Omit<ClassTemplate, 'id'>, token: string) =>
      apiFetch<ClassTemplate>('/templates', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: Partial<Omit<ClassTemplate, 'id' | 'studioId'>>, token: string) =>
      apiFetch<ClassTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/templates/${id}`, { method: 'DELETE', token }),
  },
  rooms: {
    layout: (roomId: string, token: string) =>
      apiFetch<RoomLayout | null>(`/rooms/${roomId}/layout`, { token }),
    layouts: (roomId: string, token: string) =>
      apiFetch<RoomLayout[]>(`/rooms/${roomId}/layouts`, { token }),
    activateLayout: (roomId: string, layoutId: string, token: string) =>
      apiFetch<RoomLayout>(`/rooms/${roomId}/layouts/${layoutId}/activate`, { method: 'POST', token }),
    updateLayout: (
      roomId: string,
      layoutId: string,
      body: { name?: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] },
      token: string,
    ) => apiFetch<RoomLayout>(`/rooms/${roomId}/layouts/${layoutId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    deleteLayout: (roomId: string, layoutId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/rooms/${roomId}/layouts/${layoutId}`, { method: 'DELETE', token }),
    saveLayout: (
      roomId: string,
      body: { name?: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] },
      token: string,
    ) => apiFetch<RoomLayout>(`/rooms/${roomId}/layout`, { method: 'POST', body: JSON.stringify(body), token }),
    spots: (roomId: string, sessionId: string, token: string) =>
      apiFetch<SessionSpots>(`/rooms/${roomId}/sessions/${sessionId}/spots`, { token }),
    assignSpot: (roomId: string, sessionId: string, bookingId: string, stationId: string | null, token: string) =>
      apiFetch<{ bookingId: string; stationId: string | null }>(
        `/rooms/${roomId}/sessions/${sessionId}/spots`,
        { method: 'POST', body: JSON.stringify({ bookingId, stationId }), token },
      ),
    pickMySpot: (roomId: string, sessionId: string, stationId: string | null, token: string) =>
      apiFetch<{ stationId: string | null }>(
        `/rooms/${roomId}/sessions/${sessionId}/my-spot`,
        { method: 'POST', body: JSON.stringify({ stationId }), token },
      ),
  },
  schedules: {
    week: (studioId: string, weekStart: string, token: string) =>
      apiFetch<CalendarWeek>(`/schedules?studioId=${studioId}&weekStart=${weekStart}`, { token }),
    all: (studioId: string, token: string) =>
      apiFetch<ClassSchedule[]>(`/schedules/all?studioId=${studioId}`, { token }),
    create: (
      body: {
        studioId: string
        templateId: string
        instructorId: string
        roomId: string
        capacity: number
        creditsRequired?: number
        daysOfWeek: number[]
        startTime: string
        durationMin: number
        intervalWeeks?: number
        validFrom: string
        validUntil?: string
        generateWeeks?: number
      },
      token: string,
    ) => apiFetch<{ success: boolean; id: string }>('/schedules', {
      method: 'POST', body: JSON.stringify(body), token,
    }),
    update: (
      scheduleId: string,
      body: {
        studioId: string
        templateId?: string
        instructorId?: string
        roomId?: string
        capacity?: number
        creditsRequired?: number
        daysOfWeek?: number[]
        startTime?: string
        durationMin?: number
        intervalWeeks?: number
        validUntil?: string | null
      },
      token: string,
    ) => apiFetch<{ success: boolean }>(`/schedules/${scheduleId}`, {
      method: 'PATCH', body: JSON.stringify(body), token,
    }),
    delete: (scheduleId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/schedules/${scheduleId}?studioId=${studioId}`, {
        method: 'DELETE', token,
      }),
    month: (studioId: string, year: number, month: number, token: string, instructorId?: string) =>
      apiFetch<{ year: number; month: number; days: Record<string, { id: string; sport: string; name: string; startsAt: string; instructorId: string | null; instructorName: string; substituteInstructorId: string | null; status: string }[]> }>(
        `/schedules/month?studioId=${studioId}&year=${year}&month=${month}${instructorId ? `&instructorId=${instructorId}` : ''}`, { token },
      ),
    orphaned: (studioId: string, token: string) =>
      apiFetch<OrphanedPattern[]>(`/schedules/orphaned?studioId=${studioId}`, { token }),
    deleteOrphaned: (studioId: string, templateId: string, instructorId: string, startTime: string, token: string) =>
      apiFetch<{ success: boolean; deleted: number }>(
        `/schedules/orphaned?studioId=${studioId}&templateId=${encodeURIComponent(templateId)}&instructorId=${encodeURIComponent(instructorId)}&startTime=${encodeURIComponent(startTime)}`,
        { method: 'DELETE', token },
      ),
    setSubstitute: (
      sessionId: string,
      substituteInstructorId: string | null,
      studioId: string,
      token: string,
    ) => apiFetch<{ success: boolean; substituteInstructorId: string | null; substituteInstructorName: string | null }>(
      `/schedules/sessions/${sessionId}/substitute`,
      { method: 'PATCH', body: JSON.stringify({ substituteInstructorId, studioId }), token },
    ),
  },
  staff: {
    myStudios: (token: string) =>
      apiFetch<{ id: string; name: string; timezone: string }[]>('/staff/studios', { token }),
    list: (studioId: string, token: string) =>
      apiFetch<StaffMember[]>(`/staff?studioId=${studioId}`, { token }),
    assign: (studioId: string, email: string, staffRole: string, token: string) =>
      apiFetch<{ success: boolean }>('/staff', {
        method: 'POST',
        body: JSON.stringify({ studioId, email, staffRole }),
        token,
      }),
    remove: (memberId: string, studioId: string, token: string, role?: string) =>
      apiFetch<{ success: boolean; remainingRoles: string[]; remainingStudios: number }>(
        `/staff/${memberId}?studioId=${studioId}${role ? `&role=${encodeURIComponent(role)}` : ''}`,
        { method: 'DELETE', token },
      ),
    invite: (email: string, firstName: string, role: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean; message: string }>('/staff/invite', {
        method: 'POST',
        body: JSON.stringify({ email, firstName, role, studioId }),
        token,
      }),
    updateInstructorPayRate: (instructorId: string, payRatePerHeadCents: number | null, token: string) =>
      apiFetch<{ success: boolean }>(`/staff/instructors/${instructorId}`, {
        method: 'PATCH',
        body: JSON.stringify({ payRatePerHeadCents }),
        token,
      }),
  },
  studios: {
    list: (token: string) =>
      apiFetch<any[]>('/studios', { token }),
    get: (studioId: string, token: string) =>
      apiFetch<StudioDetail>(`/studios/${studioId}`, { token }),
    update: (
      studioId: string,
      body: {
        name?: string; slug?: string; timezone?: string; currency?: string; timeFormat?: string
        location?: { id: string; name?: string; address?: string; city?: string; country?: string }
      },
      token: string,
    ) => apiFetch<{ success: boolean; studio: StudioDetail }>(`/studios/${studioId}`, {
      method: 'PATCH', body: JSON.stringify(body), token,
    }),
    create: (
      body: {
        name: string
        slug: string
        timezone: string
        currency: string
        location: { name: string; address: string; city: string; country: string }
      },
      token: string,
    ) =>
      apiFetch<{ success: boolean; data: { id: string; name: string; slug: string } }>('/studios', {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      }),
    delete: (studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/studios/${studioId}`, { method: 'DELETE', token }),
    rooms: (studioId: string, token: string) =>
      apiFetch<RoomSummary[]>(`/studios/${studioId}/rooms`, { token }),
    createRoom: (studioId: string, body: { name: string; capacity: number; locationId?: string }, token: string) =>
      apiFetch<{ id: string; name: string; capacity: number }>(`/studios/${studioId}/rooms`, {
        method: 'POST', body: JSON.stringify(body), token,
      }),
    deleteRoom: (studioId: string, roomId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/studios/${studioId}/rooms/${roomId}`, { method: 'DELETE', token }),
    layouts: (studioId: string, token: string) =>
      apiFetch<LayoutTemplate[]>(`/studios/${studioId}/layouts`, { token }),
    getPolicy: (studioId: string, token: string) =>
      apiFetch<{ lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number; waitlistWindowMinutes: number }>(
        `/studios/${studioId}/policy`, { token },
      ),
    updatePolicy: (
      studioId: string,
      body: { lateCancelWindowHours?: number; lateCancelFeeCredits?: number; noShowFeeCredits?: number; waitlistWindowMinutes?: number },
      token: string,
    ) =>
      apiFetch<{ lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number; waitlistWindowMinutes: number }>(
        `/studios/${studioId}/policy`, { method: 'PATCH', body: JSON.stringify(body), token },
      ),
    onboard: (
      body: {
        name: string
        slug: string
        timezone: string
        currency: string
        policy: { lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number }
        location: { name: string; address: string; city: string; country: string }
        rooms: { name: string; capacity: number; sport: string }[]
      },
      token: string,
    ) =>
      apiFetch<ApiResponse<{ id: string }>>('/studios/onboard', {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      }),
  },
  products: {
    list: (studioId: string, token: string, all = false) =>
      apiFetch<Product[]>(`/products?studioId=${studioId}${all ? '&all=true' : ''}`, { token }),
    create: (body: { studioId: string; name: string; category?: string; priceInCents: number; creditsRequired?: number }, token: string) =>
      apiFetch<Product>('/products', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: Partial<Omit<Product, 'id' | 'studioId'>>, token: string) =>
      apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/products/${id}`, { method: 'DELETE', token }),
  },
  memberships: {
    listPlans: (studioId: string, token: string) =>
      apiFetch<MembershipPlan[]>(`/memberships/plans?studioId=${studioId}`, { token }),
    createPlan: (body: { studioId: string; name: string; description?: string; priceInCents: number; intervalMonths?: number; creditsPerCycle?: number | null }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipPlan }>('/memberships/plans', { method: 'POST', body: JSON.stringify(body), token }),
    updatePlan: (planId: string, body: Partial<Omit<MembershipPlan, 'id' | 'studioId' | 'activeSubscriptions'>>, token: string) =>
      apiFetch<{ success: boolean; data: MembershipPlan }>(`/memberships/plans/${planId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    deletePlan: (planId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/memberships/plans/${planId}`, { method: 'DELETE', token }),
    listSubscriptions: (params: { studioId?: string; memberId?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.studioId) qs.set('studioId', params.studioId)
      if (params.memberId) qs.set('memberId', params.memberId)
      return apiFetch<MembershipSubscription[]>(`/memberships?${qs}`, { token })
    },
    assign: (body: { memberId: string; planId: string; startDate?: string; grantCredits?: boolean }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>('/memberships', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { status?: string; endDate?: string | null; grantCredits?: boolean }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>(`/memberships/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    me: (token: string) =>
      apiFetch<MembershipSubscription | null>('/memberships/me', { token }),
    publicPlans: (studioId: string, token: string) =>
      apiFetch<Omit<MembershipPlan, 'activeSubscriptions'>[]>(`/memberships/plans/member?studioId=${studioId}`, { token }),
    subscribe: (planId: string, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>('/memberships/subscribe', { method: 'POST', body: JSON.stringify({ planId }), token }),
    cancelMe: (token: string) =>
      apiFetch<{ success: boolean }>('/memberships/me', { token, method: 'DELETE' }),
    pauseSubscription: (memberId: string, token: string, pausedUntil?: string | null) =>
      apiFetch<{ success: boolean; status: string; pausedUntil: string | null }>(
        `/admin/members/${memberId}/subscription/pause`,
        { method: 'POST', body: JSON.stringify({ pausedUntil: pausedUntil ?? null }), token },
      ),
    resumeSubscription: (memberId: string, token: string) =>
      apiFetch<{ success: boolean; status: string }>(
        `/admin/members/${memberId}/subscription/resume`,
        { method: 'POST', token },
      ),
  },
  stripe: {
    checkout: (planId: string, studioId: string, token: string, promoCodeId?: string) =>
      apiFetch<{ url: string }>('/stripe/checkout', { method: 'POST', body: JSON.stringify({ planId, studioId, ...(promoCodeId ? { promoCodeId } : {}) }), token }),
    portal: (token: string) =>
      apiFetch<{ url: string }>('/stripe/portal', { method: 'POST', token }),
    customerCard: (memberId: string, token: string) =>
      apiFetch<{ hasCard: boolean; last4?: string; brand?: string; paymentMethodId?: string }>(`/stripe/customer-card?memberId=${memberId}`, { token }),
    chargeMember: (body: { memberId: string; studioId: string; items: CartSaleItem[]; totalCents: number; totalCredits: number }, token: string) =>
      apiFetch<{ success: boolean }>('/stripe/charge-member', { method: 'POST', body: JSON.stringify(body), token }),
    refund: (saleId: string, token: string, amountCents?: number) =>
      apiFetch<{ success: boolean; refundId: string; refundedCents: number }>('/stripe/refund', { method: 'POST', body: JSON.stringify({ saleId, amountCents }), token }),
  },
  availability: {
    list: (studioId: string, token: string, from?: string, to?: string) => {
      const qs = new URLSearchParams({ studioId })
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      return apiFetch<AvailabilityBlock[]>(`/availability?${qs}`, { token })
    },
    listForInstructor: (instructorId: string, token: string, from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      return apiFetch<AvailabilityBlock[]>(`/availability/instructor/${instructorId}?${qs}`, { token })
    },
    create: (body: { instructorId: string; studioId: string; title: string; startDate: string; endDate: string }, token: string) =>
      apiFetch<AvailabilityBlock>('/availability', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { title?: string; startDate?: string; endDate?: string }, token: string) =>
      apiFetch<AvailabilityBlock>(`/availability/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/availability/${id}`, { method: 'DELETE', token }),
  },
  promos: {
    list: (studioId: string, token: string) =>
      apiFetch<PromoCode[]>(`/promos?studioId=${studioId}`, { token }),
    create: (body: { studioId: string; code: string; description?: string; type: string; value: number; maxUses?: number | null; validFrom?: string; validUntil?: string | null }, token: string) =>
      apiFetch<PromoCode>('/promos', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { description?: string; value?: number; maxUses?: number | null; validFrom?: string; validUntil?: string | null; isActive?: boolean }, token: string) =>
      apiFetch<PromoCode>(`/promos/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/promos/${id}`, { method: 'DELETE', token }),
    redeem: (code: string, studioId: string, token: string, memberId?: string) =>
      apiFetch<{ success: boolean; type: string; creditsAdded: number; discount: { type: string; value: number; promoCodeId: string } | null; message: string }>(
        '/promos/redeem', { method: 'POST', body: JSON.stringify({ code, studioId, ...(memberId ? { memberId } : {}) }), token },
      ),
  },
  ical: {
    getToken: (token: string) =>
      apiFetch<{ token: string; urls: { member: string; instructor?: string } }>('/ical/token', { token }),
  },
  networks: {
    list: (token: string) =>
      apiFetch<NetworkWithStudios[]>('/networks', { token }),
    create: (body: { name: string; slug: string }, token: string) =>
      apiFetch<StudioNetwork>('/networks', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { name?: string; slug?: string }, token: string) =>
      apiFetch<StudioNetwork>(`/networks/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/networks/${id}`, { method: 'DELETE', token }),
    addStudio: (networkId: string, studioId: string, token: string) =>
      apiFetch<{ id: string; studio: { id: string; name: string; slug: string } }>(`/networks/${networkId}/studios`, { method: 'POST', body: JSON.stringify({ studioId }), token }),
    removeStudio: (networkId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/networks/${networkId}/studios/${studioId}`, { method: 'DELETE', token }),
    my: (token: string) =>
      apiFetch<MemberNetworkInfo>('/networks/my', { token }),
  },

  brands: {
    list: (token: string) =>
      apiFetch<{ success: true; data: Brand[] }>('/brands', { token }),
    my: (token: string) =>
      apiFetch<{ success: true; data: Brand }>('/brands/my', { token }),
    get: (id: string, token: string) =>
      apiFetch<{ success: true; data: Brand }>(`/brands/${id}`, { token }),
    create: (body: { name: string; slug: string; logoUrl?: string; description?: string }, token: string) =>
      apiFetch<{ success: true; data: Brand }>('/brands', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { name?: string; logoUrl?: string | null; description?: string }, token: string) =>
      apiFetch<{ success: true; data: Brand }>(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${id}`, { method: 'DELETE', token }),
    addStudio: (brandId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/studios`, { method: 'POST', body: JSON.stringify({ studioId }), token }),
    removeStudio: (brandId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/studios/${studioId}`, { method: 'DELETE', token }),
    createFranchise: (brandId: string, body: { name: string; slug: string; description?: string }, token: string) =>
      apiFetch<{ success: true; data: { id: string; name: string; slug: string } }>(`/brands/${brandId}/franchises`, { method: 'POST', body: JSON.stringify(body), token }),
    promoteFranchiseAdmin: (brandId: string, body: { email: string; franchiseId: string; firstName?: string; lastName?: string }, token: string) =>
      apiFetch<{ success: true; created: boolean; roles: string[]; franchiseId: string; message: string }>(`/brands/${brandId}/franchise-admins`, { method: 'POST', body: JSON.stringify(body), token }),
    stats: (id: string, period: string, token: string) =>
      apiFetch<{ success: true; data: BrandStats }>(`/brands/${id}/stats?period=${period}`, { token }),
    members: (id: string, params: { q?: string; studioId?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.q) qs.set('q', params.q)
      if (params.studioId) qs.set('studioId', params.studioId)
      return apiFetch<{ success: true; data: BrandMember[] }>(`/brands/${id}/members?${qs}`, { token })
    },
    sessions: (id: string, params: { studioId?: string; from?: string; to?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.studioId) qs.set('studioId', params.studioId)
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      return apiFetch<{ success: true; data: BrandSession[] }>(`/brands/${id}/sessions?${qs}`, { token })
    },
  },
}
