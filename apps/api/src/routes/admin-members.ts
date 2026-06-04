import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { audit, AUDIT } from '../lib/audit.js'
import { assertStudioAccess } from './admin-shared.js'
import { logger } from '../lib/logger.js'
import Stripe from 'stripe'
import { Id, StudioIdQuery, CursorQuery, MemberIdParam } from '../schemas.js'
import {
  AdminMemberProfileSchema, PaginatedMembersSchema, AdminMemberHistorySchema,
  StaffNoteSchema, GuestPassEntrySchema, MemberListItemSchema,
} from '../schemas/responses.js'

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

  // GET /admin/members?studioId=&q=&cursor=&take= — paginated member list
  app.get<{ Querystring: { studioId: string; q?: string; cursor?: string; take?: string } }>(
    '/members',
    {
      preHandler: requireInstructor,
      config: { studioIdFrom: 'querystring' },
      schema: {
        querystring: StudioIdQuery.merge(CursorQuery).extend({
          q: z.string().optional(),
        }),
        response: { 200: PaginatedMembersSchema },
      },
    },
    async (request, reply) => {
      const { studioId, q, cursor, take: takeStr } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)

      const take = Math.min(parseInt(takeStr ?? '50', 10) || 50, 200)

      const where: object = {
        studioId,
        ...(q && q.trim().length >= 2 ? { OR: [
          { user: { firstName: { contains: q.trim(), mode: 'insensitive' as const } } },
          { user: { lastName:  { contains: q.trim(), mode: 'insensitive' as const } } },
          { user: { email:     { contains: q.trim(), mode: 'insensitive' as const } } },
        ] } : {}),
      }

      const members = await prisma.member.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: { where: { status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { startDate: 'desc' }, take: 1, select: { status: true } },
        },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })

      const hasMore = members.length > take
      const items = hasMore ? members.slice(0, take) : members
      const nextCursor = hasMore ? items[items.length - 1].id : null

      return reply.send({
        items: items.map(m => ({
          id: m.id,
          name: `${m.user.firstName} ${m.user.lastName}`,
          email: m.user.email,
          creditBalance: m.creditBalance?.balance ?? 0,
          membershipStatus: m.memberships[0]?.status ?? null,
        })),
        nextCursor,
        hasMore,
      })
    },
  )

  // GET /admin/members/search?studioId=&q=
  app.get<{ Querystring: { studioId: string; q: string } }>(
    '/members/search',
    {
      preHandler: requireInstructor,
      config: { studioIdFrom: 'querystring' },
      schema: {
        querystring: StudioIdQuery.extend({
          q: z.string().min(1),
        }),
        response: { 200: z.array(MemberListItemSchema) },
      },
    },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!q || q.trim().length < 2) return reply.badRequest('q must be at least 2 characters')

      const user = getUser(request)

      // Instructors (not fronthosts) must have canViewMemberContact permission to see email addresses
      if (user.role === 'instructor') {
        const instructor = await prisma.instructor.findFirst({
          where: { studioId, userId: user.id },
          select: { permissions: true },
        })
        const perms = (instructor?.permissions ?? {}) as Record<string, unknown>
        if (!perms.canViewMemberContact) return reply.forbidden('canViewMemberContact permission required')
      }

      const term = q.trim()

      // ── Trigram fuzzy search via pg_trgm ─────────────────────────────────
      // Scoring:
      //   3 = name starts with the term  (best — "erik" → "Erik A.")
      //   2 = term appears anywhere in name/email  (good — substring)
      //   1 = trigram similarity only  (fuzzy — "eric" finds "Erik", misspellings)
      //
      // The similarity threshold 0.25 is deliberately low for short names.
      // For term length ≥ 4 the trigram algorithm is reliable; for shorter
      // terms we rely on the ILIKE clause so there are no spurious matches.
      const rows = await prisma.$queryRaw<{
        id: string; score: number; sim: number
      }[]>`
        SELECT
          m.id,
          CASE
            WHEN lower(u."firstName") LIKE lower(${term}) || '%'
              OR lower(u."lastName")  LIKE lower(${term}) || '%'
            THEN 3
            WHEN lower(u."firstName") LIKE '%' || lower(${term}) || '%'
              OR lower(u."lastName")  LIKE '%' || lower(${term}) || '%'
              OR lower(u.email)       LIKE '%' || lower(${term}) || '%'
            THEN 2
            ELSE 1
          END AS score,
          GREATEST(
            similarity(lower(u."firstName"),                            lower(${term})),
            similarity(lower(u."lastName"),                             lower(${term})),
            similarity(lower(u."firstName" || ' ' || u."lastName"),    lower(${term}))
          ) AS sim
        FROM "Member" m
        JOIN "User" u ON u.id = m."userId"
        WHERE m."studioId" = ${studioId}
          AND (
            lower(u."firstName") LIKE '%' || lower(${term}) || '%'
            OR lower(u."lastName")  LIKE '%' || lower(${term}) || '%'
            OR lower(u.email)       LIKE '%' || lower(${term}) || '%'
            OR (
              ${term.length} >= 4
              AND (
                similarity(lower(u."firstName"),                         lower(${term})) > 0.25
                OR similarity(lower(u."lastName"),                       lower(${term})) > 0.25
                OR similarity(lower(u."firstName" || ' ' || u."lastName"), lower(${term})) > 0.25
              )
            )
          )
        ORDER BY score DESC, sim DESC
        LIMIT 10
      `

      if (rows.length === 0) return []

      // Fetch full member data for matched IDs, preserving ranked order
      const order = new Map(rows.map((r, i) => [r.id, i]))
      const members = await prisma.member.findMany({
        where: { id: { in: rows.map(r => r.id) } },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: { where: { status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { startDate: 'desc' }, take: 1, select: { status: true } },
        },
      })

      const sorted = members.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))

      // If the query is an exact full-name match for any result, show only those.
      // Prevents "Alex Rivera" returning Alex Richardson alongside Alex Rivera.
      // Normalise whitespace so "Alex  Rivera" still matches.
      const normalisedTerm = term.toLowerCase().replace(/\s+/g, ' ')
      const exactMatches = sorted.filter(
        m => `${m.user.firstName} ${m.user.lastName}`.toLowerCase().replace(/\s+/g, ' ') === normalisedTerm
      )
      const finalResults = exactMatches.length > 0 ? exactMatches : sorted

      return finalResults.map(m => ({
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
    { preHandler: requireInstructor, schema: { params: MemberIdParam, response: { 200: AdminMemberProfileSchema } } },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)

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
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    { preHandler: requireInstructor, schema: { params: MemberIdParam, response: { 200: AdminMemberHistorySchema } } },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    {
      preHandler: requireInstructor,
      schema: {
        params: MemberIdParam,
        body: z.object({
          amount: z.number().int().refine(n => n !== 0, { message: 'amount must be non-zero' }),
          note:   z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { memberId } = request.params
      const { amount, note } = request.body

      if (!Number.isInteger(amount) || amount === 0) return reply.badRequest('amount must be a non-zero integer')

      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { id: memberId }, include: { creditBalance: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
        actorId: user.id,
        actorRole: user.role,
        action: AUDIT.CREDIT_ADJUST,
        targetId: memberId,
        studioId: member.studioId,
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
      const user = getUser(request)

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    { preHandler: requireInstructor, schema: { params: MemberIdParam, response: { 200: z.array(StaffNoteSchema) } } },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    {
      preHandler: requireInstructor,
      schema: {
        params: MemberIdParam,
        body: z.object({ content: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const { memberId } = request.params
      const { content } = request.body
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      if (!content?.trim()) return reply.badRequest('content is required')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    {
      preHandler: requireStudioAdmin,
      schema: {
        params: z.object({ memberId: Id, noteId: Id }),
      },
    },
    async (request, reply) => {
      const { memberId, noteId } = request.params
      const note = await prisma.memberNote.findUnique({
        where: { id: noteId },
        include: { member: { select: { studioId: true } } },
      })
      if (!note) return reply.notFound()
      if (note.memberId !== memberId) return reply.notFound()
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, note.member.studioId, reply, user.studioIds)) return
      await prisma.memberNote.delete({ where: { id: noteId } })
      audit({
        actorId: getUser(request).id,
        actorRole: getUser(request).role,
        action: AUDIT.MEMBER_NOTE_DELETE,
        targetId: memberId,
        studioId: note.member.studioId,
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

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
        await getStripe().subscriptions.update(sub.stripeSubId, { pause_collection: { behavior: 'void' } }).catch(err => logger.warn({ err }, 'Stripe subscription pause sync failed'))
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

      const memberForResume = await prisma.member.findUnique({ where: { id: memberId }, select: { studioId: true } })
      if (!memberForResume) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, memberForResume.studioId, reply, user.studioIds)) return

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
        } as Parameters<typeof Stripe.prototype.subscriptions.update>[1]).catch(err => logger.warn({ err }, 'Stripe subscription resume sync failed'))
      }

      audit({
        actorId: user.id, actorRole: user.role,
        action: AUDIT.RESUME_SUBSCRIPTION,
        targetId: memberId,
        studioId: memberForResume.studioId,
        meta: { subscriptionId: sub.id },
      })

      return reply.send({ success: true, status: updated.status })
    },
  )

  // POST /admin/members/:memberId/guest-passes/grant
  app.post<{ Params: { memberId: string }; Body: { amount: number; note?: string } }>(
    '/members/:memberId/guest-passes/grant',
    {
      preHandler: requireInstructor,
      schema: {
        params: MemberIdParam,
        body: z.object({
          amount: z.number().int().min(1),
          note:   z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId } = request.params
      const { amount, note } = request.body
      if (!amount || amount < 1 || !Number.isInteger(amount)) return reply.badRequest('amount must be a positive integer')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    { preHandler: requireInstructor, schema: { params: MemberIdParam, response: { 200: z.array(GuestPassEntrySchema) } } },
    async (request, reply) => {
      const { memberId } = request.params
      const user = getUser(request)

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { studioId: true } })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

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
    {
      preHandler: requireStudioAdmin,
      config: { studioIdFrom: 'querystring' },
      schema: {
        querystring: StudioIdQuery.merge(CursorQuery).extend({
          targetId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, limit: limitStr, cursor, targetId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)

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
