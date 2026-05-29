import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { assertStudioAccess } from './admin-shared.js'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor  = requireRole('instructor')

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  // GET /admin/stats?studioId=
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    { preHandler: requireInstructor },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const today = new Date(); today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)

      const [studio, todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { name: true, timeFormat: true, currency: true, timezone: true, bookingWindowDays: true, bookingCloseHours: true, waitlistEnabled: true, guestCheckInEnabled: true, creditPurchaseEnabled: true, selfCheckInEnabled: true, classReminderHours: true, maxPauseDays: true, maxPausesPerYear: true, websiteUrl: true, supportEmail: true } }),
        prisma.classSession.count({ where: { studioId, startsAt: { gte: today, lt: tomorrow } } }),
        prisma.member.count({ where: { studioId } }),
        prisma.booking.count({ where: { session: { studioId }, bookedAt: { gte: today }, status: 'CONFIRMED' } }),
        prisma.waitlistEntry.count({ where: { session: { studioId }, joinedAt: { gte: today }, status: 'WAITING' } }),
      ])

      return {
        studioName: studio?.name ?? null,
        timeFormat: studio?.timeFormat ?? '24h',
        currency: studio?.currency ?? 'USD',
        timezone: studio?.timezone ?? 'UTC',
        bookingWindowDays: studio?.bookingWindowDays ?? 30,
        bookingCloseHours: studio?.bookingCloseHours ?? 1,
        waitlistEnabled: studio?.waitlistEnabled ?? true,
        guestCheckInEnabled: studio?.guestCheckInEnabled ?? true,
        creditPurchaseEnabled: studio?.creditPurchaseEnabled ?? true,
        selfCheckInEnabled: studio?.selfCheckInEnabled ?? false,
        classReminderHours: studio?.classReminderHours ?? 24,
        maxPauseDays: studio?.maxPauseDays ?? 30,
        maxPausesPerYear: studio?.maxPausesPerYear ?? 2,
        websiteUrl: studio?.websiteUrl ?? null,
        supportEmail: studio?.supportEmail ?? null,
        todaySessions, totalMembers, totalBookingsToday, waitlistToday,
      }
    },
  )

  // GET /admin/leaderboard?studioId=&period=week|month|alltime
  app.get<{ Querystring: { studioId: string; period?: string } }>(
    '/leaderboard',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, period = 'month' } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const now = new Date()
      let from: Date | undefined
      if (period === 'week') { from = new Date(now); from.setDate(from.getDate() - 7) }
      else if (period === 'month') { from = new Date(now); from.setMonth(from.getMonth() - 1) }

      const bookings = await prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          session: {
            studioId,
            startsAt: { lt: now, ...(from ? { gte: from } : {}) },
            status: { not: 'CANCELLED' },
          },
        },
        select: {
          memberId: true,
          checkedIn: true,
          session: {
            select: {
              startsAt: true,
              instructorId: true,
              substituteInstructorId: true,
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
          member: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      })

      const memberMap = new Map<string, { name: string; visits: number; checkIns: number; lastVisit: Date }>()
      for (const b of bookings) {
        const existing = memberMap.get(b.memberId) ?? { name: `${b.member.user.firstName} ${b.member.user.lastName}`, visits: 0, checkIns: 0, lastVisit: new Date(0) }
        memberMap.set(b.memberId, {
          ...existing,
          visits: existing.visits + 1,
          checkIns: existing.checkIns + (b.checkedIn ? 1 : 0),
          lastVisit: b.session.startsAt > existing.lastVisit ? b.session.startsAt : existing.lastVisit,
        })
      }
      const members = Array.from(memberMap.entries())
        .sort((a, b) => b[1].visits - a[1].visits)
        .slice(0, 25)
        .map(([memberId, v], i) => ({ rank: i + 1, memberId, name: v.name, visits: v.visits, checkIns: v.checkIns, lastVisit: v.lastVisit.toISOString() }))

      const instrMap = new Map<string, { name: string; totalBookings: number }>()
      for (const b of bookings) {
        const instr = b.session.instructor
        if (!instr) continue
        const id = b.session.substituteInstructorId ?? b.session.instructorId
        const name = `${instr.user.firstName} ${instr.user.lastName}`
        const existing = instrMap.get(id) ?? { name, totalBookings: 0 }
        instrMap.set(id, { ...existing, totalBookings: existing.totalBookings + 1 })
      }
      const topInstructors = Array.from(instrMap.entries())
        .sort((a, b) => b[1].totalBookings - a[1].totalBookings)
        .slice(0, 5)
        .map(([id, v], i) => ({ rank: i + 1, instructorId: id, name: v.name, totalBookings: v.totalBookings }))

      return reply.send({ members, topInstructors, period, generatedAt: now.toISOString() })
    },
  )

  // GET /admin/analytics?studioId=&weeks=12
  app.get<{ Querystring: { studioId: string; weeks?: string } }>(
    '/analytics',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)

      const allStudios = studioId === 'all'
      if (allStudios && ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin']) {
        return reply.forbidden('franchise_admin role required to view all-studios analytics')
      }

      const weeks = Math.min(Math.max(parseInt(request.query.weeks ?? '12', 10) || 12, 4), 52)
      const now = new Date()

      const windowStart = new Date(now)
      windowStart.setHours(0, 0, 0, 0)
      const dayOfWeek = windowStart.getDay() || 7
      windowStart.setDate(windowStart.getDate() - (dayOfWeek - 1) - (weeks - 1) * 7)

      const sessions = await prisma.classSession.findMany({
        where: {
          ...(allStudios ? {} : { studioId }),
          status: { not: 'CANCELLED' },
          startsAt: { gte: windowStart, lt: now },
        },
        include: {
          template: { select: { id: true, name: true, sport: true } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          substitute: { include: { user: { select: { firstName: true, lastName: true } } } },
          bookings: { select: { status: true, checkedIn: true, memberId: true } },
        },
        orderBy: { startsAt: 'asc' },
      })

      function isoWeekMonday(d: Date): string {
        const copy = new Date(d); copy.setHours(0, 0, 0, 0)
        const dow = copy.getDay() || 7
        copy.setDate(copy.getDate() - (dow - 1))
        return copy.toISOString().slice(0, 10)
      }

      function monFirstDow(d: Date): number { return (d.getDay() + 6) % 7 }

      const heatmapMap = new Map<string, { total: number; sum: number }>()
      for (const s of sessions) {
        const key = `${monFirstDow(s.startsAt)}_${s.startsAt.getHours()}`
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const fill = s.capacity > 0 ? confirmed / s.capacity : 0
        const existing = heatmapMap.get(key) ?? { total: 0, sum: 0 }
        heatmapMap.set(key, { total: existing.total + 1, sum: existing.sum + fill })
      }
      const heatmap = Array.from(heatmapMap.entries()).map(([key, v]) => {
        const [dow, hour] = key.split('_').map(Number)
        return { dow, hour, fillRate: v.sum / v.total, count: v.total }
      })

      const weekMap = new Map<string, { sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number; cancelledSum: number }>()
      for (let w = 0; w < weeks; w++) {
        const d = new Date(windowStart.getTime() + w * 7 * 86400000)
        weekMap.set(d.toISOString().slice(0, 10), { sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0, cancelledSum: 0 })
      }
      for (const s of sessions) {
        const wk = isoWeekMonday(s.startsAt)
        const entry = weekMap.get(wk) ?? { sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0, cancelledSum: 0 }
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const cancelled = s.bookings.filter(b => b.status === 'CANCELLED' || b.status === 'LATE_CANCELLED').length
        weekMap.set(wk, { sessions: entry.sessions + 1, capacitySum: entry.capacitySum + s.capacity, confirmedSum: entry.confirmedSum + confirmed, checkedInSum: entry.checkedInSum + checkedIn, cancelledSum: entry.cancelledSum + cancelled })
      }
      const weeklyTrend = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, v]) => ({
          weekStart,
          sessions: v.sessions,
          avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0,
          checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0,
          cancelRate: (v.confirmedSum + v.cancelledSum) > 0 ? v.cancelledSum / (v.confirmedSum + v.cancelledSum) : 0,
        }))

      const classMap = new Map<string, { name: string; sport: string; sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number }>()
      for (const s of sessions) {
        const tid = s.template.id
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const existing = classMap.get(tid) ?? { name: s.template.name, sport: s.template.sport, sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0 }
        classMap.set(tid, { ...existing, sessions: existing.sessions + 1, capacitySum: existing.capacitySum + s.capacity, confirmedSum: existing.confirmedSum + confirmed, checkedInSum: existing.checkedInSum + checkedIn })
      }
      const classStats = Array.from(classMap.entries()).map(([templateId, v]) => ({
        templateId, name: v.name, sport: v.sport, sessions: v.sessions,
        avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0,
        checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0,
        totalBookings: v.confirmedSum,
      })).sort((a, b) => b.avgFillRate - a.avgFillRate)

      const funnel = { confirmed: 0, checkedIn: 0, onTimeCancelled: 0, lateCancelled: 0, noShow: 0 }
      for (const s of sessions) {
        for (const b of s.bookings) {
          if (b.status === 'CONFIRMED') { funnel.confirmed++; if (b.checkedIn) funnel.checkedIn++; else funnel.noShow++ }
          else if (b.status === 'CANCELLED') funnel.onTimeCancelled++
          else if (b.status === 'LATE_CANCELLED') funnel.lateCancelled++
        }
      }

      const instrCumulativeMembers = new Map<string, Set<string>>()
      const instrSessionLoyalties  = new Map<string, number[]>()
      for (const s of sessions) {
        const instr = s.substitute ?? s.instructor
        if (!instr) continue
        const id = instr.id
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED')
        if (confirmed.length === 0) continue
        if (!instrCumulativeMembers.has(id)) { instrCumulativeMembers.set(id, new Set()); instrSessionLoyalties.set(id, []) }
        const prevMembers = instrCumulativeMembers.get(id)!
        const returningCount = confirmed.filter(b => prevMembers.has(b.memberId)).length
        instrSessionLoyalties.get(id)!.push(returningCount / confirmed.length)
        for (const b of confirmed) prevMembers.add(b.memberId)
      }

      const instrMap2 = new Map<string, { name: string; sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number }>()
      for (const s of sessions) {
        const instr = s.substitute ?? s.instructor
        if (!instr) continue
        const id = instr.id
        const name = `${instr.user.firstName} ${instr.user.lastName}`.trim()
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED').length
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        const existing = instrMap2.get(id) ?? { name, sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0 }
        instrMap2.set(id, { name, sessions: existing.sessions + 1, capacitySum: existing.capacitySum + s.capacity, confirmedSum: existing.confirmedSum + confirmed, checkedInSum: existing.checkedInSum + checkedIn })
      }
      const instructors = Array.from(instrMap2.entries()).map(([id, v]) => {
        const loyalties = instrSessionLoyalties.get(id) ?? []
        const loyaltyRate = loyalties.length > 0 ? loyalties.reduce((a, b) => a + b, 0) / loyalties.length : 0
        return { id, name: v.name, sessions: v.sessions, avgFillRate: v.capacitySum > 0 ? v.confirmedSum / v.capacitySum : 0, checkInRate: v.confirmedSum > 0 ? v.checkedInSum / v.confirmedSum : 0, loyaltyRate }
      }).sort((a, b) => b.avgFillRate - a.avgFillRate)

      const membersByMonth = new Map<string, Set<string>>()
      for (const s of sessions) {
        const monthKey = `${s.startsAt.getFullYear()}-${String(s.startsAt.getMonth() + 1).padStart(2, '0')}`
        if (!membersByMonth.has(monthKey)) membersByMonth.set(monthKey, new Set())
        for (const b of s.bookings) { if (b.status === 'CONFIRMED') membersByMonth.get(monthKey)!.add(b.memberId) }
      }
      const monthKeys = Array.from(membersByMonth.keys()).sort()
      const momRates: number[] = []
      for (let i = 1; i < monthKeys.length; i++) {
        const prev = membersByMonth.get(monthKeys[i - 1])!
        const curr = membersByMonth.get(monthKeys[i])!
        if (prev.size === 0) continue
        momRates.push([...prev].filter(id => curr.has(id)).length / prev.size)
      }
      const monthOverMonth = momRates.length > 0 ? momRates.reduce((a, b) => a + b, 0) / momRates.length : 0

      const memberBookingCount = new Map<string, number>()
      for (const s of sessions) {
        for (const b of s.bookings) {
          if (b.status === 'CONFIRMED') memberBookingCount.set(b.memberId, (memberBookingCount.get(b.memberId) ?? 0) + 1)
        }
      }
      const counts = Array.from(memberBookingCount.values())
      const avgBookingsPerMember = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0
      const buckets: Record<string, number> = { '1': 0, '2–4': 0, '5–9': 0, '10–19': 0, '20+': 0 }
      for (const c of counts) {
        if (c === 1) buckets['1']++
        else if (c <= 4) buckets['2–4']++
        else if (c <= 9) buckets['5–9']++
        else if (c <= 19) buckets['10–19']++
        else buckets['20+']++
      }
      const frequencyBuckets = Object.entries(buckets).map(([label, count]) => ({ label, count }))

      const transactions = await prisma.creditTransaction.findMany({
        where: { ...(allStudios ? {} : { member: { studioId } }), createdAt: { gte: windowStart, lt: now } },
        select: { type: true, amount: true, createdAt: true },
      })
      const revMap: Record<string, number> = {}
      for (const tx of transactions) revMap[tx.type] = (revMap[tx.type] ?? 0) + tx.amount

      const weekRevMap = new Map<string, { issued: number; consumed: number; fees: number }>()
      for (const wk of weeklyTrend) weekRevMap.set(wk.weekStart, { issued: 0, consumed: 0, fees: 0 })
      for (const tx of transactions) {
        const wk = isoWeekMonday(tx.createdAt)
        if (!weekRevMap.has(wk)) continue
        const entry = weekRevMap.get(wk)!
        if (tx.amount > 0) entry.issued += tx.amount
        else if (tx.type === 'CLASS_DEBIT') entry.consumed += Math.abs(tx.amount)
        else entry.fees += Math.abs(tx.amount)
      }
      const weeklyCredits = Array.from(weekRevMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, v]) => ({ weekStart, ...v }))

      const activeMembers = await prisma.membershipSubscription.count({
        where: { ...(allStudios ? {} : { plan: { studioId } }), status: 'ACTIVE' },
      })

      const revenue = {
        creditsIssued:      Math.max(0, revMap['MEMBERSHIP_RENEWAL'] ?? 0) + Math.max(0, revMap['PURCHASE'] ?? 0) + Math.max(0, revMap['MANUAL_ADJUSTMENT'] ?? 0),
        creditsConsumed:    Math.abs(Math.min(0, revMap['CLASS_DEBIT'] ?? 0)),
        lateCancelFees:     Math.abs(Math.min(0, revMap['LATE_CANCEL_FEE'] ?? 0)),
        noShowFees:         Math.abs(Math.min(0, revMap['NO_SHOW_FEE'] ?? 0)),
        activeSubscriptions: activeMembers,
        weeklyCredits,
      }

      return reply.send({
        heatmap, weeklyTrend, classStats, funnel, instructors,
        recurrence: { monthOverMonth, avgBookingsPerMember, frequencyBuckets },
        revenue,
        meta: { weeks, windowStart: windowStart.toISOString(), generatedAt: now.toISOString() },
      })
    },
  )
}
