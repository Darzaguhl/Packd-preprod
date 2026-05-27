import PgBoss from 'pg-boss'
import { prisma } from '@packd/db'

let boss: PgBoss

export async function setupJobs() {
  boss = new PgBoss(process.env.PGBOSS_DATABASE_URL ?? process.env.DATABASE_URL!)

  // pg-boss requires an error listener — without one Node will throw an unhandled
  // exception and kill the entire process on any DB connectivity blip.
  boss.on('error', (err: Error) => {
    console.error('[pg-boss]', err.message)
  })

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
      include: { session: true },
    })
    if (!booking || booking.status !== 'LATE_CANCELLED') return

    const policy = await prisma.cancellationPolicy.findUnique({
      where: { studioId: booking.session.studioId },
    })
    const fee = policy?.lateCancelFeeCredits ?? 1

    await prisma.$transaction(async (tx) => {
      // Floor at 0 — never drive balance negative
      const current = await tx.creditBalance.findUnique({ where: { memberId: booking.memberId } })
      const actualFee = Math.min(fee, current?.balance ?? 0)
      if (actualFee <= 0) return

      await tx.creditBalance.update({
        where: { memberId: booking.memberId },
        data: { balance: { decrement: actualFee } },
      })
      await tx.creditTransaction.create({
        data: {
          memberId: booking.memberId,
          amount: -actualFee,
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
      select: { id: true, memberId: true },
    })

    if (noShows.length === 0) return

    // Single batched transaction for all no-shows in the session.
    // Batch-fetch all credit balances upfront to avoid N+1 DB round-trips.
    await prisma.$transaction(async (tx) => {
      await tx.booking.updateMany({
        where: { id: { in: noShows.map(b => b.id) } },
        data: { status: 'NO_SHOW' },
      })

      const memberIds = noShows.map(b => b.memberId)
      const balances = await tx.creditBalance.findMany({
        where: { memberId: { in: memberIds } },
        select: { memberId: true, balance: true },
      })
      const balanceMap = new Map(balances.map(b => [b.memberId, b.balance]))

      for (const booking of noShows) {
        const current = balanceMap.get(booking.memberId) ?? 0
        const actualFee = Math.min(fee, current)
        if (actualFee <= 0) continue

        await tx.creditBalance.update({
          where: { memberId: booking.memberId },
          data: { balance: { decrement: actualFee } },
        })
        await tx.creditTransaction.create({
          data: {
            memberId: booking.memberId,
            amount: -actualFee,
            type: 'NO_SHOW_FEE',
            note: `No-show: session ${sessionId}`,
          },
        })
      }
    })
  })

  // Membership renewal — grants credits and extends subscription for the next cycle
  await boss.work('membership.renewal-reminder', async ([job]) => {
    const { subscriptionId } = job.data as { subscriptionId: string }
    const sub = await prisma.membershipSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    })
    if (!sub || sub.status !== 'ACTIVE') return

    const now = new Date()
    // Only renew if we're within 1 day of or past the end date
    if (sub.endDate && sub.endDate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) return

    // Calculate new end date: advance by intervalMonths from current endDate (or now)
    const base = sub.endDate ?? now
    const newEnd = new Date(base)
    newEnd.setMonth(newEnd.getMonth() + sub.plan.intervalMonths)

    await prisma.$transaction(async (tx) => {
      // Extend the subscription
      await tx.membershipSubscription.update({
        where: { id: sub.id },
        data: { endDate: newEnd, updatedAt: new Date() },
      })

      // Grant credits for the new cycle (null = unlimited, skip credit grant)
      const credits = sub.plan.creditsPerCycle
      if (credits !== null && credits > 0) {
        await tx.creditBalance.upsert({
          where: { memberId: sub.memberId },
          create: { memberId: sub.memberId, balance: credits },
          update: { balance: { increment: credits } },
        })
        await tx.creditTransaction.create({
          data: {
            memberId: sub.memberId,
            amount: credits,
            type: 'MEMBERSHIP_RENEWAL',
            note: `Renewal: ${sub.plan.name}`,
          },
        })
      }
    })

    console.log(`[jobs] renewed subscription ${sub.id} → ${newEnd.toISOString()}`)
  })

  // Nightly cron: expire old waitlist entries, schedule no-show checks, renew memberships
  await boss.schedule('nightly.maintenance', '0 2 * * *', {})
  await boss.work('nightly.maintenance', async () => {
    const now = new Date()

    // Expire stale WAITING entries for past sessions
    await prisma.waitlistEntry.updateMany({
      where: { status: 'WAITING', session: { startsAt: { lt: now } } },
      data: { status: 'EXPIRED' },
    })

    // Schedule no-show checks for sessions starting in the next 24 hours
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const upcomingSessions = await prisma.classSession.findMany({
      where: { startsAt: { gt: now, lt: tomorrow }, status: 'SCHEDULED' },
      select: { id: true, startsAt: true },
    })
    for (const session of upcomingSessions) {
      await enqueueNoShowCheck(session.id, session.startsAt)
    }

    // Mark subscriptions past their end date as EXPIRED
    await prisma.membershipSubscription.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: now } },
      data: { status: 'EXPIRED' },
    })

    // Find memberships expiring in 7 days and enqueue renewal jobs
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const expiring = await prisma.membershipSubscription.findMany({
      where: { status: 'ACTIVE', endDate: { lte: soon, gte: now } },
      select: { id: true },
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
  // Check for no-shows 30 minutes after class starts.
  // singletonKey ensures only one job per session, so nightly + on-completion calls are idempotent.
  const runAt = new Date(sessionStartsAt.getTime() + 30 * 60 * 1000)
  await boss.sendAfter('session.no-show', { sessionId }, { singletonKey: `session-${sessionId}` }, runAt)
}
