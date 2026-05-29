import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireInstructor = requireRole('instructor')

export async function adminSalesRoutes(app: FastifyInstance) {
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
      if (ROLE_RANK[user.role] < ROLE_RANK['fronthost']) return reply.forbidden()

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
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)

      const sales = await prisma.productSale.findMany({
        where: { studioId, soldAt: { gte: dayStart, lt: dayEnd } },
        select: { memberId: true },
        distinct: ['memberId'],
      })

      return reply.send({ memberIds: sales.map(s => s.memberId) })
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

      const studioSettings = await prisma.studio.findUnique({ where: { id: studioId }, select: { guestCheckInEnabled: true } })
      if (!studioSettings?.guestCheckInEnabled) return reply.badRequest('Guest check-in is not enabled for this studio')

      const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, guestPassBalance: true } })
      if (!member) return reply.notFound('Member not found')

      // Atomic check-and-decrement prevents double-spend under concurrent requests
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
}
