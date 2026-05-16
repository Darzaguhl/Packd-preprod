// ─── API Response wrapper ─────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'franchise_admin' | 'studio_admin' | 'instructor' | 'fronthost' | 'member'

/** Numeric rank — higher = more privilege. Used for requireRole() checks. */
export const ROLE_RANK: Record<UserRole, number> = {
  admin: 5,
  franchise_admin: 4,
  studio_admin: 3,
  instructor: 2,
  fronthost: 2,
  member: 1,
}

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  studioId?: string     // first assigned studio (backward compat)
  studioIds?: string[]  // all studios this user is assigned to (staff only)
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export interface SessionSlot {
  id: string
  templateName: string
  sport: string
  instructorName: string
  roomId: string
  roomName: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  waitlistCount: number
  status: string
  creditsRequired: number
  userBookingId?: string
  userStationId?: string | null
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
