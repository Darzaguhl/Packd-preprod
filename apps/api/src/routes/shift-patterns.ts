import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { audit, AUDIT } from '../lib/audit.js'
import { assertStudioAccess } from './admin-shared.js'
import { ROLE_RANK } from '@packd/types'
import { Id, ISODateTime, StudioIdQuery } from '../schemas.js'

const GENERATE_WEEKS = 12

function isAdmin(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['studio_admin']
}

function generateOccurrences(pattern: {
  daysOfWeek: number[]
  startTime: string
  endTime: string
  intervalWeeks: number
  validFrom: Date
  validUntil: Date | null
}): Array<{ startsAt: Date; endsAt: Date }> {
  const [startH, startM] = pattern.startTime.split(':').map(Number)
  const [endH, endM] = pattern.endTime.split(':').map(Number)
  const intervalWeeks = Math.max(1, pattern.intervalWeeks)

  const from = new Date(pattern.validFrom)
  from.setHours(0, 0, 0, 0)

  const until = pattern.validUntil
    ? new Date(Math.min(pattern.validUntil.getTime(), from.getTime() + GENERATE_WEEKS * 7 * 86400000))
    : new Date(from.getTime() + GENERATE_WEEKS * 7 * 86400000)

  const epochMonday = new Date(from)
  epochMonday.setDate(from.getDate() - ((from.getDay() + 6) % 7))

  const occurrences: Array<{ startsAt: Date; endsAt: Date }> = []
  const cursor = new Date(from)

  while (cursor <= until) {
    const cursorMonday = new Date(cursor)
    cursorMonday.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
    const weeksSinceStart = Math.round((cursorMonday.getTime() - epochMonday.getTime()) / (7 * 86400000))

    if (pattern.daysOfWeek.includes(cursor.getDay()) && weeksSinceStart % intervalWeeks === 0) {
      const startsAt = new Date(cursor)
      startsAt.setHours(startH, startM, 0, 0)
      const endsAt = new Date(cursor)
      endsAt.setHours(endH, endM, 0, 0)
      if (endsAt > startsAt) occurrences.push({ startsAt, endsAt })
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return occurrences
}

export async function shiftPatternsRoutes(app: FastifyInstance) {

  app.get<{ Querystring: { studioId: string; memberId?: string } }>(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        querystring: StudioIdQuery.extend({ memberId: z.string().min(1).optional() }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()
      const { studioId, memberId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const patterns = await prisma.staffShiftPattern.findMany({
        where: { studioId, ...(memberId ? { memberId } : {}) },
        include: { member: { select: { user: { select: { email: true } } } } },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(patterns.map(p => ({
        id: p.id,
        memberId: p.memberId,
        memberName: p.member.user.email,
        studioId: p.studioId,
        daysOfWeek: p.daysOfWeek,
        startTime: p.startTime,
        endTime: p.endTime,
        intervalWeeks: p.intervalWeeks,
        validFrom: p.validFrom.toISOString(),
        validUntil: p.validUntil?.toISOString() ?? null,
        note: p.note ?? null,
        createdAt: p.createdAt.toISOString(),
      })))
    },
  )

  app.post<{
    Body: {
      studioId: string
      memberId: string
      daysOfWeek: number[]
      startTime: string
      endTime: string
      intervalWeeks?: number
      validFrom: string
      validUntil?: string
      note?: string
    }
  }>(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          studioId: Id,
          memberId: Id,
          daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
          startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
          endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
          intervalWeeks: z.number().int().min(1).max(4).optional(),
          validFrom: ISODateTime,
          validUntil: ISODateTime.optional(),
          note: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { studioId, memberId, daysOfWeek, startTime, endTime, intervalWeeks = 1, validFrom, validUntil, note } = request.body
      if (!studioId || !memberId || !daysOfWeek?.length || !startTime || !endTime || !validFrom) {
        return reply.badRequest('studioId, memberId, daysOfWeek, startTime, endTime, validFrom are required')
      }
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return
      if (endTime <= startTime) return reply.badRequest('endTime must be after startTime')

      const member = await prisma.member.findFirst({ where: { id: memberId, studioId }, select: { id: true } })
      if (!member) return reply.badRequest('Member not found in this studio')

      const pattern = await prisma.staffShiftPattern.create({
        data: {
          studioId,
          memberId,
          daysOfWeek,
          startTime,
          endTime,
          intervalWeeks,
          validFrom: new Date(validFrom),
          validUntil: validUntil ? new Date(validUntil) : null,
          note: note ?? null,
        },
      })

      const occurrences = generateOccurrences({
        daysOfWeek,
        startTime,
        endTime,
        intervalWeeks,
        validFrom: new Date(validFrom),
        validUntil: validUntil ? new Date(validUntil) : null,
      })

      if (occurrences.length > 0) {
        await prisma.staffShift.createMany({
          data: occurrences.map(o => ({
            studioId,
            memberId,
            startsAt: o.startsAt,
            endsAt: o.endsAt,
            note: note ?? null,
            patternId: pattern.id,
          })),
        })
      }

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.SHIFT_PATTERN_CREATE,
        targetId: memberId, studioId,
        meta: { patternId: pattern.id, daysOfWeek, startTime, endTime, shiftsGenerated: occurrences.length },
      })

      return reply.status(201).send({ ...pattern, shiftsGenerated: occurrences.length })
    },
  )

  app.patch<{
    Params: { id: string }
    Body: {
      daysOfWeek?: number[]
      startTime?: string
      endTime?: string
      intervalWeeks?: number
      validFrom?: string
      validUntil?: string | null
      note?: string | null
    }
  }>(
    '/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
          startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM').optional(),
          endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM').optional(),
          intervalWeeks: z.number().int().min(1).max(4).optional(),
          validFrom: ISODateTime.optional(),
          validUntil: ISODateTime.nullable().optional(),
          note: z.string().nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const { id } = request.params
      const existing = await prisma.staffShiftPattern.findUnique({ where: { id } })
      if (!existing) return reply.notFound()
      if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin'] &&
          !user.studioIds?.includes(existing.studioId)) return reply.forbidden()

      const {
        daysOfWeek = existing.daysOfWeek,
        startTime = existing.startTime,
        endTime = existing.endTime,
        intervalWeeks = existing.intervalWeeks,
        validFrom = existing.validFrom.toISOString(),
        validUntil = existing.validUntil?.toISOString() ?? null,
        note = existing.note,
      } = request.body

      if (endTime <= startTime) return reply.badRequest('endTime must be after startTime')

      const updated = await prisma.staffShiftPattern.update({
        where: { id },
        data: {
          daysOfWeek,
          startTime,
          endTime,
          intervalWeeks: Math.max(1, intervalWeeks),
          validFrom: new Date(validFrom),
          validUntil: validUntil ? new Date(validUntil) : null,
          note: note ?? null,
        },
      })

      const now = new Date()
      await prisma.staffShift.deleteMany({ where: { patternId: id, startsAt: { gte: now } } })

      const occurrences = generateOccurrences({
        daysOfWeek,
        startTime,
        endTime,
        intervalWeeks,
        validFrom: now > new Date(validFrom) ? now : new Date(validFrom),
        validUntil: validUntil ? new Date(validUntil) : null,
      })

      if (occurrences.length > 0) {
        await prisma.staffShift.createMany({
          data: occurrences.map(o => ({
            studioId: existing.studioId,
            memberId: existing.memberId,
            startsAt: o.startsAt,
            endsAt: o.endsAt,
            note: note ?? null,
            patternId: id,
          })),
        })
      }

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.SHIFT_PATTERN_UPDATE,
        targetId: existing.memberId, studioId: existing.studioId,
        meta: { patternId: id, daysOfWeek, startTime, endTime, shiftsRegenerated: occurrences.length },
      })

      return reply.send({ ...updated, shiftsRegenerated: occurrences.length })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth, schema: { params: z.object({ id: Id }) } },
    async (request, reply) => {
      const user = getUser(request)
      if (!isAdmin(user.role)) return reply.forbidden()

      const pattern = await prisma.staffShiftPattern.findUnique({
        where: { id: request.params.id },
        select: { id: true, memberId: true, studioId: true },
      })
      if (!pattern) return reply.notFound()
      if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin'] &&
          !user.studioIds?.includes(pattern.studioId)) return reply.forbidden()

      const now = new Date()
      const { count } = await prisma.staffShift.deleteMany({
        where: { patternId: pattern.id, startsAt: { gte: now } },
      })

      await prisma.staffShiftPattern.delete({ where: { id: pattern.id } })

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.SHIFT_PATTERN_DELETE,
        targetId: pattern.memberId, studioId: pattern.studioId,
        meta: { patternId: pattern.id, futureShiftsDeleted: count },
      })

      return reply.send({ success: true, futureShiftsDeleted: count })
    },
  )
}
