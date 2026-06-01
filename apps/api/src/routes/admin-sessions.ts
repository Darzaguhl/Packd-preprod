import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { audit, AUDIT } from '../lib/audit.js'
import { logger } from '../lib/logger.js'
import { enqueueNoShowCheck } from '../jobs/index.js'
import { sendSessionAnnouncement, sendBookingCancellation } from '../lib/email.js'
import { assertStudioAccess } from './admin-shared.js'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor  = requireRole('instructor')

const VALID_SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
type SessionStatus = typeof VALID_SESSION_STATUSES[number]

/** Returns true if instructor has a non-cancelled overlapping session (excluding the given session). */
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

export async function adminSessionRoutes(app: FastifyInstance) {
  // GET /admin/sessions?studioId=&date=
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, date } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const day = date ? new Date(date) : new Date()
      const from = new Date(day); from.setHours(0, 0, 0, 0)
      const to   = new Date(day); to.setHours(23, 59, 59, 999)

      const sessions = await prisma.classSession.findMany({
        where: { studioId, startsAt: { gte: from, lte: to } },
        include: {
          template: true,
          instructor: { include: { user: true } },
          substitute: { include: { user: true } },
          room: true,
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
        },
        orderBy: { startsAt: 'asc' },
      })

      return sessions.map((s) => ({
        id: s.id,
        templateName: s.template.name,
        sport: s.template.sport,
        instructorId: s.instructorId,
        instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
        instructorUserId: s.instructor.userId,
        substituteInstructorId: s.substituteInstructorId ?? null,
        substituteInstructorUserId: s.substitute?.user.id ?? null,
        roomId: s.roomId,
        roomName: s.room.name,
        capacity: s.capacity,
        bookedCount: s._count.bookings,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        creditsRequired: s.creditsRequired,
        isPrivate: s.isPrivate,
      }))
    },
  )

  // GET /admin/sessions/bulk?studioId=&from=&to=&instructorId=&templateId= — preview (dry-run)
  app.get<{ Querystring: { studioId: string; from: string; to: string; instructorId?: string; templateId?: string } }>(
    '/sessions/bulk',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to, instructorId, templateId } = request.query
      if (!studioId || !from || !to) return reply.badRequest('studioId, from and to are required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const sessions = await prisma.classSession.findMany({
        where: {
          studioId,
          startsAt: { gte: new Date(from), lt: new Date(to) },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          ...(instructorId ? { instructorId } : {}),
          ...(templateId   ? { templateId   } : {}),
        },
        include: {
          template: { select: { name: true } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
        },
        orderBy: { startsAt: 'asc' },
      })

      const byTemplate = new Map<string, { name: string; count: number }>()
      for (const s of sessions) {
        const existing = byTemplate.get(s.templateId) ?? { name: s.template.name, count: 0 }
        byTemplate.set(s.templateId, { ...existing, count: existing.count + 1 })
      }

      return reply.send({
        total: sessions.length,
        sessionIds: sessions.map(s => s.id),
        byTemplate: Array.from(byTemplate.values()),
        sessions: sessions.map(s => ({
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          templateName: s.template.name,
          instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
          confirmedBookings: s._count.bookings,
        })),
      })
    },
  )

  // GET /admin/sessions/:id/bookings
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/bookings',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({ where: { id: request.params.id } })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: { sessionId: request.params.id, status: 'CONFIRMED' },
        include: { member: { include: { user: true, creditBalance: true } } },
        orderBy: { bookedAt: 'asc' },
        // memberNote is a scalar field on Booking — included by default (no explicit select needed)
      })

      return bookings.map((b) => ({
        id: b.id,
        memberId: b.memberId,
        memberName: `${b.member.user.firstName} ${b.member.user.lastName}`,
        memberEmail: b.member.user.email,
        checkedIn: b.checkedIn,
        checkedInAt: b.checkedInAt?.toISOString() ?? null,
        creditBalance: b.member.creditBalance?.balance ?? 0,
        bookedAt: b.bookedAt.toISOString(),
        memberNote: b.memberNote ?? null,
      }))
    },
  )

  // POST /admin/sessions/:id/checkin/:bookingId
  app.post<{ Params: { id: string; bookingId: string } }>(
    '/sessions/:id/checkin/:bookingId',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({ where: { id: request.params.id } })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: request.params.bookingId } })
      if (booking.sessionId !== request.params.id) return reply.notFound()
      if (booking.status !== 'CONFIRMED') return reply.badRequest('Cannot check in a non-confirmed booking')

      // Atomic toggle: condition on the current checkedIn value prevents concurrent double-flip
      const newCheckedIn = !booking.checkedIn
      const result = await prisma.booking.updateMany({
        where: { id: request.params.bookingId, checkedIn: booking.checkedIn },
        data: {
          checkedIn: newCheckedIn,
          checkedInAt: newCheckedIn ? new Date() : null,
        },
      })
      if (result.count !== 1) return reply.conflict('Check-in state was modified concurrently — please retry')

      if (newCheckedIn) {
        audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SESSION_CHECKIN, targetId: booking.memberId, studioId: session.studioId, meta: { sessionId: session.id, bookingId: booking.id } })
      }
      return { success: true, checkedIn: newCheckedIn }
    },
  )

  // PATCH /admin/sessions/:id
  app.patch<{ Params: { id: string }; Body: { status?: string; startsAt?: string; endsAt?: string; isPrivate?: boolean } }>(
    '/sessions/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { status, startsAt, endsAt, isPrivate } = request.body
      const user = getUser(request)
      const existing = await prisma.classSession.findUniqueOrThrow({ where: { id: request.params.id } })
      if (!await assertStudioAccess(user.id, user.role, existing.studioId, reply, user.studioIds)) return

      if (startsAt !== undefined || endsAt !== undefined) {
        if (!startsAt || !endsAt) return reply.badRequest('Both startsAt and endsAt are required for reschedule')
        const newStart = new Date(startsAt)
        const newEnd   = new Date(endsAt)
        if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return reply.badRequest('Invalid date format')
        if (newEnd <= newStart) return reply.badRequest('endsAt must be after startsAt')

        // Check instructor conflict at the new time
        const effectiveInstructorId = existing.substituteInstructorId ?? existing.instructorId
        if (effectiveInstructorId) {
          const hasConflict = await checkInstructorConflict(effectiveInstructorId, newStart, newEnd, request.params.id)
          if (hasConflict) {
            return reply.code(409).send({ error: 'Instructor already has a session at this time' })
          }
        }

        const session = await prisma.classSession.update({
          where: { id: request.params.id },
          data: { startsAt: newStart, endsAt: newEnd },
        })
        audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SESSION_RESCHEDULE, targetId: request.params.id, studioId: existing.studioId, meta: { from: existing.startsAt, to: newStart } })
        return reply.send({ success: true, startsAt: session.startsAt.toISOString(), endsAt: session.endsAt.toISOString() })
      }

      if (isPrivate !== undefined) {
        await prisma.classSession.update({ where: { id: request.params.id }, data: { isPrivate } })
        return reply.send({ success: true, isPrivate })
      }

      if (!status) return reply.badRequest('status or isPrivate is required')
      if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
        return reply.badRequest(`Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}`)
      }

      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: status as SessionStatus },
      })

      if (status === 'COMPLETED') {
        await enqueueNoShowCheck(session.id, session.startsAt).catch(err =>
          logger.error({ err }, '[jobs] failed to enqueue no-show check'),
        )
      }
      if (status === 'CANCELLED') {
        audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SESSION_CANCEL, targetId: request.params.id, studioId: existing.studioId, meta: { startsAt: existing.startsAt } })

        // Cancel confirmed bookings, refund credits, and notify members
        const confirmedBookings = await prisma.booking.findMany({
          where: { sessionId: request.params.id, status: 'CONFIRMED' },
          include: {
            member: {
              include: {
                user: { select: { email: true, firstName: true } },
                studio: { select: { name: true } },
              },
            },
          },
        })

        if (confirmedBookings.length > 0) {
          await prisma.$transaction(async (tx) => {
            await tx.booking.updateMany({
              where: { id: { in: confirmedBookings.map(b => b.id) } },
              data: { status: 'CANCELLED', stationId: null },
            })
            if (existing.creditsRequired > 0) {
              for (const b of confirmedBookings) {
                await tx.creditBalance.upsert({
                  where: { memberId: b.memberId },
                  create: { memberId: b.memberId, balance: existing.creditsRequired },
                  update: { balance: { increment: existing.creditsRequired } },
                })
                await tx.creditTransaction.create({
                  data: { memberId: b.memberId, amount: existing.creditsRequired, type: 'MANUAL_ADJUSTMENT', note: 'Refund: class cancelled' },
                })
              }
            }
          })

          const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
          const className = existing.templateId
            ? (await prisma.classTemplate.findUnique({ where: { id: existing.templateId }, select: { name: true } }))?.name ?? 'Class'
            : 'Class'
          const studioName = (await prisma.studio.findUnique({ where: { id: existing.studioId }, select: { name: true } }))?.name ?? ''
          await Promise.allSettled(
            confirmedBookings.map(b =>
              sendBookingCancellation({
                to: b.member.user.email,
                firstName: b.member.user.firstName,
                studioName,
                className,
                startsAt: existing.startsAt.toISOString(),
                reason: 'This class has been cancelled by the studio.',
                webUrl,
              }),
            ),
          )
        }
      }

      return reply.send({ success: true, status: session.status })
    },
  )

  // POST /admin/sessions/bulk — execute bulk cancel or substitute
  app.post<{
    Body: {
      studioId: string
      from: string
      to: string
      instructorId?: string
      templateId?: string
      action: 'CANCEL' | 'SUBSTITUTE'
      substituteInstructorId?: string
    }
  }>(
    '/sessions/bulk',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to, instructorId, templateId, action, substituteInstructorId } = request.body
      if (!studioId || !from || !to || !action) return reply.badRequest('studioId, from, to and action are required')
      if (action === 'SUBSTITUTE' && !substituteInstructorId) return reply.badRequest('substituteInstructorId is required for SUBSTITUTE action')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const sessions = await prisma.classSession.findMany({
        where: {
          studioId,
          startsAt: { gte: new Date(from), lt: new Date(to) },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          ...(instructorId ? { instructorId } : {}),
          ...(templateId   ? { templateId   } : {}),
        },
        select: { id: true, creditsRequired: true },
      })

      if (sessions.length === 0) return reply.send({ affected: 0, sessionIds: [] })

      const sessionIds = sessions.map(s => s.id)

      if (action === 'SUBSTITUTE') {
        // Validate that the substitute instructor belongs to this studio
        const subInstructor = await prisma.instructor.findFirst({
          where: { id: substituteInstructorId, studioId },
          select: { id: true },
        })
        if (!subInstructor) return reply.badRequest('Substitute instructor not found in this studio')

        await prisma.classSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { substituteInstructorId },
        })
        return reply.send({ affected: sessionIds.length, sessionIds })
      }

      await prisma.$transaction(async (tx) => {
        await tx.classSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { status: 'CANCELLED' },
        })

        const bookings = await tx.booking.findMany({
          where: { sessionId: { in: sessionIds }, status: 'CONFIRMED' },
          select: { id: true, memberId: true, sessionId: true },
        })

        if (bookings.length > 0) {
          await tx.booking.updateMany({
            where: { id: { in: bookings.map(b => b.id) } },
            data: { status: 'CANCELLED', stationId: null },
          })

          const sessionCredits = new Map<string, number>(sessions.map(s => [s.id, s.creditsRequired] as [string, number]))
          const refundsByMember = new Map<string, number>()
          for (const b of bookings) {
            const credits = sessionCredits.get(b.sessionId) ?? 0
            if (credits > 0) {
              refundsByMember.set(b.memberId, (refundsByMember.get(b.memberId) ?? 0) + credits)
            }
          }

          for (const [memberId, amount] of refundsByMember) {
            await tx.creditBalance.upsert({
              where: { memberId },
              create: { memberId, balance: amount },
              update: { balance: { increment: amount } },
            })
            await tx.creditTransaction.create({
              data: { memberId, amount, type: 'MANUAL_ADJUSTMENT', note: 'Refund: bulk session cancellation' },
            })
          }
        }
      })

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.SCHEDULE_BULK, targetId: studioId, studioId, meta: { action, affected: sessionIds.length, from, to, instructorId, templateId } })
      return reply.send({ affected: sessionIds.length, sessionIds })
    },
  )

  // POST /admin/sessions/:id/announce — email all confirmed attendees of a session (studio_admin+)
  // Rate-limited to 5/min — prevents accidental spam blasts.
  app.post<{ Params: { id: string }; Body: { subject: string; message: string } }>(
    '/sessions/:id/announce',
    { preHandler: requireStudioAdmin, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = getUser(request)
      const { subject, message } = request.body
      if (!subject?.trim() || !message?.trim()) return reply.badRequest('subject and message are required')

      const session = await prisma.classSession.findUnique({
        where: { id: request.params.id },
        include: {
          template: { select: { name: true } },
          studio: { select: { id: true, name: true } },
        },
      })
      if (!session) return reply.notFound()
      if (!await assertStudioAccess(user.id, user.role, session.studio.id, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: { sessionId: session.id, status: 'CONFIRMED' },
        include: { member: { include: { user: { select: { email: true, firstName: true } } } } },
      })

      if (bookings.length === 0) return reply.send({ sent: 0 })

      const webUrl = process.env.WEB_URL ?? 'http://localhost:3001'
      const results = await Promise.allSettled(
        bookings.map(b =>
          sendSessionAnnouncement({
            to: b.member.user.email,
            firstName: b.member.user.firstName,
            studioName: session.studio.name,
            className: session.template.name,
            startsAt: session.startsAt.toISOString(),
            subject: subject.trim(),
            message: message.trim(),
            webUrl,
          }),
        ),
      )

      const sent = results.filter(r => r.status === 'fulfilled' && r.value).length
      audit({ actorId: user.id, actorRole: user.role, action: 'session.announce', targetId: session.id, studioId: session.studio.id, meta: { subject, sent, total: bookings.length } })

      return reply.send({ sent, total: bookings.length })
    },
  )
}
