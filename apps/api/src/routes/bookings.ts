import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { enqueueLateCancelCheck } from '../jobs/index.js'

export async function bookingRoutes(app: FastifyInstance) {
  // POST /bookings — create booking
  app.post<{ Body: { sessionId: string; spotLabel?: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId, spotLabel } = request.body
      const user = getUser(request)

      const [session, member] = await Promise.all([
        prisma.classSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: { _count: { select: { bookings: true } } },
        }),
        prisma.member.findUniqueOrThrow({
          where: { userId: user.id },
          include: { creditBalance: true },
        }),
      ])

      if (session.status !== 'SCHEDULED') {
        return reply.badRequest('Class is not available for booking')
      }

      if (session._count.bookings >= session.capacity) {
        return reply.conflict('Class is full — join the waitlist instead')
      }

      const balance = member.creditBalance?.balance ?? 0
      if (balance < session.creditsRequired) {
        return reply.paymentRequired('Insufficient credits')
      }

      const booking = await prisma.$transaction(async (tx) => {
        const newBooking = await tx.booking.create({
          data: { sessionId, memberId: member.id, spotLabel, status: 'CONFIRMED' },
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

        return newBooking
      })

      await enqueueLateCancelCheck(booking.id, session.startsAt)

      return reply.code(201).send({ success: true, data: booking })
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

      const now = new Date()
      const policy = await prisma.cancellationPolicy.findUnique({
        where: { studioId: booking.session.studioId },
      })
      const windowHours = policy?.lateCancelWindowHours ?? 12
      const hoursUntilClass =
        (booking.session.startsAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      const isLateCancel = hoursUntilClass < windowHours

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: isLateCancel ? 'LATE_CANCELLED' : 'CANCELLED' },
        })

        // Refund credits only for on-time cancellations
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
      })

      // Promote next waitlist member
      await promoteFromWaitlist(booking.sessionId)

      return { success: true, isLateCancel }
    },
  )

  // POST /bookings/:id/checkin
  app.post<{ Params: { id: string } }>(
    '/:id/checkin',
    { preHandler: requireAuth },
    async (request, reply) => {
      const booking = await prisma.booking.update({
        where: { id: request.params.id },
        data: { checkedIn: true, checkedInAt: new Date() },
      })
      return { success: true, data: booking }
    },
  )
}

async function promoteFromWaitlist(sessionId: string) {
  const next = await prisma.waitlistEntry.findFirst({
    where: { sessionId, status: 'WAITING' },
    orderBy: { position: 'asc' },
  })

  if (!next) return

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  await prisma.waitlistEntry.update({
    where: { id: next.id },
    data: { status: 'NOTIFIED', notifiedAt: new Date(), expiresAt },
  })

  // TODO: send push/email notification to member
}
