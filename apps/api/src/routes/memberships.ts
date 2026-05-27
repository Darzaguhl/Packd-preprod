import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function membershipRoutes(app: FastifyInstance) {
  // GET /memberships/plans?studioId= — list plans for a studio (studio_admin+)
  app.get<{ Querystring: { studioId: string } }>(
    '/plans',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const plans = await prisma.membershipPlan.findMany({
        where: { studioId },
        include: {
          _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: { priceInCents: 'asc' },
      })
      return reply.send(plans.map(p => ({
        id: p.id,
        studioId: p.studioId,
        name: p.name,
        description: p.description,
        priceInCents: p.priceInCents,
        intervalMonths: p.intervalMonths,
        creditsPerCycle: p.creditsPerCycle,
        stripePriceId: p.stripePriceId,
        activeSubscriptions: p._count.subscriptions,
      })))
    },
  )

  // POST /memberships/plans — create plan (studio_admin+)
  app.post<{
    Body: {
      studioId: string
      name: string
      description?: string
      priceInCents: number
      intervalMonths?: number
      creditsPerCycle?: number | null
      stripePriceId?: string
    }
  }>(
    '/plans',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, name, description, priceInCents, intervalMonths = 1, creditsPerCycle, stripePriceId } = request.body
      if (!studioId || !name || priceInCents === undefined) {
        return reply.badRequest('studioId, name and priceInCents are required')
      }
      if (!Number.isInteger(priceInCents) || priceInCents < 0) {
        return reply.badRequest('priceInCents must be a non-negative integer')
      }
      if (creditsPerCycle !== undefined && creditsPerCycle !== null &&
          (!Number.isInteger(creditsPerCycle) || creditsPerCycle < 0)) {
        return reply.badRequest('creditsPerCycle must be a non-negative integer or null (unlimited)')
      }

      const plan = await prisma.membershipPlan.create({
        data: { studioId, name, description, priceInCents, intervalMonths, creditsPerCycle, stripePriceId },
      })
      return reply.code(201).send({ success: true, data: plan })
    },
  )

  // PATCH /memberships/plans/:planId — update plan (studio_admin+)
  app.patch<{
    Params: { planId: string }
    Body: {
      name?: string
      description?: string
      priceInCents?: number
      intervalMonths?: number
      creditsPerCycle?: number | null
      stripePriceId?: string | null
    }
  }>(
    '/plans/:planId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { planId } = request.params
      const { name, description, priceInCents, intervalMonths, creditsPerCycle, stripePriceId } = request.body

      const existing = await prisma.membershipPlan.findUnique({ where: { id: planId } })
      if (!existing) return reply.notFound('Plan not found')

      const plan = await prisma.membershipPlan.update({
        where: { id: planId },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(priceInCents !== undefined && { priceInCents }),
          ...(intervalMonths !== undefined && { intervalMonths }),
          ...(creditsPerCycle !== undefined && { creditsPerCycle }),
          ...(stripePriceId !== undefined && { stripePriceId }),
        },
      })
      return reply.send({ success: true, data: plan })
    },
  )

  // DELETE /memberships/plans/:planId — delete plan (studio_admin+)
  // Blocked if there are active subscriptions
  app.delete<{ Params: { planId: string } }>(
    '/plans/:planId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { planId } = request.params
      const plan = await prisma.membershipPlan.findUnique({
        where: { id: planId },
        include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
      })
      if (!plan) return reply.notFound('Plan not found')
      if (plan._count.subscriptions > 0) {
        return reply.code(409).send({
          error: `Cannot delete — ${plan._count.subscriptions} active subscription(s) still use this plan`,
        })
      }
      await prisma.membershipPlan.delete({ where: { id: planId } })
      return reply.send({ success: true })
    },
  )

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  // GET /memberships?studioId=&memberId= — list subscriptions (studio_admin+)
  app.get<{ Querystring: { studioId?: string; memberId?: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, memberId } = request.query
      if (!studioId && !memberId) return reply.badRequest('studioId or memberId is required')

      const subscriptions = await prisma.membershipSubscription.findMany({
        where: {
          ...(memberId && { memberId }),
          ...(studioId && { plan: { studioId } }),
        },
        include: {
          plan: { select: { name: true, creditsPerCycle: true, intervalMonths: true, priceInCents: true } },
          member: { select: { id: true, userId: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      // Enrich with user name/email
      const userIds = [...new Set(subscriptions.map(s => s.member.userId))]
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const userMap: Record<string, { firstName: string; lastName: string; email: string }> = {}
      for (const uid of userIds) {
        const { data } = await supabase.auth.admin.getUserById(uid)
        if (data?.user) {
          const m = data.user.user_metadata as { first_name?: string; last_name?: string } | null
          userMap[uid] = {
            firstName: m?.first_name ?? '',
            lastName: m?.last_name ?? '',
            email: data.user.email ?? '',
          }
        }
      }

      return reply.send(subscriptions.map(s => ({
        id: s.id,
        memberId: s.memberId,
        memberFirstName: userMap[s.member.userId]?.firstName ?? '',
        memberLastName: userMap[s.member.userId]?.lastName ?? '',
        memberEmail: userMap[s.member.userId]?.email ?? '',
        plan: s.plan,
        planId: s.planId,
        status: s.status,
        startDate: s.startDate.toISOString(),
        endDate: s.endDate?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })))
    },
  )

  // GET /memberships/me — calling member's current subscription
  app.get(
    '/me',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const member = await prisma.member.findUnique({ where: { userId: user.id } })
      if (!member) return reply.notFound('Member not found')

      const sub = await prisma.membershipSubscription.findFirst({
        where: { memberId: member.id, status: { in: ['ACTIVE', 'PAUSED'] } },
        include: { plan: { select: { name: true, creditsPerCycle: true, intervalMonths: true, priceInCents: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send(sub ? {
        id: sub.id,
        planId: sub.planId,
        plan: sub.plan,
        status: sub.status,
        startDate: sub.startDate.toISOString(),
        endDate: sub.endDate?.toISOString() ?? null,
      } : null)
    },
  )

  // POST /memberships — assign a plan to a member (studio_admin+)
  app.post<{
    Body: {
      memberId: string
      planId: string
      startDate?: string    // ISO date; defaults to today
      grantCredits?: boolean // default true
    }
  }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId, planId, startDate, grantCredits = true } = request.body
      if (!memberId || !planId) return reply.badRequest('memberId and planId are required')

      const [member, plan] = await Promise.all([
        prisma.member.findUnique({ where: { id: memberId } }),
        prisma.membershipPlan.findUnique({ where: { id: planId } }),
      ])
      if (!member) return reply.notFound('Member not found')
      if (!plan) return reply.notFound('Plan not found')

      const start = startDate ? new Date(startDate) : new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setMonth(end.getMonth() + plan.intervalMonths)

      // Cancel any existing active subscription for this member at this studio
      await prisma.membershipSubscription.updateMany({
        where: { memberId, plan: { studioId: plan.studioId }, status: { in: ['ACTIVE', 'PAUSED'] } },
        data: { status: 'CANCELLED' },
      })

      const sub = await prisma.$transaction(async (tx) => {
        const newSub = await tx.membershipSubscription.create({
          data: { memberId, planId, startDate: start, endDate: end, status: 'ACTIVE' },
        })

        if (grantCredits && plan.creditsPerCycle && plan.creditsPerCycle > 0) {
          await tx.creditBalance.upsert({
            where: { memberId },
            create: { memberId, balance: plan.creditsPerCycle },
            update: { balance: { increment: plan.creditsPerCycle } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId,
              amount: plan.creditsPerCycle,
              type: 'MEMBERSHIP_RENEWAL',
              note: `New subscription: ${plan.name}`,
            },
          })
        }

        return newSub
      })

      return reply.code(201).send({ success: true, data: sub })
    },
  )

  // PATCH /memberships/:id — update subscription status or end date (studio_admin+)
  app.patch<{
    Params: { id: string }
    Body: {
      status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED'
      endDate?: string | null
      grantCredits?: boolean // grant cycle credits when reactivating
    }
  }>(
    '/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { id } = request.params
      const { status, endDate, grantCredits = false } = request.body

      const sub = await prisma.membershipSubscription.findUnique({
        where: { id },
        include: { plan: true },
      })
      if (!sub) return reply.notFound('Subscription not found')

      const wasActive = sub.status === 'ACTIVE'
      const reactivating = !wasActive && status === 'ACTIVE'

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.membershipSubscription.update({
          where: { id },
          data: {
            ...(status && { status }),
            ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
          },
        })

        // Optionally grant credits when manually reactivating
        if (reactivating && grantCredits && sub.plan.creditsPerCycle && sub.plan.creditsPerCycle > 0) {
          await tx.creditBalance.upsert({
            where: { memberId: sub.memberId },
            create: { memberId: sub.memberId, balance: sub.plan.creditsPerCycle },
            update: { balance: { increment: sub.plan.creditsPerCycle } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId: sub.memberId,
              amount: sub.plan.creditsPerCycle,
              type: 'MEMBERSHIP_RENEWAL',
              note: `Reactivated: ${sub.plan.name}`,
            },
          })
        }

        return result
      })

      return reply.send({ success: true, data: updated })
    },
  )
}
