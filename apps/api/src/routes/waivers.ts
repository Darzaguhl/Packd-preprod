import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { assertStudioAccess } from './admin-shared.js'
import { Id, StudioIdQuery } from '../schemas.js'

const requireStudioAdmin = requireRole('studio_admin')

export async function waiverRoutes(app: FastifyInstance) {
  // GET /waivers/active?studioId= — get the active waiver for a studio (any authenticated user)
  app.get<{ Querystring: { studioId: string } }>(
    '/active',
    {
      preHandler: requireAuth,
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const waiver = await prisma.waiver.findFirst({
        where: { studioId, isActive: true },
        select: { id: true, title: true, body: true, version: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      })
      if (!waiver) return reply.send({ waiver: null })
      return reply.send({ waiver })
    },
  )

  // POST /waivers/:id/sign — member signs a waiver
  app.post<{ Params: { id: string } }>(
    '/:id/sign',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          studioId: z.string().min(1).optional(),
          ipAddress: z.string().optional(),
        }).nullish(),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true } })
      if (!member) return reply.notFound('No member profile found')

      const waiver = await prisma.waiver.findUnique({ where: { id: request.params.id }, select: { id: true, isActive: true } })
      if (!waiver) return reply.notFound('Waiver not found')
      if (!waiver.isActive) return reply.badRequest('This waiver is no longer active')

      const ip = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
        ?? request.socket.remoteAddress

      await prisma.waiverSignature.upsert({
        where: { waiverId_memberId: { waiverId: waiver.id, memberId: member.id } },
        create: { waiverId: waiver.id, memberId: member.id, ipAddress: ip },
        update: { signedAt: new Date(), ipAddress: ip },
      })

      return reply.send({ success: true })
    },
  )

  // GET /waivers/admin?studioId= — get the active waiver for a studio (admin)
  app.get<{ Querystring: { studioId: string } }>(
    '/admin',
    {
      preHandler: requireStudioAdmin,
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const waiver = await prisma.waiver.findFirst({
        where: { studioId, isActive: true },
        select: { id: true, title: true, body: true, version: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send({ waiver: waiver ?? null })
    },
  )

  // PUT /waivers/admin — create or replace the active waiver for a studio
  // Deactivates any previous waiver and creates a new one.
  app.put<{ Body: { studioId: string; title: string; body: string } }>(
    '/admin',
    {
      preHandler: requireStudioAdmin,
      schema: {
        body: z.object({
          studioId: z.string().min(1),
          title: z.string().min(1),
          body: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, title, body } = request.body
      if (!studioId) return reply.badRequest('studioId is required')
      if (!title?.trim() || !body?.trim()) return reply.badRequest('title and body are required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const existing = await prisma.waiver.findFirst({
        where: { studioId, isActive: true },
        select: { id: true, version: true },
        orderBy: { createdAt: 'desc' },
      })

      const newVersion = (existing?.version ?? 0) + 1

      await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.waiver.update({ where: { id: existing.id }, data: { isActive: false } })
        }
        await tx.waiver.create({
          data: { studioId, title: title.trim(), body: body.trim(), isActive: true, version: newVersion },
        })
      })

      return reply.send({ success: true, version: newVersion })
    },
  )

  // DELETE /waivers/admin?studioId= — deactivate the active waiver (studio no longer requires one)
  app.delete<{ Querystring: { studioId: string } }>(
    '/admin',
    {
      preHandler: requireStudioAdmin,
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      await prisma.waiver.updateMany({ where: { studioId, isActive: true }, data: { isActive: false } })
      return reply.send({ success: true })
    },
  )
}
