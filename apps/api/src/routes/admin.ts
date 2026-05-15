import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

// Fix #3: role must come from app_metadata only (set server-side, not user-editable)
async function requireAdmin(
  request: Parameters<typeof requireAuth>[0],
  reply: Parameters<typeof requireAuth>[1],
) {
  await requireAuth(request, reply)
  const user = getUser(request)
  if (user.role !== 'admin') return reply.forbidden('Admin access required')
}

// Fix #4: allowlist of valid session statuses
const VALID_SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
type SessionStatus = typeof VALID_SESSION_STATUSES[number]

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/sessions?studioId=&date=
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { studioId, date } = request.query

      // Fix #14: require studioId to avoid full-table scans
      if (!studioId) return reply.badRequest('studioId is required')

      // Fix #9: verify the admin belongs to this studio
      const user = getUser(request)
      await assertStudioAccess(user.id, studioId, reply)

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

  // GET /admin/sessions/:id/bookings
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/bookings',
    { preHandler: requireAdmin },
    async (request, reply) => {
      // Fix #9: verify the session belongs to a studio this admin can access
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      await assertStudioAccess(user.id, session.studioId, reply)

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

  // POST /admin/sessions/:id/checkin/:bookingId — toggle check-in
  app.post<{ Params: { id: string; bookingId: string } }>(
    '/sessions/:id/checkin/:bookingId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      // Fix #9: verify session belongs to admin's studio
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      await assertStudioAccess(user.id, session.studioId, reply)

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.bookingId },
      })

      // Ensure booking belongs to this session
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

  // PATCH /admin/sessions/:id — update status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/sessions/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      // Fix #4: validate status against enum allowlist
      const { status } = request.body
      if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
        return reply.badRequest(`Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}`)
      }

      // Fix #9: verify studio access
      const user = getUser(request)
      const existing = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      await assertStudioAccess(user.id, existing.studioId, reply)

      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: status as SessionStatus },
      })
      return { success: true, status: session.status }
    },
  )

  // GET /admin/stats?studioId=
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { studioId } = request.query

      // Fix #14: require studioId
      if (!studioId) return reply.badRequest('studioId is required')

      // Fix #9: verify studio access
      const user = getUser(request)
      await assertStudioAccess(user.id, studioId, reply)

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

// Fix #9: shared studio access guard — checks that the user's Member record
// belongs to the requested studio. Throws forbidden if not.
async function assertStudioAccess(
  userId: string,
  studioId: string,
  reply: Parameters<typeof requireAdmin>[1],
) {
  const member = await prisma.member.findUnique({ where: { userId } })
  if (!member || member.studioId !== studioId) {
    return reply.forbidden('Access denied to this studio')
  }
}
