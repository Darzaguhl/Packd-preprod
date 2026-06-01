// Type-only module — all API method implementations live in api-client.ts.
// Keep only interface/type/const exports consumed by components.
import type { MemberProfile } from '@packd/types'

export interface AdminSession {
  id: string
  templateName: string
  sport: string
  instructorId: string
  instructorName: string
  instructorUserId: string
  substituteInstructorId?: string | null
  substituteInstructorUserId?: string | null
  roomId: string
  roomName: string
  capacity: number
  bookedCount: number
  startsAt: string
  endsAt: string
  status: string
  creditsRequired: number
  isPrivate?: boolean
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
  stripePriceId?: string | null
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
  revenueThisMonthCents: number
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
  myBookingId: string | null
  myStationId: string | null
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
  isPrivate?: boolean
}

export interface ClassTemplate {
  id: string
  studioId: string
  name: string
  sport: string
  durationMin: number
  description?: string | null
  color: string
  isPrivate?: boolean
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
  isPrivate?: boolean
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
  payRateHourlyCents?: number | null
  avatarUrl?: string | null
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

export interface StaffShift {
  id: string
  memberId: string
  memberName: string
  studioId: string
  startsAt: string
  endsAt: string
  note: string | null
  patternId: string | null
  createdAt: string
}

export interface StaffShiftPattern {
  id: string
  memberId: string
  memberName: string
  studioId: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  intervalWeeks: number
  validFrom: string
  validUntil: string | null
  note: string | null
  createdAt: string
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

/** Shape returned by GET /brands (admin-only list — has studios[], not franchises[]) */
export interface PlatformBrand {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  description: string | null
  createdAt: string
  studios: { id: string; name: string; slug: string; timezone: string }[]
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

