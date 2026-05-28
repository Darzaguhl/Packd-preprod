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
      const user = getUser(request)

      // Tenant isolation: members can only view their own studio's schedule, OR
      // any studio that belongs to the same StudioNetwork as their home studio.
      // Elevated roles (instructor+) can view any studio.
      if (user.role === 'member') {
        const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { studioId: true } })
        if (!member) return reply.forbidden('Access denied to this studio')

        if (member.studioId !== studioId) {
          // Check if both studios are in the same network
          const [homeMembership, targetMembership] = await Promise.all([
            prisma.studioNetworkMembership.findFirst({ where: { studioId: member.studioId }, select: { networkId: true } }),
            prisma.studioNetworkMembership.findFirst({ where: { studioId }, select: { networkId: true } }),
          ])
          const sameNetwork =
            homeMembership && targetMembership && homeMembership.networkId === targetMembership.networkId
          if (!sameNetwork) return reply.forbidden('Access denied to this studio')
        }
      }

      const [studioSettings, cancelPolicy, sessions] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { timeFormat: true, timezone: true } }),
        prisma.cancellationPolicy.findUnique({ where: { studioId }, select: { lateCancelWindowHours: true, lateCancelFeeCredits: true } }),
        prisma.classSession.findMany({
          where: {
            studioId,
            startsAt: { gte: new Date(from), lte: new Date(to) },
            status: { not: 'CANCELLED' },
          },
          include: {
            template: true,
            instructor: { include: { user: true } },
            room: { include: { location: true } },
            _count: { select: { bookings: { where: { status: 'CONFIRMED' } }, waitlist: true } },
          },
          orderBy: { startsAt: 'asc' },
        }),
      ])

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

      // Waitlist position: for each session the member is waiting on,
      // count entries with an earlier joinedAt to get their 1-indexed position.
      const userWaitlistEntries =
        user.role === 'member'
          ? await prisma.waitlistEntry.findMany({
              where: {
                session: { studioId },
                member: { userId: user.id },
                status: 'WAITING',
              },
              select: { sessionId: true, joinedAt: true },
            })
          : []

      const waitlistPositionMap = new Map<string, number>()
      for (const entry of userWaitlistEntries) {
        const ahead = await prisma.waitlistEntry.count({
          where: { sessionId: entry.sessionId, status: 'WAITING', joinedAt: { lt: entry.joinedAt } },
        })
        waitlistPositionMap.set(entry.sessionId, ahead + 1)
      }

      const bookingMap = new Map(userBookings.map((b) => [b.sessionId, b]))

      return reply.send({
        timeFormat: studioSettings?.timeFormat ?? '24h',
        timezone: studioSettings?.timezone ?? 'UTC',
        lateCancelWindowHours: cancelPolicy?.lateCancelWindowHours ?? 12,
        lateCancelFeeCredits: cancelPolicy?.lateCancelFeeCredits ?? 1,
        sessions: sessions.map((s) => {
          const userBooking = bookingMap.get(s.id)
          return {
            id: s.id,
            templateName: s.template.name,
            sport: s.template.sport,
            instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
            roomId: s.roomId,
            roomName: s.room.name,
            locationId: s.room.location.id,
            locationName: s.room.location.name,
            startsAt: s.startsAt.toISOString(),
            endsAt: s.endsAt.toISOString(),
            capacity: s.capacity,
            bookedCount: s._count.bookings,
            waitlistCount: s._count.waitlist,
            status: s.status,
            creditsRequired: s.creditsRequired,
            userBookingId: userBooking?.id,
            userStationId: userBooking?.stationId ?? null,
            userWaitlistPosition: waitlistPositionMap.get(s.id) ?? null,
          }
        }),
      })
    },
  )
}
