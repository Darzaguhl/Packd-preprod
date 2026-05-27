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
}

export const DEFAULT_INSTRUCTOR_PERMISSIONS: InstructorPermissions = {
  canCheckInMembers: false,
  canManageBookings: false,
  canViewMemberContact: false,
  canManageWaitlist: true,
  canEditSessionDetails: false,
  canCancelSession: false,
  canCreateSchedules: false,
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
  stripePriceId?: string | null
  activeSubscriptions?: number
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
  type: 'PURCHASE' | 'CLASS_DEBIT' | 'REFUND' | 'LATE_CANCEL_FEE' | 'NO_SHOW_FEE' | 'MANUAL_ADJUSTMENT'
  note: string | null
  createdAt: string
}

export interface MemberHistory {
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
}

export interface AdminMemberProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  creditBalance: number
  notes: string | null
  activeSubscription: {
    id: string
    planId: string
    planName: string
    status: string
    startDate: string
    endDate: string | null
  } | null
  joinedAt: string
}

export interface AdminMemberHistory {
  upcoming: UpcomingBooking[]
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options
  const hasBody = fetchOptions.body != null
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.message ?? error.error ?? 'API error')
  }

  return res.json() as Promise<T>
}

export const api = {
  schedule: {
    list: (studioId: string, from: string, to: string, token: string) =>
      apiFetch<{ timeFormat: string; sessions: SessionSlot[] }>(`/schedule/${studioId}?from=${from}&to=${to}`, { token }),
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
    me: (token: string) => apiFetch<MemberProfile>('/members/me', { token }),
    bookings: (token: string) => apiFetch<UpcomingBooking[]>('/members/me/bookings', { token }),
    history: (token: string) => apiFetch<MemberHistory>('/members/me/history', { token }),
    ensure: (token: string, studioId?: string) =>
      apiFetch<{ success: boolean; memberId: string }>('/members/ensure', {
        method: 'POST', body: JSON.stringify({ studioId }), token,
      }),
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
  },
  franchise: {
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
      apiFetch<{ year: number; month: number; days: Record<string, { sport: string; count: number }[]> }>(
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
  },
}
