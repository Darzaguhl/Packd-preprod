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

      // Fix #12: validate body
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.badRequest('sessionId is required')
      }

      const user = getUser(request)
      const member = await prisma.member.findUniqueOrThrow({ where: { userId: user.id } })

      // Fix #2 (waitlist position race condition): compute position and insert
      // inside a transaction. The @@unique([sessionId, memberId]) on WaitlistEntry
      // prevents duplicate entries at the DB level.
      const entry = await prisma.$transaction(async (tx) => {
        const lastEntry = await tx.waitlistEntry.findFirst({
          where: { sessionId, status: 'WAITING' },
          orderBy: { position: 'desc' },
          select: { position: true },
        })

        const position = (lastEntry?.position ?? 0) + 1

        return tx.waitlistEntry.create({
          data: { sessionId, memberId: member.id, position, status: 'WAITING' },
        })
      })

      return reply.code(201).send({ success: true, data: { ...entry, position: entry.position } })
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
          session: { include: { _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } } } },
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

      // Fix #6: re-check capacity inside the confirmation transaction
      await prisma.$transaction(async (tx) => {
        // Re-read confirmed booking count with a lock
        const session = await tx.classSession.findUniqueOrThrow({
          where: { id: entry.sessionId },
          include: { _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } } },
        })

        if (session._count.bookings >= session.capacity) {
          throw Object.assign(new Error('Class is now full'), { code: 'CONFLICT' })
        }

        await tx.booking.create({
          data: { sessionId: entry.sessionId, memberId: entry.memberId, status: 'CONFIRMED' },
        })

        // Fix #10: guard against negative balance
        const current = await tx.creditBalance.findUniqueOrThrow({ where: { memberId: entry.memberId } })
        if (current.balance < entry.session.creditsRequired) {
          throw Object.assign(new Error('Insufficient credits'), { code: 'PAYMENT_REQUIRED' })
        }

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
