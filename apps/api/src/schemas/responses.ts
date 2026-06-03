/**
 * Zod response schemas for Fastify routes.
 *
 * Adding these to route `schema.response` makes openapi-typescript emit typed
 * response bodies in api-types.generated.ts, eliminating the hand-written
 * interfaces in apps/web/src/lib/api.ts.
 *
 * Rules:
 *  - Schemas reflect what the route handler ACTUALLY returns (verified against
 *    the handler source).  If the hand-written interface diverges, the schema
 *    wins and the interface should be updated.
 *  - Dates are always serialised to ISO strings by the handlers.
 *  - Nullable DB fields become .nullable(), truly optional response fields
 *    use .optional().
 */

import { z } from 'zod'

// ─── Shared atomic sub-schemas ────────────────────────────────────────────

export const StationTypeSchema = z.enum([
  'BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER',
])

export const StationSchema = z.object({
  id:       z.string(),
  layoutId: z.string(),
  type:     StationTypeSchema,
  label:    z.string(),
  xM:       z.number(),
  yM:       z.number(),
  rotation: z.number(),
})

export const RoomLayoutSchema = z.object({
  id:       z.string(),
  roomId:   z.string(),
  name:     z.string(),
  widthM:   z.number(),
  lengthM:  z.number(),
  isActive: z.boolean(),
  stations: z.array(StationSchema),
})

export const StudioLocationSchema = z.object({
  id:       z.string(),
  name:     z.string(),
  address:  z.string(),
  city:     z.string(),
  country:  z.string(),
  timezone: z.string(),
})

export const StaffNoteSchema = z.object({
  id:        z.string(),
  content:   z.string(),
  staffName: z.string(),
  createdAt: z.string(),
})

export const PastBookingSchema = z.object({
  id:              z.string(),
  sessionId:       z.string(),
  startsAt:        z.string(),
  endsAt:          z.string(),
  templateName:    z.string(),
  sport:           z.string(),
  instructorName:  z.string(),
  roomName:        z.string(),
  status:          z.enum(['CONFIRMED', 'CANCELLED', 'LATE_CANCELLED', 'NO_SHOW']),
  checkedIn:       z.boolean(),
  creditsRequired: z.number().int(),
})

export const CreditTransactionSchema = z.object({
  id:        z.string(),
  amount:    z.number().int(),
  type:      z.enum(['PURCHASE', 'CLASS_DEBIT', 'REFUND', 'LATE_CANCEL_FEE', 'NO_SHOW_FEE', 'MANUAL_ADJUSTMENT', 'MEMBERSHIP_RENEWAL', 'EXPIRY', 'REFERRAL']),
  note:      z.string().nullable(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string(),
})

export const GuestPassEntrySchema = z.object({
  id:        z.string(),
  guestName: z.string().nullable(),
  sessionId: z.string().nullable(),
  amount:    z.number().int(),
  note:      z.string().nullable(),
  createdAt: z.string(),
})

export const InstructorPermissionsSchema = z.object({
  canCheckInMembers:              z.boolean(),
  canManageBookings:              z.boolean(),
  canViewMemberContact:           z.boolean(),
  canManageWaitlist:              z.boolean(),
  canEditSessionDetails:          z.boolean(),
  canCancelSession:               z.boolean(),
  canCreateSchedules:             z.boolean(),
  canSetSubstitute:               z.boolean(),
  canGrantCredits:                z.boolean(),
  canManagePromoCodes:            z.boolean(),
  canViewPurchaseHistory:         z.boolean(),
  canOverrideBookingRestrictions: z.boolean(),
})

export const FronthostPermissionsSchema = z.object({
  canCheckInMembers:              z.boolean(),
  canAdjustCredits:               z.boolean(),
  canManageBookings:              z.boolean(),
  canManageWaitlist:              z.boolean(),
  canViewMemberContact:           z.boolean(),
  canGrantCredits:                z.boolean(),
  canIssueRefunds:                z.boolean(),
  canManagePromoCodes:            z.boolean(),
  canViewPurchaseHistory:         z.boolean(),
  canExportData:                  z.boolean(),
  canOverrideBookingRestrictions: z.boolean(),
})

export const CartSaleItemSchema = z.object({
  productId:       z.string(),
  name:            z.string(),
  qty:             z.number().int(),
  priceInCents:    z.number().int(),
  creditsRequired: z.number().int(),
})

// ─── Sessions ─────────────────────────────────────────────────────────────

export const AdminSessionSchema = z.object({
  id:                          z.string(),
  templateName:                z.string(),
  sport:                       z.string(),
  instructorId:                z.string(),
  instructorName:              z.string(),
  instructorUserId:            z.string(),
  substituteInstructorId:      z.string().nullable(),
  substituteInstructorUserId:  z.string().nullable(),
  roomId:                      z.string(),
  roomName:                    z.string(),
  capacity:                    z.number().int(),
  bookedCount:                 z.number().int(),
  startsAt:                    z.string(),
  endsAt:                      z.string(),
  status:                      z.string(),
  creditsRequired:             z.number().int(),
  isPrivate:                   z.boolean().optional(),
})

// ─── Bookings ─────────────────────────────────────────────────────────────

export const AdminBookingSchema = z.object({
  id:           z.string(),
  memberId:     z.string(),
  memberName:   z.string(),
  memberEmail:  z.string(),
  checkedIn:    z.boolean(),
  checkedInAt:  z.string().nullable(),
  creditBalance: z.number().int(),
  bookedAt:     z.string(),
  memberNote:   z.string().nullable(),
})

// ─── Members ──────────────────────────────────────────────────────────────

export const ActiveSubscriptionSchema = z.object({
  id:              z.string(),
  planId:          z.string(),
  planName:        z.string(),
  status:          z.string(),
  pausedUntil:     z.string().nullable(),
  startDate:       z.string(),
  endDate:         z.string().nullable(),
  nextBillingDate: z.string().nullable().optional(),
}).nullable()

export const AdminMemberProfileSchema = z.object({
  id:                     z.string(),
  studioId:               z.string(),
  firstName:              z.string(),
  lastName:               z.string(),
  email:                  z.string(),
  creditBalance:          z.number().int(),
  guestPassBalance:       z.number().int(),
  notes:                  z.string().nullable(),
  birthday:               z.string().nullable(),
  emergencyContactName:   z.string().nullable(),
  emergencyContactPhone:  z.string().nullable(),
  staffNotes:             z.array(StaffNoteSchema),
  activeSubscription:     ActiveSubscriptionSchema,
  joinedAt:               z.string(),
})

export const MemberListItemSchema = z.object({
  id:               z.string(),
  name:             z.string(),
  email:            z.string(),
  creditBalance:    z.number().int(),
  membershipStatus: z.string().nullable(),
})

export const PaginatedMembersSchema = z.object({
  items:      z.array(MemberListItemSchema),
  nextCursor: z.string().nullable(),
  hasMore:    z.boolean(),
})

export const UpcomingBookingAdminSchema = z.object({
  id:              z.string(),
  sessionId:       z.string(),
  startsAt:        z.string(),
  endsAt:          z.string(),
  templateName:    z.string(),
  sport:           z.string(),
  instructorName:  z.string(),
  roomName:        z.string(),
  creditsRequired: z.number().int(),
  sessionStatus:   z.string(),
})

export const AdminMemberHistorySchema = z.object({
  upcoming:     z.array(UpcomingBookingAdminSchema),
  pastBookings: z.array(PastBookingSchema),
  transactions: z.array(CreditTransactionSchema),
})

// ─── Rooms / layouts ──────────────────────────────────────────────────────

export const RoomSummarySchema = z.object({
  id:           z.string(),
  name:         z.string(),
  capacity:     z.number().int(),
  locationId:   z.string(),
  locationName: z.string(),
  activeLayout: z.object({
    id:     z.string(),
    name:   z.string(),
    widthM: z.number(),
    lengthM: z.number(),
    _count: z.object({ stations: z.number().int() }),
  }).nullable(),
})

export const SpotAssignmentSchema = z.object({
  bookingId:        z.string(),
  memberId:         z.string(),
  memberName:       z.string(),
  checkedIn:        z.boolean(),
  stationId:        z.string().nullable(),
  creditBalance:    z.number().int(),
  membershipStatus: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED']).nullable(),
})

export const SessionSpotsSchema = z.object({
  layout:       RoomLayoutSchema.nullable(),
  assignments:  z.array(SpotAssignmentSchema),
  myBookingId:  z.string().nullable(),
  myStationId:  z.string().nullable(),
})

// ─── Schedule / calendar ──────────────────────────────────────────────────

export const ClassScheduleSchema = z.object({
  id:              z.string(),
  templateId:      z.string(),
  templateName:    z.string(),
  sport:           z.string(),
  instructorId:    z.string(),
  instructorName:  z.string(),
  roomId:          z.string(),
  roomName:        z.string(),
  daysOfWeek:      z.array(z.number().int()),
  startTime:       z.string(),
  durationMin:     z.number().int(),
  intervalWeeks:   z.number().int(),
  capacity:        z.number().int(),
  creditsRequired: z.number().int(),
  validFrom:       z.string(),
  validUntil:      z.string().nullable(),
})

export const CalendarSessionSchema = z.object({
  id:                         z.string(),
  scheduleId:                 z.string().nullable(),
  templateId:                 z.string(),
  templateName:               z.string(),
  sport:                      z.string(),
  instructorId:               z.string(),
  instructorName:             z.string(),
  substituteInstructorId:     z.string().nullable(),
  substituteInstructorName:   z.string().nullable(),
  roomId:                     z.string(),
  roomName:                   z.string(),
  startsAt:                   z.string(),
  endsAt:                     z.string(),
  capacity:                   z.number().int(),
  creditsRequired:            z.number().int(),
  status:                     z.string(),
  isPrivate:                  z.boolean().optional(),
})

export const CalendarTemplateSchema = z.object({
  id:                    z.string(),
  name:                  z.string(),
  sport:                 z.string(),
  durationMin:           z.number().int(),
  isPrivate:             z.boolean().optional(),
  defaultInstructorId:   z.string().nullable().optional(),
  defaultRoomId:         z.string().nullable().optional(),
  defaultCapacity:       z.number().int().nullable().optional(),
  defaultCreditsRequired: z.number().int().nullable().optional(),
  defaultStartTime:      z.string().nullable().optional(),
  defaultStartTime2:     z.string().nullable().optional(),
  defaultDaysOfWeek:     z.array(z.number().int()).optional(),
  defaultIntervalWeeks:  z.number().int().optional(),
})

export const CalendarInstructorSchema = z.object({
  id:   z.string(),
  name: z.string(),
})

export const CalendarRoomSchema = z.object({
  id:           z.string(),
  name:         z.string(),
  capacity:     z.number().int(),
  locationName: z.string(),
})

export const CalendarWeekSchema = z.object({
  weekStart:    z.string(),
  sessions:     z.array(CalendarSessionSchema),
  templates:    z.array(CalendarTemplateSchema),
  instructors:  z.array(CalendarInstructorSchema),
  rooms:        z.array(CalendarRoomSchema),
})

export const OrphanedPatternSchema = z.object({
  templateId:     z.string(),
  templateName:   z.string(),
  sport:          z.string(),
  instructorId:   z.string(),
  instructorName: z.string(),
  roomId:         z.string(),
  roomName:       z.string(),
  startTime:      z.string(),
  durationMin:    z.number().int(),
  sessionCount:   z.number().int(),
  nextOccurrence: z.string(),
  daysOfWeek:     z.array(z.number().int()),
})

// ─── Templates ────────────────────────────────────────────────────────────

export const ClassTemplateSchema = z.object({
  id:                     z.string(),
  studioId:               z.string(),
  name:                   z.string(),
  sport:                  z.string(),
  durationMin:            z.number().int(),
  description:            z.string().nullable().optional(),
  color:                  z.string(),
  isPrivate:              z.boolean().optional(),
  defaultInstructorId:    z.string().nullable().optional(),
  defaultRoomId:          z.string().nullable().optional(),
  defaultCapacity:        z.number().int().nullable().optional(),
  defaultCreditsRequired: z.number().int().nullable().optional(),
  defaultStartTime:       z.string().nullable().optional(),
  defaultStartTime2:      z.string().nullable().optional(),
  defaultDaysOfWeek:      z.array(z.number().int()).optional(),
  defaultIntervalWeeks:   z.number().int().optional(),
})

// ─── Staff ────────────────────────────────────────────────────────────────

export const StaffMemberSchema = z.object({
  id:                  z.string(),
  userId:              z.string(),
  name:                z.string(),
  email:               z.string(),
  staffRoles:          z.array(z.string()),
  joinedAt:            z.string(),
  instructorId:        z.string().nullable(),
  payRatePerHeadCents: z.number().int().nullable().optional(),
  payRateHourlyCents:  z.number().int().nullable().optional(),
  avatarUrl:           z.string().nullable().optional(),
  /** Set for management-tier users (studio_admin, franchise_admin, admin, brand_admin).
   *  When present, this user is shown read-only in the Management section. */
  primaryRole:         z.string().optional(),
})

export const StaffWithPermissionsSchema = z.object({
  id:                     z.string(),
  memberId:               z.string().nullable(),
  userId:                 z.string(),
  name:                   z.string(),
  email:                  z.string(),
  roles:                  z.array(z.enum(['instructor', 'fronthost'])),
  instructorPermissions:  InstructorPermissionsSchema.optional(),
  fronthostPermissions:   FronthostPermissionsSchema.optional(),
})

export const StaffShiftSchema = z.object({
  id:         z.string(),
  memberId:   z.string(),
  memberName: z.string(),
  studioId:   z.string(),
  startsAt:   z.string(),
  endsAt:     z.string(),
  note:       z.string().nullable(),
  patternId:  z.string().nullable(),
  createdAt:  z.string(),
})

export const StaffShiftPatternSchema = z.object({
  id:            z.string(),
  memberId:      z.string(),
  memberName:    z.string(),
  studioId:      z.string(),
  daysOfWeek:    z.array(z.number().int()),
  startTime:     z.string(),
  endTime:       z.string(),
  intervalWeeks: z.number().int(),
  validFrom:     z.string(),
  validUntil:    z.string().nullable(),
  note:          z.string().nullable(),
  createdAt:     z.string(),
})

export const AvailabilityBlockSchema = z.object({
  id:              z.string(),
  instructorId:    z.string(),
  instructorName:  z.string().optional(),
  studioId:        z.string(),
  title:           z.string(),
  startDate:       z.string(),
  endDate:         z.string(),
  createdAt:       z.string(),
})

// ─── Products / sales ─────────────────────────────────────────────────────

export const ProductSchema = z.object({
  id:              z.string(),
  studioId:        z.string(),
  name:            z.string(),
  category:        z.string(),
  priceInCents:    z.number().int(),
  creditsRequired: z.number().int(),
  imageUrl:        z.string().nullable(),
  inStock:         z.boolean(),
  stripePriceId:   z.string().nullable().optional(),
})

export const ProductSaleSchema = z.object({
  id:                      z.string(),
  memberId:                z.string(),
  studioId:                z.string(),
  items:                   z.array(CartSaleItemSchema),
  totalCents:              z.number().int(),
  totalCredits:            z.number().int(),
  paymentMethod:           z.enum(['card', 'cash', 'credits', 'free', 'terminal']),
  stripePaymentIntentId:   z.string().nullable(),
  staffUserId:             z.string().nullable(),
  soldAt:                  z.string(),
  refundedAt:              z.string().nullable(),
  refundedCents:           z.number().int().nullable(),
  stripeRefundId:          z.string().nullable(),
  failedAt:                z.string().nullable(),
  stripeReceiptUrl:        z.string().nullable().optional(),
})

// ─── Memberships ──────────────────────────────────────────────────────────

export const MembershipPlanSchema = z.object({
  id:                        z.string(),
  studioId:                  z.string(),
  name:                      z.string(),
  description:               z.string().nullable().optional(),
  priceInCents:              z.number().int(),
  intervalMonths:            z.number().int(),
  creditsPerCycle:           z.number().int().nullable(),
  guestPassesPerCycle:       z.number().int(),
  creditExpiryDays:          z.number().int().nullable().optional(),
  isIntroOffer:              z.boolean().optional(),
  maxRedemptionsPerMember:   z.number().int().nullable().optional(),
  memberRedemptions:         z.number().int().optional(),
  stripePriceId:             z.string().nullable().optional(),
  activeSubscriptions:       z.number().int().optional(),
})

export const MembershipSubscriptionSchema = z.object({
  id:                z.string(),
  memberId:          z.string(),
  memberFirstName:   z.string().optional(),
  memberLastName:    z.string().optional(),
  memberEmail:       z.string().optional(),
  planId:            z.string(),
  plan: z.object({
    name:           z.string(),
    creditsPerCycle: z.number().int().nullable(),
    intervalMonths: z.number().int(),
    priceInCents:   z.number().int(),
  }),
  status:    z.enum(['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PAST_DUE']),
  startDate: z.string(),
  endDate:   z.string().nullable(),
  createdAt: z.string().optional(),
})

// ─── Studio ───────────────────────────────────────────────────────────────

export const StudioSummarySchema = z.object({
  id:                    z.string(),
  name:                  z.string(),
  slug:                  z.string(),
  timezone:              z.string(),
  currency:              z.string(),
  memberCount:           z.number().int(),
  todaySessionCount:     z.number().int(),
  staffCount:            z.number().int(),
  fillRateToday:         z.number(),
  revenueThisMonthCents: z.number().int(),
})

export const StudioDetailSchema = z.object({
  id:         z.string(),
  name:       z.string(),
  slug:       z.string(),
  timezone:   z.string(),
  currency:   z.string(),
  timeFormat: z.string(),
  locations:  z.array(StudioLocationSchema),
})

// ─── Promos ───────────────────────────────────────────────────────────────

export const PromoCodeSchema = z.object({
  id:          z.string(),
  code:        z.string(),
  description: z.string().nullable().optional(),
  type:        z.enum(['CREDIT_GRANT', 'FREE_CLASS', 'MEMBERSHIP_PCT', 'MEMBERSHIP_FLAT']),
  value:       z.number(),
  maxUses:     z.number().int().nullable(),
  usageCount:  z.number().int(),
  validFrom:   z.string(),
  validUntil:  z.string().nullable(),
  isActive:    z.boolean(),
  createdAt:   z.string(),
})

// ─── Analytics ────────────────────────────────────────────────────────────

export const LeaderboardEntrySchema = z.object({
  rank:      z.number().int(),
  memberId:  z.string(),
  name:      z.string(),
  visits:    z.number().int(),
  checkIns:  z.number().int(),
  lastVisit: z.string(),
})

export const LeaderboardInstructorSchema = z.object({
  rank:          z.number().int(),
  instructorId:  z.string(),
  name:          z.string(),
  totalBookings: z.number().int(),
})

export const LeaderboardSchema = z.object({
  members:         z.array(LeaderboardEntrySchema),
  topInstructors:  z.array(LeaderboardInstructorSchema),
  period:          z.string(),
  generatedAt:     z.string(),
})

export const AnalyticsDataSchema = z.object({
  heatmap: z.array(z.object({
    dow:      z.number().int(),
    hour:     z.number().int(),
    fillRate: z.number(),
    count:    z.number().int(),
  })),
  weeklyTrend: z.array(z.object({
    weekStart:    z.string(),
    sessions:     z.number().int(),
    avgFillRate:  z.number(),
    checkInRate:  z.number(),
    cancelRate:   z.number(),
  })),
  classStats: z.array(z.object({
    templateId:    z.string(),
    name:          z.string(),
    sport:         z.string(),
    sessions:      z.number().int(),
    avgFillRate:   z.number(),
    checkInRate:   z.number(),
    totalBookings: z.number().int(),
  })),
  funnel: z.object({
    confirmed:        z.number().int(),
    checkedIn:        z.number().int(),
    onTimeCancelled:  z.number().int(),
    lateCancelled:    z.number().int(),
    noShow:           z.number().int(),
  }),
  instructors: z.array(z.object({
    id:          z.string(),
    name:        z.string(),
    sessions:    z.number().int(),
    avgFillRate: z.number(),
    checkInRate: z.number(),
    loyaltyRate: z.number(),
  })),
  recurrence: z.object({
    monthOverMonth:       z.number(),
    avgBookingsPerMember: z.number(),
    frequencyBuckets: z.array(z.object({
      label: z.string(),
      count: z.number().int(),
    })),
  }),
  revenue: z.object({
    creditsIssued:       z.number().int(),
    creditsConsumed:     z.number().int(),
    lateCancelFees:      z.number().int(),
    noShowFees:          z.number().int(),
    activeSubscriptions: z.number().int(),
    weeklyCredits: z.array(z.object({
      weekStart: z.string(),
      issued:    z.number().int(),
      consumed:  z.number().int(),
      fees:      z.number().int(),
    })),
  }),
  meta: z.object({
    weeks:       z.number().int(),
    windowStart: z.string(),
    generatedAt: z.string(),
  }),
})

export const QueryResultSchema = z.object({
  columns:  z.array(z.string()),
  rows:     z.array(z.array(z.unknown())),
  rowCount: z.number().int(),
  duration: z.number(),
})

// ─── Networks ─────────────────────────────────────────────────────────────

export const StudioNetworkSchema = z.object({
  id:   z.string(),
  name: z.string(),
  slug: z.string(),
})

const NetworkStudioMembershipSchema = z.object({
  id:        z.string(),
  studioId:  z.string(),
  networkId: z.string(),
  joinedAt:  z.string(),
  studio: z.object({
    id:       z.string(),
    name:     z.string(),
    slug:     z.string(),
    timezone: z.string(),
  }),
})

export const NetworkWithStudiosSchema = StudioNetworkSchema.extend({
  studios: z.array(NetworkStudioMembershipSchema),
})

export const NetworkStudioSchema = z.object({
  id:       z.string(),
  name:     z.string(),
  slug:     z.string(),
  timezone: z.string(),
  isHome:   z.boolean(),
})

export const MemberNetworkInfoSchema = z.object({
  network:     StudioNetworkSchema.nullable(),
  homeStudioId: z.string().optional(),
  studios:     z.array(NetworkStudioSchema),
})

// ─── Photos ───────────────────────────────────────────────────────────────

export const InstructorPhotoSchema = z.object({
  id:               z.string(),
  instructorId:     z.string(),
  studioId:         z.string(),
  storageKey:       z.string(),
  url:              z.string(),
  fileName:         z.string(),
  approvedForSocial: z.boolean(),
  uploadedBy:       z.string(),
  createdAt:        z.string(),
})

// ─── Brands ───────────────────────────────────────────────────────────────

export const PlatformBrandStudioSchema = z.object({
  id:       z.string(),
  name:     z.string(),
  slug:     z.string(),
  timezone: z.string(),
})

export const PlatformBrandSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  slug:        z.string(),
  logoUrl:     z.string().nullable(),
  description: z.string().nullable(),
  createdAt:   z.string(),
  studios: z.array(z.object({
    brandId:  z.string(),
    studioId: z.string(),
    studio:   PlatformBrandStudioSchema,
  })),
})
