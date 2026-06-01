import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { tryAuth, getUser } from '../lib/auth.js'

export async function scheduleRoutes(app: FastifyInstance) {
  // GET /schedule/brand-studios?studioId=X — public, returns brand hierarchy for filter UI
  app.get<{ Querystring: { studioId: string } }>(
    '/brand-studios',
    {
      schema: {
        querystring: z.object({ studioId: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const studioInfo = (id: { id: string; name: string; locations: { city: string; country: string }[] }) => ({
        id: id.id,
        name: id.name,
        city: id.locations[0]?.city ?? '',
        country: id.locations[0]?.country ?? '',
      })

      const brandStudio = await prisma.brandStudio.findFirst({
        where: { studioId },
        include: { brand: true },
      })
      const brand = brandStudio?.brand

      if (!brand) {
        const studio = await prisma.studio.findUnique({
          where: { id: studioId },
          include: { locations: { take: 1 } },
        })
        return reply.send({
          brandId: null, brandName: null,
          franchises: [],
          standalone: studio ? [studioInfo(studio)] : [],
        })
      }

      const [allBrandStudios, allFranchises] = await Promise.all([
        prisma.brandStudio.findMany({
          where: { brandId: brand.id },
          include: { studio: { include: { locations: { take: 1 } } } },
        }),
        prisma.franchise.findMany({
          where: { brandId: brand.id },
          include: { studios: { include: { studio: { include: { locations: { take: 1 } } } } } },
        }),
      ])

      const inFranchise = new Set(allFranchises.flatMap(f => f.studios.map(s => s.studioId)))

      return reply.send({
        brandId: brand.id,
        brandName: brand.name,
        franchises: allFranchises.map(f => ({
          id: f.id,
          name: f.name,
          studios: f.studios.map(s => studioInfo(s.studio)),
        })),
        standalone: allBrandStudios
          .filter(bs => !inFranchise.has(bs.studioId))
          .map(bs => studioInfo(bs.studio)),
      })
    },
  )

  // GET /schedule/:studioId?from=&to= — optional auth; public browsing allowed
  app.get<{ Params: { studioId: string }; Querystring: { from: string; to: string } }>(
    '/:studioId',
    {
      preHandler: tryAuth,
      schema: {
        params: z.object({ studioId: z.string().min(1) }),
        querystring: z.object({
          from: z.string().min(1),
          to: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const { studioId } = request.params
      const { from, to } = request.query
      const user = request.user ? getUser(request) : null

      // Authenticated members: check studio access (own studio or same network)
      if (user?.role === 'member') {
        const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { studioId: true } })
        if (member && member.studioId !== studioId) {
          const [homeMembership, targetMembership] = await Promise.all([
            prisma.studioNetworkMembership.findFirst({ where: { studioId: member.studioId }, select: { networkId: true } }),
            prisma.studioNetworkMembership.findFirst({ where: { studioId }, select: { networkId: true } }),
          ])
          const sameNetwork = homeMembership && targetMembership && homeMembership.networkId === targetMembership.networkId
          if (!sameNetwork) return reply.forbidden('Access denied to this studio')
        }
      }

      const [studio, cancelPolicy, sessions] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { name: true, timeFormat: true, timezone: true } }),
        prisma.cancellationPolicy.findUnique({ where: { studioId }, select: { lateCancelWindowHours: true, lateCancelFeeCredits: true } }),
        prisma.classSession.findMany({
          where: {
            studioId,
            startsAt: { gte: new Date(from), lte: new Date(to) },
            status: { not: 'CANCELLED' },
            isPrivate: false, // public schedule never shows private sessions
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

      const userBookings = user?.role === 'member'
        ? await prisma.booking.findMany({
            where: { session: { studioId }, member: { userId: user.id }, status: 'CONFIRMED' },
            select: { sessionId: true, id: true, stationId: true },
          })
        : []

      const userWaitlistEntries = user?.role === 'member'
        ? await prisma.waitlistEntry.findMany({
            where: { session: { studioId }, member: { userId: user.id }, status: 'WAITING' },
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

      type UserBooking = typeof userBookings[number]
      const bookingMap = new Map<string, UserBooking>(userBookings.map(b => [b.sessionId, b] as [string, UserBooking]))

      return reply.send({
        studioId,
        studioName: studio?.name ?? '',
        timeFormat: studio?.timeFormat ?? '24h',
        timezone: studio?.timezone ?? 'UTC',
        lateCancelWindowHours: cancelPolicy?.lateCancelWindowHours ?? 12,
        lateCancelFeeCredits: cancelPolicy?.lateCancelFeeCredits ?? 1,
        sessions: sessions.map(s => {
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
            studioId,
            studioName: studio?.name ?? '',
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
