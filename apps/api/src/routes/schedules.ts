import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

async function assertStudioAccess(
  userId: string,
  userRole: string,
  studioId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) return true
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member || member.studioId !== studioId) {
    reply.code(403).send({ error: 'Access denied' })
    return false
  }
  return true
}

function getMondayOf(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  date.setDate(date.getDate() - ((day + 6) % 7))
  return date
}

/** Generates ClassSession rows for a schedule between startDate and endDate (inclusive). */
async function generateSessions(
  scheduleId: string,
  studioId: string,
  templateId: string,
  instructorId: string,
  roomId: string,
  capacity: number,
  creditsRequired: number,
  daysOfWeek: number[],
  startTime: string,
  durationMin: number,
  intervalWeeks: number,
  from: Date,
  until: Date,
): Promise<void> {
  const [hh, mm] = startTime.split(':').map(Number)
  const sessions: {
    studioId: string
    templateId: string
    instructorId: string
    roomId: string
    scheduleId: string
    startsAt: Date
    endsAt: Date
    capacity: number
    creditsRequired: number
  }[] = []

  // Walk week-by-week, jumping intervalWeeks at a time
  const weekCursor = getMondayOf(from)
  const step = intervalWeeks * 7

  while (weekCursor <= until) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekCursor)
      day.setDate(weekCursor.getDate() + d)
      if (day >= from && day <= until && daysOfWeek.includes(day.getDay())) {
        const startsAt = new Date(day)
        startsAt.setHours(hh, mm, 0, 0)
        const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
        sessions.push({ studioId, templateId, instructorId, roomId, scheduleId, startsAt, endsAt, capacity, creditsRequired })
      }
    }
    weekCursor.setDate(weekCursor.getDate() + step)
  }

  if (sessions.length > 0) {
    await prisma.classSession.createMany({ data: sessions, skipDuplicates: true })
  }
}

export async function classScheduleRoutes(app: FastifyInstance) {
  // GET /schedules?studioId=&weekStart= — schedules + sessions for a week
  app.get<{ Querystring: { studioId: string; weekStart?: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, weekStart } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      // Default weekStart = today
      const base = weekStart ? new Date(weekStart) : new Date()
      base.setHours(0, 0, 0, 0)
      const day = base.getDay() // 0=Sun
      const monday = new Date(base)
      monday.setDate(base.getDate() - ((day + 6) % 7))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)

      const [sessions, templates, instructors, rooms] = await Promise.all([
        prisma.classSession.findMany({
          where: { studioId, startsAt: { gte: monday, lte: sunday } },
          include: {
            template: true,
            instructor: { include: { user: true } },
            substitute: { include: { user: true } },
            room: true,
          },
          orderBy: { startsAt: 'asc' },
        }),
        prisma.classTemplate.findMany({ where: { studioId }, orderBy: { name: 'asc' } }),
        prisma.instructor.findMany({
          where: { studioId },
          include: { user: true },
          orderBy: { user: { firstName: 'asc' } },
        }),
        prisma.room.findMany({
          where: { location: { studioId } },
          include: { location: true },
          orderBy: { name: 'asc' },
        }),
      ])

      return reply.send({
        weekStart: monday.toISOString(),
        sessions: sessions.map(s => ({
          id: s.id,
          scheduleId: s.scheduleId,
          templateId: s.templateId,
          templateName: s.template.name,
          sport: s.template.sport,
          instructorId: s.instructorId,
          instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
          substituteInstructorId: s.substituteInstructorId,
          substituteInstructorName: s.substitute
            ? `${s.substitute.user.firstName} ${s.substitute.user.lastName}`
            : null,
          roomId: s.roomId,
          roomName: s.room.name,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          capacity: s.capacity,
          creditsRequired: s.creditsRequired,
          status: s.status,
        })),
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          sport: t.sport,
          durationMin: t.durationMin,
        })),
        instructors: instructors.map(i => ({
          id: i.id,
          name: `${i.user.firstName} ${i.user.lastName}`,
        })),
        rooms: rooms.map(r => ({
          id: r.id,
          name: r.name,
          capacity: r.capacity,
          locationName: r.location.name,
        })),
      })
    },
  )

  // GET /schedules/all?studioId= — list all recurring schedules (for management)
  app.get<{ Querystring: { studioId: string } }>(
    '/all',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const schedules = await prisma.classSchedule.findMany({
        where: { studioId, isActive: true },
        include: {
          template: true,
          instructor: { include: { user: true } },
          room: true,
        },
        orderBy: { createdAt: 'asc' },
      })

      return reply.send(schedules.map(s => ({
        id: s.id,
        templateId: s.templateId,
        templateName: s.template.name,
        sport: s.template.sport,
        instructorId: s.instructorId,
        instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
        roomId: s.roomId,
        roomName: s.room.name,
        daysOfWeek: s.daysOfWeek,
        startTime: s.startTime,
        durationMin: s.durationMin,
        intervalWeeks: s.intervalWeeks,
        capacity: s.capacity,
        creditsRequired: s.creditsRequired,
        validFrom: s.validFrom,
        validUntil: s.validUntil,
      })))
    },
  )

  // POST /schedules — create a recurring schedule + generate sessions
  app.post<{
    Body: {
      studioId: string
      templateId: string
      instructorId: string
      roomId: string
      capacity: number
      creditsRequired?: number
      daysOfWeek: number[]
      startTime: string
      durationMin: number
      intervalWeeks?: number
      validFrom: string
      validUntil?: string
      generateWeeks?: number
    }
  }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const {
        studioId, templateId, instructorId, roomId, capacity,
        creditsRequired = 1, daysOfWeek, startTime, durationMin,
        intervalWeeks = 1, validFrom, validUntil, generateWeeks = 8,
      } = request.body

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      if (!daysOfWeek?.length) return reply.badRequest('daysOfWeek must be non-empty')
      if (!/^\d{2}:\d{2}$/.test(startTime)) return reply.badRequest('startTime must be HH:MM')
      if (intervalWeeks < 1) return reply.badRequest('intervalWeeks must be ≥1')

      const from = new Date(validFrom)
      const until = validUntil
        ? new Date(validUntil)
        : new Date(from.getTime() + generateWeeks * 7 * 24 * 60 * 60 * 1000)

      const sched = await prisma.classSchedule.create({
        data: {
          studioId, templateId, instructorId, roomId,
          capacity, creditsRequired, daysOfWeek, startTime, durationMin, intervalWeeks,
          validFrom: from, validUntil: validUntil ? new Date(validUntil) : null,
        },
      })

      await generateSessions(
        sched.id, studioId, templateId, instructorId, roomId,
        capacity, creditsRequired, daysOfWeek, startTime, durationMin, intervalWeeks,
        from, until,
      )

      return reply.code(201).send({ success: true, id: sched.id })
    },
  )

  // PATCH /schedules/:id — update schedule, regenerate future sessions (keeps substitutes)
  app.patch<{
    Params: { id: string }
    Body: {
      studioId: string
      templateId?: string
      instructorId?: string
      roomId?: string
      capacity?: number
      creditsRequired?: number
      daysOfWeek?: number[]
      startTime?: string
      durationMin?: number
      intervalWeeks?: number
      validUntil?: string | null
    }
  }>(
    '/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { id } = request.params
      const { studioId, ...fields } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const existing = await prisma.classSchedule.findFirst({ where: { id, studioId } })
      if (!existing) return reply.notFound('Schedule not found')

      const updated = await prisma.classSchedule.update({
        where: { id },
        data: {
          ...(fields.templateId !== undefined && { templateId: fields.templateId }),
          ...(fields.instructorId !== undefined && { instructorId: fields.instructorId }),
          ...(fields.roomId !== undefined && { roomId: fields.roomId }),
          ...(fields.capacity !== undefined && { capacity: fields.capacity }),
          ...(fields.creditsRequired !== undefined && { creditsRequired: fields.creditsRequired }),
          ...(fields.daysOfWeek !== undefined && { daysOfWeek: fields.daysOfWeek }),
          ...(fields.startTime !== undefined && { startTime: fields.startTime }),
          ...(fields.durationMin !== undefined && { durationMin: fields.durationMin }),
          ...(fields.intervalWeeks !== undefined && { intervalWeeks: fields.intervalWeeks }),
          ...(fields.validUntil !== undefined && { validUntil: fields.validUntil ? new Date(fields.validUntil) : null }),
        },
      })

      const now = new Date()
      const generateUntil = updated.validUntil
        ?? new Date(now.getTime() + 8 * 7 * 24 * 60 * 60 * 1000)

      await prisma.classSession.deleteMany({
        where: {
          scheduleId: id,
          startsAt: { gte: now },
          substituteInstructorId: null,
          bookings: { none: {} },
        },
      })

      await generateSessions(
        id,
        updated.studioId,
        updated.templateId,
        updated.instructorId,
        updated.roomId,
        updated.capacity,
        updated.creditsRequired,
        updated.daysOfWeek,
        updated.startTime,
        updated.durationMin,
        updated.intervalWeeks,
        now,
        generateUntil,
      )

      return reply.send({ success: true })
    },
  )

  // DELETE /schedules/:id — deactivate schedule + cancel future unbooked sessions
  app.delete<{ Params: { id: string }; Querystring: { studioId: string } }>(
    '/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { id } = request.params
      const { studioId } = request.query
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const existing = await prisma.classSchedule.findFirst({ where: { id, studioId } })
      if (!existing) return reply.notFound('Schedule not found')

      await prisma.$transaction([
        prisma.classSchedule.update({ where: { id }, data: { isActive: false } }),
        prisma.classSession.deleteMany({
          where: {
            scheduleId: id,
            startsAt: { gte: new Date() },
            bookings: { none: {} },
          },
        }),
      ])

      return reply.send({ success: true })
    },
  )

  // PATCH /schedules/sessions/:sessionId/substitute — set/clear substitute for a single session
  app.patch<{
    Params: { sessionId: string }
    Body: { substituteInstructorId: string | null; studioId: string }
  }>(
    '/sessions/:sessionId/substitute',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { sessionId } = request.params
      const { substituteInstructorId, studioId } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const session = await prisma.classSession.findFirst({
        where: { id: sessionId, studioId },
      })
      if (!session) return reply.notFound('Session not found')

      const updated = await prisma.classSession.update({
        where: { id: sessionId },
        data: { substituteInstructorId },
        include: { substitute: { include: { user: true } } },
      })

      return reply.send({
        success: true,
        substituteInstructorId: updated.substituteInstructorId,
        substituteInstructorName: updated.substitute
          ? `${updated.substitute.user.firstName} ${updated.substitute.user.lastName}`
          : null,
      })
    },
  )

  // DELETE /schedules/orphaned?studioId=&templateId=&instructorId=&startTime=
  // Deletes all future unbooked sessions that match the given pattern and have no scheduleId
  app.delete<{
    Querystring: { studioId: string; templateId: string; instructorId: string; startTime: string }
  }>(
    '/orphaned',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, templateId, instructorId, startTime } = request.query
      if (!studioId || !templateId || !instructorId || !startTime) {
        return reply.badRequest('studioId, templateId, instructorId and startTime are required')
      }
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const [hh, mm] = startTime.split(':').map(Number)
      const now = new Date()

      // Fetch matching future sessions to check hours/minutes (can't filter by time in Prisma directly)
      const candidates = await prisma.classSession.findMany({
        where: {
          studioId,
          templateId,
          instructorId,
          scheduleId: null,
          startsAt: { gte: now },
          bookings: { none: {} },
        },
        select: { id: true, startsAt: true },
      })

      const ids = candidates
        .filter(s => s.startsAt.getHours() === hh && s.startsAt.getMinutes() === mm)
        .map(s => s.id)

      if (ids.length > 0) {
        await prisma.classSession.deleteMany({ where: { id: { in: ids } } })
      }

      return reply.send({ success: true, deleted: ids.length })
    },
  )

  // GET /schedules/month?studioId=&year=&month= — sessions grouped by date for month view
  app.get<{ Querystring: { studioId: string; year: string; month: string } }>(
    '/month',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, year, month } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const y = Number(year ?? new Date().getFullYear())
      const m = Number(month ?? new Date().getMonth() + 1)

      const from = new Date(y, m - 1, 1)
      const until = new Date(y, m, 0, 23, 59, 59, 999) // last day of month

      const sessions = await prisma.classSession.findMany({
        where: { studioId, startsAt: { gte: from, lte: until } },
        include: { template: true },
        orderBy: { startsAt: 'asc' },
      })

      // Group by local date string "YYYY-MM-DD"
      const byDate: Record<string, { sport: string; count: number }[]> = {}
      for (const s of sessions) {
        const d = s.startsAt
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!byDate[key]) byDate[key] = []
        byDate[key].push({ sport: s.template.sport, count: 1 })
      }

      return reply.send({ year: y, month: m, days: byDate })
    },
  )

  // GET /schedules/orphaned?studioId= — sessions without a scheduleId grouped by pattern
  app.get<{ Querystring: { studioId: string } }>(
    '/orphaned',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply)) return

      const now = new Date()
      const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) // 60 days ahead

      const sessions = await prisma.classSession.findMany({
        where: { studioId, scheduleId: null, startsAt: { gte: now, lte: future } },
        include: {
          template: true,
          instructor: { include: { user: true } },
          room: true,
        },
        orderBy: { startsAt: 'asc' },
      })

      // Group by template+instructor+time pattern
      const patterns: Record<string, {
        templateId: string; templateName: string; sport: string
        instructorId: string; instructorName: string
        roomId: string; roomName: string
        startTime: string; durationMin: number
        sessionCount: number; nextOccurrence: string
        daysOfWeek: number[]
      }> = {}

      for (const s of sessions) {
        const h = String(s.startsAt.getHours()).padStart(2, '0')
        const mn = String(s.startsAt.getMinutes()).padStart(2, '0')
        const startTime = `${h}:${mn}`
        const key = `${s.templateId}|${s.instructorId}|${startTime}`

        if (!patterns[key]) {
          patterns[key] = {
            templateId: s.templateId,
            templateName: s.template.name,
            sport: s.template.sport,
            instructorId: s.instructorId,
            instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
            roomId: s.roomId,
            roomName: s.room.name,
            startTime,
            durationMin: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000),
            sessionCount: 0,
            nextOccurrence: s.startsAt.toISOString(),
            daysOfWeek: [],
          }
        }

        patterns[key].sessionCount++
        const dow = s.startsAt.getDay()
        if (!patterns[key].daysOfWeek.includes(dow)) {
          patterns[key].daysOfWeek.push(dow)
        }
      }

      return reply.send(Object.values(patterns).map(p => ({
        ...p,
        daysOfWeek: p.daysOfWeek.sort(),
      })))
    },
  )
}
