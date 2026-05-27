import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { assertStudioAccess } from './franchise.js'

type ScheduleDefaults = {
  defaultInstructorId?: string | null
  defaultRoomId?: string | null
  defaultCapacity?: number | null
  defaultCreditsRequired?: number | null
  defaultStartTime?: string | null
  defaultStartTime2?: string | null
  defaultDaysOfWeek?: number[]
  defaultIntervalWeeks?: number
}

export async function templateRoutes(app: FastifyInstance) {

  // GET /templates?studioId= — list class templates for a studio (instructor+)
  app.get<{ Querystring: { studioId: string } }>(
    '/',
    { preHandler: requireRole('instructor') },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const templates = await prisma.classTemplate.findMany({
        where: { studioId },
        orderBy: { name: 'asc' },
      })
      return reply.send(templates)
    },
  )

  // POST /templates — create a class template (studio_admin+)
  app.post<{
    Body: {
      studioId: string
      name: string
      sport: string
      durationMin: number
      description?: string
      color?: string
    } & ScheduleDefaults
  }>(
    '/',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const {
        studioId, name, sport, durationMin, description, color,
        defaultInstructorId, defaultRoomId, defaultCapacity, defaultCreditsRequired,
        defaultStartTime, defaultStartTime2, defaultDaysOfWeek, defaultIntervalWeeks,
      } = request.body
      if (!studioId || !name || !sport || !durationMin) return reply.badRequest('studioId, name, sport and durationMin are required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const template = await prisma.classTemplate.create({
        data: {
          studioId, name, sport: sport as any, durationMin,
          description, color: color ?? '#6366f1',
          defaultInstructorId: defaultInstructorId ?? null,
          defaultRoomId: defaultRoomId ?? null,
          defaultCapacity: defaultCapacity ?? null,
          defaultCreditsRequired: defaultCreditsRequired ?? null,
          defaultStartTime: defaultStartTime ?? null,
          defaultStartTime2: defaultStartTime2 ?? null,
          defaultDaysOfWeek: defaultDaysOfWeek ?? [],
          defaultIntervalWeeks: defaultIntervalWeeks ?? 1,
        },
      })
      return reply.code(201).send(template)
    },
  )

  // PATCH /templates/:id — update a class template (studio_admin+)
  app.patch<{
    Params: { id: string }
    Body: {
      name?: string; sport?: string; durationMin?: number; description?: string; color?: string
    } & ScheduleDefaults
  }>(
    '/:id',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { id } = request.params
      const {
        name, sport, durationMin, description, color,
        defaultInstructorId, defaultRoomId, defaultCapacity, defaultCreditsRequired,
        defaultStartTime, defaultStartTime2, defaultDaysOfWeek, defaultIntervalWeeks,
      } = request.body
      const user = getUser(request)

      const existing = await prisma.classTemplate.findUnique({ where: { id } })
      if (!existing) return reply.notFound()
      if (!await assertStudioAccess(user.id, user.role, existing.studioId, reply)) return

      const updated = await prisma.classTemplate.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(sport !== undefined && { sport: sport as any }),
          ...(durationMin !== undefined && { durationMin }),
          ...(description !== undefined && { description }),
          ...(color !== undefined && { color }),
          ...(defaultInstructorId !== undefined && { defaultInstructorId }),
          ...(defaultRoomId !== undefined && { defaultRoomId }),
          ...(defaultCapacity !== undefined && { defaultCapacity }),
          ...(defaultCreditsRequired !== undefined && { defaultCreditsRequired }),
          ...(defaultStartTime !== undefined && { defaultStartTime }),
          ...(defaultStartTime2 !== undefined && { defaultStartTime2 }),
          ...(defaultDaysOfWeek !== undefined && { defaultDaysOfWeek }),
          ...(defaultIntervalWeeks !== undefined && { defaultIntervalWeeks }),
        },
      })
      return reply.send(updated)
    },
  )

  // DELETE /templates/:id — delete a class template (studio_admin+)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { id } = request.params
      const user = getUser(request)

      const existing = await prisma.classTemplate.findUnique({ where: { id } })
      if (!existing) return reply.notFound()
      if (!await assertStudioAccess(user.id, user.role, existing.studioId, reply)) return

      await prisma.classTemplate.delete({ where: { id } })
      return reply.send({ success: true })
    },
  )
}
