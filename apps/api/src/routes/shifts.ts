import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { audit, AUDIT } from '../lib/audit.js'
import { ROLE_RANK } from '@packd/types'
import { Id, ISODateTime, StudioIdQuery } from '../schemas.js'
import { StaffShiftSchema } from '../schemas/responses.js'

function isAdmin(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['studio_admin']
}

function isFronthost(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['fronthost']
}

const shiftSelect = {
  id: true,
  memberId: true,
  studioId: true,
  startsAt: true,
  endsAt: true,
  note: true,
  patternId: true,
  createdAt: true,
  member: { select: { id: true, user: { select: { email: true } } } },
} as const

async function enrichShifts(shifts: Awaited<ReturnType<typeof prisma.staffShift.findMany<{ select: typeof shiftSelect }>>>) {
  const ids = [...new Set(shifts.map(s => s.memberId))]
  const members = await prisma.member.findMany({
    where: { id: { in: ids } },
    select: { id: true, user: { select: { email: true } } },
  })
  const nameMap: Record<string, string> = {}
  for (const m of members) nameMap[m.id] = m.user.email

  return shifts.map(s => ({
    id: s.id,
    memberId: s.memberId,
    memberName: nameMap[s.memberId] ?? s.memberId,
    studioId: s.studioId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    note: s.note ?? null,
    patternId: s.patternId ?? null,
    createdAt: s.createdAt.toISOString(),
  }))
}

export async function shiftsRoutes(app: FastifyInstance) {

  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/',
    {
      preHandler: requireAuth,
      config: { studioIdFrom: 'querystring' },
      schema: {
        querystring: StudioIdQuery.extend({
          memberId: z.string().min(1).optional(),
          from: ISODateTime.optional(),
          to: ISODateTime.optional(),
        }),
        response: { 200: z.array(StaffShiftSchema) },
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const shifts = await prisma.staffShift.findMany({
        where: {
          studioId,
          ...(from ? { startsAt: { gte: new Date(from) } } : {}),
          ...(to ? { endsAt: { lte: new Date(to) } } : {}),
        },
        orderBy: { startsAt: 'asc' },
        select: shiftSelect,
      })

      return reply.send(await enrichShifts(shifts))
    },
  )

  app.get<{ Querystring: { studioId?: string; from?: string; to?: string } }>(
    '/mine',
    { preHandler: requireAuth, schema: { response: { 200: z.array(StaffShiftSchema) } } },
    async (request, reply) => {
      const user = getUser(request)
      if (!isFronthost(user.role)) return reply.forbidden()

      const { studioId, from, to } = request.query

      const member = await prisma.member.findFirst({
        where: studioId ? { userId: user.id, studioId } : { userId: user.id },
        select: { id: true },
      })
      if (!member) return reply.send([])

      const shifts = await prisma.staffShift.findMany({
        where: {
          memberId: member.id,
          ...(studioId ? { studioId } : {}),
          ...(from ? { startsAt: { gte: new Date(from) } } : {}),
          ...(to ? { endsAt: { lte: new Date(to) } } : {}),
        },
        orderBy: { startsAt: 'asc' },
        select: shiftSelect,
      })

      return reply.send(await enrichShifts(shifts))
    },
  )

  app.post<{ Body: { studioId: string; memberId: string; startsAt: string; endsAt: string; note?: string } }>(
    '/',
    {
      preHandler: requireAuth,
      config: { studioIdFrom: 'body' },
      schema: {
        body: z.object({
          studioId: Id,
          memberId: Id,
          startsAt: ISODateTime,
          endsAt: ISODateTime,
          note: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { studioId, memberId, startsAt, endsAt, note } = request.body
      if (!studioId || !memberId || !startsAt || !endsAt) {
        return reply.badRequest('studioId, memberId, startsAt and endsAt are required')
      }

      const start = new Date(startsAt)
      const end = new Date(endsAt)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return reply.badRequest('Invalid date')
      if (end <= start) return reply.badRequest('endsAt must be after startsAt')

      const member = await prisma.member.findFirst({
        where: { id: memberId, studioId },
        select: { id: true },
      })
      if (!member) return reply.badRequest('Member not found in this studio')

      const shift = await prisma.staffShift.create({
        data: { studioId, memberId, startsAt: start, endsAt: end, note: note ?? null },
        select: shiftSelect,
      })

      const [enriched] = await enrichShifts([shift])
      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SHIFT_CREATE, targetId: memberId, studioId, meta: { shiftId: shift.id, startsAt, endsAt, note } })
      return reply.status(201).send(enriched)
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { startsAt?: string; endsAt?: string; note?: string | null }
  }>(
    '/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          startsAt: ISODateTime.optional(),
          endsAt: ISODateTime.optional(),
          note: z.string().nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { id } = request.params
      const { startsAt, endsAt, note } = request.body

      const existing = await prisma.staffShift.findUnique({ where: { id }, select: { startsAt: true, endsAt: true, memberId: true, studioId: true } })
      if (!existing) return reply.notFound()
      if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin'] &&
          !user.studioIds?.includes(existing.studioId)) return reply.forbidden()

      const start = startsAt ? new Date(startsAt) : existing.startsAt
      const end = endsAt ? new Date(endsAt) : existing.endsAt
      if (end <= start) return reply.badRequest('endsAt must be after startsAt')

      const shift = await prisma.staffShift.update({
        where: { id },
        data: {
          ...(startsAt ? { startsAt: start } : {}),
          ...(endsAt ? { endsAt: end } : {}),
          ...(note !== undefined ? { note: note ?? null } : {}),
        },
        select: shiftSelect,
      })

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SHIFT_UPDATE, targetId: existing.memberId, studioId: existing.studioId, meta: { shiftId: id, startsAt, endsAt, note } })
      const [enriched] = await enrichShifts([shift])
      return reply.send(enriched)
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth, schema: { params: z.object({ id: Id }) } },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { id } = request.params
      const existing = await prisma.staffShift.findUnique({ where: { id }, select: { id: true, memberId: true, studioId: true, startsAt: true, endsAt: true } })
      if (!existing) return reply.notFound()
      if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin'] &&
          !user.studioIds?.includes(existing.studioId)) return reply.forbidden()

      await prisma.staffShift.delete({ where: { id } })
      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SHIFT_DELETE, targetId: existing.memberId, studioId: existing.studioId, meta: { shiftId: id, startsAt: existing.startsAt, endsAt: existing.endsAt } })
      return reply.send({ success: true })
    },
  )
}
