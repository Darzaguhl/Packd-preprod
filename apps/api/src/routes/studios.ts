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
