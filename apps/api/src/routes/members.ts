import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert: ensures the calling user has a User + Member + CreditBalance
 * record in the DB.  Used for privileged users (admin, franchise_admin) who are
 * promoted directly via Supabase Admin API and never go through the normal
 * member signup / staff-assignment flows that create these records.
 *
 * studioId is used only for the initial Member row; if the member already exists
 * it is left unchanged.
 *
 * Exported so bookings.ts can call it without duplicating the logic.
 */
export async function ensureMemberForAdmin(userId: string, email: string, studioId: string) {
  return ensureMemberRecord(userId, email, studioId)
}

async function ensureMemberRecord(
  userId: string,
  email: string,
  studioId: string,
): Promise<string> {
  // 1. Upsert User record — fetch name from Supabase if we can, else derive from email
  let firstName: string
  let lastName: string

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!existing) {
    // Try to get name from Supabase Admin API
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { data } = await sb.auth.admin.getUserById(userId)
      const meta = data?.user?.user_metadata as { first_name?: string; last_name?: string } | undefined
      firstName = meta?.first_name ?? (email.split('@')[0] ?? 'Admin')
      lastName  = meta?.last_name  ?? ''
    } catch {
      firstName = email.split('@')[0] ?? 'Admin'
      lastName  = ''
    }

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email, firstName, lastName },
      update: {},
    })
  }

  // 2. Upsert Member record
  const member = await prisma.member.upsert({
    where: { userId },
    create: { userId, studioId, source: 'packd' },
    update: {},
    select: { id: true },
  })

  // 3. Ensure CreditBalance row exists
  await prisma.creditBalance.upsert({
    where: { memberId: member.id },
    create: { memberId: member.id, balance: 0 },
    update: {},
  })

  return member.id
}

export async function memberRoutes(app: FastifyInstance) {
  // POST /members/ensure — idempotent: creates User + Member + CreditBalance for the
  // caller if they don't exist yet.  Designed for admin/franchise_admin users who are
  // promoted directly via Supabase and may never go through normal signup.
  app.post<{ Body: { studioId?: string } }>(
    '/ensure',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const studioId = request.body?.studioId ?? user.studioIds?.[0]

      if (!studioId) {
        // No studioId from JWT or body — pick the first studio in the DB
        const first = await prisma.studio.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
        if (!first) return reply.serviceUnavailable('No studios configured yet')
        const memberId = await ensureMemberRecord(user.id, user.email, first.id)
        return reply.send({ success: true, memberId })
      }

      const memberId = await ensureMemberRecord(user.id, user.email, studioId)
      return reply.send({ success: true, memberId })
    },
  )

  // GET /members/me
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)

    // Auto-create member record for admins who were promoted directly via Supabase
    const isAdmin = ROLE_RANK[user.role] >= ROLE_RANK['franchise_admin']
    if (isAdmin) {
      const studioId = user.studioIds?.[0]
        ?? (await prisma.studio.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id
      if (studioId) await ensureMemberRecord(user.id, user.email, studioId)
    }

    let member = await prisma.member.findUnique({
      where: { userId: user.id },
      include: {
        user: true,
        creditBalance: true,
        memberships: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
      },
    })

    if (!member) return reply.notFound('No member profile found for this user')

    return {
      id: member.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      email: member.user.email,
      creditBalance: member.creditBalance?.balance ?? 0,
      activeSubscription: member.memberships[0]
        ? {
            planName: member.memberships[0].plan.name,
            status: member.memberships[0].status,
            endDate: member.memberships[0].endDate?.toISOString(),
          }
        : undefined,
    }
  })

  // GET /members/me/history — past bookings + credit transactions
  app.get('/me/history', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({ where: { userId: user.id } })
    if (!member) return reply.notFound('No member profile found for this user')

    const [pastBookings, transactions] = await Promise.all([
      prisma.booking.findMany({
        where: { memberId: member.id, session: { startsAt: { lt: new Date() } } },
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
        where: { memberId: member.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ])

    return reply.send({
      pastBookings: pastBookings.map(b => ({
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
  })

  // GET /members/me/bookings
  app.get('/me/bookings', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)

    const member = await prisma.member.findUnique({ where: { userId: user.id } })
    if (!member) return reply.notFound('No member profile found for this user')

    const bookings = await prisma.booking.findMany({
      where: {
        memberId: member.id,
        status: 'CONFIRMED',
        session: { startsAt: { gte: new Date() } },
      },
      include: {
        session: {
          include: {
            template: true,
            instructor: { include: { user: true } },
            room: { include: { location: true } },
          },
        },
      },
      orderBy: { session: { startsAt: 'asc' } },
    })

    return bookings.map((b) => ({
      id: b.id,
      sessionId: b.session.id,
      startsAt: b.session.startsAt.toISOString(),
      endsAt: b.session.endsAt.toISOString(),
      templateName: b.session.template.name,
      sport: b.session.template.sport,
      instructorName: `${b.session.instructor.user.firstName} ${b.session.instructor.user.lastName}`,
      roomName: b.session.room.name,
      locationCity: b.session.room.location.city,
      creditsRequired: b.session.creditsRequired,
      sessionStatus: b.session.status,
      bookedAt: b.bookedAt.toISOString(),
    }))
  })
}
