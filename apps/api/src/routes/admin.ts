import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK, type UserRole } from '@packd/types'
import { enqueueNoShowCheck } from '../jobs/index.js'
import Stripe from 'stripe'

// Lazy-init so tests without STRIPE_SECRET_KEY don't blow up at import time
let _stripe: Stripe | null = null
function getStripe() { return _stripe ?? (_stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)) }

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor = requireRole('instructor')

// Allowlist of valid session statuses
const VALID_SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
type SessionStatus = typeof VALID_SESSION_STATUSES[number]

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/sessions?studioId=&date= — instructor/fronthost or higher
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/sessions',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, date } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const day = date ? new Date(date) : new Date()
      const from = new Date(day)
      from.setHours(0, 0, 0, 0)
      const to = new Date(day)
      to.setHours(23, 59, 59, 999)

      const sessions = await prisma.classSession.findMany({
        where: { studioId, startsAt: { gte: from, lte: to } },
        include: {
          template: true,
          instructor: { include: { user: true } },
          room: true,
          _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
        },
        orderBy: { startsAt: 'asc' },
      })

      return sessions.map((s) => ({
        id: s.id,
        templateName: s.template.name,
        sport: s.template.sport,
        instructorName: `${s.instructor.user.firstName} ${s.instructor.user.lastName}`,
        instructorUserId: s.instructor.userId,
        roomId: s.roomId,
        roomName: s.room.name,
        capacity: s.capacity,
        bookedCount: s._count.bookings,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        creditsRequired: s.creditsRequired,
      }))
    },
  )

  // GET /admin/sessions/:id/bookings — instructor or higher
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/bookings',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: { sessionId: request.params.id, status: 'CONFIRMED' },
        include: {
          member: { include: { user: true, creditBalance: true } },
        },
        orderBy: { bookedAt: 'asc' },
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
      }))
    },
  )

  // POST /admin/sessions/:id/checkin/:bookingId — instructor or higher
  app.post<{ Params: { id: string; bookingId: string } }>(
    '/sessions/:id/checkin/:bookingId',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      const session = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, session.studioId, reply, user.studioIds)) return

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.bookingId },
      })

      if (booking.sessionId !== request.params.id) return reply.notFound()

      const updated = await prisma.booking.update({
        where: { id: request.params.bookingId },
        data: {
          checkedIn: !booking.checkedIn,
          checkedInAt: !booking.checkedIn ? new Date() : null,
        },
      })
      return { success: true, checkedIn: updated.checkedIn }
    },
  )

  // PATCH /admin/sessions/:id — studio_admin or higher
  // Accepts: { status? } to update status, or { startsAt, endsAt } to reschedule.
  app.patch<{ Params: { id: string }; Body: { status?: string; startsAt?: string; endsAt?: string } }>(
    '/sessions/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { status, startsAt, endsAt } = request.body

      const user = getUser(request)
      const existing = await prisma.classSession.findUniqueOrThrow({
        where: { id: request.params.id },
      })
      if (!await assertStudioAccess(user.id, user.role, existing.studioId, reply, user.studioIds)) return

      // ── Reschedule (drag-to-reschedule) ───────────────────────────────────
      if (startsAt !== undefined || endsAt !== undefined) {
        if (!startsAt || !endsAt) return reply.badRequest('Both startsAt and endsAt are required for reschedule')
        const newStart = new Date(startsAt)
        const newEnd   = new Date(endsAt)
        if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return reply.badRequest('Invalid date format')
        if (newEnd <= newStart) return reply.badRequest('endsAt must be after startsAt')

        const session = await prisma.classSession.update({
          where: { id: request.params.id },
          data: { startsAt: newStart, endsAt: newEnd },
        })
        return reply.send({ success: true, startsAt: session.startsAt.toISOString(), endsAt: session.endsAt.toISOString() })
      }

      // ── Status update ──────────────────────────────────────────────────────
      if (!status) return reply.badRequest('status is required')
      if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
        return reply.badRequest(`Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}`)
      }

      const session = await prisma.classSession.update({
        where: { id: request.params.id },
        data: { status: status as SessionStatus },
      })

      // When a session completes, trigger no-show fee processing
      if (status === 'COMPLETED') {
        await enqueueNoShowCheck(session.id, session.startsAt).catch(err =>
          console.error('[jobs] failed to enqueue no-show check', err),
        )
      }

      return reply.send({ success: true, status: session.status })
    },
  )

  // GET /admin/members/:memberId/upcoming — member's upcoming confirmed bookings (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/upcoming',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden('Insufficient permissions')

      const member = await prisma.member.findUnique({
        where: { id: request.params.memberId },
        select: { studioId: true },
      })
      if (!member) return reply.notFound('Member not found')
      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

      const bookings = await prisma.booking.findMany({
        where: {
          memberId: request.params.memberId,
          status: 'CONFIRMED',
          session: { startsAt: { gte: new Date() } },
        },
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

  // GET /admin/stats?studioId= — instructor/fronthost or higher
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId } = request.query

      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [studio, todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { name: true, timeFormat: true, currency: true } }),
        prisma.classSession.count({ where: { studioId, startsAt: { gte: today, lt: tomorrow } } }),
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({
          where: { session: { studioId }, bookedAt: { gte: today }, status: 'CONFIRMED' },
        }),
        prisma.waitlistEntry.count({
          where: { session: { studioId }, joinedAt: { gte: today }, status: 'WAITING' },
        }),
      ])

      return { studioName: studio?.name ?? null, timeFormat: studio?.timeFormat ?? '24h', currency: studio?.currency ?? 'USD', todaySessions, totalMembers, totalBookingsToday, waitlistToday }
    },
  )

  // GET /admin/members?studioId= — list all franchise members (studioId used only for access check)
  app.get<{ Querystring: { studioId: string; q?: string } }>(
    '/members',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      // Members are franchise-scoped — studioId is only used for access control above.
      // Search across all members in the franchise (entire DB for single-franchise deployments).
      const where = q && q.trim().length >= 2
        ? {
            OR: [
              { user: { firstName: { contains: q.trim(), mode: 'insensitive' as const } } },
              { user: { lastName:  { contains: q.trim(), mode: 'insensitive' as const } } },
              { user: { email:     { contains: q.trim(), mode: 'insensitive' as const } } },
            ],
          }
        : {}

      const members = await prisma.member.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: { status: true },
          },
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

  // GET /admin/members/search?studioId=&q= — search franchise members by name or email
  app.get<{ Querystring: { studioId: string; q: string } }>(
    '/members/search',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId, q } = request.query
      if (!q || q.trim().length < 2) return reply.badRequest('q must be at least 2 characters')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      // Search across all franchise members — studioId only used for access check above.
      const term = q.trim()
      const members = await prisma.member.findMany({
        where: {
          OR: [
            { user: { firstName: { contains: term, mode: 'insensitive' } } },
            { user: { lastName: { contains: term, mode: 'insensitive' } } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: { status: true },
          },
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

  // GET /admin/members/:memberId/profile — full member profile (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/profile',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params

      // Members are franchise-scoped; any staff member (requireInstructor) may view any member.
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
          // guestPassBalance is a scalar field — included automatically
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

      // Members are franchise-scoped; any staff member (requireInstructor) may view any member.
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { id: true },
      })
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
        prisma.creditTransaction.findMany({
          where: { memberId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ])

      return reply.send({
        upcoming: bookings
          .filter(b => b.status === 'CONFIRMED' && b.session.startsAt >= now)
          .map(b => ({
            id: b.id,
            sessionId: b.sessionId,
            startsAt: b.session.startsAt.toISOString(),
            endsAt: b.session.endsAt.toISOString(),
            templateName: b.session.template.name,
            sport: b.session.template.sport,
            instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
            roomName: b.session.room.name,
            creditsRequired: b.session.creditsRequired,
            sessionStatus: b.session.status,
          })),
        pastBookings: bookings
          .filter(b => b.session.startsAt < now)
          .map(b => ({
            id: b.id,
            sessionId: b.sessionId,
            startsAt: b.session.startsAt.toISOString(),
            endsAt: b.session.endsAt.toISOString(),
            templateName: b.session.template.name,
            sport: b.session.template.sport,
            instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
            roomName: b.session.room.name,
            status: b.status,
            checkedIn: b.checkedIn,
            creditsRequired: b.session.creditsRequired,
          })),
        transactions: transactions.map(t => ({
          id: t.id,
          amount: t.amount,
          type: t.type,
          note: t.note ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
      })
    },
  )

  // POST /admin/members/:memberId/credits — manual credit adjustment (fronthost or higher)
  app.post<{ Params: { memberId: string }; Body: { amount: number; note?: string } }>(
    '/members/:memberId/credits',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const { amount, note } = request.body

      if (!Number.isInteger(amount) || amount === 0) {
        return reply.badRequest('amount must be a non-zero integer')
      }

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { creditBalance: true },
      })
      // Members are franchise-scoped; any staff member (requireInstructor) may adjust credits.
      if (!member) return reply.notFound('Member not found')

      const [balance] = await prisma.$transaction([
        prisma.creditBalance.upsert({
          where: { memberId },
          create: { memberId, balance: Math.max(0, amount) },
          update: { balance: { increment: amount } },
        }),
        prisma.creditTransaction.create({
          data: {
            memberId,
            amount,
            type: 'MANUAL_ADJUSTMENT',
            note: note ?? 'Manual adjustment by staff',
          },
        }),
      ])

      return { success: true, newBalance: balance.balance }
    },
  )

  // POST /admin/product-sales — record a cash/terminal product sale (fronthost+)
  app.post<{
    Body: {
      memberId: string
      studioId: string
      items: { productId: string; name: string; qty: number; priceInCents: number; creditsRequired: number }[]
      totalCents: number
      totalCredits: number
      paymentMethod: 'cash' | 'credits' | 'free'
    }
  }>(
    '/product-sales',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId, studioId, items, totalCents, totalCredits, paymentMethod } = request.body
      const user = getUser(request)

      await prisma.$transaction(async (tx) => {
        if (totalCredits > 0) {
          await tx.creditBalance.update({
            where: { memberId },
            data: { balance: { decrement: totalCredits } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId,
              amount: -totalCredits,
              type: 'PURCHASE',
              note: `Products: ${items.map(i => i.name).join(', ')}`,
            },
          })
        }
        await tx.productSale.create({
          data: { memberId, studioId, items, totalCents, totalCredits, paymentMethod, staffUserId: user.id },
        })
      })

      return reply.send({ success: true })
    },
  )

  // GET /admin/product-sales?studioId=&date= — member IDs who had products charged today (fronthost+)
  app.get<{ Querystring: { studioId: string; date?: string } }>(
    '/product-sales',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { studioId, date } = request.query

      const dayStart = date ? new Date(`${date}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0))
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const sales = await prisma.productSale.findMany({
        where: { studioId, soldAt: { gte: dayStart, lt: dayEnd } },
        select: { memberId: true },
        distinct: ['memberId'],
      })

      return reply.send({ memberIds: sales.map(s => s.memberId) })
    },
  )

  // PATCH /admin/members/:memberId — update member notes (fronthost or higher)
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

  // POST /admin/query — run a SELECT query against the database (studio_admin+)
  app.post<{ Body: { sql: string; studioId: string } }>(
    '/query',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { sql, studioId } = request.body
      if (!studioId) return reply.badRequest('studioId is required')
      if (!sql || typeof sql !== 'string') return reply.badRequest('sql is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      // ── Security: only allow SELECT / WITH queries ────────────────────────
      const err = validateSelectQuery(sql)
      if (err) return reply.badRequest(err)

      // ── Wrap in a row-cap subquery (max 500 rows) ─────────────────────────
      const capped = `SELECT * FROM (${sql}) AS _result LIMIT 500`

      const t0 = Date.now()
      let rows: Record<string, unknown>[]
      try {
        rows = await prisma.$queryRawUnsafe(capped)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // Strip the "prisma.$queryRawUnsafe is not a safe API…" prefix if present
        return reply.badRequest(msg.replace(/^.*\n/, '').trim())
      }
      const duration = Date.now() - t0

      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      const data = rows.map(r => columns.map(c => {
        const v = r[c]
        if (v instanceof Date) return v.toISOString()
        if (typeof v === 'bigint') return Number(v)
        return v ?? null
      }))

      return reply.send({ columns, rows: data, rowCount: rows.length, duration })
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

      // Summarise by template
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
        await prisma.classSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { substituteInstructorId },
        })
        return reply.send({ affected: sessionIds.length, sessionIds })
      }

      // CANCEL: cancel sessions + refund bookings
      await prisma.$transaction(async (tx) => {
        // Cancel all sessions
        await tx.classSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { status: 'CANCELLED' },
        })

        // Find all CONFIRMED bookings for these sessions
        const bookings = await tx.booking.findMany({
          where: { sessionId: { in: sessionIds }, status: 'CONFIRMED' },
          select: { id: true, memberId: true, sessionId: true },
        })

        if (bookings.length > 0) {
          // Cancel bookings
          await tx.booking.updateMany({
            where: { id: { in: bookings.map(b => b.id) } },
            data: { status: 'CANCELLED', stationId: null },
          })

          // Refund credits per session's creditsRequired
          const sessionCredits = new Map(sessions.map(s => [s.id, s.creditsRequired]))
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

      return reply.send({ affected: sessionIds.length, sessionIds })
    },
  )

  // GET /admin/leaderboard?studioId=&period=week|month|alltime
  app.get<{ Querystring: { studioId: string; period?: string } }>(
    '/leaderboard',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, period = 'month' } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const now = new Date()
      let from: Date | undefined
      if (period === 'week') {
        from = new Date(now)
        from.setDate(from.getDate() - 7)
      } else if (period === 'month') {
        from = new Date(now)
        from.setMonth(from.getMonth() - 1)
      }
      // alltime: no from filter

      const bookings = await prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          session: {
            studioId,
            startsAt: { lt: now, ...(from ? { gte: from } : {}) },
            status: { not: 'CANCELLED' },
          },
        },
        select: {
          memberId: true,
          checkedIn: true,
          session: {
            select: {
              startsAt: true,
              instructorId: true,
              substituteInstructorId: true,
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
          member: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      })

      // Members leaderboard
      const memberMap = new Map<string, { name: string; visits: number; checkIns: number; lastVisit: Date }>()
      for (const b of bookings) {
        const existing = memberMap.get(b.memberId) ?? {
          name: `${b.member.user.firstName} ${b.member.user.lastName}`,
          visits: 0, checkIns: 0, lastVisit: new Date(0),
        }
        memberMap.set(b.memberId, {
          ...existing,
          visits: existing.visits + 1,
          checkIns: existing.checkIns + (b.checkedIn ? 1 : 0),
          lastVisit: b.session.startsAt > existing.lastVisit ? b.session.startsAt : existing.lastVisit,
        })
      }
      const members = Array.from(memberMap.entries())
        .sort((a, b) => b[1].visits - a[1].visits)
        .slice(0, 25)
        .map(([memberId, v], i) => ({
          rank: i + 1,
          memberId,
          name: v.name,
          visits: v.visits,
          checkIns: v.checkIns,
          lastVisit: v.lastVisit.toISOString(),
        }))

      // Top instructors by total confirmed attendees
      const instrMap = new Map<string, { name: string; totalBookings: number }>()
      for (const b of bookings) {
        const instr = b.session.instructor
        if (!instr) continue
        const id = b.session.substituteInstructorId ?? b.session.instructorId
        const name = `${instr.user.firstName} ${instr.user.lastName}`
        const existing = instrMap.get(id) ?? { name, totalBookings: 0 }
        instrMap.set(id, { ...existing, totalBookings: existing.totalBookings + 1 })
      }
      const topInstructors = Array.from(instrMap.entries())
        .sort((a, b) => b[1].totalBookings - a[1].totalBookings)
        .slice(0, 5)
        .map(([id, v], i) => ({ rank: i + 1, instructorId: id, name: v.name, totalBookings: v.totalBookings }))

      return reply.send({ members, topInstructors, period, generatedAt: now.toISOString() })
    },
  )

  // GET /admin/members/:memberId/notes — staff notes log (fronthost+)
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
        id: n.id,
        content: n.content,
        staffName: `${n.staff.firstName} ${n.staff.lastName}`,
        createdAt: n.createdAt.toISOString(),
      })))
    },
  )

  // POST /admin/members/:memberId/notes — create staff note (fronthost+)
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
        id: note.id,
        content: note.content,
        staffName: `${note.staff.firstName} ${note.staff.lastName}`,
        createdAt: note.createdAt.toISOString(),
      })
    },
  )

  // DELETE /admin/members/:memberId/notes/:noteId — delete note (studio_admin+)
  app.delete<{ Params: { memberId: string; noteId: string } }>(
    '/members/:memberId/notes/:noteId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId, noteId } = request.params
      const note = await prisma.memberNote.findUnique({ where: { id: noteId } })
      if (!note) return reply.notFound()
      // Scope guard: note must belong to the member in the URL (prevents cross-studio delete)
      if (note.memberId !== memberId) return reply.notFound()
      await prisma.memberNote.delete({ where: { id: noteId } })
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

  // POST /admin/members/:memberId/subscription/pause — pause active membership (fronthost+)
  app.post<{
    Params: { memberId: string }
    Body: { pausedUntil?: string | null }
  }>(
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
      })
      if (!sub) return reply.notFound('No active subscription found')

      const updated = await prisma.membershipSubscription.update({
        where: { id: sub.id },
        data: {
          status: 'PAUSED',
          pausedUntil: pausedUntil ? new Date(pausedUntil) : null,
        },
      })

      // Pause Stripe billing so the member isn't charged while paused
      if (sub.stripeSubId) {
        await getStripe().subscriptions.update(sub.stripeSubId, {
          pause_collection: { behavior: 'void' },
        }).catch(() => {}) // non-fatal — DB is source of truth
      }

      return reply.send({ success: true, status: updated.status, pausedUntil: updated.pausedUntil?.toISOString() ?? null })
    },
  )

  // POST /admin/members/:memberId/subscription/resume — resume paused membership (fronthost+)
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

      // Resume Stripe billing
      if (sub.stripeSubId) {
        await getStripe().subscriptions.update(sub.stripeSubId, {
          pause_collection: '',
        } as Parameters<typeof Stripe.prototype.subscriptions.update>[1]).catch(() => {})
      }

      return reply.send({ success: true, status: updated.status })
    },
  )

  // POST /admin/members/:memberId/guest-passes/grant — manually grant guest passes (fronthost+)
  app.post<{
    Params: { memberId: string }
    Body: { amount: number; note?: string }
  }>(
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
        prisma.member.update({
          where: { id: memberId },
          data: { guestPassBalance: { increment: amount } },
        }),
        prisma.guestPass.create({
          data: { memberId, studioId: member.studioId, amount, note: note ?? `Granted by staff` },
        }),
      ])

      const updated = await prisma.member.findUnique({ where: { id: memberId }, select: { guestPassBalance: true } })
      return reply.send({ success: true, guestPassBalance: updated!.guestPassBalance })
    },
  )

  // POST /admin/guest-checkin — use one guest pass, log guest attendance (fronthost+)
  app.post<{
    Body: { memberId: string; guestName: string; sessionId?: string; studioId: string }
  }>(
    '/guest-checkin',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const user = getUser(request)
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()
      const { memberId, guestName, sessionId, studioId } = request.body
      if (!memberId || !guestName?.trim() || !studioId) return reply.badRequest('memberId, guestName and studioId are required')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, guestPassBalance: true } })
      if (!member) return reply.notFound('Member not found')

      // Atomic check-and-decrement: updateMany with balance guard prevents double-spend
      // under concurrent requests for the same member.
      const { count } = await prisma.member.updateMany({
        where: { id: memberId, guestPassBalance: { gte: 1 } },
        data: { guestPassBalance: { decrement: 1 } },
      })
      if (count === 0) return reply.badRequest('Member has no guest passes remaining')

      await prisma.guestPass.create({
        data: {
          memberId,
          studioId,
          guestName: guestName.trim(),
          sessionId: sessionId ?? null,
          amount: -1,
          note: `Guest check-in: ${guestName.trim()}`,
        },
      })

      const updated = await prisma.member.findUnique({ where: { id: memberId }, select: { guestPassBalance: true } })
      return reply.send({ success: true, guestPassBalance: updated!.guestPassBalance })
    },
  )

  // GET /admin/members/:memberId/guest-passes — guest pass log (fronthost+)
  app.get<{ Params: { memberId: string } }>(
    '/members/:memberId/guest-passes',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { memberId } = request.params
      const passes = await prisma.guestPass.findMany({
        where: { memberId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return reply.send(passes.map(p => ({
        id: p.id,
        guestName: p.guestName,
        sessionId: p.sessionId,
        amount: p.amount,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
      })))
    },
  )

  // GET /admin/analytics?studioId=&weeks=12
  // Returns utilization analytics: heatmap, weekly trend, class rankings,
  // instructor stats, booking funnel, and member recurrence rates.
  // Pass studioId=all (franchise_admin+ only) to aggregate across every studio.
  app.get<{ Querystring: { studioId: string; weeks?: string } }>(
    '/analytics',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)

      // 'all' mode: franchise_admin+ only
      const allStudios = studioId === 'all'
      if (allStudios && ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin']) {
        return reply.forbidden('franchise_admin role required to view all-studios analytics')
      }

      const weeks = Math.min(Math.max(parseInt(request.query.weeks ?? '12', 10) || 12, 4), 52)
      const now = new Date()

      // Monday of current week (start of the analytics window)
      const windowStart = new Date(now)
      windowStart.setHours(0, 0, 0, 0)
      const dayOfWeek = windowStart.getDay() || 7   // Mon=1…Sun=7
      windowStart.setDate(windowStart.getDate() - (dayOfWeek - 1) - (weeks - 1) * 7)

      // Fetch all non-cancelled past sessions in the window with their bookings
      const sessions = await prisma.classSession.findMany({
        where: {
          ...(allStudios ? {} : { studioId }),
          status: { not: 'CANCELLED' },
          startsAt: { gte: windowStart, lt: now },
        },
        include: {
          template: { select: { id: true, name: true, sport: true } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          substitute: { include: { user: { select: { firstName: true, lastName: true } } } },
          bookings: { select: { status: true, checkedIn: true, memberId: true } },
        },
        orderBy: { startsAt: 'asc' },
      })

      // ── Helpers ──────────────────────────────────────────────────────────────

      // ISO week Monday (Mon=0…Sun=6 local time)
      function isoWeekMonday(d: Date): string {
        const copy = new Date(d)
        copy.setHours(0, 0, 0, 0)
        const dow = copy.getDay() || 7
        copy.setDate(copy.getDate() - (dow - 1))
        return copy.toISOString().slice(0, 10)
      }

      // 0=Mon … 6=Sun (Monday-first)
      function monFirstDow(d: Date): number {
        return (d.getDay() + 6) % 7
      }

      // ── Heatmap: fill rate by day-of-week × hour ──────────────────────────

      const heatmapMap = new Map<string, { total: number; sum: number }>()
      for (const s of sessions) {
        const key = `${monFirstDow(s.startsAt)}_${s.startsAt.getHours()}`
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const fill = s.capacity > 0 ? confirmed / s.capacity : 0
        const existing = heatmapMap.get(key) ?? { total: 0, sum: 0 }
        heatmapMap.set(key, { total: existing.total + 1, sum: existing.sum + fill })
      }
      const heatmap = Array.from(heatmapMap.entries()).map(([key, v]) => {
        const [dow, hour] = key.split('_').map(Number)
        return { dow, hour, fillRate: v.sum / v.total, count: v.total }
      })

      // ── Weekly trend ──────────────────────────────────────────────────────

      const weekMap = new Map<string, {
        sessions: number; capacitySum: number; confirmedSum: number
        checkedInSum: number; cancelledSum: number
      }>()

      // Pre-populate all weeks so weeks with no sessions still appear
      for (let w = 0; w < weeks; w++) {
        const d = new Date(windowStart.getTime() + w * 7 * 86400000)
        weekMap.set(d.toISOString().slice(0, 10), { sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0, cancelledSum: 0 })
      }

      for (const s of sessions) {
        const wk = isoWeekMonday(s.startsAt)
        const entry = weekMap.get(wk) ?? { sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0, cancelledSum: 0 }
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const cancelled = s.bookings.filter(b => b.status === 'CANCELLED' || b.status === 'LATE_CANCELLED').length
        weekMap.set(wk, {
          sessions: entry.sessions + 1,
          capacitySum: entry.capacitySum + s.capacity,
          confirmedSum: entry.confirmedSum + confirmed,
          checkedInSum: entry.checkedInSum + checkedIn,
          cancelledSum: entry.cancelledSum + cancelled,
        })
      }

      const weeklyTrend = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, v]) => ({
          weekStart,
          sessions: v.sessions,
          avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0,
          checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0,
          cancelRate: (v.confirmedSum + v.cancelledSum) > 0
            ? v.cancelledSum / (v.confirmedSum + v.cancelledSum) : 0,
        }))

      // ── Class stats by template ───────────────────────────────────────────

      const classMap = new Map<string, {
        name: string; sport: string
        sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number
      }>()
      for (const s of sessions) {
        const tid = s.template.id
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const existing = classMap.get(tid) ?? { name: s.template.name, sport: s.template.sport, sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0 }
        classMap.set(tid, {
          ...existing,
          sessions: existing.sessions + 1,
          capacitySum: existing.capacitySum + s.capacity,
          confirmedSum: existing.confirmedSum + confirmed,
          checkedInSum: existing.checkedInSum + checkedIn,
        })
      }
      const classStats = Array.from(classMap.entries()).map(([templateId, v]) => ({
        templateId,
        name: v.name,
        sport: v.sport,
        sessions: v.sessions,
        avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0,
        checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0,
        totalBookings: v.confirmedSum,
      })).sort((a, b) => b.avgFillRate - a.avgFillRate)

      // ── Overall funnel ────────────────────────────────────────────────────

      const funnel = { confirmed: 0, checkedIn: 0, onTimeCancelled: 0, lateCancelled: 0, noShow: 0 }
      for (const s of sessions) {
        for (const b of s.bookings) {
          if (b.status === 'CONFIRMED') {
            funnel.confirmed++
            if (b.checkedIn) funnel.checkedIn++
            else funnel.noShow++
          } else if (b.status === 'CANCELLED') {
            funnel.onTimeCancelled++
          } else if (b.status === 'LATE_CANCELLED') {
            funnel.lateCancelled++
          }
        }
      }

      // ── Instructor loyalty rate ────────────────────────────────────────────
      // For each session (in time order), compute the fraction of confirmed
      // attendees who had previously attended THIS instructor. Average across
      // all sessions with bookings → "loyalty rate" (0 = all first-timers,
      // 1 = all returning). Sessions are already sorted asc by startsAt.

      const instrCumulativeMembers = new Map<string, Set<string>>()
      const instrSessionLoyalties  = new Map<string, number[]>()

      for (const s of sessions) {
        const instr = s.substitute ?? s.instructor
        if (!instr) continue
        const id = instr.id
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED')
        if (confirmed.length === 0) continue

        if (!instrCumulativeMembers.has(id)) {
          instrCumulativeMembers.set(id, new Set())
          instrSessionLoyalties.set(id, [])
        }
        const prevMembers   = instrCumulativeMembers.get(id)!
        const returningCount = confirmed.filter(b => prevMembers.has(b.memberId)).length
        instrSessionLoyalties.get(id)!.push(returningCount / confirmed.length)
        // Add this session's members AFTER computing rate so they count as "prior" next time
        for (const b of confirmed) prevMembers.add(b.memberId)
      }

      // ── Instructor stats ──────────────────────────────────────────────────

      const instrMap = new Map<string, {
        name: string
        sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number
      }>()
      for (const s of sessions) {
        // Primary instructor or substitute (whoever actually taught)
        const instr = s.substitute ?? s.instructor
        if (!instr) continue
        const id = instr.id
        const name = `${instr.user.firstName} ${instr.user.lastName}`.trim()
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const existing = instrMap.get(id) ?? { name, sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0 }
        instrMap.set(id, {
          name,
          sessions: existing.sessions + 1,
          capacitySum: existing.capacitySum + s.capacity,
          confirmedSum: existing.confirmedSum + confirmed,
          checkedInSum: existing.checkedInSum + checkedIn,
        })
      }
      const instructors = Array.from(instrMap.entries()).map(([id, v]) => {
        const loyalties   = instrSessionLoyalties.get(id) ?? []
        const loyaltyRate = loyalties.length > 0
          ? loyalties.reduce((a, b) => a + b, 0) / loyalties.length
          : 0
        return {
          id,
          name: v.name,
          sessions: v.sessions,
          avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0,
          checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0,
          loyaltyRate,
        }
      }).sort((a, b) => b.avgFillRate - a.avgFillRate)

      // ── Recurrence / retention ────────────────────────────────────────────

      // Month-over-month: for each complete calendar month in the window,
      // find what % of last month's active members booked again this month.
      const membersByMonth = new Map<string, Set<string>>()
      for (const s of sessions) {
        const monthKey = `${s.startsAt.getFullYear()}-${String(s.startsAt.getMonth() + 1).padStart(2, '0')}`
        if (!membersByMonth.has(monthKey)) membersByMonth.set(monthKey, new Set())
        for (const b of s.bookings) {
          if (b.status === 'CONFIRMED') membersByMonth.get(monthKey)!.add(b.memberId)
        }
      }

      const monthKeys = Array.from(membersByMonth.keys()).sort()
      const momRates: number[] = []
      for (let i = 1; i < monthKeys.length; i++) {
        const prev = membersByMonth.get(monthKeys[i - 1])!
        const curr = membersByMonth.get(monthKeys[i])!
        if (prev.size === 0) continue
        const retained = [...prev].filter(id => curr.has(id)).length
        momRates.push(retained / prev.size)
      }
      const monthOverMonth = momRates.length > 0 ? momRates.reduce((a, b) => a + b, 0) / momRates.length : 0

      // Frequency distribution: bookings per member over the full window
      const memberBookingCount = new Map<string, number>()
      for (const s of sessions) {
        for (const b of s.bookings) {
          if (b.status === 'CONFIRMED') {
            memberBookingCount.set(b.memberId, (memberBookingCount.get(b.memberId) ?? 0) + 1)
          }
        }
      }
      const counts = Array.from(memberBookingCount.values())
      const avgBookingsPerMember = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0

      // Bucket into 1, 2-4, 5-9, 10-19, 20+
      const buckets: Record<string, number> = { '1': 0, '2–4': 0, '5–9': 0, '10–19': 0, '20+': 0 }
      for (const c of counts) {
        if (c === 1) buckets['1']++
        else if (c <= 4) buckets['2–4']++
        else if (c <= 9) buckets['5–9']++
        else if (c <= 19) buckets['10–19']++
        else buckets['20+']++
      }
      const frequencyBuckets = Object.entries(buckets).map(([label, count]) => ({ label, count }))

      // ── Revenue: credit transactions in the window ────────────────────────

      // Fetch all credit transactions within the window
      // For 'all' mode: no studio filter. Per-studio: scope by member.studioId.
      const transactions = await prisma.creditTransaction.findMany({
        where: {
          ...(allStudios ? {} : { member: { studioId } }),
          createdAt: { gte: windowStart, lt: now },
        },
        select: { type: true, amount: true, createdAt: true },
      })

      // Aggregate by type
      const revMap: Record<string, number> = {}
      for (const tx of transactions) {
        revMap[tx.type] = (revMap[tx.type] ?? 0) + tx.amount
      }

      // Weekly credit flow
      const weekRevMap = new Map<string, { issued: number; consumed: number; fees: number }>()
      for (const wk of weeklyTrend) weekRevMap.set(wk.weekStart, { issued: 0, consumed: 0, fees: 0 })
      for (const tx of transactions) {
        const wk = isoWeekMonday(tx.createdAt)
        if (!weekRevMap.has(wk)) continue
        const entry = weekRevMap.get(wk)!
        if (tx.amount > 0) entry.issued += tx.amount
        else if (tx.type === 'CLASS_DEBIT') entry.consumed += Math.abs(tx.amount)
        else entry.fees += Math.abs(tx.amount)
      }
      const weeklyCredits = Array.from(weekRevMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, v]) => ({ weekStart, ...v }))

      // Active membership subscriptions count
      const activeMembers = await prisma.membershipSubscription.count({
        where: {
          ...(allStudios ? {} : { plan: { studioId } }),
          status: 'ACTIVE',
        },
      })

      const revenue = {
        creditsIssued:      Math.max(0,  revMap['MEMBERSHIP_RENEWAL'] ?? 0) + Math.max(0, revMap['PURCHASE'] ?? 0) + Math.max(0, revMap['MANUAL_ADJUSTMENT'] ?? 0),
        creditsConsumed:    Math.abs(Math.min(0, revMap['CLASS_DEBIT'] ?? 0)),
        lateCancelFees:     Math.abs(Math.min(0, revMap['LATE_CANCEL_FEE'] ?? 0)),
        noShowFees:         Math.abs(Math.min(0, revMap['NO_SHOW_FEE'] ?? 0)),
        activeSubscriptions: activeMembers,
        weeklyCredits,
      }

      return reply.send({
        heatmap,
        weeklyTrend,
        classStats,
        funnel,
        instructors,
        recurrence: { monthOverMonth, avgBookingsPerMember, frequencyBuckets },
        revenue,
        meta: { weeks, windowStart: windowStart.toISOString(), generatedAt: now.toISOString() },
      })
    },
  )

  // GET /admin/members/:memberId/purchases — member purchase history (fronthost+)
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

  // ─── CSV Exports (studio_admin+) ────────────────────────────────────────────

  /** Escape a value for CSV */
  function csvEscape(val: unknown): string {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  function toCsv(headers: string[], rows: unknown[][]): string {
    const lines = [headers.map(csvEscape).join(',')]
    for (const row of rows) lines.push(row.map(csvEscape).join(','))
    return lines.join('\r\n')
  }

  // GET /admin/export/members?studioId= — member list CSV (studio_admin+)
  app.get<{ Querystring: { studioId: string } }>(
    '/export/members',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      if (!await assertStudioAccess(getUser(request).id, getUser(request).role, studioId, reply, getUser(request).studioIds)) return

      const members = await prisma.member.findMany({
        where: { studioId, staffRoles: { isEmpty: true } },
        include: {
          user: { select: { email: true, firstName: true, lastName: true, createdAt: true } },
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            select: { plan: { select: { name: true } }, status: true, endDate: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { user: { lastName: 'asc' } },
      })

      const headers = ['First Name', 'Last Name', 'Email', 'Credits', 'Plan', 'Status', 'Plan End', 'Joined']
      const rows = members.map(m => {
        const sub = m.memberships[0]
        return [
          m.user.firstName,
          m.user.lastName,
          m.user.email,
          m.creditBalance?.balance ?? 0,
          sub?.plan.name ?? '',
          sub?.status ?? '',
          sub?.endDate?.toISOString().slice(0, 10) ?? '',
          m.user.createdAt.toISOString().slice(0, 10),
        ]
      })

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="members.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/attendance?studioId=&from=&to= — attendance CSV (studio_admin+)
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/attendance',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      if (!await assertStudioAccess(getUser(request).id, getUser(request).role, studioId, reply, getUser(request).studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate = to ? new Date(to) : new Date()

      const bookings = await prisma.booking.findMany({
        where: {
          session: { studioId, startsAt: { gte: fromDate, lte: toDate } },
          status: { in: ['CONFIRMED', 'NO_SHOW', 'LATE_CANCELLED'] },
        },
        include: {
          session: { include: { template: { select: { name: true } } } },
          member: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        },
        orderBy: { session: { startsAt: 'asc' } },
      })

      const headers = ['Date', 'Class', 'Member First', 'Member Last', 'Email', 'Status', 'Checked In']
      const rows = bookings.map(b => [
        b.session.startsAt.toISOString().slice(0, 10),
        b.session.template.name,
        b.member.user.firstName,
        b.member.user.lastName,
        b.member.user.email,
        b.status,
        b.checkedIn ? 'Yes' : 'No',
      ])

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="attendance.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/revenue?studioId=&from=&to= — revenue CSV (studio_admin+)
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/revenue',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      if (!await assertStudioAccess(getUser(request).id, getUser(request).role, studioId, reply, getUser(request).studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate = to ? new Date(to) : new Date()

      const sales = await prisma.productSale.findMany({
        where: { studioId, soldAt: { gte: fromDate, lte: toDate }, failedAt: null },
        include: {
          member: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        },
        orderBy: { soldAt: 'asc' },
      })

      const headers = ['Date', 'Member First', 'Member Last', 'Email', 'Items', 'Total (cents)', 'Payment Method', 'Refunded']
      const rows = sales.map(s => [
        s.soldAt.toISOString().slice(0, 10),
        s.member.user.firstName,
        s.member.user.lastName,
        s.member.user.email,
        (s.items as { name: string; qty: number }[]).map(i => `${i.name}×${i.qty}`).join('; '),
        s.totalCents,
        s.paymentMethod,
        s.refundedAt ? 'Yes' : 'No',
      ])

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="revenue.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )
}

/**
 * Validate that a SQL string is a safe read-only SELECT (or WITH…SELECT) query.
 * Returns an error message string if invalid, or null if OK.
 */
function validateSelectQuery(sql: string): string | null {
  if (!sql.trim()) return 'Query cannot be empty'

  // Strip line comments and block comments, then normalise whitespace
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Must start with SELECT or WITH
  if (!stripped.startsWith('select') && !stripped.startsWith('with')) {
    return 'Only SELECT (and WITH … SELECT) queries are allowed'
  }

  // Block DML, DDL, and dangerous functions
  // Two passes: word-bounded keywords (DML/DDL), then function-call patterns
  const forbiddenKeywords = /\b(insert\s+into|update\s+\w|delete\s+from|drop\s+|create\s+|alter\s+|truncate\s+|grant\s+|revoke\s+|pg_read_file|pg_write_file|pg_read_binary_file|lo_import|lo_export)\b/
  const forbiddenFunctions = /\b(execute|dblink|pg_sleep|set_config|current_setting)\s*\(/
  const forbidden = { test: (s: string) => forbiddenKeywords.test(s) || forbiddenFunctions.test(s) }
  if (forbidden.test(stripped)) {
    return 'Query contains forbidden keywords (DML/DDL is not allowed)'
  }

  // No COPY … TO (file exfil)
  if (/\bcopy\b.*\bto\b/s.test(stripped)) {
    return 'COPY … TO is not allowed'
  }

  // Reject multiple statements (semicolons except at the very end)
  const withoutTrailingSemicolon = stripped.replace(/;\s*$/, '')
  if (withoutTrailingSemicolon.includes(';')) {
    return 'Multiple statements are not allowed'
  }

  return null
}

/**
 * admin/franchise_admin: unrestricted.
 * staff (instructor/fronthost) with studioId in JWT app_metadata: checked against the JWT value (no DB roundtrip).
 * All others: must have a Member record for this studio.
 * Returns false and sends 403 if access is denied — callers must `return` on false.
 */
async function assertStudioAccess(
  userId: string,
  role: UserRole,
  studioId: string,
  reply: FastifyReply,
  jwtStudioIds?: string[],
): Promise<boolean> {
  if (ROLE_RANK[role] >= ROLE_RANK['franchise_admin']) return true
  // Staff carry all their assigned studio IDs in the JWT — no Member record needed
  if (jwtStudioIds && jwtStudioIds.length > 0) {
    if (jwtStudioIds.includes(studioId)) return true
    reply.forbidden('Access denied to this studio')
    return false
  }
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member || member.studioId !== studioId) {
    reply.forbidden('Access denied to this studio')
    return false
  }
  return true
}
