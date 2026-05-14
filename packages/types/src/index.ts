// ─── API Response wrapper ─────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'studio_admin' | 'instructor' | 'client'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  studioId?: string
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export interface SessionSlot {
  id: string
  templateName: string
  sport: string
  instructorName: string
  roomName: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  waitlistCount: number
  status: string
  creditsRequired: number
  userBookingId?: string
  userWaitlistPosition?: number
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export interface BookingRequest {
  sessionId: string
  spotLabel?: string
}

export interface WaitlistRequest {
  sessionId: string
}

// ─── Room layout ──────────────────────────────────────────────────────────────

export interface SpotLayout {
  id: string
  row: number
  col: number
  label: string
  status: 'available' | 'booked' | 'blocked'
}

// ─── Membership & Credits ─────────────────────────────────────────────────────

export interface MembershipPlanSummary {
  id: string
  name: string
  description?: string
  priceInCents: number
  intervalMonths: number
  creditsPerCycle?: number
}

export interface MemberProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  creditBalance: number
  activeSubscription?: {
    planName: string
    status: string
    endDate?: string
  }
}

// ─── pg-boss job payloads ─────────────────────────────────────────────────────

export interface WaitlistPromotePayload {
  waitlistEntryId: string
  sessionId: string
  memberId: string
}

export interface LateCancelFeePayload {
  bookingId: string
  memberId: string
  sessionId: string
}

export interface NoShowFeePayload {
  sessionId: string
}

export interface MembershipRenewalReminderPayload {
  memberId: string
  subscriptionId: string
  daysUntilExpiry: number
}
