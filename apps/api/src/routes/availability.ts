import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { Id } from '../schemas.js'
import { AvailabilityBlockSchema } from '../schemas/responses.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const requireStudioAdmin = { preHandler: requireAuth }

/** Returns true if the caller is studio_admin+ */
function isManager(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['studio_admin']
}

/** Assert caller can act on this block: either studio_admin+ or the instructor themselves */
async function canManageBlock(
  callerId: string,
  callerRole: string,
  instructorId: string,
): Promise<boolean> {
  if (isManager(callerRole)) return true
  const instr = await prisma.instructor.findUnique({ where: { id: instructorId }, select: { userId: true } })
  return instr?.userId === callerId
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function availabilityRoutes(app: FastifyInstance) {

  // GET /availability?studioId=&from=&to=
  // List all availability blocks for a studio in a date range.
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/',
    {
      ...requireStudioAdmin,
      schema: {
        querystring: z.object({
          studioId: z.string().min(1),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
        response: { 200: z.array(AvailabilityBlockSchema) },
      },
    },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!isManager(user.role)) return reply.forbidden()

      const where: Record<string, unknown> = { studioId }
      if (from || to) {
        where.startDate = {}
        if (from) (where.startDate as Record<string, unknown>).gte = new Date(from)
        if (to)   (where.startDate as Record<string, unknown>).lte = new Date(to)
      }

      const blocks = await prisma.instructorAvailabilityBlock.findMany({
        where,
        include: { instructor: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { startDate: 'asc' },
      })

      return reply.send(blocks.map(b => ({
        id: b.id,
        instructorId: b.instructorId,
        instructorName: `${b.instructor.user.firstName} ${b.instructor.user.lastName}`,
        studioId: b.studioId,
        title: b.title,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
        createdAt: b.createdAt.toISOString(),
      })))
    },
  )

  // GET /availability/instructor/:instructorId?from=&to=
  // Blocks for a single instructor (manager or owner).
  app.get<{ Params: { instructorId: string }; Querystring: { from?: string; to?: string } }>(
    '/instructor/:instructorId',
    {
      ...requireStudioAdmin,
      schema: {
        params: z.object({ instructorId: Id }),
        querystring: z.object({
          from: z.string().optional(),
          to: z.string().optional(),
        }),
        response: { 200: z.array(AvailabilityBlockSchema) },
      },
    },
    async (request, reply) => {
      const { instructorId } = request.params
      const { from, to } = request.query
      const user = getUser(request)

      if (!await canManageBlock(user.id, user.role, instructorId)) return reply.forbidden()

      const where: Record<string, unknown> = { instructorId }
      if (from || to) {
        where.startDate = {}
        if (from) (where.startDate as Record<string, unknown>).gte = new Date(from)
        if (to)   (where.startDate as Record<string, unknown>).lte = new Date(to)
      }

      const blocks = await prisma.instructorAvailabilityBlock.findMany({
        where,
        orderBy: { startDate: 'asc' },
      })

      return reply.send(blocks.map(b => ({
        id: b.id,
        instructorId: b.instructorId,
        studioId: b.studioId,
        title: b.title,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
        createdAt: b.createdAt.toISOString(),
      })))
    },
  )

  // POST /availability — create a block
  app.post<{
    Body: { instructorId: string; studioId: string; title: string; startDate: string; endDate: string }
  }>(
    '/',
    {
      ...requireStudioAdmin,
      schema: {
        body: z.object({
          instructorId: z.string().min(1),
          studioId: z.string().min(1),
          title: z.string().min(1),
          startDate: z.string().min(1),
          endDate: z.string().min(1),
          note: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { instructorId, studioId, title, startDate, endDate } = request.body
      const user = getUser(request)

      if (!instructorId || !studioId || !title || !startDate || !endDate) {
        return reply.badRequest('instructorId, studioId, title, startDate and endDate are required')
      }
      if (new Date(startDate) >= new Date(endDate)) {
        return reply.badRequest('startDate must be before endDate')
      }
      if (!await canManageBlock(user.id, user.role, instructorId)) return reply.forbidden()

      const block = await prisma.instructorAvailabilityBlock.create({
        data: { instructorId, studioId, title, startDate: new Date(startDate), endDate: new Date(endDate) },
      })

      return reply.code(201).send({
        id: block.id,
        instructorId: block.instructorId,
        studioId: block.studioId,
        title: block.title,
        startDate: block.startDate.toISOString(),
        endDate: block.endDate.toISOString(),
        createdAt: block.createdAt.toISOString(),
      })
    },
  )

  // PATCH /availability/:id — update
  app.patch<{
    Params: { id: string }
    Body: { title?: string; startDate?: string; endDate?: string }
  }>(
    '/:id',
    {
      ...requireStudioAdmin,
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          title: z.string().min(1).optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { title, startDate, endDate } = request.body
      const user = getUser(request)

      const block = await prisma.instructorAvailabilityBlock.findUnique({ where: { id } })
      if (!block) return reply.notFound()
      if (!await canManageBlock(user.id, user.role, block.instructorId)) return reply.forbidden()

      const updated = await prisma.instructorAvailabilityBlock.update({
        where: { id },
        data: {
          ...(title     !== undefined && { title }),
          ...(startDate !== undefined && { startDate: new Date(startDate) }),
          ...(endDate   !== undefined && { endDate:   new Date(endDate) }),
        },
      })

      return reply.send({
        id: updated.id,
        instructorId: updated.instructorId,
        studioId: updated.studioId,
        title: updated.title,
        startDate: updated.startDate.toISOString(),
        endDate: updated.endDate.toISOString(),
      })
    },
  )

  // DELETE /availability/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      ...requireStudioAdmin,
      schema: { params: z.object({ id: Id }) },
    },
    async (request, reply) => {
      const { id } = request.params
      const user = getUser(request)

      const block = await prisma.instructorAvailabilityBlock.findUnique({ where: { id } })
      if (!block) return reply.notFound()
      if (!await canManageBlock(user.id, user.role, block.instructorId)) return reply.forbidden()

      await prisma.instructorAvailabilityBlock.delete({ where: { id } })
      return reply.send({ success: true })
    },
  )
}
