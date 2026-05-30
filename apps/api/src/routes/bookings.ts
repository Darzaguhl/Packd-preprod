import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js'
import { requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { enqueueLateCancelCheck } from '../jobs/index.js'
import { ensureMemberForAdmin } from './members.js'
import { sendBookingConfirmation, sendBookingCancellation } from '../lib/email.js'

/** Format a human-readable note for credit transactions, e.g. "Cycling · 26 May, 09:00" */
function fmtClassNote(className: string | null | undefined, startsAt: Date): string {
  const name = className ?? 'Class'
  const date = startsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${name} · ${date}, ${time}`
}

export async function bookingRoutes(app: FastifyInstance) {
  // POST /bookings — create booking
  // Privileged roles (studio_admin, fronthost, instructor, etc.) may pass a
  // memberId in the body to book on behalf of another member (walk-in flow).
  app.post<{ Body: { sessionId: string; memberId?: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId, memberId: targetMemberId } = request.body

      // Fix #12: validate required body fields
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.badRequest('sessionId is required')
      }

      const user = getUser(request)

      // Privileged roles can book on behalf of any member by passing memberId
      const isPrivileged = ROLE_RANK[user.role] >= ROLE_RANK['fronthost']
      const isAdmin = ROLE_RANK[user.role] >= ROLE_RANK['franchise_admin']

      let member
      if (isPrivileged && targetMemberId) {
        member = await prisma.member.findUniqueOrThrow({ where: { id: targetMemberId } })
      } else {
        // For admin/franchise_admin: auto-create member record if missing (they may have
        // been promoted directly via Supabase without going through normal member signup)
        if (isAdmin) {
          const session = await prisma.classSession.findUnique({ where: { id: sessionId }, select: { studioId: true } })
          if (session) await ensureMemberForAdmin(user.id, user.email, session.studioId)
        }
        member = await prisma.member.findUniqueOrThrow({ where: { userId: user.id } })
      }

      // For self-booking (non-privileged), verify the session's studio is the
      // member's home studio OR belongs to the same StudioNetwork.
      const isMemberBooking = !isPrivileged || !targetMemberId
      if (isMemberBooking) {
        const sessionStudio = await prisma.classSession.findUnique({
          where: { id: sessionId },
          select: { studioId: true },
        })
        if (sessionStudio && sessionStudio.studioId !== member.studioId) {
          // Allow if both studios are in the same network
          const [homeMembership, targetMembership] = await Promise.all([
            prisma.studioNetworkMembership.findFirst({ where: { studioId: member.studioId }, select: { networkId: true } }),
            prisma.studioNetworkMembership.findFirst({ where: { studioId: sessionStudio.studioId }, select: { networkId: true } }),
          ])
          if (!homeMembership || !targetMembership || homeMembership.networkId !== targetMembership.networkId) {
            return reply.forbidden('Cannot book at a studio outside your network')
          }
        }
      }

      // Run capacity check + balance check + booking creation inside a single
      // transaction. Both the session and credit balance are read inside the
      // transaction so concurrent requests cannot race past either guard.
      // The @@unique([sessionId, memberId]) on Booking is the final DB-level guard.
      const booking = await prisma.$transaction(async (tx) => {
        const session = await tx.classSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: {
            _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
            template: { select: { name: true } },
            studio: { select: { bookingWindowDays: true, bookingCloseHours: true } },
          },
        })

        if (session.status !== 'SCHEDULED') {
          throw Object.assign(new Error('Class is not available for booking'), { statusCode: 400 })
        }

        // Members cannot book classes that have already started; admins and
        // fronthosts can re-book or adjust spots on running/past classes.
        const isMember = !user.role || user.role === 'member'
        if (isMember && session.startsAt <= new Date()) {
          throw Object.assign(new Error('Class has already started'), { statusCode: 400 })
        }

        // Enforce booking window and close time for members (privileged roles bypass)
        if (isMember) {
          const now = new Date()
          const bookingWindowDays = session.studio?.bookingWindowDays ?? 30
          const bookingCloseHours = session.studio?.bookingCloseHours ?? 1
          // Block bookings too far in the future (beyond the booking window)
          const windowClose = new Date(now.getTime() + bookingWindowDays * 24 * 60 * 60 * 1000)
          if (session.startsAt > windowClose) {
            throw Object.assign(new Error(`Booking opens ${bookingWindowDays} days before the class`), { statusCode: 400 })
          }
          // Block bookings too close to class start (within booking close window)
          if (bookingCloseHours > 0) {
            const closeTime = new Date(session.startsAt.getTime() - bookingCloseHours * 60 * 60 * 1000)
            if (now > closeTime) {
              throw Object.assign(new Error(`Booking closed ${bookingCloseHours}h before class starts`), { statusCode: 400 })
            }
          }
        }

        if (session._count.bookings >= session.capacity) {
          throw Object.assign(new Error('Class is full — join the waitlist instead'), { statusCode: 409 })
        }

        // Read balance inside the transaction to prevent concurrent overdraft
        const creditBalance = await tx.creditBalance.findUnique({ where: { memberId: member.id } })
        const balance = creditBalance?.balance ?? 0
        // Privileged staff booking on behalf of a member (fronthost / studio_admin / etc.)
        // bypass the credit guard — balance can go negative and be topped up at the desk.
        // Members booking for themselves always need sufficient credits.
        const onBehalf = isPrivileged && !!targetMemberId
        if (!onBehalf && balance < session.creditsRequired) {
          throw Object.assign(new Error('Insufficient credits'), { statusCode: 402 })
        }

        // Check for a time-overlap conflict — member already has a CONFIRMED booking
        // for another session (at any studio) that runs at the same time.
        const conflict = await tx.booking.findFirst({
          where: {
            memberId: member.id,
            status: 'CONFIRMED',
            sessionId: { not: sessionId }, // exclude the session itself (re-book edge case)
            session: {
              startsAt: { lt: session.endsAt },
              endsAt:   { gt: session.startsAt },
            },
          },
          select: { session: { select: { startsAt: true, template: { select: { name: true } } } } },
        })
        if (conflict) {
          const conflictName = conflict.session.template?.name ?? 'another class'
          const conflictTime = conflict.session.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
          throw Object.assign(
            new Error(`You already have ${conflictName} booked at ${conflictTime} — classes overlap`),
            { statusCode: 409 },
          )
        }

        // Check for an existing booking row (confirmed = already booked,
        // cancelled = user previously cancelled and is re-booking).
        const existing = await tx.booking.findUnique({
          where: { sessionId_memberId: { sessionId, memberId: member.id } },
        })

        if (existing?.status === 'CONFIRMED') {
          throw Object.assign(new Error('Already booked'), { statusCode: 409 })
        }

        // Re-activate a previously cancelled booking instead of creating a
        // duplicate (which would violate the @@unique([sessionId, memberId])).
        // Both CANCELLED and LATE_CANCELLED rows must be updated — creating a
        // new row would violate the unique constraint on (sessionId, memberId).
        let newBooking
        if (existing?.status === 'CANCELLED' || existing?.status === 'LATE_CANCELLED') {
          newBooking = await tx.booking.update({
            where: { id: existing.id },
            data: { status: 'CONFIRMED', stationId: null, checkedIn: false, checkedInAt: null },
          })
        } else {
          try {
            newBooking = await tx.booking.create({
              data: { sessionId, memberId: member.id, status: 'CONFIRMED' },
            })
          } catch (e: unknown) {
            if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
              throw Object.assign(new Error('Already booked'), { statusCode: 409 })
            }
            throw e
          }
        }

        await tx.creditBalance.update({
          where: { memberId: member.id },
          data: { balance: { decrement: session.creditsRequired } },
        })

        const classLabel = fmtClassNote(session.template?.name, session.startsAt)
        await tx.creditTransaction.create({
          data: {
            memberId: member.id,
            amount: -session.creditsRequired,
            type: 'CLASS_DEBIT',
            note: classLabel,
          },
        })

        return { booking: newBooking, session }
      })

      await enqueueLateCancelCheck(booking.booking.id, booking.session.startsAt)

      // Send booking confirmation email (non-fatal)
      prisma.classSession.findUnique({
        where: { id: sessionId },
        include: {
          studio: { select: { name: true } },
          room: { select: { name: true } },
        },
      }).then(async sess => {
        if (!sess) return
        const userRecord = await prisma.user.findUnique({ where: { id: member.userId }, select: { email: true, firstName: true } })
        if (!userRecord) return
        sendBookingConfirmation({
          to: userRecord.email,
          firstName: userRecord.firstName,
          studioName: sess.studio.name,
          className: booking.session.template?.name ?? 'Class',
          startsAt: booking.session.startsAt.toISOString(),
          roomName: sess.room?.name ?? '',
          webUrl: process.env.WEB_URL ?? 'http://localhost:3001',
        }).catch(() => {})
      }).catch(() => {})

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
          session: { include: { template: { select: { name: true } } } },
          member: { include: { creditBalance: true } },
        },
      })

      // Members can only cancel their own booking; privileged staff can cancel any
      const isPrivileged = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['fronthost']
      if (!isPrivileged && booking.member.userId !== user.id) {
        return reply.forbidden()
      }

      if (booking.status !== 'CONFIRMED') {
        return reply.badRequest('Booking is already cancelled')
      }

      const now = new Date()
      const policy = await prisma.cancellationPolicy.findUnique({
        where: { studioId: booking.session.studioId },
      })
      const windowHours          = policy?.lateCancelWindowHours  ?? 12
      const lateCancelFeeCredits = policy?.lateCancelFeeCredits   ?? 1
      const waitlistWindowMs     = (policy?.waitlistWindowMinutes ?? 15) * 60 * 1000

      const hoursUntilClass =
        (booking.session.startsAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      const isLateCancel = hoursUntilClass < windowHours

      // Privileged staff cancellations (on behalf) are never charged late-cancel fees
      const isPrivilegedCancel = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['fronthost']
      const chargeFee = isLateCancel && !isPrivilegedCancel && lateCancelFeeCredits > 0

      // Run waitlist promotion inside the same transaction as the cancellation
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: isLateCancel ? 'LATE_CANCELLED' : 'CANCELLED',
            stationId: null, // always release the spot on cancellation
          },
        })

        if (!isLateCancel) {
          // On-time cancel: full credit refund
          await tx.creditBalance.update({
            where: { memberId: booking.memberId },
            data: { balance: { increment: booking.session.creditsRequired } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId: booking.memberId,
              amount: booking.session.creditsRequired,
              type: 'REFUND',
              note: `Cancelled: ${fmtClassNote(booking.session.template?.name, booking.session.startsAt)}`,
            },
          })
        } else if (chargeFee) {
          // Late cancel: no refund + charge the late-cancel fee (floor at 0, never go negative)
          const current = await tx.creditBalance.findUnique({ where: { memberId: booking.memberId } })
          const actualFee = Math.min(lateCancelFeeCredits, current?.balance ?? 0)
          if (actualFee > 0) {
            await tx.creditBalance.upsert({
              where: { memberId: booking.memberId },
              create: { memberId: booking.memberId, balance: 0 },
              update: { balance: { decrement: actualFee } },
            })
            await tx.creditTransaction.create({
              data: {
                memberId: booking.memberId,
                amount: -actualFee,
                type: 'LATE_CANCEL_FEE',
                note: `Late cancellation fee for ${booking.session.template?.name ?? 'class'}`,
              },
            })
          }
        }

        // Promote next waitlist member within the same transaction
        const next = await tx.waitlistEntry.findFirst({
          where: { sessionId: booking.sessionId, status: 'WAITING' },
          orderBy: { position: 'asc' },
        })
        if (next) {
          const expiresAt = new Date(Date.now() + waitlistWindowMs)
          await tx.waitlistEntry.update({
            where: { id: next.id },
            data: { status: 'NOTIFIED', notifiedAt: new Date(), expiresAt },
          })
        }
      })

      // Send cancellation email (non-fatal)
      prisma.booking.findUnique({
        where: { id: request.params.id },
        include: {
          session: {
            include: {
              template: { select: { name: true } },
              studio: { select: { name: true } },
            },
          },
          member: { include: { user: { select: { email: true, firstName: true } } } },
        },
      }).then(b => {
        if (!b) return
        sendBookingCancellation({
          to: b.member.user.email,
          firstName: b.member.user.firstName,
          studioName: b.session.studio.name,
          className: b.session.template?.name ?? 'Class',
          startsAt: b.session.startsAt.toISOString(),
          reason: isLateCancel ? 'This was a late cancellation.' : undefined,
          webUrl: process.env.WEB_URL ?? 'http://localhost:3001',
        }).catch(() => {})
      }).catch(() => {})

      return { success: true, isLateCancel }
    },
  )

  // POST /bookings/:id/checkin — member self check-in
  app.post<{ Params: { id: string } }>(
    '/:id/checkin',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: request.params.id },
        include: {
          member: true,
          session: { select: { studioId: true } },
        },
      })

      const isPrivilegedRole = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['fronthost']
      const isSelf = booking.member.userId === user.id

      if (!isSelf && !isPrivilegedRole) return reply.forbidden()

      // Members can only self-check-in if the studio allows it
      if (isSelf && !isPrivilegedRole) {
        const studio = await prisma.studio.findUnique({
          where: { id: booking.session.studioId },
          select: { selfCheckInEnabled: true },
        })
        if (!studio?.selfCheckInEnabled) {
          return reply.forbidden('Self check-in is not enabled for this studio')
        }
      }

      const updated = await prisma.booking.update({
        where: { id: request.params.id },
        data: { checkedIn: true, checkedInAt: new Date() },
      })
      return { success: true, data: updated }
    },
  )
}
