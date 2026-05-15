import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

async function requireAdmin(request: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1]) {
  await requireAuth(request, reply)
  const user = getUser(request)
  if (user.role !== 'admin') return reply.forbidden('Admin access required')
}

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/sessions?studioId=&date=
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireAdmin },
    async (request) => {
      const { studioId, date } = request.query
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
    async (request) => {
      const bookings = await prisma.booking.findMany({
        where: { sessionId: request.params.id, status: 'CONFIRMED' },
        include: {
          member: {
            include: {
              user: true,
              creditBalance: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      return bookings.map((b) => ({
        id: b.id,
        memberId: b.memberId,
        memberName: `${b.member.user.firstName} ${b.member.user.lastName}`,
        memberEmail: b.member.user.email,
        checkedIn: b.checkedIn,
        checkedInAt: b.checkedInAt?.toISOString() ?? null,
        creditBalance: b.member.creditBalance?.balance ?? 0,
        bookedAt: b.createdAt.toISOString(),
      }))
    },
  )

  // POST /admin/sessions/:id/checkin/:bookingId — toggle check-in
  app.post<{ Params: { id: string; bookingId: string } }>(
    '/sessions/:id/checkin/:bookingId',
    { preHandler: requireAdmin },
    async (request) => {
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.bookingId },
      })
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

  // PATCH /admin/sessions/:id — update status (cancel, complete, etc.)
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/sessions/:id',
    { preHandler: requireAdmin },
    async (request) => {
      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: request.body.status as never },
      })
      return { success: true, status: session.status }
    },
  )

  // GET /admin/stats?studioId=
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireAdmin },
    async (request) => {
      const { studioId } = request.query
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.classSession.count({ where: { studioId, startsAt: { gte: today, lt: tomorrow } } }),
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({
          where: { session: { studioId }, createdAt: { gte: today }, status: 'CONFIRMED' },
        }),
        prisma.waitlistEntry.count({
          where: { session: { studioId }, createdAt: { gte: today }, status: 'WAITING' },
        }),
      ])

      return { todaySessions, totalMembers, totalBookingsToday, waitlistToday }
    },
  )
}
