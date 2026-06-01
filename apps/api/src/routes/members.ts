import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js'
import { requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import Stripe from 'stripe'
import { logger } from '../lib/logger.js'

// Lazy-init so tests without STRIPE_SECRET_KEY don't blow up at import time
let _stripe: Stripe | null = null
function stripe() { return _stripe ?? (_stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)) }

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
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({ studioId: z.string().min(1).optional() }).nullish(),
      },
    },
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
          where: { status: { in: ['ACTIVE', 'PAUSED', 'PAST_DUE'] } },
          include: { plan: true },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
      },
    })

    if (!member) return reply.notFound('No member profile found for this user')

    // Fetch next billing date from Stripe if subscription exists
    let nextBillingDate: string | null = null
    const activeSub = member.memberships[0]
    if (activeSub?.stripeSubId && activeSub.status === 'ACTIVE') {
      try {
        const stripeSub = await stripe().subscriptions.retrieve(activeSub.stripeSubId)
        nextBillingDate = new Date(stripeSub.current_period_end * 1000).toISOString()
      } catch {
        // non-fatal
      }
    }

    return {
      id: member.id,
      studioId: member.studioId,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      email: member.user.email,
      creditBalance: member.creditBalance?.balance ?? 0,
      guestPassBalance: member.guestPassBalance,
      birthday: member.birthday?.toISOString() ?? null,
      emergencyContactName: member.emergencyContactName ?? null,
      emergencyContactPhone: member.emergencyContactPhone ?? null,
      activeSubscription: activeSub
        ? {
            planName: activeSub.plan.name,
            status: activeSub.status,
            endDate: activeSub.endDate?.toISOString(),
            nextBillingDate,
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
        expiresAt: t.expiresAt?.toISOString() ?? null,
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
        station: { select: { label: true } },
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
      stationLabel: b.station?.label ?? null,
      memberNote: b.memberNote ?? null,
    }))
  })

  // PATCH /members/me — update display name + profile fields
  app.patch<{
    Body: {
      firstName?: string
      lastName?: string
      birthday?: string | null
      emergencyContactName?: string | null
      emergencyContactPhone?: string | null
    }
  }>(
    '/me',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          birthday: z.string().nullable().optional(),
          emergencyContactName: z.string().nullable().optional(),
          emergencyContactPhone: z.string().nullable().optional(),
        }).nullish(),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      const { firstName, lastName, birthday, emergencyContactName, emergencyContactPhone } = request.body

      if (firstName !== undefined && (typeof firstName !== 'string' || !firstName.trim())) {
        return reply.badRequest('firstName must be a non-empty string')
      }
      if (lastName !== undefined && (typeof lastName !== 'string' || !lastName.trim())) {
        return reply.badRequest('lastName must be a non-empty string')
      }

      const [updatedUser, updatedMember] = await Promise.all([
        prisma.user.update({
          where: { id: user.id },
          data: {
            ...(firstName !== undefined && { firstName: firstName.trim() }),
            ...(lastName  !== undefined && { lastName:  lastName.trim() }),
          },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
        (birthday !== undefined || emergencyContactName !== undefined || emergencyContactPhone !== undefined)
          ? prisma.member.update({
              where: { userId: user.id },
              data: {
                ...(birthday              !== undefined && { birthday:              birthday ? new Date(birthday) : null }),
                ...(emergencyContactName  !== undefined && { emergencyContactName:  emergencyContactName  ?? null }),
                ...(emergencyContactPhone !== undefined && { emergencyContactPhone: emergencyContactPhone ?? null }),
              },
              select: { birthday: true, emergencyContactName: true, emergencyContactPhone: true },
            })
          : Promise.resolve(null),
      ])

      return reply.send({
        success: true,
        data: {
          ...updatedUser,
          birthday: updatedMember?.birthday?.toISOString() ?? null,
          emergencyContactName: updatedMember?.emergencyContactName ?? null,
          emergencyContactPhone: updatedMember?.emergencyContactPhone ?? null,
        },
      })
    },
  )

  // GET /members/me/stats?studioId= — member's rank + top 3 instructors
  app.get<{ Querystring: { studioId: string } }>(
    '/me/stats',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('No member profile found for this user')
      if (member.studioId !== studioId) return reply.forbidden('Access denied to this studio')

      // All confirmed bookings in this studio (past) — capped at 10k rows to prevent OOM
      // on large studios. Rank is approximate beyond that cap.
      const allBookings = await prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          session: { studioId, startsAt: { lt: new Date() }, status: { not: 'CANCELLED' } },
        },
        select: {
          memberId: true,
          session: {
            select: {
              instructorId: true,
              substituteInstructorId: true,
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
        take: 10000,
        orderBy: { bookedAt: 'desc' },
      })

      // Build per-member visit count
      const memberVisits = new Map<string, number>()
      for (const b of allBookings) {
        memberVisits.set(b.memberId, (memberVisits.get(b.memberId) ?? 0) + 1)
      }

      const myVisits = memberVisits.get(member.id) ?? 0
      const sortedMembers = Array.from(memberVisits.entries()).sort((a, b) => b[1] - a[1])
      const myRank = sortedMembers.findIndex(([id]) => id === member.id) + 1

      // Top 3 instructors for this member
      const instrCount = new Map<string, { name: string; count: number }>()
      for (const b of allBookings) {
        if (b.memberId !== member.id) continue
        const s = b.session as { instructorId: string; substituteInstructorId: string | null; instructor: { user: { firstName: string; lastName: string } } }
        const id = s.substituteInstructorId ?? s.instructorId
        const name = `${s.instructor.user.firstName} ${s.instructor.user.lastName}`
        const existing = instrCount.get(id) ?? { name, count: 0 }
        instrCount.set(id, { ...existing, count: existing.count + 1 })
      }
      const topInstructors = Array.from(instrCount.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 3)
        .map(([id, v]) => ({ instructorId: id, name: v.name, sessionsTogether: v.count }))

      return reply.send({
        visits: myVisits,
        rank: myRank > 0 ? myRank : null,
        totalMembers: sortedMembers.length,
        topInstructors,
      })
    },
  )

  // GET /members/me/purchases?studioId= — member's own purchase history
  app.get<{ Querystring: { studioId: string } }>(
    '/me/purchases',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studioId } = request.query
      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true } })
      if (!member) return reply.notFound('No member profile found')

      const sales = await prisma.productSale.findMany({
        where: { memberId: member.id, ...(studioId ? { studioId } : {}) },
        orderBy: { soldAt: 'desc' },
        take: 50,
      })

      return reply.send(sales)
    },
  )

  // PATCH /members/me/email-preferences
  app.patch<{ Body: { classReminder?: boolean; marketing?: boolean; waitlist?: boolean } }>(
    '/me/email-preferences',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          classReminder: z.boolean().optional(),
          marketing: z.boolean().optional(),
          waitlist: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true, emailPreferences: true } })
      if (!member) return reply.notFound('No member profile found')

      const current = (member.emailPreferences ?? {}) as Record<string, boolean>
      const { classReminder, marketing, waitlist } = request.body
      const updated = {
        ...current,
        ...(classReminder !== undefined && { classReminder }),
        ...(marketing     !== undefined && { marketing }),
        ...(waitlist      !== undefined && { waitlist }),
      }

      await prisma.member.update({ where: { id: member.id }, data: { emailPreferences: updated } })
      return reply.send({ success: true, emailPreferences: updated })
    },
  )

  // GET /members/me/referral — returns/generates referral code + stats
  app.get('/me/referral', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true, referralCode: true } })
    if (!member) return reply.notFound('No member profile found')

    let code = member.referralCode
    if (!code) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = Math.random().toString(36).substring(2, 8).toUpperCase()
        try {
          await prisma.member.update({ where: { id: member.id }, data: { referralCode: candidate } })
          code = candidate
          break
        } catch (e) {
          if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') continue
          throw e
        }
      }
      if (!code) return reply.code(500).send({ error: 'Could not generate a unique referral code. Please try again.' })
    }

    const referrals = await prisma.referral.findMany({ where: { referrerId: member.id } })
    const totalReferrals = referrals.length
    const creditsEarned = referrals.filter(r => r.rewarded).reduce((sum, r) => sum + r.rewardCredits, 0)
    const pendingReward = referrals.filter(r => !r.rewarded).reduce((sum, r) => sum + r.rewardCredits, 0)

    return reply.send({ code, totalReferrals, pendingReward, creditsEarned })
  })

  // POST /members/referral/apply — apply a referral code
  app.post<{ Body: { code: string } }>(
    '/referral/apply',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({ code: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const user = getUser(request)
      const { code } = request.body
      if (!code) return reply.badRequest('code is required')

      const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true, studioId: true } })
      if (!member) return reply.notFound('No member profile found')

      const referrer = await prisma.member.findUnique({ where: { referralCode: code }, select: { id: true } })
      if (!referrer) return reply.notFound('Referral code not found')

      if (referrer.id === member.id) {
        return reply.code(409).send({ error: 'You cannot apply your own referral code' })
      }

      const existing = await prisma.referral.findFirst({ where: { refereeId: member.id } })
      if (existing) {
        return reply.code(409).send({ error: 'You have already applied a referral code' })
      }

      const studio = await prisma.studio.findUnique({ where: { id: member.studioId }, select: { referralRewardCredits: true } })
      const rewardCredits = studio?.referralRewardCredits ?? 0

      await prisma.referral.create({
        data: { studioId: member.studioId, referrerId: referrer.id, refereeId: member.id, rewardCredits },
      })

      return reply.code(201).send({ success: true })
    },
  )

  // GET /members/me/receipts — list product sales with Stripe receipt URLs
  app.get('/me/receipts', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true, studio: { select: { currency: true } } } })
    if (!member) return reply.notFound()
    const sales = await prisma.productSale.findMany({
      where: { memberId: member.id, failedAt: null },
      select: { id: true, soldAt: true, totalCents: true, items: true, stripeReceiptUrl: true },
      orderBy: { soldAt: 'desc' },
      take: 100,
    })
    const currency = member.studio.currency ?? 'USD'
    return reply.send(sales.map(s => ({ ...s, currency, soldAt: s.soldAt.toISOString() })))
  })

  // GET /members/me/export — GDPR data export
  app.get('/me/export', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({
      where: { userId: user.id },
      include: {
        user: true,
        creditBalance: true,
      },
    })
    if (!member) return reply.notFound('No member profile found')

    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    const [bookings, transactions, subscriptions, sales] = await Promise.all([
      prisma.booking.findMany({
        where: { memberId: member.id, bookedAt: { gte: twoYearsAgo } },
        include: { session: { include: { template: { select: { name: true } } } } },
        orderBy: { bookedAt: 'desc' },
      }),
      prisma.creditTransaction.findMany({
        where: { memberId: member.id },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.membershipSubscription.findMany({
        where: { memberId: member.id },
        include: { plan: { select: { name: true, priceInCents: true } } },
        orderBy: { startDate: 'desc' },
      }),
      prisma.productSale.findMany({
        where: { memberId: member.id },
        orderBy: { soldAt: 'desc' },
        take: 200,
      }),
    ])

    const data = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: member.id,
        email: member.user.email,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        createdAt: member.user.createdAt,
        creditBalance: member.creditBalance?.balance ?? 0,
      },
      bookings: bookings.map(b => ({ id: b.id, sessionId: b.sessionId, className: b.session.template.name, startsAt: b.session.startsAt, status: b.status, bookedAt: b.bookedAt })),
      creditTransactions: transactions.map(t => ({ id: t.id, amount: t.amount, type: t.type, note: t.note, createdAt: t.createdAt })),
      memberships: subscriptions.map(s => ({ id: s.id, planName: s.plan.name, status: s.status, startDate: s.startDate, endDate: s.endDate })),
      purchases: sales.map(s => ({ id: s.id, totalCents: s.totalCents, soldAt: s.soldAt, paymentMethod: s.paymentMethod })),
    }

    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', 'attachment; filename="my-data.json"')
    return reply.send(data)
  })

  // DELETE /members/me — GDPR account deletion
  app.delete('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const member = await prisma.member.findUnique({
      where: { userId: user.id },
      include: { memberships: { where: { status: { in: ['ACTIVE', 'PAUSED'] } } } },
    })
    if (!member) return reply.notFound('No member profile found')

    // Cancel active subscriptions — also cancel in Stripe to stop future billing
    if (member.memberships.length > 0) {
      for (const sub of member.memberships) {
        if (sub.stripeSubId) {
          await stripe().subscriptions.cancel(sub.stripeSubId).catch(err =>
            logger.warn({ err }, 'stripe sub cancel failed during GDPR delete'),
          )
        }
      }
      await prisma.membershipSubscription.updateMany({
        where: { memberId: member.id, status: { in: ['ACTIVE', 'PAUSED'] } },
        data: { status: 'CANCELLED' },
      })
    }

    // Anonymize user record
    const deletedEmail = `deleted_${user.id}@packd.invalid`
    await prisma.user.update({
      where: { id: user.id },
      data: { email: deletedEmail, firstName: 'Deleted', lastName: 'User', avatarUrl: null },
    })

    // Delete member record
    await prisma.member.delete({ where: { id: member.id } })

    // Delete from Supabase Auth
    const SUPABASE_URL = process.env.SUPABASE_URL!
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
    }).catch(err => logger.warn({ err }, 'supabase auth deletion failed during GDPR delete'))

    return reply.send({ success: true })
  })
}
