import type { ApiResponse, SessionSlot, MemberProfile } from '@packd/types'

export interface AdminSession {
  id: string
  templateName: string
  sport: string
  instructorName: string
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
}

export const DEFAULT_INSTRUCTOR_PERMISSIONS: InstructorPermissions = {
  canCheckInMembers: true,
  canManageBookings: false,
  canViewMemberContact: false,
  canManageWaitlist: true,
  canEditSessionDetails: false,
  canCancelSession: false,
}

export interface InstructorWithPermissions {
  id: string
  userId: string
  name: string
  email: string
  permissions: InstructorPermissions
}

export interface StudioSummary {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  memberCount: number
  todaySessionCount: number
  instructorCount: number
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

export interface CalendarTemplate {
  id: string
  name: string
  sport: string
  durationMin: number
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
      apiFetch<SessionSlot[]>(`/schedule/${studioId}?from=${from}&to=${to}`, { token }),
  },
  bookings: {
    create: (sessionId: string, token: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
        token,
      }),
    cancel: (bookingId: string, token: string) =>
      apiFetch<ApiResponse<{ isLateCancel: boolean }>>(`/bookings/${bookingId}`, {
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
  },
  admin: {
    stats: (studioId: string, token: string) =>
      apiFetch<{ todaySessions: number; totalMembers: number; totalBookingsToday: number; waitlistToday: number }>(
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
  },
  franchise: {
    studios: (token: string) =>
      apiFetch<StudioSummary[]>('/franchise/studios', { token }),
    instructors: (studioId: string, token: string) =>
      apiFetch<InstructorWithPermissions[]>(`/franchise/studios/${studioId}/instructors`, { token }),
    updatePermissions: (studioId: string, instructorId: string, permissions: Partial<InstructorPermissions>, token: string) =>
      apiFetch<{ success: boolean; permissions: InstructorPermissions }>(
        `/franchise/studios/${studioId}/instructors/${instructorId}/permissions`,
        { method: 'PATCH', body: JSON.stringify(permissions), token },
      ),
  },
  rooms: {
    layout: (roomId: string, token: string) =>
      apiFetch<RoomLayout | null>(`/rooms/${roomId}/layout`, { token }),
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
    month: (studioId: string, year: number, month: number, token: string) =>
      apiFetch<{ year: number; month: number; days: Record<string, { sport: string; count: number }[]> }>(
        `/schedules/month?studioId=${studioId}&year=${year}&month=${month}`, { token },
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
  studios: {
    list: (token: string) =>
      apiFetch<any[]>('/studios', { token }),
    get: (studioId: string, token: string) =>
      apiFetch<StudioDetail>(`/studios/${studioId}`, { token }),
    update: (
      studioId: string,
      body: {
        name?: string; slug?: string; timezone?: string; currency?: string
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
}
