// Type-only module — all API method implementations live in api-client.ts.
// Keep only interface/type/const exports consumed by components.
//
// Types for routes with Zod response schemas are now generated automatically
// in api-types.generated.ts and re-exported from api-client.ts.
// This file retains only: permission defaults/consts, complex nested types not
// yet covered by generated schemas, and types used by the legacy apiFetch layer.
import type { MemberProfile } from '@packd/types'

// AdminSession, AdminBooking, AdminMemberProfile, AdminMemberHistory, StaffNote,
// GuestPassEntry, AnalyticsData, QueryResult, Leaderboard, StudioSummary,
// StaffWithPermissions, RoomLayout, Station, SessionSpots, CalendarWeek,
// ClassSchedule, OrphanedPattern, StaffMember, InstructorPhoto, ClassTemplate,
// Product, MembershipPlan, MembershipSubscription, StaffShift, StaffShiftPattern,
// AvailabilityBlock, PromoCode, StudioDetail, NetworkWithStudios, StudioNetwork,
// MemberNetworkInfo — now generated from Zod response schemas; exported from api-client.ts.

export interface InstructorPermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canViewMemberContact: boolean
  canManageWaitlist: boolean
  canEditSessionDetails: boolean
  canCancelSession: boolean
  canCreateSchedules: boolean
  canSetSubstitute: boolean
  canGrantCredits: boolean
  canManagePromoCodes: boolean
  canViewPurchaseHistory: boolean
  canOverrideBookingRestrictions: boolean
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
  canGrantCredits: false,
  canManagePromoCodes: false,
  canViewPurchaseHistory: false,
  canOverrideBookingRestrictions: false,
}


export interface FronthostPermissions {
  canCheckInMembers: boolean
  canAdjustCredits: boolean
  canManageBookings: boolean
  canManageWaitlist: boolean
  canViewMemberContact: boolean
  canGrantCredits: boolean
  canIssueRefunds: boolean
  canManagePromoCodes: boolean
  canViewPurchaseHistory: boolean
  canExportData: boolean
  canOverrideBookingRestrictions: boolean
}

export const DEFAULT_FRONTHOST_PERMISSIONS: FronthostPermissions = {
  canCheckInMembers: true,
  canAdjustCredits: true,
  canManageBookings: true,
  canManageWaitlist: true,
  canViewMemberContact: true,
  canGrantCredits: true,
  canIssueRefunds: true,
  canManagePromoCodes: false,
  canViewPurchaseHistory: true,
  canExportData: false,
  canOverrideBookingRestrictions: true,
}

/** Unified permission set used in the Live view — covers both fronthost and instructor fields. */
export interface LivePermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canManageWaitlist: boolean
  canViewMemberContact: boolean
  canGrantCredits: boolean
  canAdjustCredits: boolean
  canIssueRefunds: boolean
  canOverrideBookingRestrictions: boolean
}

/** Full access — used for studio_admin+ who bypass permission checks entirely. */
export const FULL_LIVE_PERMISSIONS: LivePermissions = {
  canCheckInMembers: true,
  canManageBookings: true,
  canManageWaitlist: true,
  canViewMemberContact: true,
  canGrantCredits: true,
  canAdjustCredits: true,
  canIssueRefunds: true,
  canOverrideBookingRestrictions: true,
}

// StaffWithPermissions — now generated from /franchise/studios/{studioId}/staff-permissions response schema

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

// MembershipPlan, MembershipSubscription — now generated from response schemas

export interface StudioLocation {
  id: string
  name: string
  address: string
  city: string
  country: string
  timezone: string
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

// StationType kept for type safety in room-map components
export type StationType = 'BIKE' | 'TREADMILL' | 'BENCH' | 'ROWER' | 'MAT' | 'REFORMER' | 'BARRE' | 'OTHER'

// LayoutTemplate is RoomLayout + roomName (returned by GET /studios/:id/layouts endpoint)
export interface LayoutTemplate {
  id: string
  roomId: string
  name: string
  widthM: number
  lengthM: number
  isActive: boolean
  stations: { id: string; layoutId: string; type: StationType; label: string; xM: number; yM: number; rotation: number }[]
  roomName: string
}

// SpotAssignment, SessionSpots, CalendarSession sub-types, CalendarWeek, ClassTemplate,
// ClassSchedule, OrphanedPattern — now generated from response schemas

// StaffMember, AdminBooking — now generated from response schemas

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
  type: 'PURCHASE' | 'CLASS_DEBIT' | 'REFUND' | 'LATE_CANCEL_FEE' | 'NO_SHOW_FEE' | 'MANUAL_ADJUSTMENT' | 'MEMBERSHIP_RENEWAL' | 'EXPIRY' | 'REFERRAL'
  note: string | null
  expiresAt?: string | null
  createdAt: string
}

export interface MemberHistory {
  pastBookings: PastBooking[]
  transactions: CreditTransaction[]
}

// StaffNote, AdminMemberProfile, StaffShift, StaffShiftPattern, AvailabilityBlock,
// PromoCode — now generated from response schemas

// Leaderboard, LeaderboardEntry, LeaderboardInstructor — now generated
// StudioNetwork, NetworkStudio, MemberNetworkInfo, NetworkWithStudios — now generated

export interface NetworkStudio {
  id: string
  name: string
  slug: string
  timezone: string
  isHome: boolean
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

/** Shape returned by GET /brands (admin-only list — has studios[], not franchises[]) */
export interface PlatformBrand {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  description: string | null
  createdAt: string
  admin: { id: string; email: string; firstName: string; lastName: string } | null
  studios: { id: string; name: string; slug: string; timezone: string }[]
}

// NetworkWithStudios, AdminMemberHistory — now generated from response schemas

export interface MemberStats {
  visits: number
  rank: number | null
  totalMembers: number
  topInstructors: { instructorId: string; name: string; sessionsTogether: number }[]
}

