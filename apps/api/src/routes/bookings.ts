import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { enqueueLateCancelCheck } from '../jobs/index.js'

export async function bookingRoutes(app: FastifyInstance) {
  // POST /bookings — create booking
  app.post<{ Body: { sessionId: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId } = request.body

      // Fix #12: validate required body fields
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.badRequest('sessionId is required')
      }

      const user = getUser(request)

      const member = await prisma.member.findUniqueOrThrow({
        where: { userId: user.id },
      })

      // Run capacity check + balance check + booking creation inside a single
      // transaction. Both the session and credit balance are read inside the
      // transaction so concurrent requests cannot race past either guard.
      // The @@unique([sessionId, memberId]) on Booking is the final DB-level guard.
      const booking = await prisma.$transaction(async (tx) => {
        const session = await tx.classSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: { _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } } },
        })

        if (session.status !== 'SCHEDULED') {
          throw Object.assign(new Error('Class is not available for booking'), { statusCode: 400 })
        }

        if (session._count.bookings >= session.capacity) {
          throw Object.assign(new Error('Class is full — join the waitlist instead'), { statusCode: 409 })
        }

        // Read balance inside the transaction to prevent concurrent overdraft
        const creditBalance = await tx.creditBalance.findUnique({ where: { memberId: member.id } })
        const balance = creditBalance?.balance ?? 0
        if (balance < session.creditsRequired) {
          throw Object.assign(new Error('Insufficient credits'), { statusCode: 402 })
        }

        const newBooking = await tx.booking.create({
          data: { sessionId, memberId: member.id, status: 'CONFIRMED' },
        })

        await tx.creditBalance.update({
          where: { memberId: member.id },
          data: { balance: { decrement: session.creditsRequired } },
        })

        await tx.creditTransaction.create({
          data: {
            memberId: member.id,
            amount: -session.creditsRequired,
            type: 'CLASS_DEBIT',
            note: `Booking ${newBooking.id}`,
          },
        })

        return { booking: newBooking, session }
      })

      await enqueueLateCancelCheck(booking.booking.id, booking.session.startsAt)

      return reply.code(201).send({ success: true, data: booking.booking })
    },
  )

  // DELETE /bookings/:id — cancel booking
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.id },
        include: {
          session: true,
          member: { include: { creditBalance: true } },
        },
      })

      if (booking.member.userId !== user.id) {
        return reply.forbidden()
      }

      if (booking.status !== 'CONFIRMED') {
        return reply.badRequest('Booking is already cancelled')
      }

      const now = new Date()
      const policy = await prisma.cancellationPolicy.findUnique({
        where: { studioId: booking.session.studioId },
      })
      const windowHours = policy?.lateCancelWindowHours ?? 12
      const hoursUntilClass =
        (booking.session.startsAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      const isLateCancel = hoursUntilClass < windowHours

      // Fix #7: run waitlist promotion inside the same transaction as the cancellation
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: isLateCancel ? 'LATE_CANCELLED' : 'CANCELLED' },
        })

        if (!isLateCancel) {
          await tx.creditBalance.update({
            where: { memberId: booking.memberId },
            data: { balance: { increment: booking.session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId: booking.memberId,
              amount: booking.session.creditsRequired,
              type: 'REFUND',
              note: `Cancellation of booking ${booking.id}`,
            },
          })
        }

        // Promote next waitlist member within the same transaction
        const next = await tx.waitlistEntry.findFirst({
          where: { sessionId: booking.sessionId, status: 'WAITING' },
          orderBy: { position: 'asc' },
        })
        if (next) {
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
          await tx.waitlistEntry.update({
            where: { id: next.id },
            data: { status: 'NOTIFIED', notifiedAt: new Date(), expiresAt },
          })
        }
      })

      return { success: true, isLateCancel }
    },
  )

  // POST /bookings/:id/checkin — member self check-in
  app.post<{ Params: { id: string } }>(
    '/:id/checkin',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)

      // Fix #5: verify the booking belongs to the requesting user
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.id },
        include: { member: true },
      })

      if (booking.member.userId !== user.id && user.role !== 'admin') {
        return reply.forbidden()
      }

      const updated = await prisma.booking.update({
        where: { id: request.params.id },
        data: { checkedIn: true, checkedInAt: new Date() },
      })
      return { success: true, data: updated }
    },
  )
}
