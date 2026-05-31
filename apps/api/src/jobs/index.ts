import PgBoss from 'pg-boss'
import { logger } from '../lib/logger.js'
import { prisma } from '@packd/db'
import { sendWaitlistPromotion, sendClassReminder, sendWinback, sendCreditExpiryWarning, sendFirstClassFollowup, sendFranchiseBroadcast } from '../lib/email.js'

let boss: PgBoss

export async function setupJobs() {
  boss = new PgBoss(process.env.PGBOSS_DATABASE_URL ?? process.env.DATABASE_URL!)

  // pg-boss requires an error listener — without one Node will throw an unhandled
  // exception and kill the entire process on any DB connectivity blip.
  boss.on('error', (err: Error) => {
    logger.error({ err: err.message }, '[pg-boss] error')
  })

  await boss.start()

  // Create all queues first (required in pg-boss v10 — sequential to avoid DDL deadlocks)
  for (const name of [
    'waitlist.expire',
    'booking.late-cancel-fee',
    'session.no-show',
    'session.reminder',
    'nightly.maintenance',
    'membership.renewal-reminder',
    'credit.expiry-sweep',
    'member.first-class-followup',
    'franchise.broadcast',
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

      // Send waitlist promotion email
      const promoted = await prisma.waitlistEntry.findUnique({
        where: { id: next.id },
        include: {
          member: { include: { user: true } },
          session: {
            include: {
              template: { select: { name: true } },
              studio: { select: { name: true } },
            },
          },
        },
      })
      if (promoted) {
        sendWaitlistPromotion({
          to: promoted.member.user.email,
          firstName: promoted.member.user.firstName,
          studioName: promoted.session.studio.name,
          className: promoted.session.template?.name ?? 'Class',
          startsAt: promoted.session.startsAt.toISOString(),
          webUrl: process.env.WEB_URL ?? 'http://localhost:3001',
        }).catch(() => {})
      }
    }
  })

  // Late cancel fee — runs after class starts, checks for late cancellations
  await boss.work('booking.late-cancel-fee', async ([job]) => {
    const { bookingId } = job.data as { bookingId: string }
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { session: { include: { template: { select: { name: true } } } } },
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
          note: `Late cancel fee: ${booking.session.template.name} · ${booking.session.startsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${booking.session.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
        },
      })
    })
  })

  // No-show processing — runs 30 min after class starts
  await boss.work('session.no-show', async ([job]) => {
    const { sessionId } = job.data as { sessionId: string }
    const session = await prisma.classSession.findUnique({
      where: { id: sessionId },
      include: { template: { select: { name: true } } },
    })
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
      const balanceMap = new Map<string, number>(balances.map(b => [b.memberId, b.balance] as [string, number]))

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
            note: `No-show: ${session.template.name} · ${session.startsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${session.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
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

    logger.info({ subscriptionId: sub.id, newEnd }, '[jobs] renewed subscription')
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

    // Schedule no-show checks + reminders for sessions starting in the next 7 days.
    // 7-day window covers studios with long reminder lead times (e.g. 48h).
    // singletonKey on both jobs ensures they're only enqueued once per session.
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const upcomingSessions = await prisma.classSession.findMany({
      where: { startsAt: { gt: now, lt: in7Days }, status: 'SCHEDULED' },
      select: { id: true, startsAt: true, studioId: true },
    })
    for (const session of upcomingSessions) {
      await enqueueNoShowCheck(session.id, session.startsAt)
      await enqueueClassReminder(session.id, session.startsAt, session.studioId)
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

    // Enqueue credit expiry sweep
    await boss.send('credit.expiry-sweep', {})

    // Win-back: members inactive 30+ days, no win-back email in 60 days
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3001'
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sixtyDaysAgo  = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const lapsed = await prisma.member.findMany({
      where: {
        staffRoles: { isEmpty: true },
        OR: [{ lastWinbackAt: null }, { lastWinbackAt: { lt: sixtyDaysAgo } }],
        bookings: { none: { bookedAt: { gte: thirtyDaysAgo }, status: 'CONFIRMED' } },
      },
      select: {
        id: true,
        emailPreferences: true,
        user: { select: { firstName: true, email: true } },
        studio: { select: { name: true } },
      },
      take: 200,
    })
    for (const m of lapsed) {
      const prefs = (m.emailPreferences ?? {}) as Record<string, boolean>
      if (prefs.marketing === false) continue
      await sendWinback({ to: m.user.email, firstName: m.user.firstName, studioName: m.studio.name, webUrl })
      await prisma.member.update({ where: { id: m.id }, data: { lastWinbackAt: new Date() } })
    }

    // Credit expiry warning: credits expiring within 7 days
    // Only sent once per member per 7-day window (creditWarningSentAt guard prevents daily re-fires)
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const expiringCredits = await prisma.creditTransaction.findMany({
      where: { expiresAt: { gte: tomorrow, lte: sevenDaysOut }, amount: { gt: 0 } },
      include: {
        member: {
          select: {
            id: true,
            emailPreferences: true,
            creditWarningSentAt: true,
            user: { select: { firstName: true, email: true } },
            studio: { select: { name: true } },
          },
        },
      },
      distinct: ['memberId'],
    })
    for (const tx of expiringCredits) {
      const prefs = (tx.member.emailPreferences ?? {}) as Record<string, boolean>
      if (prefs.classReminder === false) continue
      // Skip if a warning was already sent within the last 7 days
      if (tx.member.creditWarningSentAt && tx.member.creditWarningSentAt >= sevenDaysAgo) continue
      const totalExpiring = await prisma.creditTransaction.aggregate({
        where: { memberId: tx.memberId, expiresAt: { gte: tomorrow, lte: sevenDaysOut }, amount: { gt: 0 } },
        _sum: { amount: true },
      })
      await sendCreditExpiryWarning({
        to: tx.member.user.email,
        firstName: tx.member.user.firstName,
        studioName: tx.member.studio.name,
        credits: totalExpiring._sum.amount ?? 0,
        expiresAt: tx.expiresAt!,
        webUrl,
      })
      await prisma.member.update({ where: { id: tx.memberId }, data: { creditWarningSentAt: new Date() } })
    }
  })

  // Credit expiry sweep — deduct expired credits from balances
  await boss.work('credit.expiry-sweep', async () => {
    const now = new Date()

    // Find all positive credit transactions that have expired and haven't been offset yet
    const expired = await prisma.creditTransaction.findMany({
      where: {
        expiresAt: { lte: now },
        amount: { gt: 0 },
        type: { in: ['PURCHASE', 'MEMBERSHIP_RENEWAL'] },
      },
      select: { id: true, memberId: true, amount: true },
    })

    // Group by member — sum up what needs to be deducted
    const byMember = new Map<string, number>()
    for (const tx of expired) {
      byMember.set(tx.memberId, (byMember.get(tx.memberId) ?? 0) + tx.amount)
    }

    if (byMember.size === 0) return

    for (const [memberId, totalExpired] of byMember) {
      await prisma.$transaction(async (tx) => {
        const balance = await tx.creditBalance.findUnique({
          where: { memberId },
          select: { balance: true },
        })
        if (!balance || balance.balance <= 0) return

        const deduct = Math.min(totalExpired, balance.balance)
        await tx.creditBalance.update({
          where: { memberId },
          data: { balance: { decrement: deduct } },
        })
        await tx.creditTransaction.create({
          data: {
            memberId,
            amount: -deduct,
            type: 'EXPIRY',
            note: `${deduct} credit${deduct !== 1 ? 's' : ''} expired`,
          },
        })
        // Mark the original transactions so they aren't double-counted on the next run
        await tx.creditTransaction.updateMany({
          where: { memberId, expiresAt: { lte: now }, amount: { gt: 0 }, type: { in: ['PURCHASE', 'MEMBERSHIP_RENEWAL'] } },
          data: { type: 'EXPIRY_PROCESSED' },
        })
      })
    }
  })

  // Class reminder — send 24h before session to all confirmed bookings
  await boss.work('session.reminder', async ([job]) => {
    const { sessionId } = job.data as { sessionId: string }
    const session = await prisma.classSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { select: { name: true } },
        studio: { select: { name: true } },
        room: { select: { name: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        bookings: {
          where: { status: 'CONFIRMED' },
          include: {
            member: { select: { emailPreferences: true, user: { select: { email: true, firstName: true } } } },
            station: { select: { label: true } },
          },
        },
      },
    })
    if (!session || session.status === 'CANCELLED') return

    const webUrl = process.env.WEB_URL ?? 'http://localhost:3001'
    for (const booking of session.bookings) {
      const memberPrefs = (booking.member.emailPreferences ?? {}) as Record<string, boolean>
      if (memberPrefs.classReminder === false) continue
      sendClassReminder({
        to: booking.member.user.email,
        firstName: booking.member.user.firstName,
        studioName: session.studio.name,
        className: session.template?.name ?? 'Class',
        startsAt: session.startsAt.toISOString(),
        instructorName: `${session.instructor.user.firstName} ${session.instructor.user.lastName}`,
        roomName: session.room?.name ?? '',
        stationLabel: booking.station?.label ?? null,
        webUrl,
      }).catch(() => {})
    }
  })

  // Franchise broadcast — sends emails in batches of 25 concurrently
  await boss.work('franchise.broadcast', async ([job]) => {
    const { studioIds, subject, message, studioName } = job.data as {
      studioIds: string[]; subject: string; message: string; studioName: string
    }
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3001'

    const members = await prisma.member.findMany({
      where: { studioId: { in: studioIds }, staffRoles: { isEmpty: true } },
      select: {
        id: true,
        emailPreferences: true,
        user: { select: { firstName: true, email: true } },
      },
    })

    const BATCH = 25
    let sent = 0
    for (let i = 0; i < members.length; i += BATCH) {
      const batch = members.slice(i, i + BATCH)
      const results = await Promise.allSettled(batch.map(async m => {
        const prefs = (m.emailPreferences ?? {}) as Record<string, boolean>
        if (prefs.marketing === false) return
        await sendFranchiseBroadcast({
          to: m.user.email,
          firstName: m.user.firstName,
          studioName,
          subject,
          message,
          webUrl,
        })
        sent++
      }))
      results.forEach(r => { if (r.status === 'rejected') logger.error({ err: r.reason }, '[broadcast] email failed') })
    }
    logger.info({ sent, total: members.length }, '[broadcast] complete')
  })

  // First-class follow-up email — sent ~26h after a member's first booking
  await boss.work('member.first-class-followup', async ([job]) => {
    const { memberId } = job.data as { memberId: string }
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: { user: true, studio: true },
    })
    if (!member) return
    const prefs = (member.emailPreferences ?? {}) as Record<string, boolean>
    if (prefs.marketing === false) return
    await sendFirstClassFollowup({
      to: member.user.email,
      firstName: member.user.firstName,
      studioName: member.studio.name,
      webUrl: process.env.WEB_URL ?? 'http://localhost:3001',
    })
  })

  logger.info('pg-boss jobs registered')
}

export async function stopJobs() {
  await boss?.stop()
}

export async function enqueueWaitlistExpiry(waitlistEntryId: string, expiresAt: Date) {
  await boss.sendAfter('waitlist.expire', { waitlistEntryId }, {}, expiresAt)
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

export async function enqueueBroadcast(payload: { studioIds: string[]; subject: string; message: string; studioName: string }) {
  await boss.send('franchise.broadcast', payload)
}

export async function enqueueFirstClassFollowup(memberId: string, sessionId: string) {
  const runAt = new Date(Date.now() + 26 * 60 * 60 * 1000)
  await boss.sendAfter('member.first-class-followup', { memberId, sessionId }, {}, runAt)
}

export async function enqueueClassReminder(sessionId: string, sessionStartsAt: Date, studioId?: string) {
  // Look up studio's reminder hours setting (null = disabled)
  let reminderHours = 24
  if (studioId) {
    const studio = await prisma.studio.findUnique({
      where: { id: studioId },
      select: { classReminderHours: true },
    })
    if (studio?.classReminderHours === null) return // reminders disabled for this studio
    reminderHours = studio?.classReminderHours ?? 24
  }

  const runAt = new Date(sessionStartsAt.getTime() - reminderHours * 60 * 60 * 1000)
  if (runAt <= new Date()) return // already past — skip
  await boss.sendAfter('session.reminder', { sessionId }, { singletonKey: `reminder-${sessionId}` }, runAt)
}
