import type { FastifyInstance, FastifyRequest } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

let _platformClient: Anthropic | null = null
function platformClient() {
  return _platformClient ?? (_platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))
}

function clientForKey(apiKey: string) {
  return new Anthropic({ apiKey })
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const MEMBER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_schedule',
    description: 'Get upcoming class sessions for the studio.',
    input_schema: {
      type: 'object' as const,
      properties: {
        studioId: { type: 'string', description: 'The studio ID' },
        days: { type: 'number', description: 'Number of days ahead to look (default 7, max 14)' },
      },
      required: ['studioId'],
    },
  },
  {
    name: 'get_my_bookings',
    description: "Get the current user's upcoming confirmed bookings.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_my_credits',
    description: "Get the current user's credit balance and active membership.",
    input_schema: {
      type: 'object' as const,
      properties: { studioId: { type: 'string' } },
      required: ['studioId'],
    },
  },
  {
    name: 'book_class',
    description: 'Book a class session for the current user. Only call when the user explicitly asks to book a specific class.',
    input_schema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string', description: 'The session ID to book' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel a booking for the current user. Only call when the user has explicitly confirmed.',
    input_schema: {
      type: 'object' as const,
      properties: { bookingId: { type: 'string', description: 'The booking ID to cancel' } },
      required: ['bookingId'],
    },
  },
  {
    name: 'join_waitlist',
    description: 'Join the waitlist for a full class session.',
    input_schema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'leave_waitlist',
    description: "Leave the waitlist for a session the user is currently on.",
    input_schema: {
      type: 'object' as const,
      properties: { waitlistEntryId: { type: 'string', description: 'The waitlist entry ID to remove' } },
      required: ['waitlistEntryId'],
    },
  },
]

const STAFF_TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_member',
    description: 'Search for a member by name or email and return their full info (credits, membership, upcoming bookings) in one call. Always use this instead of searching then fetching separately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        studioId: { type: 'string' },
        query: { type: 'string', description: 'Name or email — can be partial or full name' },
      },
      required: ['studioId', 'query'],
    },
  },
  {
    name: 'get_today_sessions',
    description: "Get today's sessions and booking counts for the front desk.",
    input_schema: {
      type: 'object' as const,
      properties: { studioId: { type: 'string' } },
      required: ['studioId'],
    },
  },
  {
    name: 'get_session_bookings',
    description: 'Get the full list of members booked into a session — names, check-in status, and spot assignments. Use this when asked "who\'s in this class?" or similar.',
    input_schema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'book_class_for_member',
    description: 'Book a class on behalf of a specific member. Staff can book into live or past sessions — do not refuse based on session start time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memberId: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['memberId', 'sessionId'],
    },
  },
  {
    name: 'cancel_booking_for_member',
    description: "Cancel a member's booking on their behalf. Only call when explicitly asked and confirmed.",
    input_schema: {
      type: 'object' as const,
      properties: {
        bookingId: { type: 'string', description: 'The bookingId from get_session_bookings or find_member upcomingBookings' },
      },
      required: ['bookingId'],
    },
  },
  {
    name: 'get_session_spots',
    description: 'Get the room layout and spot assignments for a session. Only call this if `hasLayout` is true in the session data. Returns stations with `stationId`, `label` (full name e.g. "Treadmill 1"), and `alias` (short form shown in the UI e.g. "T1"). Match user shorthand like "T1", "B2" against the `alias` field. Use `stationId` — never the label — when calling assign_spot.',
    input_schema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'assign_spot',
    description: 'Assign a member to a specific station/spot in a session. Always call get_session_spots first. Use the `stationId` field from that result — never the label or a user-supplied alias like "T1".',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        bookingId: { type: 'string', description: 'The booking ID to assign a spot to' },
        stationId: { type: 'string', description: 'The `stationId` value from get_session_spots — the database ID, not the label' },
      },
      required: ['sessionId', 'bookingId', 'stationId'],
    },
  },
  {
    name: 'checkin_member',
    description: 'Toggle check-in status for a member\'s booking. Calling this checks in an unchecked member, or un-checks a checked-in one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        bookingId: { type: 'string' },
      },
      required: ['sessionId', 'bookingId'],
    },
  },
]

const ADMIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_studio_stats',
    description: 'Get high-level studio stats: total members, bookings today, active subscriptions.',
    input_schema: {
      type: 'object' as const,
      properties: { studioId: { type: 'string' } },
      required: ['studioId'],
    },
  },
  {
    name: 'adjust_member_credits',
    description: 'Add or remove credits for a member. Only call when explicitly asked.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memberId: { type: 'string' },
        amount: { type: 'number', description: 'Credits to add (positive) or remove (negative)' },
        reason: { type: 'string' },
      },
      required: ['memberId', 'amount', 'reason'],
    },
  },
]

// ── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Format a date as a human-readable string in the studio's timezone,
 * respecting the studio's 12h/24h preference.
 * e.g. "Monday, Jun 2, 9:00 AM" or "Monday, Jun 2, 09:00"
 */
function fmtInTz(date: Date, timezone: string, timeFormat: string = '12h'): string {
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: timeFormat !== '24h',
  })
}

/**
 * Returns { start, end } as UTC Dates for the current calendar day
 * in the given IANA timezone (e.g. "Europe/Stockholm").
 */
function todayBoundsInTz(timezone: string): { start: Date; end: Date } {
  const now = new Date()
  // Get today's date string (YYYY-MM-DD) in the studio timezone
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }) // "2026-05-30"
  const [year, month, day] = dateStr.split('-').map(Number)

  // Compute the UTC offset for this timezone at the current moment.
  // en-US gives a parseable string that new Date() understands on all platforms.
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr  = now.toLocaleString('en-US', { timeZone: timezone })
  const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime()

  // midnight in the target timezone expressed as UTC
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0)
  const start = new Date(utcMidnight - offsetMs)
  const end   = new Date(start.getTime() + 86_400_000 - 1) // +24h - 1ms
  return { start, end }
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  userRole: string,
): Promise<unknown> {
  const rank = ROLE_RANK[userRole as keyof typeof ROLE_RANK] ?? 0

  switch (name) {
    case 'get_schedule': {
      const { studioId, days = 7 } = input as { studioId: string; days?: number }
      const from = new Date()
      const to = new Date(from.getTime() + Math.min(Number(days), 14) * 86400000)
      const [sessions, studioTz] = await Promise.all([
        prisma.classSession.findMany({
          where: { studioId, startsAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
          include: {
            template: { select: { name: true, sport: true } },
            instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
          },
          orderBy: { startsAt: 'asc' },
          take: 30,
        }),
        prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true, timeFormat: true } }),
      ])
      const tz = studioTz?.timezone ?? 'UTC'
      const tf = studioTz?.timeFormat ?? '12h'
      return sessions.map(s => ({
        id: s.id,
        name: s.template?.name ?? 'Class',
        sport: s.template?.sport,
        instructor: s.instructor ? `${s.instructor.user.firstName} ${s.instructor.user.lastName}` : null,
        startsAt: fmtInTz(s.startsAt, tz, tf),
        durationMin: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60000),
        capacity: s.capacity,
        booked: s._count.bookings,
        spotsLeft: s.capacity - s._count.bookings,
        creditsRequired: s.creditsRequired,
      }))
    }

    case 'get_my_bookings': {
      const member = await prisma.member.findUnique({ where: { userId }, select: { id: true } })
      if (!member) return { error: 'Member not found' }
      const bookings = await prisma.booking.findMany({
        where: { memberId: member.id, status: 'CONFIRMED', session: { startsAt: { gte: new Date() } } },
        include: {
          session: {
            include: {
              template: { select: { name: true } },
              studio: { select: { name: true, timezone: true, timeFormat: true } },
            },
          },
        },
        orderBy: { session: { startsAt: 'asc' } },
        take: 10,
      })
      return bookings.map(b => ({
        bookingId: b.id,
        class: b.session.template?.name ?? 'Class',
        studio: b.session.studio.name,
        startsAt: fmtInTz(b.session.startsAt, b.session.studio.timezone ?? 'UTC', b.session.studio.timeFormat ?? '12h'),
      }))
    }

    case 'get_my_credits': {
      const { studioId } = input as { studioId: string }
      const member = await prisma.member.findUnique({
        where: { userId },
        include: {
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: 'ACTIVE', plan: { studioId } },
            include: { plan: { select: { name: true } } },
            take: 1,
          },
        },
      })
      return {
        credits: member?.creditBalance?.balance ?? 0,
        activePlan: member?.memberships[0]?.plan.name ?? null,
      }
    }

    case 'book_class': {
      const { sessionId } = input as { sessionId: string }
      const member = await prisma.member.findUnique({
        where: { userId },
        include: { creditBalance: true },
      })
      if (!member) return { error: 'Member not found' }

      const session = await prisma.classSession.findUnique({
        where: { id: sessionId },
        include: { _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } } },
      })
      if (!session) return { error: 'Session not found' }
      if (session.startsAt < new Date()) return { error: 'Class has already started' }
      if (session._count.bookings >= session.capacity) return { error: 'Class is full' }
      if ((member.creditBalance?.balance ?? 0) < session.creditsRequired) {
        return { error: `Not enough credits (need ${session.creditsRequired}, have ${member.creditBalance?.balance ?? 0})` }
      }

      const existing = await prisma.booking.findFirst({
        where: { memberId: member.id, sessionId, status: { in: ['CONFIRMED', 'LATE_CANCELLED'] } },
      })
      if (existing?.status === 'CONFIRMED') return { error: 'Already booked for this class' }

      await prisma.$transaction(async (tx) => {
        if (existing?.status === 'LATE_CANCELLED') {
          await tx.booking.update({ where: { id: existing.id }, data: { status: 'CONFIRMED' } })
        } else {
          await tx.booking.create({ data: { memberId: member.id, sessionId, status: 'CONFIRMED' } })
        }
        if (session.creditsRequired > 0) {
          await tx.creditBalance.update({
            where: { memberId: member.id },
            data: { balance: { decrement: session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: { memberId: member.id, amount: -session.creditsRequired, type: 'CLASS_DEBIT', note: 'Booked via assistant' },
          })
        }
      })
      return { success: true, message: 'Booking confirmed!' }
    }

    case 'cancel_booking': {
      const { bookingId } = input as { bookingId: string }
      const member = await prisma.member.findUnique({ where: { userId }, select: { id: true } })
      if (!member) return { error: 'Member not found' }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { session: true },
      })
      if (!booking) return { error: 'Booking not found' }
      if (booking.memberId !== member.id) return { error: 'Not your booking' }
      if (booking.status !== 'CONFIRMED') return { error: 'Booking is not confirmed' }

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', stationId: null } })
        if (booking.session.creditsRequired > 0) {
          await tx.creditBalance.update({
            where: { memberId: member.id },
            data: { balance: { increment: booking.session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: { memberId: member.id, amount: booking.session.creditsRequired, type: 'REFUND', note: 'Cancelled via assistant' },
          })
        }
      })
      return { success: true, message: 'Booking cancelled and credits refunded.' }
    }

    case 'find_member': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { studioId, query } = input as { studioId: string; query: string }
      const words = query.trim().split(/\s+/).filter(Boolean)
      const members = await prisma.member.findMany({
        where: {
          studioId,
          user: {
            OR: words.flatMap(word => [
              { firstName: { contains: word, mode: 'insensitive' as const } },
              { lastName:  { contains: word, mode: 'insensitive' as const } },
              { email:     { contains: word, mode: 'insensitive' as const } },
            ]),
          },
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: true,
          memberships: {
            where: { status: 'ACTIVE' },
            include: { plan: { select: { name: true } } },
            take: 1,
          },
          bookings: {
            where: { status: 'CONFIRMED', session: { startsAt: { gte: new Date() } } },
            include: { session: { include: { template: { select: { name: true } }, studio: { select: { timezone: true, timeFormat: true } } } } },
            orderBy: { session: { startsAt: 'asc' } },
            take: 5,
          },
        },
        take: 5,
      })
      if (members.length === 0) return { error: `No members found matching "${query}"` }
      return members.map(m => ({
        memberId: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        credits: m.creditBalance?.balance ?? 0,
        activePlan: m.memberships[0]?.plan.name ?? null,
        upcomingBookings: m.bookings.map(b => ({
          bookingId: b.id,
          class: b.session.template?.name ?? 'Class',
          startsAt: fmtInTz(b.session.startsAt, b.session.studio?.timezone ?? 'UTC', b.session.studio?.timeFormat ?? '12h'),
        })),
      }))
    }

    case 'get_today_sessions': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { studioId } = input as { studioId: string }
      const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true, timeFormat: true } })
      const { start, end } = todayBoundsInTz(studio?.timezone ?? 'UTC')
      const sessions = await prisma.classSession.findMany({
        where: { studioId, startsAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        include: {
          template: { select: { name: true } },
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
          layout: { select: { id: true } },
          room: { select: { layouts: { where: { isActive: true }, select: { id: true }, take: 1 } } },
        },
        orderBy: { startsAt: 'asc' },
      })
      return sessions.map(s => ({
        sessionId: s.id,
        name: s.template?.name ?? 'Class',
        startsAt: fmtInTz(s.startsAt, studio?.timezone ?? 'UTC', studio?.timeFormat ?? '12h'),
        durationMin: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60000),
        booked: s._count.bookings,
        capacity: s.capacity,
        hasLayout: !!(s.layout ?? s.room?.layouts[0]),
      }))
    }

    case 'join_waitlist': {
      const { sessionId } = input as { sessionId: string }
      const member = await prisma.member.findUnique({ where: { userId }, select: { id: true } })
      if (!member) return { error: 'Member not found' }

      const existing = await prisma.waitlistEntry.findFirst({
        where: { memberId: member.id, sessionId, status: { in: ['WAITING', 'NOTIFIED'] } },
      })
      if (existing) return { error: 'Already on the waitlist for this class' }

      const last = await prisma.waitlistEntry.findFirst({
        where: { sessionId, status: { in: ['WAITING', 'NOTIFIED'] } },
        orderBy: { position: 'desc' },
        select: { position: true },
      })

      const entry = await prisma.waitlistEntry.create({
        data: { memberId: member.id, sessionId, status: 'WAITING', position: (last?.position ?? 0) + 1 },
      })
      return { success: true, waitlistEntryId: entry.id, position: entry.position, message: `Added to waitlist at position ${entry.position}.` }
    }

    case 'leave_waitlist': {
      const { waitlistEntryId } = input as { waitlistEntryId: string }
      const member = await prisma.member.findUnique({ where: { userId }, select: { id: true } })
      if (!member) return { error: 'Member not found' }

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistEntryId } })
      if (!entry) return { error: 'Waitlist entry not found' }
      if (entry.memberId !== member.id) return { error: 'Not your waitlist entry' }

      await prisma.waitlistEntry.update({ where: { id: waitlistEntryId }, data: { status: 'REMOVED' } })
      return { success: true, message: 'Removed from waitlist.' }
    }

    case 'get_session_bookings': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { sessionId } = input as { sessionId: string }
      const bookings = await prisma.booking.findMany({
        where: { sessionId, status: 'CONFIRMED' },
        include: {
          member: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { bookedAt: 'asc' },
      })
      const waitlist = await prisma.waitlistEntry.findMany({
        where: { sessionId, status: { in: ['WAITING', 'NOTIFIED'] } },
        include: { member: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { position: 'asc' },
      })
      return {
        bookings: bookings.map(b => ({
          bookingId: b.id,
          memberId: b.memberId,
          name: `${b.member.user.firstName} ${b.member.user.lastName}`,
          checkedIn: b.checkedIn,
          stationId: b.stationId ?? null,
        })),
        waitlist: waitlist.map(w => ({
          waitlistEntryId: w.id,
          name: `${w.member.user.firstName} ${w.member.user.lastName}`,
          position: w.position,
          status: w.status,
        })),
        totalBooked: bookings.length,
        totalWaiting: waitlist.length,
      }
    }

    case 'book_class_for_member': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { memberId, sessionId } = input as { memberId: string; sessionId: string }

      const [member, session] = await Promise.all([
        prisma.member.findUnique({ where: { id: memberId }, include: { creditBalance: true } }),
        prisma.classSession.findUnique({
          where: { id: sessionId },
          include: { _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } } },
        }),
      ])
      if (!member) return { error: 'Member not found' }
      if (!session) return { error: 'Session not found' }
      if (session._count.bookings >= session.capacity) return { error: 'Class is full — consider assigning from waitlist' }

      const existing = await prisma.booking.findFirst({
        where: { memberId, sessionId, status: { in: ['CONFIRMED', 'LATE_CANCELLED'] } },
      })
      if (existing?.status === 'CONFIRMED') return { error: 'Member is already booked into this class' }

      await prisma.$transaction(async (tx) => {
        if (existing?.status === 'LATE_CANCELLED') {
          await tx.booking.update({ where: { id: existing.id }, data: { status: 'CONFIRMED' } })
        } else {
          await tx.booking.create({ data: { memberId, sessionId, status: 'CONFIRMED' } })
        }
        // Privileged booking — still deducts credits if required
        if (session.creditsRequired > 0 && (member.creditBalance?.balance ?? 0) >= session.creditsRequired) {
          await tx.creditBalance.update({
            where: { memberId },
            data: { balance: { decrement: session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: { memberId, amount: -session.creditsRequired, type: 'CLASS_DEBIT', note: 'Booked by staff via assistant' },
          })
        }
      })
      return { success: true, message: 'Member booked successfully.' }
    }

    case 'cancel_booking_for_member': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { bookingId } = input as { bookingId: string }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { session: true },
      })
      if (!booking) return { error: 'Booking not found' }
      if (booking.status !== 'CONFIRMED') return { error: 'Booking is not confirmed' }

      const memberId = booking.memberId
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', stationId: null } })
        if (booking.session.creditsRequired > 0) {
          await tx.creditBalance.update({
            where: { memberId },
            data: { balance: { increment: booking.session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: { memberId, amount: booking.session.creditsRequired, type: 'REFUND', note: 'Cancelled by staff via assistant' },
          })
        }
      })
      return { success: true, message: 'Booking cancelled and credits refunded.' }
    }

    case 'get_session_spots': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { sessionId } = input as { sessionId: string }
      const session = await prisma.classSession.findUnique({
        where: { id: sessionId },
        include: {
          room: true,
          layout: { include: { stations: true } },
          bookings: {
            where: { status: 'CONFIRMED' },
            include: {
              member: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      })
      if (!session) return { error: 'Session not found' }

      // Fall back to room's active layout if no session-level snapshot
      const layout = session.layout ?? await prisma.roomLayout.findFirst({
        where: { roomId: session.roomId, isActive: true },
        include: { stations: true },
      })

      const assignments = session.bookings.map(b => ({
        bookingId: b.id,
        memberName: `${b.member.user.firstName} ${b.member.user.lastName}`,
        stationId: b.stationId ?? null,
        checkedIn: b.checkedIn,
      }))

      const stations = (layout?.stations ?? []).map(s => ({
        stationId: s.id,   // pass this exact value to assign_spot
        label: s.label,
        // Short alias shown in the live UI (e.g. "Treadmill 1" → "T1", "Bench 2" → "B2")
        alias: (() => {
          const parts = s.label.trim().split(/\s+/)
          const letter = parts[0]?.[0]?.toUpperCase() ?? ''
          const num = parts.findLast((p: string) => /^\d+$/.test(p)) ?? ''
          return letter + num
        })(),
        type: s.type,
        takenBy: assignments.find(a => a.stationId === s.id)?.memberName ?? null,
      }))

      return {
        stations,
        assignments,
        totalBooked: session.bookings.length,
        capacity: session.capacity,
      }
    }

    case 'assign_spot': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { sessionId, bookingId, stationId } = input as { sessionId: string; bookingId: string; stationId: string | null }

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
      if (!booking) return { error: 'Booking not found' }
      if (booking.sessionId !== sessionId) return { error: 'Booking does not belong to this session' }
      if (booking.status !== 'CONFIRMED') return { error: 'Booking is not confirmed' }

      if (stationId) {
        // Free any booking already in this spot
        await prisma.booking.updateMany({
          where: { sessionId, stationId, id: { not: bookingId } },
          data: { stationId: null },
        })
      }
      await prisma.booking.update({ where: { id: bookingId }, data: { stationId } })
      return { success: true, message: stationId ? `Spot assigned.` : 'Spot cleared.' }
    }

    case 'checkin_member': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { sessionId, bookingId } = input as { sessionId: string; bookingId: string }

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
      if (!booking) return { error: 'Booking not found' }
      if (booking.sessionId !== sessionId) return { error: 'Booking does not belong to this session' }

      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          checkedIn: !booking.checkedIn,
          checkedInAt: !booking.checkedIn ? new Date() : null,
        },
      })
      return {
        success: true,
        checkedIn: updated.checkedIn,
        message: updated.checkedIn ? 'Member checked in.' : 'Check-in removed.',
      }
    }

    case 'get_studio_stats': {
      if (rank < ROLE_RANK['studio_admin']) return { error: 'Insufficient permissions' }
      const { studioId } = input as { studioId: string }
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const [members, bookingsToday, activeSubs] = await Promise.all([
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({ where: { session: { studioId }, status: 'CONFIRMED', bookedAt: { gte: today } } }),
        prisma.membershipSubscription.count({ where: { plan: { studioId }, status: 'ACTIVE' } }),
      ])
      return { totalMembers: members, bookingsToday, activeSubscriptions: activeSubs }
    }

    case 'adjust_member_credits': {
      if (rank < ROLE_RANK['fronthost']) return { error: 'Insufficient permissions' }
      const { memberId, amount, reason } = input as { memberId: string; amount: number; reason: string }
      await prisma.$transaction(async (tx) => {
        await tx.creditBalance.upsert({
          where: { memberId },
          create: { memberId, balance: Math.max(0, amount) },
          update: { balance: { increment: amount } },
        })
        await tx.creditTransaction.create({
          data: { memberId, amount, type: 'MANUAL_ADJUSTMENT', note: reason },
        })
      })
      return { success: true, message: `Credits adjusted by ${amount > 0 ? '+' : ''}${amount}. Reason: ${reason}` }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function aiRoutes(app: FastifyInstance) {
  // 20 requests per minute per user — protects Anthropic API costs
  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const key = `ai:${(request as FastifyRequest & { user?: { id: string } }).user?.id ?? request.ip}`
    const now = Date.now()
    const windowMs = 60_000
    const limit = 20

    const store = (app as FastifyInstance & { _aiRateStore?: Map<string, number[]> })
    if (!store._aiRateStore) store._aiRateStore = new Map()
    const hits = (store._aiRateStore.get(key) ?? []).filter(t => now - t < windowMs)
    if (hits.length >= limit) {
      return reply.code(429).send({ error: 'Too many requests — please wait a moment before sending another message.' })
    }
    hits.push(now)
    store._aiRateStore.set(key, hits)
  })

  app.post<{
    Body: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      studioId: string
      studioName?: string
    }
  }>(
    '/chat',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const { messages, studioId, studioName } = request.body
      const rank = ROLE_RANK[user.role as keyof typeof ROLE_RANK] ?? 0

      // Resolve API key: studio's own key takes precedence over platform key
      const studio = await prisma.studio.findUnique({
        where: { id: studioId },
        select: { anthropicApiKey: true, aiEnabled: true },
      })

      if (studio && !studio.aiEnabled) {
        return reply.code(403).send({ error: 'AI assistant is disabled for this studio.' })
      }

      const apiKey = studio?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        return reply.code(503).send({ error: 'AI assistant is not configured. Add an Anthropic API key in Studio Settings → AI.' })
      }

      const anthropic = studio?.anthropicApiKey ? clientForKey(studio.anthropicApiKey) : platformClient()

      const tools: Anthropic.Tool[] = [
        ...MEMBER_TOOLS,
        ...(rank >= ROLE_RANK['fronthost'] ? STAFF_TOOLS : []),
        ...(rank >= ROLE_RANK['studio_admin'] ? ADMIN_TOOLS : []),
      ]

      const roleLabel =
        rank >= ROLE_RANK['studio_admin'] ? 'studio admin' :
        rank >= ROLE_RANK['fronthost'] ? 'front desk staff' :
        'member'

      const systemPrompt = `You are a helpful assistant for ${studioName ?? 'a boutique fitness studio'} powered by Packd. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

The user is a ${roleLabel}. Be friendly, concise, and action-oriented. Use tools to answer questions directly rather than explaining how to navigate the UI.

When showing times, format them clearly (e.g. "Monday at 9:00 AM"). Before cancelling a booking, confirm with the user: "Are you sure you want to cancel [class name]?" unless they already said so explicitly.

Studio ID: ${studioId}`

      // Keep last 20 messages to avoid hitting context limits on long conversations
      const trimmed = messages.slice(-20)
      const apiMessages: Anthropic.MessageParam[] = trimmed.map(m => ({
        role: m.role,
        content: m.content,
      }))

      // ── SSE streaming response ────────────────────────────────────────────
      reply.hijack()
      const raw = reply.raw
      raw.setHeader('Content-Type', 'text/event-stream')
      raw.setHeader('Cache-Control', 'no-cache')
      raw.setHeader('Connection', 'keep-alive')
      raw.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN?.split(',')[0] ?? '*')

      function send(event: Record<string, unknown>) {
        raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      // Tools that mutate booking/session state — frontend should refresh after these
      const MUTATING_TOOLS = new Set([
        'book_class', 'cancel_booking', 'checkin_member', 'assign_spot',
        'book_class_for_member', 'cancel_booking_for_member', 'adjust_member_credits',
        'join_waitlist', 'leave_waitlist',
      ])

      const TOOL_LABELS: Record<string, string> = {
        get_schedule: 'Checking schedule…',
        get_my_bookings: 'Looking up your bookings…',
        get_my_credits: 'Checking your credits…',
        book_class: 'Booking class…',
        cancel_booking: 'Cancelling booking…',
        join_waitlist: 'Joining waitlist…',
        leave_waitlist: 'Leaving waitlist…',
        find_member: 'Looking up member…',
        get_today_sessions: "Checking today's sessions…",
        get_session_bookings: 'Loading class roster…',
        get_session_spots: 'Loading room map…',
        book_class_for_member: 'Booking class for member…',
        cancel_booking_for_member: 'Cancelling booking…',
        assign_spot: 'Assigning spot…',
        checkin_member: 'Checking in member…',
        get_studio_stats: 'Loading studio stats…',
        adjust_member_credits: 'Adjusting credits…',
      }

      try {
        const MAX_ITERATIONS = 5
        let didMutate = false
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const stream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools,
            messages: apiMessages,
          })

          // Stream text deltas as they arrive
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta' &&
              chunk.delta.text
            ) {
              send({ type: 'delta', text: chunk.delta.text })
            }
          }

          const finalMsg = await stream.finalMessage()
          const hasToolUse = finalMsg.content.some(b => b.type === 'tool_use')

          if (finalMsg.stop_reason === 'end_turn' || !hasToolUse) break

          // Execute tools, notifying the client before each one
          apiMessages.push({ role: 'assistant', content: finalMsg.content })
          const toolResults: Anthropic.ToolResultBlockParam[] = []

          for (const block of finalMsg.content) {
            if (block.type !== 'tool_use') continue
            send({ type: 'tool', label: TOOL_LABELS[block.name] ?? 'Working…' })
            if (MUTATING_TOOLS.has(block.name)) didMutate = true
            const result = await executeTool(
              block.name,
              block.input as Record<string, unknown>,
              user.id,
              user.role,
            )
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          }

          apiMessages.push({ role: 'user', content: toolResults })
        }

        send({ type: 'done', refresh: didMutate })
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'Something went wrong' })
      } finally {
        raw.end()
      }
    },
  )
}
