/**
 * Shared Zod schemas used across multiple route files.
 *
 * Route-specific schemas live inline in their route file; only schemas
 * reused in ≥2 places belong here.
 */
import { z } from 'zod'

// ── Primitives ────────────────────────────────────────────────────────────────

/** CUID / UUID-shaped ID — non-empty string */
export const Id = z.string().min(1)

/** studioId query param — required non-empty string */
export const StudioIdQuery = z.object({
  studioId: z.string().min(1),
})

/** Optional studioId query param */
export const OptionalStudioIdQuery = z.object({
  studioId: z.string().min(1).optional(),
})

/** Pagination cursor query params */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
})

/** Date string (YYYY-MM-DD) */
export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')

/** ISO 8601 datetime string */
export const ISODateTime = z.string().datetime({ offset: true })

/** Positive integer cents amount */
export const Cents = z.number().int().positive()

/** Non-negative integer */
export const NonNegativeInt = z.number().int().min(0)

// ── Route param schemas ───────────────────────────────────────────────────────

export const IdParam = z.object({ id: Id })
export const MemberIdParam = z.object({ memberId: Id })
export const SessionIdParam = z.object({ sessionId: Id })
export const BookingIdParam = z.object({ bookingId: Id })
export const StudioIdParam = z.object({ studioId: Id })

// ── Common response bodies ────────────────────────────────────────────────────

export const MessageResponse = z.object({ message: z.string() })
export const OkResponse = z.object({ ok: z.literal(true) })

// ── Auth / roles ──────────────────────────────────────────────────────────────

export const StaffRole = z.enum(['studio_admin', 'instructor', 'fronthost'])
export const BookingStatus = z.enum(['CONFIRMED', 'CANCELLED', 'LATE_CANCELLED', 'NO_SHOW'])
export const SubscriptionStatus = z.enum(['ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE', 'PAUSED'])
export const TransactionType = z.enum([
  'PURCHASE', 'ADJUSTMENT', 'EXPIRY', 'LATE_CANCEL_FEE', 'NO_SHOW_FEE',
  'REFERRAL', 'REFUND', 'GRANT',
])
