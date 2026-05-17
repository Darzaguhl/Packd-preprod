import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK, type UserRole } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor = requireRole('instructor')

// Allowlist of valid session statuses
const VALID_SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
type SessionStatus = typeof VALID_SESSION_STATUSES[number]

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/sessions?studioId=&date= — instructor/fronthost or higher
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, date } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const day = date ? new Date(date) : new Date()
      const from = new Date(day)
      from.setHours(0, 0, 0, 0)
      const to = new Date(day)
      to.setHours(23, 59, 59, 999)

      const sessions = await prisma.classSession.findMany({
        where: { studioId, startsAt: { gte: from, lte: to } },
        include: {
          template: true,
          instructor: { include: { user: true } },
          room: true,
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
        },
        orderBy: { startsAt: 'asc' },
      })

      return sessions.map((s) => ({
        id: s.id,
        templateName: s.template.name,
        sport: s.template.sport,
        instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
        instructorUserId: s.instructor.userId,
        roomId: s.roomId,
        roomName: s.room.name,
        capacity: s.capacity,
        bookedCount: s._count.bookings,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        creditsRequired: s.creditsRequired,
      }))
    },
  )

  // GET /admin/sessions/:id/bookings — instructor or higher
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/bookings',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: { sessionId: request.params.id, status: 'CONFIRMED' },
        include: {
          member: { include: { user: true, creditBalance: true } },
        },
        orderBy: { bookedAt: 'asc' },
      })

      return bookings.map((b) => ({
        id: b.id,
        memberId: b.memberId,
        memberName: `${b.member.user.firstName} ${b.member.user.lastName}`,
        memberEmail: b.member.user.email,
        checkedIn: b.checkedIn,
        checkedInAt: b.checkedInAt?.toISOString() ?? null,
        creditBalance: b.member.creditBalance?.balance ?? 0,
        bookedAt: b.bookedAt.toISOString(),
      }))
    },
  )

  // POST /admin/sessions/:id/checkin/:bookingId — instructor or higher
  app.post<{ Params: { id: string; bookingId: string } }>(
    '/sessions/:id/checkin/:bookingId',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.bookingId },
      })

      if (booking.sessionId !== request.params.id) return reply.notFound()

      const updated = await prisma.booking.update({
        where: { id: request.params.bookingId },
        data: {
          checkedIn: !booking.checkedIn,
          checkedInAt: !booking.checkedIn ? new Date() : null,
        },
      })
      return { success: true, checkedIn: updated.checkedIn }
    },
  )

  // PATCH /admin/sessions/:id — studio_admin or higher
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/sessions/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { status } = request.body
      if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
        return reply.badRequest(`Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}`)
      }

      const user = getUser(request)
      const existing = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, existing.studioId, reply, user.studioIds)) return

      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: status as SessionStatus },
      })
      return { success: true, status: session.status }
    },
  )

  // GET /admin/stats?studioId= — instructor/fronthost or higher
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [studio, todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
        prisma.classSession.count({ where: { studioId, startsAt: { gte: today, lt: tomorrow } } }),
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({
          where: { session: { studioId }, bookedAt: { gte: today }, status: 'CONFIRMED' },
        }),
        prisma.waitlistEntry.count({
          where: { session: { studioId }, joinedAt: { gte: today }, status: 'WAITING' },
        }),
      ])

      return { studioName: studio?.name ?? null, todaySessions, totalMembers, totalBookingsToday, waitlistToday }
    },
  )

  // GET /admin/members/search?studioId=&q= — search members by name or email
  app.get<{ Querystring: { studioId: string; q: string } }>(
    '/members/search',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!q || q.trim().length < 2) return reply.badRequest('q must be at least 2 characters')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const term = q.trim().toLowerCase()
      const members = await prisma.member.findMany({
        where: {
          studioId,
          OR: [
            { user: { firstName: { contains: term, mode: 'insensitive' } } },
            { user: { lastName: { contains: term, mode: 'insensitive' } } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
        take: 10,
      })

      return members.map(m => ({
        id: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        creditBalance: m.creditBalance?.balance ?? 0,
        membershipStatus: m.memberships[0]?.status ?? null,
      }))
    },
  )

  // POST /admin/members/:memberId/credits — manual credit adjustment (fronthost or higher)
  app.post<{ Params: { memberId: string }; Body: { amount: number; note?: string } }>(
    '/members/:memberId/credits',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { amount, note } = request.body

      if (!Number.isInteger(amount) || amount === 0) {
        return reply.badRequest('amount must be a non-zero integer')
      }

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { creditBalance: true },
      })
      if (!member) return reply.notFound('Member not found')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

      const [balance] = await prisma.$transaction([
        prisma.creditBalance.upsert({
          where: { memberId },
          create: { memberId, balance: Math.max(0, amount) },
          update: { balance: { increment: amount } },
        }),
        prisma.creditTransaction.create({
          data: {
            memberId,
            amount,
            type: 'MANUAL_ADJUSTMENT',
            note: note ?? 'Manual adjustment by staff',
          },
        }),
      ])

      return { success: true, newBalance: balance.balance }
    },
  )
}

/**
 * admin/franchise_admin: unrestricted.
 * staff (instructor/fronthost) with studioId in JWT app_metadata: checked against the JWT value (no DB roundtrip).
 * All others: must have a Member record for this studio.
 * Returns false and sends 403 if access is denied — callers must `return` on false.
 */
async function assertStudioAccess(
  userId: string,
  role: UserRole,
  studioId: string,
  reply: FastifyReply,
  jwtStudioIds?: string[],
): Promise<boolean> {
  if (ROLE_RANK[role] >= ROLE_RANK['franchise_admin']) return true
  // Staff carry all their assigned studio IDs in the JWT — no Member record needed
  if (jwtStudioIds && jwtStudioIds.length > 0) {
    if (jwtStudioIds.includes(studioId)) return true
    reply.forbidden('Access denied to this studio')
    return false
  }
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member || member.studioId !== studioId) {
    reply.forbidden('Access denied to this studio')
    return false
  }
  return true
}
