import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { audit, AUDIT } from '../lib/audit.js'
import { assertStudioAccess } from './admin-shared.js'
import Stripe from 'stripe'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor  = requireRole('instructor')

let _stripe: Stripe | null = null
function getStripe() { return _stripe ?? (_stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)) }

export async function adminMembersRoutes(app: FastifyInstance) {
  // GET /admin/members/:memberId/upcoming — upcoming confirmed bookings (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/upcoming',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden('Insufficient permissions')

      const member = await prisma.member.findUnique({ where: { id: request.params.memberId }, select: { studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: { memberId: request.params.memberId, status: 'CONFIRMED', session: { startsAt: { gte: new Date() } } },
        include: {
          session: {
            include: {
              template: { select: { name: true, sport: true } },
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
              room: { select: { name: true } },
            },
          },
        },
        orderBy: { session: { startsAt: 'asc' } },
      })

      return reply.send(bookings.map(b => ({
        id: b.id,
        sessionId: b.session.id,
        startsAt: b.session.startsAt.toISOString(),
        endsAt: b.session.endsAt.toISOString(),
        templateName: b.session.template.name,
        sport: b.session.template.sport,
        instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
        roomName: b.session.room.name,
        creditsRequired: b.session.creditsRequired,
        sessionStatus: b.session.status,
      })))
    },
  )

  // GET /admin/members?studioId= — list members (franchise-scoped)
  app.get<{ Querystring: { studioId: string; q?: string } }>(
    '/members',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const where = q && q.trim().length >= 2
        ? { OR: [
            { user: { firstName: { contains: q.trim(), mode: 'insensitive' as const } } },
            { user: { lastName:  { contains: q.trim(), mode: 'insensitive' as const } } },
            { user: { email:     { contains: q.trim(), mode: 'insensitive' as const } } },
          ] }
        : {}

      const members = await prisma.member.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: { where: { status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { startDate: 'desc' }, take: 1, select: { status: true } },
        },
        orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
        take: 500,
      })

      return members.map(m => ({
        id: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        creditBalance: m.creditBalance?.balance ?? 0,
        membershipStatus: m.memberships[0]?.status ?? null,
      }))
    },
  )

  // GET /admin/members/search?studioId=&q=
  app.get<{ Querystring: { studioId: string; q: string } }>(
    '/members/search',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!q || q.trim().length < 2) return reply.badRequest('q must be at least 2 characters')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const term = q.trim()
      const members = await prisma.member.findMany({
        where: {
          OR: [
            { user: { firstName: { contains: term, mode: 'insensitive' } } },
            { user: { lastName:  { contains: term, mode: 'insensitive' } } },
            { user: { email:     { contains: term, mode: 'insensitive' } } },
          ],
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: { where: { status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { startDate: 'desc' }, take: 1, select: { status: true } },
        },
        take: 10,
      })

      return members.map(m => ({
        id: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        creditBalance: m.creditBalance?.balance ?? 0,
        membershipStatus: m.memberships[0]?.status ?? null,
      }))
    },
  )

  // GET /admin/members/:memberId/profile — full profile (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/profile',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params

      const [member, memberNotes] = await Promise.all([
        prisma.member.findUnique({
          where: { id: memberId },
          include: {
            user: true,
            creditBalance: true,
            memberships: {
              where: { status: { in: ['ACTIVE', 'PAUSED'] } },
              include: { plan: true },
              take: 1,
              orderBy: { startDate: 'desc' },
            },
          },
        }),
        prisma.memberNote.findMany({
          where: { memberId },
          include: { staff: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      if (!member) return reply.notFound('Member not found')

      return reply.send({
        id: member.id,
        studioId: member.studioId,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        email: member.user.email,
        creditBalance: member.creditBalance?.balance ?? 0,
        notes: member.notes ?? null,
        birthday: member.birthday?.toISOString() ?? null,
        emergencyContactName: member.emergencyContactName ?? null,
        emergencyContactPhone: member.emergencyContactPhone ?? null,
        staffNotes: memberNotes.map(n => ({
          id: n.id,
          content: n.content,
          staffName: `${n.staff.firstName} ${n.staff.lastName}`,
          createdAt: n.createdAt.toISOString(),
        })),
        guestPassBalance: member.guestPassBalance,
        activeSubscription: member.memberships[0]
          ? {
              id: member.memberships[0].id,
              planId: member.memberships[0].planId,
              planName: member.memberships[0].plan.name,
              status: member.memberships[0].status,
              pausedUntil: member.memberships[0].pausedUntil?.toISOString() ?? null,
              startDate: member.memberships[0].startDate.toISOString(),
              endDate: member.memberships[0].endDate?.toISOString() ?? null,
            }
          : null,
        joinedAt: member.joinedAt.toISOString(),
      })
    },
  )

  // GET /admin/members/:memberId/history — booking + transaction history (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/history',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } })
      if (!member) return reply.notFound('Member not found')

      const now = new Date()
      const [bookings, transactions] = await Promise.all([
        prisma.booking.findMany({
          where: { memberId },
          include: {
            session: {
              include: {
                template: { select: { name: true, sport: true } },
                instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
                room: { select: { name: true } },
              },
            },
          },
          orderBy: { session: { startsAt: 'desc' } },
          take: 100,
        }),
        prisma.creditTransaction.findMany({ where: { memberId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ])

      return reply.send({
        upcoming: bookings
          .filter(b => b.status === 'CONFIRMED' && b.session.startsAt >= now)
          .map(b => ({
            id: b.id, sessionId: b.sessionId,
            startsAt: b.session.startsAt.toISOString(), endsAt: b.session.endsAt.toISOString(),
            templateName: b.session.template.name, sport: b.session.template.sport,
            instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
            roomName: b.session.room.name, creditsRequired: b.session.creditsRequired, sessionStatus: b.session.status,
          })),
        pastBookings: bookings
          .filter(b => b.session.startsAt < now)
          .map(b => ({
            id: b.id, sessionId: b.sessionId,
            startsAt: b.session.startsAt.toISOString(), endsAt: b.session.endsAt.toISOString(),
            templateName: b.session.template.name, sport: b.session.template.sport,
            instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
            roomName: b.session.room.name, status: b.status, checkedIn: b.checkedIn, creditsRequired: b.session.creditsRequired,
          })),
        transactions: transactions.map(t => ({ id: t.id, amount: t.amount, type: t.type, note: t.note ?? null, createdAt: t.createdAt.toISOString() })),
      })
    },
  )

  // POST /admin/members/:memberId/credits — manual credit adjustment (fronthost+)
  app.post<{ Params: { memberId: string }; Body: { amount: number; note?: string } }>(
    '/members/:memberId/credits',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { amount, note } = request.body

      if (!Number.isInteger(amount) || amount === 0) return reply.badRequest('amount must be a non-zero integer')

      const member = await prisma.member.findUnique({ where: { id: memberId }, include: { creditBalance: true } })
      if (!member) return reply.notFound('Member not found')

      const [balance] = await prisma.$transaction([
        prisma.creditBalance.upsert({
          where: { memberId },
          create: { memberId, balance: Math.max(0, amount) },
          update: { balance: { increment: amount } },
        }),
        prisma.creditTransaction.create({
          data: { memberId, amount, type: 'MANUAL_ADJUSTMENT', note: note ?? 'Manual adjustment by staff' },
        }),
      ])

      audit({
        actorId: getUser(request).id,
        actorRole: getUser(request).role,
        action: AUDIT.CREDIT_ADJUST,
        targetId: memberId,
        meta: { amount, note, newBalance: balance.balance },
      })

      return { success: true, newBalance: balance.balance }
    },
  )

  // PATCH /admin/members/:memberId — update member notes (fronthost+)
  app.patch<{ Params: { memberId: string }; Body: { notes?: string | null } }>(
    '/members/:memberId',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { notes } = request.body

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } })
      if (!member) return reply.notFound('Member not found')

      const updated = await prisma.member.update({
        where: { id: memberId },
        data: { notes: notes ?? null },
        select: { id: true, notes: true },
      })

      return { success: true, data: updated }
    },
  )

  // GET /admin/members/:memberId/notes
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/notes',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } })
      if (!member) return reply.notFound('Member not found')

      const notes = await prisma.memberNote.findMany({
        where: { memberId },
        include: { staff: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(notes.map(n => ({
        id: n.id, content: n.content,
        staffName: `${n.staff.firstName} ${n.staff.lastName}`,
        createdAt: n.createdAt.toISOString(),
      })))
    },
  )

  // POST /admin/members/:memberId/notes
  app.post<{ Params: { memberId: string }; Body: { content: string } }>(
    '/members/:memberId/notes',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { content } = request.body
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      if (!content?.trim()) return reply.badRequest('content is required')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } })
      if (!member) return reply.notFound('Member not found')

      const note = await prisma.memberNote.create({
        data: { memberId, staffId: user.id, content: content.trim() },
        include: { staff: { select: { firstName: true, lastName: true } } },
      })

      return reply.code(201).send({
        id: note.id, content: note.content,
        staffName: `${note.staff.firstName} ${note.staff.lastName}`,
        createdAt: note.createdAt.toISOString(),
      })
    },
  )

  // DELETE /admin/members/:memberId/notes/:noteId
  app.delete<{ Params: { memberId: string; noteId: string } }>(
    '/members/:memberId/notes/:noteId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId, noteId } = request.params
      const note = await prisma.memberNote.findUnique({ where: { id: noteId } })
      if (!note) return reply.notFound()
      if (note.memberId !== memberId) return reply.notFound()
      await prisma.memberNote.delete({ where: { id: noteId } })
      audit({
        actorId: getUser(request).id,
        actorRole: getUser(request).role,
        action: AUDIT.MEMBER_NOTE_DELETE,
        targetId: memberId,
        meta: { noteId },
      })
      return reply.send({ success: true })
    },
  )

  // PATCH /admin/members/:memberId/profile — update enriched profile fields (fronthost+)
  app.patch<{
    Params: { memberId: string }
    Body: { birthday?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }
  }>(
    '/members/:memberId/profile',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { birthday, emergencyContactName, emergencyContactPhone } = request.body
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true } })
      if (!member) return reply.notFound('Member not found')

      const updated = await prisma.member.update({
        where: { id: memberId },
        data: {
          ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
          ...(emergencyContactName  !== undefined && { emergencyContactName:  emergencyContactName  ?? null }),
          ...(emergencyContactPhone !== undefined && { emergencyContactPhone: emergencyContactPhone ?? null }),
        },
        select: { id: true, birthday: true, emergencyContactName: true, emergencyContactPhone: true },
      })

      return reply.send({
        success: true,
        birthday: updated.birthday?.toISOString() ?? null,
        emergencyContactName: updated.emergencyContactName,
        emergencyContactPhone: updated.emergencyContactPhone,
      })
    },
  )

  // POST /admin/members/:memberId/subscription/pause
  app.post<{ Params: { memberId: string }; Body: { pausedUntil?: string | null } }>(
    '/members/:memberId/subscription/pause',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId } = request.params
      const { pausedUntil } = request.body ?? {}

      const sub = await prisma.membershipSubscription.findFirst({
        where: { memberId, status: { in: ['ACTIVE', 'PAUSED'] } },
        orderBy: { startDate: 'desc' },
        include: { plan: { select: { studioId: true } } },
      })
      if (!sub) return reply.notFound('No active subscription found')

      const studioRules = await prisma.studio.findUnique({
        where: { id: sub.plan.studioId },
        select: { maxPauseDays: true, maxPausesPerYear: true },
      })
      const maxPauseDays    = studioRules?.maxPauseDays    ?? 30
      const maxPausesPerYear = studioRules?.maxPausesPerYear ?? 2

      if (pausedUntil) {
        const pauseEnd  = new Date(pausedUntil)
        const pauseDays = Math.ceil((pauseEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        if (pauseDays > maxPauseDays) return reply.badRequest(`Pause duration cannot exceed ${maxPauseDays} days`)
      }

      const yearStart = new Date(new Date().getFullYear(), 0, 1)
      const pausesThisYear = await prisma.membershipSubscription.count({
        where: { memberId, status: 'PAUSED', updatedAt: { gte: yearStart } },
      })
      if (pausesThisYear >= maxPausesPerYear) {
        return reply.badRequest(`Maximum of ${maxPausesPerYear} pause${maxPausesPerYear !== 1 ? 's' : ''} per year reached`)
      }

      const updated = await prisma.membershipSubscription.update({
        where: { id: sub.id },
        data: { status: 'PAUSED', pausedUntil: pausedUntil ? new Date(pausedUntil) : null },
      })

      if (sub.stripeSubId) {
        await getStripe().subscriptions.update(sub.stripeSubId, { pause_collection: { behavior: 'void' } }).catch(() => {})
      }

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.PAUSE_SUBSCRIPTION,
        targetId: memberId, studioId: sub.plan.studioId,
        meta: { subscriptionId: sub.id, pausedUntil },
      })

      return reply.send({ success: true, status: updated.status, pausedUntil: updated.pausedUntil?.toISOString() ?? null })
    },
  )

  // POST /admin/members/:memberId/subscription/resume
  app.post<{ Params: { memberId: string } }>(
    '/members/:memberId/subscription/resume',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId } = request.params

      const sub = await prisma.membershipSubscription.findFirst({
        where: { memberId, status: 'PAUSED' },
        orderBy: { startDate: 'desc' },
      })
      if (!sub) return reply.notFound('No paused subscription found')

      const updated = await prisma.membershipSubscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', pausedUntil: null },
      })

      if (sub.stripeSubId) {
        await getStripe().subscriptions.update(sub.stripeSubId, {
          pause_collection: '',
        } as Parameters<typeof Stripe.prototype.subscriptions.update>[1]).catch(() => {})
      }

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.RESUME_SUBSCRIPTION,
        targetId: memberId,
        meta: { subscriptionId: sub.id },
      })

      return reply.send({ success: true, status: updated.status })
    },
  )

  // POST /admin/members/:memberId/guest-passes/grant
  app.post<{ Params: { memberId: string }; Body: { amount: number; note?: string } }>(
    '/members/:memberId/guest-passes/grant',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId } = request.params
      const { amount, note } = request.body
      if (!amount || amount < 1 || !Number.isInteger(amount)) return reply.badRequest('amount must be a positive integer')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')

      await prisma.$transaction([
        prisma.member.update({ where: { id: memberId }, data: { guestPassBalance: { increment: amount } } }),
        prisma.guestPass.create({ data: { memberId, studioId: member.studioId, amount, note: note ?? `Granted by staff` } }),
      ])

      const updated = await prisma.member.findUnique({ where: { id: memberId }, select: { guestPassBalance: true } })

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.GUEST_PASS_GRANT,
        targetId: memberId, studioId: member.studioId,
        meta: { amount, note, newBalance: updated!.guestPassBalance },
      })

      return reply.send({ success: true, guestPassBalance: updated!.guestPassBalance })
    },
  )

  // GET /admin/members/:memberId/guest-passes — guest pass log (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/guest-passes',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const passes = await prisma.guestPass.findMany({ where: { memberId }, orderBy: { createdAt: 'desc' }, take: 50 })
      return reply.send(passes.map(p => ({
        id: p.id, guestName: p.guestName, sessionId: p.sessionId,
        amount: p.amount, note: p.note, createdAt: p.createdAt.toISOString(),
      })))
    },
  )

  // GET /admin/members/:memberId/purchases — purchase history (fronthost+)
  app.get<{ Params: { memberId: string }; Querystring: { studioId?: string } }>(
    '/members/:memberId/purchases',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId } = request.params
      const { studioId } = request.query

      const sales = await prisma.productSale.findMany({
        where: { memberId, ...(studioId ? { studioId } : {}) },
        orderBy: { soldAt: 'desc' },
        take: 50,
      })

      return reply.send(sales)
    },
  )

  // GET /admin/audit-log?studioId=&limit=&cursor= — paginated audit log (studio_admin+)
  app.get<{ Querystring: { studioId: string; limit?: string; cursor?: string; targetId?: string } }>(
    '/audit-log',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, limit: limitStr, cursor, targetId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200)

      const entries = await prisma.auditLog.findMany({
        where: {
          studioId,
          ...(targetId ? { targetId } : {}),
          ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1, // fetch one extra to determine if there's a next page
      })

      const hasMore = entries.length > limit
      const page = entries.slice(0, limit)

      return reply.send({
        entries: page.map(e => ({
          id: e.id,
          actorId: e.actorId,
          actorRole: e.actorRole,
          action: e.action,
          targetId: e.targetId,
          meta: e.meta,
          studioId: e.studioId,
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      })
    },
  )
}
