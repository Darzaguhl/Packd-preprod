import type { ApiResponse, SessionSlot, MemberProfile } from '@packd/types'

export interface AdminSession {
  id: string
  templateName: string
  sport: string
  instructorName: string
  roomName: string
  capacity: number
  bookedCount: number
  startsAt: string
  endsAt: string
  status: string
  creditsRequired: number
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
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
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
    create: (sessionId: string, token: string, spotLabel?: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId, spotLabel }),
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
  studios: {
    create: (
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
