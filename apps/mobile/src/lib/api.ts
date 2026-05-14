import type { SessionSlot, MemberProfile, ApiResponse } from '@packd/types'
import { supabase } from './supabase'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
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
    list: (studioId: string, from: string, to: string) =>
      apiFetch<SessionSlot[]>(`/schedule/${studioId}?from=${from}&to=${to}`),
  },
  bookings: {
    create: (sessionId: string, spotLabel?: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId, spotLabel }),
      }),
    cancel: (bookingId: string) =>
      apiFetch<ApiResponse<{ isLateCancel: boolean }>>(`/bookings/${bookingId}`, {
        method: 'DELETE',
      }),
  },
  waitlist: {
    join: (sessionId: string) =>
      apiFetch<ApiResponse<{ id: string; position: number }>>('/waitlist', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }),
  },
  members: {
    me: () => apiFetch<MemberProfile>('/members/me'),
  },
}
