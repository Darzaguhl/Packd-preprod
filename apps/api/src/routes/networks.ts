import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, getUser, requireRole } from '../lib/auth.js'
import { Id } from '../schemas.js'

export async function networkRoutes(app: FastifyInstance) {
  // GET /networks — list all networks (franchise_admin+)
  app.get('/', { preHandler: requireRole('franchise_admin') }, async (_request, reply) => {
    const networks = await prisma.studioNetwork.findMany({
      include: {
        studios: {
          include: { studio: { select: { id: true, name: true, slug: true, timezone: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })
    return reply.send(networks)
  })

  // POST /networks — create network (franchise_admin+)
  app.post<{ Body: { name: string; slug: string } }>(
    '/',
    {
      preHandler: requireRole('franchise_admin'),
      schema: {
        body: z.object({
          name: z.string().min(1),
          slug: z.string().min(1),
          franchiseId: z.string().min(1).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { name, slug } = request.body
      if (!name || !slug) return reply.badRequest('name and slug are required')
      const network = await prisma.studioNetwork.create({ data: { name, slug } })
      return reply.code(201).send(network)
    },
  )

  // PATCH /networks/:id — update network (franchise_admin+)
  app.patch<{ Params: { id: string }; Body: { name?: string; slug?: string } }>(
    '/:id',
    {
      preHandler: requireRole('franchise_admin'),
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          name: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { name, slug } = request.body
      const network = await prisma.studioNetwork.update({
        where: { id },
        data: { ...(name ? { name } : {}), ...(slug ? { slug } : {}) },
      })
      return reply.send(network)
    },
  )

  // DELETE /networks/:id — delete network (franchise_admin+)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { params: z.object({ id: Id }) },
    },
    async (request, reply) => {
      await prisma.studioNetwork.delete({ where: { id: request.params.id } })
      return reply.send({ success: true })
    },
  )

  // POST /networks/:id/studios — add studio to network (franchise_admin+)
  app.post<{ Params: { id: string }; Body: { studioId: string } }>(
    '/:id/studios',
    {
      preHandler: requireRole('franchise_admin'),
      schema: {
        params: z.object({ id: Id }),
        body: z.object({ studioId: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const { id: networkId } = request.params
      const { studioId } = request.body
      if (!studioId) return reply.badRequest('studioId is required')
      const membership = await prisma.studioNetworkMembership.create({
        data: { networkId, studioId },
        include: { studio: { select: { id: true, name: true, slug: true } } },
      })
      return reply.code(201).send(membership)
    },
  )

  // DELETE /networks/:id/studios/:studioId — remove studio from network (franchise_admin+)
  app.delete<{ Params: { id: string; studioId: string } }>(
    '/:id/studios/:studioId',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { params: z.object({ id: Id, studioId: Id }) },
    },
    async (request, reply) => {
      const { id: networkId, studioId } = request.params
      await prisma.studioNetworkMembership.delete({
        where: { networkId_studioId: { networkId, studioId } },
      })
      return reply.send({ success: true })
    },
  )

  // GET /networks/my — return the network (if any) for the current member's home studio
  app.get('/my', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({
      where: { userId: user.id },
      select: { studioId: true },
    })
    if (!member) return reply.send({ network: null, studios: [] })

    const membership = await prisma.studioNetworkMembership.findFirst({
      where: { studioId: member.studioId },
      include: {
        network: {
          include: {
            studios: {
              include: { studio: { select: { id: true, name: true, slug: true, timezone: true } } },
            },
          },
        },
      },
    })

    if (!membership) return reply.send({ network: null, studios: [] })

    const siblings = membership.network.studios
      .filter(m => m.studioId !== member.studioId)
      .map(m => m.studio)

    return reply.send({
      network: { id: membership.network.id, name: membership.network.name, slug: membership.network.slug },
      homeStudioId: member.studioId,
      studios: [
        ...membership.network.studios
          .sort((a, b) => (a.studioId === member.studioId ? -1 : b.studioId === member.studioId ? 1 : 0))
          .map(m => ({ ...m.studio, isHome: m.studioId === member.studioId })),
      ],
    })
  })
}
