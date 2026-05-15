import PgBoss from 'pg-boss'
import { prisma } from '@packd/db'

let boss: PgBoss

export async function setupJobs() {
  boss = new PgBoss(process.env.PGBOSS_DATABASE_URL ?? process.env.DATABASE_URL!)
  await boss.start()

  // Create all queues first (required in pg-boss v10 — sequential to avoid DDL deadlocks)
  for (const name of [
    'waitlist.expire',
    'booking.late-cancel-fee',
    'session.no-show',
    'nightly.maintenance',
    'membership.renewal-reminder',
  ]) {
    await boss.createQueue(name)
  }

  // Waitlist expiry — runs when a notified member doesn't confirm in time
  await boss.work('waitlist.expire', async ([job]) => {
    const { waitlistEntryId } = job.data as { waitlistEntryId: string }
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistEntryId } })
    if (!entry || entry.status !== 'NOTIFIED') return

    await prisma.waitlistEntry.update({
      where: { id: waitlistEntryId },
      data: { status: 'EXPIRED' },
    })

    // Promote next person
    const next = await prisma.waitlistEntry.findFirst({
      where: { sessionId: entry.sessionId, status: 'WAITING' },
      orderBy: { position: 'asc' },
    })

    if (next) {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
      await prisma.waitlistEntry.update({
        where: { id: next.id },
        data: { status: 'NOTIFIED', notifiedAt: new Date(), expiresAt },
      })
      await boss.sendAfter('waitlist.expire', { waitlistEntryId: next.id }, {}, expiresAt)
      // TODO: send push notification
    }
  })

  // Late cancel fee — runs after class starts, checks for late cancellations
  await boss.work('booking.late-cancel-fee', async ([job]) => {
    const { bookingId } = job.data as { bookingId: string }
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { session: true, member: { include: { creditBalance: true } } },
    })
    if (!booking || booking.status !== 'LATE_CANCELLED') return

    const policy = await prisma.cancellationPolicy.findUnique({
      where: { studioId: booking.session.studioId },
    })
    const fee = policy?.lateCancelFeeCredits ?? 1

    await prisma.$transaction(async (tx) => {
      await tx.creditBalance.update({
        where: { memberId: booking.memberId },
        data: { balance: { decrement: fee } },
      })
      await tx.creditTransaction.create({
        data: {
          memberId: booking.memberId,
          amount: -fee,
          type: 'LATE_CANCEL_FEE',
          note: `Late cancel: session ${booking.sessionId}`,
        },
      })
    })
  })

  // No-show processing — runs 30 min after class starts
  await boss.work('session.no-show', async ([job]) => {
    const { sessionId } = job.data as { sessionId: string }
    const session = await prisma.classSession.findUnique({ where: { id: sessionId } })
    if (!session) return

    const policy = await prisma.cancellationPolicy.findUnique({
      where: { studioId: session.studioId },
    })
    const fee = policy?.noShowFeeCredits ?? 1

    const noShows = await prisma.booking.findMany({
      where: { sessionId, status: 'CONFIRMED', checkedIn: false },
    })

    for (const booking of noShows) {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'NO_SHOW' } })
        await tx.creditBalance.update({
          where: { memberId: booking.memberId },
          data: { balance: { decrement: fee } },
        })
        await tx.creditTransaction.create({
          data: {
            memberId: booking.memberId,
            amount: -fee,
            type: 'NO_SHOW_FEE',
            note: `No-show: session ${sessionId}`,
          },
        })
      })
    }
  })

  // Nightly cron: expire old waitlist entries and send membership reminders
  await boss.schedule('nightly.maintenance', '0 2 * * *', {})
  await boss.work('nightly.maintenance', async () => {
    // Expire stale WAITING entries for past sessions
    await prisma.waitlistEntry.updateMany({
      where: { status: 'WAITING', session: { startsAt: { lt: new Date() } } },
      data: { status: 'EXPIRED' },
    })

    // Find memberships expiring in 7 days and enqueue reminders
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const expiring = await prisma.membershipSubscription.findMany({
      where: { status: 'ACTIVE', endDate: { lte: soon, gte: new Date() } },
    })
    for (const sub of expiring) {
      await boss.send('membership.renewal-reminder', { subscriptionId: sub.id })
    }
  })

  console.log('pg-boss jobs registered')
}

export async function enqueueLateCancelCheck(bookingId: string, sessionStartsAt: Date) {
  // Schedule fee check 5 minutes after class starts
  const runAt = new Date(sessionStartsAt.getTime() + 5 * 60 * 1000)
  await boss.sendAfter('booking.late-cancel-fee', { bookingId }, {}, runAt)
}

export async function enqueueNoShowCheck(sessionId: string, sessionStartsAt: Date) {
  // Check for no-shows 30 minutes after class starts
  const runAt = new Date(sessionStartsAt.getTime() + 30 * 60 * 1000)
  await boss.sendAfter('session.no-show', { sessionId }, {}, runAt)
}
