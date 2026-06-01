import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { audit, AUDIT } from '../lib/audit.js'
import { ROLE_RANK } from '@packd/types'
import { assertStudioAccess } from './admin-shared.js'
import { sendSubstituteNotification } from '../lib/email.js'
import { IdParam, StudioIdQuery } from '../schemas.js'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor = requireRole('instructor')

/**
 * Returns true if the instructor already has a non-cancelled session that overlaps
 * the given time window. Excludes excludeSessionId if provided (useful for edits).
 */
async function checkInstructorConflict(
  instructorId: string,
  startsAt: Date,
  endsAt: Date,
  excludeSessionId?: string,
): Promise<boolean> {
  if (!instructorId) return false
  const conflict = await prisma.classSession.findFirst({
    where: {
      instructorId,
      status: { not: 'CANCELLED' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    select: { id: true },
  })
  return conflict !== null
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
  isPrivate = false,
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
    isPrivate: boolean
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
        sessions.push({ studioId, templateId, instructorId, roomId, scheduleId, startsAt, endsAt, capacity, creditsRequired, isPrivate })
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
    {
      preHandler: requireInstructor,
      schema: {
        querystring: z.object({
          studioId: z.string().min(1),
          weekStart: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, weekStart } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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
            template: { select: { name: true, sport: true } },
            instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            substitute: { include: { user: { select: { firstName: true, lastName: true } } } },
            room: { select: { name: true } },
          },
          orderBy: { startsAt: 'asc' },
        }),
        prisma.classTemplate.findMany({
          where: { studioId },
          select: { id: true, name: true, sport: true, durationMin: true, isPrivate: true, defaultInstructorId: true, defaultRoomId: true, defaultCapacity: true, defaultCreditsRequired: true, defaultStartTime: true, defaultStartTime2: true, defaultDaysOfWeek: true, defaultIntervalWeeks: true },
          orderBy: { name: 'asc' },
        }),
        prisma.instructor.findMany({
          where: { studioId },
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
          orderBy: { user: { firstName: 'asc' } },
        }),
        prisma.room.findMany({
          where: { location: { studioId } },
          select: { id: true, name: true, capacity: true, location: { select: { name: true } } },
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
          isPrivate: s.isPrivate,
        })),
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          sport: t.sport,
          durationMin: t.durationMin,
          isPrivate: t.isPrivate,
          defaultInstructorId: t.defaultInstructorId,
          defaultRoomId: t.defaultRoomId,
          defaultCapacity: t.defaultCapacity,
          defaultCreditsRequired: t.defaultCreditsRequired,
          defaultStartTime: t.defaultStartTime,
          defaultStartTime2: t.defaultStartTime2,
          defaultDaysOfWeek: t.defaultDaysOfWeek,
          defaultIntervalWeeks: t.defaultIntervalWeeks,
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
    {
      preHandler: requireInstructor,
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const schedules = await prisma.classSchedule.findMany({
        where: { studioId, isActive: true },
        include: {
          template: { select: { name: true, sport: true } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          room: { select: { name: true } },
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
      isPrivate?: boolean
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
    {
      preHandler: requireStudioAdmin,
      schema: {
        body: z.object({
          studioId: z.string().min(1),
          templateId: z.string().min(1),
          instructorId: z.string().min(1),
          roomId: z.string().min(1),
          capacity: z.number().int().positive(),
          creditsRequired: z.number().int().min(0).optional(),
          isPrivate: z.boolean().optional(),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
          durationMin: z.number().int().positive(),
          intervalWeeks: z.number().int().min(1).optional(),
          validFrom: z.string().min(1),
          validUntil: z.string().optional(),
          generateWeeks: z.number().int().positive().optional(),
        }),
      },
    },
    async (request, reply) => {
      const {
        studioId, templateId, instructorId, roomId, capacity,
        creditsRequired = 1, isPrivate: isPrivateOverride, daysOfWeek, startTime, durationMin,
        intervalWeeks = 1, validFrom, validUntil, generateWeeks = 8,
      } = request.body

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      if (!daysOfWeek?.length) return reply.badRequest('daysOfWeek must be non-empty')
      if (!/^\d{2}:\d{2}$/.test(startTime)) return reply.badRequest('startTime must be HH:MM')
      if (intervalWeeks < 1) return reply.badRequest('intervalWeeks must be ≥1')

      const from = new Date(validFrom)
      const until = validUntil
        ? new Date(validUntil)
        : new Date(from.getTime() + generateWeeks * 7 * 24 * 60 * 60 * 1000)

      const template = await prisma.classTemplate.findUnique({ where: { id: templateId }, select: { isPrivate: true } })
      // Body override takes precedence over template default
      const resolvedIsPrivate = isPrivateOverride ?? template?.isPrivate ?? false

      // Note: bulk session generation means we can't check every generated slot for conflicts
      // without computing them all upfront. Skip conflict check for schedule creation — per-session
      // substitute assignment does check. Conflict check is applied on single session edits below.

      const sched = await prisma.classSchedule.create({
        data: {
          studioId, templateId, instructorId, roomId,
          capacity, creditsRequired, daysOfWeek, startTime, durationMin, intervalWeeks,
          validFrom: from, validUntil: until,
        },
      })

      await generateSessions(
        sched.id, studioId, templateId, instructorId, roomId,
        capacity, creditsRequired, daysOfWeek, startTime, durationMin, intervalWeeks,
        from, until, resolvedIsPrivate,
      )

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SCHEDULE_CREATE, targetId: sched.id, studioId, meta: { templateId, instructorId, startTime, daysOfWeek } })
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
    {
      preHandler: requireStudioAdmin,
      schema: {
        params: IdParam,
        body: z.object({
          studioId: z.string().min(1),
          templateId: z.string().min(1).optional(),
          instructorId: z.string().min(1).optional(),
          roomId: z.string().min(1).optional(),
          capacity: z.number().int().positive().optional(),
          creditsRequired: z.number().int().min(0).optional(),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          durationMin: z.number().int().positive().optional(),
          intervalWeeks: z.number().int().min(1).optional(),
          validUntil: z.string().nullable().optional(),
        }).nullish(),
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { studioId, ...fields } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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
    {
      preHandler: requireStudioAdmin,
      schema: {
        params: IdParam,
        querystring: StudioIdQuery,
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { studioId } = request.query
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SCHEDULE_DELETE, targetId: id, studioId, meta: { templateId: existing.templateId, instructorId: existing.instructorId } })
      return reply.send({ success: true })
    },
  )

  // PATCH /schedules/sessions/:sessionId/substitute — set/clear substitute for a single session
  app.patch<{
    Params: { sessionId: string }
    Body: { substituteInstructorId: string | null; studioId: string }
  }>(
    '/sessions/:sessionId/substitute',
    {
      preHandler: requireInstructor,
      schema: {
        params: z.object({ sessionId: z.string().min(1) }),
        body: z.object({
          substituteInstructorId: z.string().min(1).nullable(),
          studioId: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params
      const { substituteInstructorId, studioId } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      // Instructors need the canEditSessionDetails permission; studio_admin+ always allowed
      if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['studio_admin']) {
        const instructor = await prisma.instructor.findFirst({
          where: { studioId, userId: user.id },
          select: { permissions: true },
        })
        const perms = (instructor?.permissions ?? {}) as Record<string, unknown>
        if (!perms.canEditSessionDetails) {
          return reply.code(403).send({ error: 'You do not have permission to set a substitute' })
        }
      }

      const session = await prisma.classSession.findFirst({
        where: { id: sessionId, studioId },
      })
      if (!session) return reply.notFound('Session not found')

      // Check substitute conflict (only if setting a substitute, not clearing it)
      if (substituteInstructorId) {
        const hasConflict = await checkInstructorConflict(substituteInstructorId, session.startsAt, session.endsAt, sessionId)
        if (hasConflict) {
          return reply.code(409).send({ error: 'Instructor already has a session at this time' })
        }
      }

      const updated = await prisma.classSession.update({
        where: { id: sessionId },
        data: { substituteInstructorId },
        include: {
          substitute: { include: { user: true } },
          template: { select: { name: true } },
          studio: { select: { name: true } },
        },
      })

      // Notify confirmed attendees about the instructor change (only when assigning, not clearing)
      if (substituteInstructorId && updated.substitute) {
        const substituteName = `${updated.substitute.user.firstName} ${updated.substitute.user.lastName}`
        const confirmedBookings = await prisma.booking.findMany({
          where: { sessionId, status: 'CONFIRMED' },
          include: { member: { select: { emailPreferences: true, user: { select: { email: true, firstName: true } } } } },
        })
        if (confirmedBookings.length > 0) {
          const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
          const notifications: Promise<unknown>[] = []
          for (const b of confirmedBookings) {
            const prefs = (b.member.emailPreferences as Record<string, boolean> | null) ?? {}
            // classReminder preference controls substitute notifications (opt-out respected)
            if ((prefs.classReminder ?? true) === false) continue
            notifications.push(sendSubstituteNotification({
              to: b.member.user.email,
              firstName: b.member.user.firstName,
              studioName: updated.studio.name,
              className: updated.template?.name ?? 'Class',
              startsAt: updated.startsAt.toISOString(),
              substituteName,
              webUrl,
            }))
          }
          await Promise.allSettled(notifications)
        }
      }

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
    {
      preHandler: requireStudioAdmin,
      schema: {
        querystring: z.object({
          studioId: z.string().min(1),
          templateId: z.string().min(1),
          instructorId: z.string().min(1),
          startTime: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, templateId, instructorId, startTime } = request.query
      if (!studioId || !templateId || !instructorId || !startTime) {
        return reply.badRequest('studioId, templateId, instructorId and startTime are required')
      }
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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

  // GET /schedules/month?studioId=&year=&month=[&instructorId=] — sessions grouped by date for month view
  app.get<{ Querystring: { studioId: string; year: string; month: string; instructorId?: string } }>(
    '/month',
    {
      preHandler: requireInstructor,
      schema: {
        querystring: z.object({
          studioId: z.string().min(1),
          year: z.string().optional(),
          month: z.string().optional(),
          instructorId: z.string().min(1).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, year, month, instructorId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const y = Number(year ?? new Date().getFullYear())
      const m = Number(month ?? new Date().getMonth() + 1)

      const from = new Date(y, m - 1, 1)
      const until = new Date(y, m, 0, 23, 59, 59, 999) // last day of month

      const sessions = await prisma.classSession.findMany({
        where: {
          studioId,
          startsAt: { gte: from, lte: until },
          ...(instructorId ? {
            OR: [
              { instructorId },
              { substituteInstructorId: instructorId },
            ],
          } : {}),
        },
        include: {
          template: true,
          instructor: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { startsAt: 'asc' },
      })

      // Group by local date string "YYYY-MM-DD"
      const byDate: Record<string, { id: string; sport: string; name: string; startsAt: string; instructorId: string | null; instructorName: string; substituteInstructorId: string | null; status: string }[]> = {}
      for (const s of sessions) {
        const d = s.startsAt
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!byDate[key]) byDate[key] = []
        const u = s.instructor?.user
        const instructorName = u ? `${u.firstName} ${u.lastName}`.trim() : ''
        byDate[key].push({
          id: s.id,
          sport: s.template.sport,
          name: s.template.name,
          startsAt: s.startsAt.toISOString(),
          instructorId: s.instructor?.id ?? null,
          instructorName,
          substituteInstructorId: s.substituteInstructorId ?? null,
          status: s.status,
        })
      }

      return reply.send({ year: y, month: m, days: byDate })
    },
  )

  // GET /schedules/orphaned?studioId= — sessions without a scheduleId grouped by pattern
  app.get<{ Querystring: { studioId: string } }>(
    '/orphaned',
    {
      preHandler: requireInstructor,
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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
