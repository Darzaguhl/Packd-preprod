import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

export async function scheduleRoutes(app: FastifyInstance) {
  // GET /schedule/:studioId?from=&to=
  app.get<{ Params: { studioId: string }; Querystring: { from: string; to: string } }>(
    '/:studioId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studioId } = request.params
      const { from, to } = request.query

      const sessions = await prisma.classSession.findMany({
        where: {
          studioId,
          startsAt: { gte: new Date(from), lte: new Date(to) },
          status: { not: 'CANCELLED' },
        },
        include: {
          template: true,
          instructor: { include: { user: true } },
          room: true,
          _count: { select: { bookings: true, waitlist: true } },
        },
        orderBy: { startsAt: 'asc' },
      })

      const user = getUser(request)

      const userBookings =
        user.role === 'member'
          ? await prisma.booking.findMany({
              where: {
                session: { studioId },
                member: { userId: user.id },
                status: 'CONFIRMED',
              },
              select: { sessionId: true, id: true, stationId: true },
            })
          : []

      const bookingMap = new Map(userBookings.map((b) => [b.sessionId, b]))

      return sessions.map((s) => {
        const userBooking = bookingMap.get(s.id)
        return {
          id: s.id,
          templateName: s.template.name,
          sport: s.template.sport,
          instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
          roomId: s.roomId,
          roomName: s.room.name,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          capacity: s.capacity,
          bookedCount: s._count.bookings,
          waitlistCount: s._count.waitlist,
          status: s.status,
          creditsRequired: s.creditsRequired,
          userBookingId: userBooking?.id,
          userStationId: userBooking?.stationId ?? null,
        }
      })
    },
  )
}
