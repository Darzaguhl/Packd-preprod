import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

export async function memberRoutes(app: FastifyInstance) {
  // GET /members/me
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)

    const member = await prisma.member.findUnique({
      where: { userId: user.id },
      include: {
        user: true,
        creditBalance: true,
        memberships: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
      },
    })

    if (!member) return reply.notFound('No member profile found for this user')

    return {
      id: member.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      email: member.user.email,
      creditBalance: member.creditBalance?.balance ?? 0,
      activeSubscription: member.memberships[0]
        ? {
            planName: member.memberships[0].plan.name,
            status: member.memberships[0].status,
            endDate: member.memberships[0].endDate?.toISOString(),
          }
        : undefined,
    }
  })

  // GET /members/me/bookings
  app.get('/me/bookings', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)

    const member = await prisma.member.findUnique({ where: { userId: user.id } })
    if (!member) return reply.notFound('No member profile found for this user')

    const bookings = await prisma.booking.findMany({
      where: {
        memberId: member.id,
        status: 'CONFIRMED',
        session: { startsAt: { gte: new Date() } },
      },
      include: {
        session: {
          include: {
            template: true,
            instructor: { include: { user: true } },
            room: { include: { location: true } },
          },
        },
      },
      orderBy: { session: { startsAt: 'asc' } },
    })

    return bookings.map((b) => ({
      id: b.id,
      sessionId: b.session.id,
      startsAt: b.session.startsAt.toISOString(),
      endsAt: b.session.endsAt.toISOString(),
      templateName: b.session.template.name,
      sport: b.session.template.sport,
      instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
      roomName: b.session.room.name,
      locationCity: b.session.room.location.city,
      creditsRequired: b.session.creditsRequired,
      sessionStatus: b.session.status,
      bookedAt: b.bookedAt.toISOString(),
    }))
  })
}
