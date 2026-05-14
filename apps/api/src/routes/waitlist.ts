import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

export async function waitlistRoutes(app: FastifyInstance) {
  // POST /waitlist — join waitlist
  app.post<{ Body: { sessionId: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId } = request.body
      const user = getUser(request)

      const member = await prisma.member.findUniqueOrThrow({ where: { userId: user.id } })

      const lastEntry = await prisma.waitlistEntry.findFirst({
        where: { sessionId, status: 'WAITING' },
        orderBy: { position: 'desc' },
        select: { position: true },
      })

      const position = (lastEntry?.position ?? 0) + 1

      const entry = await prisma.waitlistEntry.create({
        data: { sessionId, memberId: member.id, position, status: 'WAITING' },
      })

      return reply.code(201).send({ success: true, data: { ...entry, position } })
    },
  )

  // DELETE /waitlist/:id — leave waitlist
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const entry = await prisma.waitlistEntry.findUniqueOrThrow({
        where: { id: request.params.id },
        include: { member: true },
      })

      if (entry.member.userId !== user.id) return reply.forbidden()

      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'REMOVED' },
      })

      return { success: true }
    },
  )

  // POST /waitlist/:id/confirm — confirm waitlist promotion
  app.post<{ Params: { id: string } }>(
    '/:id/confirm',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const entry = await prisma.waitlistEntry.findUniqueOrThrow({
        where: { id: request.params.id },
        include: {
          member: { include: { creditBalance: true } },
          session: true,
        },
      })

      if (entry.member.userId !== user.id) return reply.forbidden()
      if (entry.status !== 'NOTIFIED') return reply.badRequest('Entry is not in notified state')
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'EXPIRED' } })
        return reply.gone('Confirmation window expired')
      }

      const balance = entry.member.creditBalance?.balance ?? 0
      if (balance < entry.session.creditsRequired) {
        return reply.paymentRequired('Insufficient credits')
      }

      await prisma.$transaction(async (tx) => {
        await tx.booking.create({
          data: {
            sessionId: entry.sessionId,
            memberId: entry.memberId,
            status: 'CONFIRMED',
          },
        })

        await tx.creditBalance.update({
          where: { memberId: entry.memberId },
          data: { balance: { decrement: entry.session.creditsRequired } },
        })

        await tx.creditTransaction.create({
          data: {
            memberId: entry.memberId,
            amount: -entry.session.creditsRequired,
            type: 'CLASS_DEBIT',
            note: `Waitlist booking for session ${entry.sessionId}`,
          },
        })

        await tx.waitlistEntry.update({
          where: { id: entry.id },
          data: { status: 'CONFIRMED' },
        })
      })

      return { success: true }
    },
  )
}
