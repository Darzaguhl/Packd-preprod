import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

export async function studioRoutes(app: FastifyInstance) {
  // GET /studios/:slug — public studio info
  app.get<{ Params: { slug: string } }>('/:slug', async (request, reply) => {
    const studio = await prisma.studio.findUnique({
      where: { slug: request.params.slug },
      include: { locations: true },
    })
    if (!studio) return reply.notFound()
    return studio
  })

  // POST /studios — create studio (admin only, onboarding)
  app.post<{ Body: { name: string; slug: string; timezone: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { name, slug, timezone } = request.body
      const studio = await prisma.studio.create({
        data: {
          name,
          slug,
          timezone,
          cancellationPolicy: { create: {} },
        },
      })
      return reply.code(201).send({ success: true, data: studio })
    },
  )

  // POST /studios/onboard — full studio setup in one transaction
  app.post<{
    Body: {
      name: string
      slug: string
      timezone: string
      currency: string
      policy: { lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number }
      location: { name: string; address: string; city: string; country: string }
      rooms: { name: string; capacity: number; sport: string }[]
    }
  }>(
    '/onboard',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { name, slug, timezone, currency, policy, location, rooms } = request.body

      const studio = await prisma.$transaction(async (tx) => {
        const s = await tx.studio.create({
          data: {
            name, slug, timezone, currency,
            cancellationPolicy: { create: policy },
          },
        })

        const loc = await tx.location.create({
          data: {
            studioId: s.id,
            name: location.name,
            address: location.address,
            city: location.city,
            country: location.country,
            timezone,
          },
        })

        await Promise.all(
          rooms.map((room) =>
            tx.room.create({
              data: { locationId: loc.id, name: room.name, capacity: room.capacity },
            }),
          ),
        )

        return s
      })

      return reply.code(201).send({ success: true, data: { id: studio.id } })
    },
  )

  // GET /studios/:studioId/membership-plans
  app.get<{ Params: { studioId: string } }>(
    '/:studioId/membership-plans',
    async (request, reply) => {
      const plans = await prisma.membershipPlan.findMany({
        where: { studioId: request.params.studioId },
      })
      return plans
    },
  )
}
