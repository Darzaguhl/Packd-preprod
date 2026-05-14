import type { ApiResponse, SessionSlot, MemberProfile } from '@packd/types'

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
