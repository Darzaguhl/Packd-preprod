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
  // GET /admin/sessions?studioId=&date=
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, date } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      await assertStudioAccess(user.id, user.role, studioId, reply)

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
      await assertStudioAccess(user.id, user.role, session.studioId, reply)

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
      await assertStudioAccess(user.id, user.role, session.studioId, reply)

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
      await assertStudioAccess(user.id, user.role, existing.studioId, reply)

      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: status as SessionStatus },
      })
      return { success: true, status: session.status }
    },
  )

  // GET /admin/stats?studioId= — studio_admin or higher
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      await assertStudioAccess(user.id, user.role, studioId, reply)

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.classSession.count({ where: { studioId, startsAt: { gte: today, lt: tomorrow } } }),
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({
          where: { session: { studioId }, bookedAt: { gte: today }, status: 'CONFIRMED' },
        }),
        prisma.waitlistEntry.count({
          where: { session: { studioId }, joinedAt: { gte: today }, status: 'WAITING' },
        }),
      ])

      return { todaySessions, totalMembers, totalBookingsToday, waitlistToday }
    },
  )
}

/**
 * admin/franchise_admin: unrestricted.
 * studio_admin/instructor: must have a Member record for this studio.
 */
async function assertStudioAccess(
  userId: string,
  role: UserRole,
  studioId: string,
  reply: FastifyReply,
) {
  if (ROLE_RANK[role] >= ROLE_RANK['franchise_admin']) return
  const member = await prisma.member.findUnique({ where: { userId } })
  if (!member || member.studioId !== studioId) {
    return reply.forbidden('Access denied to this studio')
  }
}
