import { supabase } from './supabase'
import type { SessionSlot, MemberProfile, ApiResponse } from '@packd/types'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    const err = new Error(body.message ?? body.error ?? 'API error') as Error & Record<string, unknown>
    Object.assign(err, body)
    throw err
  }

  return res.json() as Promise<T>
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
}

export interface SessionSpots {
  layout: RoomLayout | null
  assignments: SpotAssignment[]
  myBookingId: string | null
  myStationId: string | null
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
  memberNote: string | null
}

export interface ScheduleResponse {
  studioId: string
  studioName: string
  timeFormat: string
  timezone: string
  lateCancelWindowHours: number
  lateCancelFeeCredits: number
  sessions: SessionSlot[]
}

export const api = {
  schedule: {
    list: (studioId: string, from: string, to: string) =>
      apiFetch<ScheduleResponse>(`/schedule/${studioId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  },
  bookings: {
    create: (sessionId: string, memberNote?: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId, ...(memberNote ? { memberNote } : {}) }),
      }),
    cancel: (bookingId: string) =>
      apiFetch<{ success: boolean; isLateCancel: boolean }>(`/bookings/${bookingId}`, { method: 'DELETE' }),
    upcoming: () =>
      apiFetch<UpcomingBooking[]>('/members/me/bookings'),
  },
  waitlist: {
    join: (sessionId: string) =>
      apiFetch<ApiResponse<{ id: string; position: number }>>('/waitlist', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }),
    leave: (sessionId: string) =>
      apiFetch<{ success: boolean }>('/waitlist', {
        method: 'DELETE',
        body: JSON.stringify({ sessionId }),
      }),
  },
  rooms: {
    spots: (roomId: string, sessionId: string) =>
      apiFetch<SessionSpots>(`/rooms/${roomId}/sessions/${sessionId}/spots`),
    assignSpot: (roomId: string, sessionId: string, stationId: string | null) =>
      apiFetch<{ stationId: string | null }>(`/rooms/${roomId}/sessions/${sessionId}/my-spot`, {
        method: 'POST',
        body: JSON.stringify({ stationId }),
      }),
  },
  waivers: {
    getActive: (studioId: string) =>
      apiFetch<{ waiver: { id: string; title: string; body: string } | null }>(`/waivers/active?studioId=${studioId}`),
    sign: (waiverId: string) =>
      apiFetch<{ success: boolean }>(`/waivers/${waiverId}/sign`, { method: 'POST' }),
  },
  members: {
    me: () => apiFetch<MemberProfile>('/members/me'),
  },
}
