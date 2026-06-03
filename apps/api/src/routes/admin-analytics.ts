import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, Prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { StudioIdQuery } from '../schemas.js'
import { LeaderboardSchema, AnalyticsDataSchema, QueryResultSchema } from '../schemas/responses.js'
import { checkPermission } from './admin-shared.js'

const requireStudioAdmin = requireRole('studio_admin')
const requireInstructor  = requireRole('instructor')

/** Resolves to true if the caller may view analytics for this studio. */
async function canSeeAnalytics(userId: string, role: string, studioId: string): Promise<boolean> {
  return checkPermission(userId, role, studioId, 'canViewAnalytics')
}

/** Guard for analytics write/read routes — studio_admin+ OR instructor/fronthost with canViewAnalytics */
const requireAnalytics = requireInstructor

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  // GET /admin/stats?studioId=
  app.get<{ Querystring: { studioId: string } }>(
    '/stats',
    {
      preHandler: requireInstructor,
      config: { studioIdFrom: 'querystring' },
      schema: { querystring: StudioIdQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const today = new Date(); today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)

      const [studio, todaySessions, totalMembers, totalBookingsToday, waitlistToday] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId }, select: { name: true, timeFormat: true, currency: true, timezone: true, bookingWindowDays: true, bookingCloseHours: true, waitlistEnabled: true, guestCheckInEnabled: true, creditPurchaseEnabled: true, selfCheckInEnabled: true, classReminderHours: true, maxPauseDays: true, maxPausesPerYear: true, allowMemberPause: true, referralRewardCredits: true, websiteUrl: true, supportEmail: true } }),
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
        allowMemberPause: studio?.allowMemberPause ?? false,
        referralRewardCredits: studio?.referralRewardCredits ?? 0,
        websiteUrl: studio?.websiteUrl ?? null,
        supportEmail: studio?.supportEmail ?? null,
        todaySessions, totalMembers, totalBookingsToday, waitlistToday,
      }
    },
  )

  // GET /admin/leaderboard?studioId=&period=week|month|alltime
  app.get<{ Querystring: { studioId: string; period?: string } }>(
    '/leaderboard',
    {
      preHandler: requireAnalytics,
      config: { studioIdFrom: 'querystring' },
      schema: {
        querystring: StudioIdQuery.extend({
          period: z.enum(['week', 'month', 'alltime']).optional(),
          limit:  z.coerce.number().int().min(1).max(100).optional(),
        }),
        response: { 200: LeaderboardSchema },
      },
    },
    async (request, reply) => {
      const { studioId, period = 'month' } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()

      const now = new Date()
      let from: Date | undefined
      if (period === 'week') { from = new Date(now); from.setDate(from.getDate() - 7) }
      else if (period === 'month') { from = new Date(now); from.setMonth(from.getMonth() - 1) }

      // Member leaderboard — pure SQL GROUP BY, no data loaded into Node memory
      const memberSf = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`cs."studioId" = ${studioId}`
      const memberFromClause = from ? Prisma.sql`AND cs."startsAt" >= ${from}` : Prisma.sql``

      const memberRows = await prisma.$queryRaw<Array<{
        member_id: string; name: string; visits: bigint; check_ins: bigint; last_visit: Date
      }>>`
        SELECT
          b."memberId"                                            AS member_id,
          CONCAT(u."firstName", ' ', u."lastName")               AS name,
          COUNT(*)::bigint                                        AS visits,
          COUNT(CASE WHEN b."checkedIn" THEN 1 END)::bigint       AS check_ins,
          MAX(cs."startsAt")                                      AS last_visit
        FROM "Booking" b
        JOIN "ClassSession" cs ON cs.id = b."sessionId"
        JOIN "Member" m        ON m.id  = b."memberId"
        JOIN "User" u          ON u.id  = m."userId"
        WHERE b.status = 'CONFIRMED'
          AND ${memberSf}
          AND cs."startsAt" < ${now}
          AND cs.status <> 'CANCELLED'
          ${memberFromClause}
        GROUP BY b."memberId", u."firstName", u."lastName"
        ORDER BY COUNT(*) DESC
        LIMIT 25
      `
      const members = memberRows.map((r, i) => ({
        rank: i + 1,
        memberId: r.member_id,
        name: r.name,
        visits: Number(r.visits),
        checkIns: Number(r.check_ins),
        lastVisit: r.last_visit.toISOString(),
      }))

      const instrRows = await prisma.$queryRaw<Array<{
        instructor_id: string; name: string; total_bookings: bigint
      }>>`
        SELECT
          COALESCE(cs."substituteInstructorId", cs."instructorId") AS instructor_id,
          CONCAT(u."firstName", ' ', u."lastName")                 AS name,
          COUNT(b.id)::bigint                                       AS total_bookings
        FROM "ClassSession" cs
        JOIN "Instructor" i ON i.id = COALESCE(cs."substituteInstructorId", cs."instructorId")
        JOIN "User" u       ON u.id = i."userId"
        LEFT JOIN "Booking" b ON b."sessionId" = cs.id AND b.status = 'CONFIRMED'
        WHERE ${memberSf}
          AND cs."startsAt" < ${now}
          AND cs.status <> 'CANCELLED'
          ${memberFromClause}
        GROUP BY instructor_id, u."firstName", u."lastName"
        ORDER BY COUNT(b.id) DESC
        LIMIT 5
      `
      const topInstructors = instrRows.map((r, i) => ({
        rank: i + 1,
        instructorId: r.instructor_id,
        name: r.name,
        totalBookings: Number(r.total_bookings),
      }))

      return reply.send({ members, topInstructors, period, generatedAt: now.toISOString() })
    },
  )

  // GET /admin/analytics?studioId=&weeks=12
  // All heavy aggregations run as SQL GROUP BY queries — no session data loaded into memory.
  // Only instructor loyalty rate (requires time-ordered sequential processing) runs in JS
  // on a minimal dataset (session IDs + confirmed member ID arrays only).
  app.get<{ Querystring: { studioId: string; weeks?: string } }>(
    '/analytics',
    {
      preHandler: requireAnalytics,
      schema: {
        querystring: StudioIdQuery.extend({
          period: z.string().optional(),
          weeks:  z.coerce.number().int().min(4).max(52).optional(),
        }),
        response: { 200: AnalyticsDataSchema },
      },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      const allStudios = studioId === 'all'
      // 'all' studios view requires franchise_admin+; per-studio requires canViewAnalytics
      if (allStudios) {
        if (ROLE_RANK[user.role as keyof typeof ROLE_RANK] < ROLE_RANK['franchise_admin']) {
          return reply.forbidden('franchise_admin role required to view all-studios analytics')
        }
      } else {
        if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
      }

      const weeks = Math.min(Math.max(parseInt(request.query.weeks ?? '12', 10) || 12, 4), 52)
      const now = new Date()
      const windowStart = new Date(now)
      windowStart.setHours(0, 0, 0, 0)
      const dayOfWeek = windowStart.getDay() || 7
      windowStart.setDate(windowStart.getDate() - (dayOfWeek - 1) - (weeks - 1) * 7)

      // Shared SQL fragment for the studio filter
      const sf = allStudios ? Prisma.sql`1=1` : Prisma.sql`cs."studioId" = ${studioId}`

      // ── Heatmap: fill rate by day-of-week × hour ────────────────────────────
      // ISODOW: 1=Mon…7=Sun → subtract 1 for 0-indexed Mon-first
      const heatmapRows = await prisma.$queryRaw<Array<{
        dow: number; hour: number; fill_rate: number; count: bigint
      }>>`
        SELECT
          (EXTRACT(ISODOW FROM cs."startsAt")::int - 1)  AS dow,
          EXTRACT(HOUR   FROM cs."startsAt")::int         AS hour,
          AVG(CASE WHEN cs.capacity > 0
              THEN COALESCE(b.confirmed_count, 0)::float / cs.capacity
              ELSE 0 END)                                 AS fill_rate,
          COUNT(cs.id)                                    AS count
        FROM "ClassSession" cs
        LEFT JOIN (
          SELECT "sessionId", COUNT(*) AS confirmed_count
          FROM "Booking" WHERE status = 'CONFIRMED' GROUP BY "sessionId"
        ) b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY dow, hour
        ORDER BY dow, hour
      `
      const heatmap = heatmapRows.map(r => ({
        dow: r.dow, hour: r.hour, fillRate: r.fill_rate, count: Number(r.count),
      }))

      // ── Weekly trend ─────────────────────────────────────────────────────────
      const weeklyRows = await prisma.$queryRaw<Array<{
        week_start: Date; sessions: bigint; capacity_sum: bigint;
        confirmed_sum: bigint; checked_in_sum: bigint; cancelled_sum: bigint
      }>>`
        SELECT
          DATE_TRUNC('week', cs."startsAt")                                     AS week_start,
          COUNT(DISTINCT cs.id)                                                  AS sessions,
          SUM(cs.capacity)                                                       AS capacity_sum,
          COUNT(CASE WHEN b.status = 'CONFIRMED' THEN 1 END)                    AS confirmed_sum,
          COUNT(CASE WHEN b."checkedIn" = true THEN 1 END)                      AS checked_in_sum,
          COUNT(CASE WHEN b.status IN ('CANCELLED','LATE_CANCELLED') THEN 1 END) AS cancelled_sum
        FROM "ClassSession" cs
        LEFT JOIN "Booking" b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY week_start
        ORDER BY week_start
      `
      // Pre-populate all weeks (SQL only returns weeks with sessions)
      const weekMap = new Map<string, { sessions: number; capacitySum: number; confirmedSum: number; checkedInSum: number; cancelledSum: number }>()
      for (let w = 0; w < weeks; w++) {
        const d = new Date(windowStart.getTime() + w * 7 * 86400000)
        weekMap.set(d.toISOString().slice(0, 10), { sessions: 0, capacitySum: 0, confirmedSum: 0, checkedInSum: 0, cancelledSum: 0 })
      }
      for (const r of weeklyRows) {
        const key = r.week_start.toISOString().slice(0, 10)
        weekMap.set(key, {
          sessions: Number(r.sessions), capacitySum: Number(r.capacity_sum),
          confirmedSum: Number(r.confirmed_sum), checkedInSum: Number(r.checked_in_sum),
          cancelledSum: Number(r.cancelled_sum),
        })
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

      // ── Class stats by template ───────────────────────────────────────────────
      const classRows = await prisma.$queryRaw<Array<{
        template_id: string; name: string; sport: string;
        sessions: bigint; capacity_sum: bigint; confirmed_sum: bigint; checked_in_sum: bigint
      }>>`
        SELECT
          ct.id   AS template_id,
          ct.name,
          ct.sport,
          COUNT(DISTINCT cs.id)                               AS sessions,
          SUM(cs.capacity)                                    AS capacity_sum,
          COUNT(CASE WHEN b.status = 'CONFIRMED' THEN 1 END)  AS confirmed_sum,
          COUNT(CASE WHEN b."checkedIn" = true THEN 1 END)    AS checked_in_sum
        FROM "ClassSession" cs
        JOIN "ClassTemplate" ct ON ct.id = cs."templateId"
        LEFT JOIN "Booking" b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY ct.id, ct.name, ct.sport
        ORDER BY (COUNT(CASE WHEN b.status='CONFIRMED' THEN 1 END)::float
                  / NULLIF(SUM(cs.capacity), 0)) DESC NULLS LAST
      `
      const classStats = classRows.map(r => ({
        templateId: r.template_id, name: r.name, sport: r.sport,
        sessions: Number(r.sessions),
        avgFillRate: Number(r.capacity_sum) > 0 ? Number(r.confirmed_sum) / Number(r.capacity_sum) : 0,
        checkInRate: Number(r.confirmed_sum) > 0 ? Number(r.checked_in_sum) / Number(r.confirmed_sum) : 0,
        totalBookings: Number(r.confirmed_sum),
      }))

      // ── Funnel ────────────────────────────────────────────────────────────────
      const funnelRows = await prisma.$queryRaw<Array<{
        confirmed: bigint; checked_in: bigint; on_time_cancelled: bigint;
        late_cancelled: bigint; no_show: bigint
      }>>`
        SELECT
          COUNT(CASE WHEN b.status = 'CONFIRMED' THEN 1 END)                       AS confirmed,
          COUNT(CASE WHEN b.status = 'CONFIRMED' AND b."checkedIn" = true THEN 1 END) AS checked_in,
          COUNT(CASE WHEN b.status = 'CANCELLED' THEN 1 END)                       AS on_time_cancelled,
          COUNT(CASE WHEN b.status = 'LATE_CANCELLED' THEN 1 END)                  AS late_cancelled,
          COUNT(CASE WHEN b.status = 'NO_SHOW' THEN 1 END)                         AS no_show
        FROM "ClassSession" cs
        JOIN "Booking" b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
      `
      const fr = funnelRows[0] ?? { confirmed: 0n, checked_in: 0n, on_time_cancelled: 0n, late_cancelled: 0n, no_show: 0n }
      const funnel = {
        confirmed: Number(fr.confirmed),
        checkedIn: Number(fr.checked_in),
        onTimeCancelled: Number(fr.on_time_cancelled),
        lateCancelled: Number(fr.late_cancelled),
        noShow: Number(fr.no_show),
      }

      // ── Instructor stats + loyalty rate ──────────────────────────────────────
      // Stats aggregated in SQL; loyalty rate computed in JS (needs sequential ordering)
      const instrStatsRows = await prisma.$queryRaw<Array<{
        instructor_id: string; name: string; sessions: bigint;
        capacity_sum: bigint; confirmed_sum: bigint; checked_in_sum: bigint
      }>>`
        SELECT
          COALESCE(cs."substituteInstructorId", cs."instructorId") AS instructor_id,
          CONCAT(u."firstName", ' ', u."lastName")                 AS name,
          COUNT(DISTINCT cs.id)                                     AS sessions,
          SUM(cs.capacity)                                          AS capacity_sum,
          COUNT(CASE WHEN b.status = 'CONFIRMED' THEN 1 END)        AS confirmed_sum,
          COUNT(CASE WHEN b."checkedIn" = true THEN 1 END)          AS checked_in_sum
        FROM "ClassSession" cs
        JOIN "Instructor" i  ON i.id  = COALESCE(cs."substituteInstructorId", cs."instructorId")
        JOIN "User"       u  ON u.id  = i."userId"
        LEFT JOIN "Booking" b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY instructor_id, name
      `

      // Loyalty rate: minimal query — only IDs and member arrays needed
      const loyaltyRows = await prisma.$queryRaw<Array<{
        instructor_id: string; member_ids: string[] | null
      }>>`
        SELECT
          COALESCE(cs."substituteInstructorId", cs."instructorId") AS instructor_id,
          ARRAY_AGG(b."memberId") FILTER (WHERE b.status = 'CONFIRMED') AS member_ids
        FROM "ClassSession" cs
        LEFT JOIN "Booking" b ON b."sessionId" = cs.id
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY cs.id, cs."startsAt", cs."instructorId", cs."substituteInstructorId"
        ORDER BY cs."startsAt"
      `
      const instrPrev = new Map<string, Set<string>>()
      const instrLoyalties = new Map<string, number[]>()
      for (const row of loyaltyRows) {
        const id = row.instructor_id
        const members = row.member_ids ?? []
        if (members.length === 0) continue
        if (!instrPrev.has(id)) { instrPrev.set(id, new Set()); instrLoyalties.set(id, []) }
        const prev = instrPrev.get(id)!
        instrLoyalties.get(id)!.push(members.filter(m => prev.has(m)).length / members.length)
        for (const m of members) prev.add(m)
      }

      const instructors = instrStatsRows.map(r => {
        const loyalties = instrLoyalties.get(r.instructor_id) ?? []
        return {
          id: r.instructor_id, name: r.name,
          sessions: Number(r.sessions),
          avgFillRate: Number(r.capacity_sum) > 0 ? Number(r.confirmed_sum) / Number(r.capacity_sum) : 0,
          checkInRate: Number(r.confirmed_sum) > 0 ? Number(r.checked_in_sum) / Number(r.confirmed_sum) : 0,
          loyaltyRate: loyalties.length > 0 ? loyalties.reduce((a, b) => a + b, 0) / loyalties.length : 0,
        }
      }).sort((a, b) => b.avgFillRate - a.avgFillRate)

      // ── Recurrence / retention ────────────────────────────────────────────────
      const memberMonthRows = await prisma.$queryRaw<Array<{ month: string; member_id: string }>>`
        SELECT
          TO_CHAR(DATE_TRUNC('month', cs."startsAt"), 'YYYY-MM') AS month,
          b."memberId"                                           AS member_id
        FROM "ClassSession" cs
        JOIN "Booking" b ON b."sessionId" = cs.id AND b.status = 'CONFIRMED'
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY month, b."memberId"
        ORDER BY month
      `
      const membersByMonth = new Map<string, Set<string>>()
      for (const r of memberMonthRows) {
        if (!membersByMonth.has(r.month)) membersByMonth.set(r.month, new Set())
        membersByMonth.get(r.month)!.add(r.member_id)
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

      const freqRows = await prisma.$queryRaw<Array<{ booking_count: bigint }>>`
        SELECT COUNT(*) AS booking_count
        FROM "ClassSession" cs
        JOIN "Booking" b ON b."sessionId" = cs.id AND b.status = 'CONFIRMED'
        WHERE ${sf}
          AND cs.status != 'CANCELLED'
          AND cs."startsAt" >= ${windowStart} AND cs."startsAt" < ${now}
        GROUP BY b."memberId"
      `
      const counts = freqRows.map(r => Number(r.booking_count))
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

      // ── Revenue (credit transactions) — pure SQL, no rows loaded into memory ──
      const memberFilter = allStudios ? Prisma.sql`1=1` : Prisma.sql`m."studioId" = ${studioId}`

      const [revTotals, revWeekly] = await Promise.all([
        // Per-type totals
        prisma.$queryRaw<Array<{ type: string; total: number }>>`
          SELECT ct.type, SUM(ct.amount)::int AS total
          FROM "CreditTransaction" ct
          JOIN "Member" m ON m.id = ct."memberId"
          WHERE ${memberFilter}
            AND ct."createdAt" >= ${windowStart} AND ct."createdAt" < ${now}
          GROUP BY ct.type
        `,
        // Weekly issued / consumed / fees
        prisma.$queryRaw<Array<{ week_start: Date; issued: number; consumed: number; fees: number }>>`
          SELECT
            DATE_TRUNC('week', ct."createdAt")                                      AS week_start,
            SUM(CASE WHEN ct.amount > 0 THEN ct.amount ELSE 0 END)::int             AS issued,
            SUM(CASE WHEN ct.type = 'CLASS_DEBIT' THEN ABS(ct.amount) ELSE 0 END)::int AS consumed,
            SUM(CASE WHEN ct.amount < 0 AND ct.type <> 'CLASS_DEBIT' THEN ABS(ct.amount) ELSE 0 END)::int AS fees
          FROM "CreditTransaction" ct
          JOIN "Member" m ON m.id = ct."memberId"
          WHERE ${memberFilter}
            AND ct."createdAt" >= ${windowStart} AND ct."createdAt" < ${now}
          GROUP BY week_start
          ORDER BY week_start
        `,
      ])

      const revMap: Record<string, number> = {}
      for (const r of revTotals) revMap[r.type] = r.total

      // Map SQL weekly results onto the weeklyTrend week keys
      const weekRevMap = new Map<string, { issued: number; consumed: number; fees: number }>()
      for (const wk of weeklyTrend) weekRevMap.set(wk.weekStart, { issued: 0, consumed: 0, fees: 0 })
      for (const r of revWeekly) {
        const key = r.week_start.toISOString().slice(0, 10)
        if (weekRevMap.has(key)) weekRevMap.set(key, { issued: r.issued, consumed: r.consumed, fees: r.fees })
      }
      const weeklyCredits = Array.from(weekRevMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, v]) => ({ weekStart, ...v }))

      const activeMembers = await prisma.membershipSubscription.count({
        where: { ...(allStudios ? {} : { plan: { studioId } }), status: 'ACTIVE' },
      })

      const revenue = {
        creditsIssued:       Math.max(0, revMap['MEMBERSHIP_RENEWAL'] ?? 0) + Math.max(0, revMap['PURCHASE'] ?? 0) + Math.max(0, revMap['MANUAL_ADJUSTMENT'] ?? 0),
        creditsConsumed:     Math.abs(Math.min(0, revMap['CLASS_DEBIT'] ?? 0)),
        lateCancelFees:      Math.abs(Math.min(0, revMap['LATE_CANCEL_FEE'] ?? 0)),
        noShowFees:          Math.abs(Math.min(0, revMap['NO_SHOW_FEE'] ?? 0)),
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

  // ── Retention cohort ──────────────────────────────────────────────────────
  // Returns a grid: for members who joined in cohort month C, what % still
  // booked in month C+N (N = 0..11). Rows = cohort months, cols = offset.
  app.get('/retention', {
    preHandler: requireStudioAdmin,
    config: { studioIdFrom: 'querystring' },
    schema: { querystring: StudioIdQuery.extend({ months: z.coerce.number().min(3).max(24).default(12) }) },
  }, async (request, reply) => {
    const { studioId, months } = request.query as { studioId: string; months: number }
    const user = getUser(request)
    if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    cutoff.setDate(1); cutoff.setHours(0, 0, 0, 0)

    const sf = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`m."studioId" = ${studioId}`

    // First booking date per member = cohort month
    const rows = await prisma.$queryRaw<{ cohort: Date; offset_month: number; members: number }[]>`
      WITH first_bookings AS (
        SELECT b."memberId",
               DATE_TRUNC('month', MIN(b."bookedAt")) AS cohort_month
        FROM "Booking" b
        JOIN "Member" m ON m.id = b."memberId"
        WHERE ${sf} AND b.status = 'CONFIRMED'
          AND b."bookedAt" >= ${cutoff}
        GROUP BY b."memberId"
      ),
      activity AS (
        SELECT b."memberId",
               DATE_TRUNC('month', b."bookedAt") AS active_month
        FROM "Booking" b
        JOIN "Member" m ON m.id = b."memberId"
        WHERE ${sf} AND b.status = 'CONFIRMED'
        GROUP BY b."memberId", DATE_TRUNC('month', b."bookedAt")
      )
      SELECT
        fb.cohort_month                                                          AS cohort,
        EXTRACT(EPOCH FROM (a.active_month - fb.cohort_month))::int / 2592000  AS offset_month,
        COUNT(DISTINCT fb."memberId")::int                                       AS members
      FROM first_bookings fb
      JOIN activity a ON a."memberId" = fb."memberId"
        AND a.active_month >= fb.cohort_month
      GROUP BY fb.cohort_month, offset_month
      ORDER BY fb.cohort_month, offset_month
    `

    // Build cohort sizes (offset 0)
    const cohortSizes = new Map<string, number>()
    for (const r of rows) {
      if (r.offset_month === 0) cohortSizes.set(r.cohort.toISOString(), r.members)
    }

    // Group into cohort rows
    const cohortMap = new Map<string, { offset: number; pct: number }[]>()
    for (const r of rows) {
      const key = r.cohort.toISOString()
      const size = cohortSizes.get(key) ?? 1
      if (!cohortMap.has(key)) cohortMap.set(key, [])
      cohortMap.get(key)!.push({ offset: r.offset_month, pct: Math.round((r.members / size) * 100) })
    }

    const cohorts = Array.from(cohortMap.entries())
      .map(([month, offsets]) => ({ month, size: cohortSizes.get(month) ?? 0, offsets }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return { cohorts }
  })

  // ── Revenue trend + MRR forecast ─────────────────────────────────────────
  app.get('/revenue', {
    preHandler: requireStudioAdmin,
    config: { studioIdFrom: 'querystring' },
    schema: { querystring: StudioIdQuery.extend({ months: z.coerce.number().min(3).max(24).default(12) }) },
  }, async (request, reply) => {
    const { studioId, months } = request.query as { studioId: string; months: number }
    const user = getUser(request)
    if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
    const sf = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`"studioId" = ${studioId}`
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months); cutoff.setDate(1); cutoff.setHours(0,0,0,0)

    const [salesRows, mrrRows] = await Promise.all([
      // One-time + card sales per month
      prisma.$queryRaw<{ month: Date; revenue: number; orders: number }[]>`
        SELECT DATE_TRUNC('month', "soldAt") AS month,
               SUM("totalCents")::int        AS revenue,
               COUNT(*)::int                 AS orders
        FROM "ProductSale"
        WHERE ${sf} AND "soldAt" >= ${cutoff} AND "refundedAt" IS NULL AND "failedAt" IS NULL
        GROUP BY month ORDER BY month
      `,
      // Active subscriptions per month (MRR proxy)
      prisma.$queryRaw<{ month: Date; mrr: number }[]>`
        SELECT DATE_TRUNC('month', s."startDate") AS month,
               SUM(p."priceInCents")::int          AS mrr
        FROM "MembershipSubscription" s
        JOIN "MembershipPlan" p ON p.id = s."planId"
        WHERE ${studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`p."studioId" = ${studioId}`}
          AND s.status = 'ACTIVE'
          AND p."intervalMonths" > 0
          AND s."startDate" >= ${cutoff}
        GROUP BY month ORDER BY month
      `,
    ])

    // Simple 3-month moving average forecast for next 3 months
    const last3 = salesRows.slice(-3)
    const avgRevenue = last3.length ? last3.reduce((s, r) => s + r.revenue, 0) / last3.length : 0
    const forecast = [1, 2, 3].map(i => {
      const d = new Date(); d.setMonth(d.getMonth() + i); d.setDate(1); d.setHours(0,0,0,0)
      return { month: d.toISOString(), revenue: Math.round(avgRevenue), forecast: true }
    })

    // Revenue breakdown by type per month (subscriptions vs products/one-time)
    const sfSub = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`p."studioId" = ${studioId}`
    const breakdownRows = await prisma.$queryRaw<{ month: Date; subscriptions: number; products: number }[]>`
      WITH sub_rev AS (
        SELECT DATE_TRUNC('month', s."startDate") AS month,
               SUM(p."priceInCents")::int          AS subscriptions
        FROM "MembershipSubscription" s
        JOIN "MembershipPlan" p ON p.id = s."planId"
        WHERE ${sfSub} AND s."startDate" >= ${cutoff}
        GROUP BY 1
      ),
      prod_rev AS (
        SELECT DATE_TRUNC('month', "soldAt") AS month,
               SUM("totalCents")::int         AS products
        FROM "ProductSale"
        WHERE ${sf} AND "soldAt" >= ${cutoff} AND "refundedAt" IS NULL AND "failedAt" IS NULL
        GROUP BY 1
      )
      SELECT COALESCE(s.month, p.month)       AS month,
             COALESCE(s.subscriptions, 0)      AS subscriptions,
             COALESCE(p.products, 0)           AS products
      FROM sub_rev s
      FULL OUTER JOIN prod_rev p ON s.month = p.month
      ORDER BY 1
    `

    return {
      monthly: salesRows.map(r => ({ month: r.month.toISOString(), revenue: r.revenue, orders: r.orders, forecast: false })),
      mrr: mrrRows.map(r => ({ month: r.month.toISOString(), mrr: r.mrr })),
      forecast,
      breakdown: breakdownRows.map(r => ({
        month: r.month.toISOString(),
        subscriptions: r.subscriptions,
        products: r.products,
      })),
    }
  })

  // ── Class performance trends — weekly fill rate per template ─────────────
  app.get('/class-trends', {
    preHandler: requireStudioAdmin,
    config: { studioIdFrom: 'querystring' },
    schema: { querystring: StudioIdQuery.extend({ weeks: z.coerce.number().min(2).max(26).default(8) }) },
  }, async (request, reply) => {
    const { studioId, weeks } = request.query as { studioId: string; weeks: number }
    const user = getUser(request)
    if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
    const sf = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`cs."studioId" = ${studioId}`
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - weeks * 7)
    cutoff.setHours(0, 0, 0, 0)

    const rows = await prisma.$queryRaw<{
      templateId: string; name: string; sport: string
      week: Date; sessions: number; fill_rate: number
    }[]>`
      SELECT
        ct.id                                         AS "templateId",
        ct.name,
        ct.sport,
        DATE_TRUNC('week', cs."startsAt")             AS week,
        COUNT(cs.id)::int                             AS sessions,
        AVG(CASE WHEN cs.capacity > 0
              THEN cs."bookedCount"::float / cs.capacity ELSE NULL END) AS fill_rate
      FROM "ClassSession" cs
      JOIN "ClassTemplate" ct ON ct.id = cs."templateId"
      WHERE ${sf}
        AND cs."startsAt" >= ${cutoff}
        AND cs.status <> 'CANCELLED'
      GROUP BY ct.id, ct.name, ct.sport, DATE_TRUNC('week', cs."startsAt")
      ORDER BY ct.name, week
    `

    // Build week grid
    const weekStarts: string[] = []
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i * 7)
      // Snap to Monday
      const dow = d.getDay() || 7
      d.setDate(d.getDate() - (dow - 1))
      d.setHours(0, 0, 0, 0)
      weekStarts.push(d.toISOString())
    }

    const byTemplate = new Map<string, { name: string; sport: string; byWeek: Map<string, number> }>()
    for (const r of rows) {
      if (!byTemplate.has(r.templateId)) {
        byTemplate.set(r.templateId, { name: r.name, sport: r.sport, byWeek: new Map() })
      }
      byTemplate.get(r.templateId)!.byWeek.set(r.week.toISOString(), r.fill_rate ?? 0)
    }

    const classes = Array.from(byTemplate.entries())
      .map(([templateId, { name, sport, byWeek }]) => ({
        templateId,
        name,
        sport,
        weeklyFill: weekStarts.map(w => {
          // Find the closest matching week key
          const key = [...byWeek.keys()].find(k => Math.abs(new Date(k).getTime() - new Date(w).getTime()) < 4 * 24 * 60 * 60 * 1000)
          return key ? Math.round((byWeek.get(key) ?? 0) * 100) : -1 // -1 = no data
        }),
      }))
      .filter(c => c.weeklyFill.some(v => v >= 0))

    return { classes, weekStarts }
  })

  // ── Membership funnel over time ───────────────────────────────────────────
  app.get('/membership-funnel', {
    preHandler: requireStudioAdmin,
    config: { studioIdFrom: 'querystring' },
    schema: { querystring: StudioIdQuery.extend({ months: z.coerce.number().min(3).max(24).default(12) }) },
  }, async (request, reply) => {
    const { studioId, months } = request.query as { studioId: string; months: number }
    const user = getUser(request)
    if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
    const sfPlan = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`p."studioId" = ${studioId}`
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months); cutoff.setDate(1); cutoff.setHours(0,0,0,0)

    // For each calendar month: snapshot of subscription states
    // new = started in that month; cancelled/expired = ended in that month; active = running
    const rows = await prisma.$queryRaw<{ month: Date; active: number; paused: number; cancelled: number; new_subs: number }[]>`
      WITH months AS (
        SELECT generate_series(${cutoff}::date, date_trunc('month', now())::date, '1 month'::interval) AS month
      )
      SELECT
        m.month,
        COUNT(*) FILTER (
          WHERE s."startDate" <= (m.month + interval '1 month - 1 day')
            AND (s."endDate" IS NULL OR s."endDate" > m.month)
            AND s.status NOT IN ('CANCELLED','EXPIRED')
            AND (s."pausedUntil" IS NULL OR s."pausedUntil" <= m.month)
        )::int  AS active,
        COUNT(*) FILTER (
          WHERE s."startDate" <= (m.month + interval '1 month - 1 day')
            AND (s."endDate" IS NULL OR s."endDate" > m.month)
            AND s.status NOT IN ('CANCELLED','EXPIRED')
            AND s."pausedUntil" IS NOT NULL AND s."pausedUntil" > m.month
        )::int  AS paused,
        COUNT(*) FILTER (
          WHERE s."startDate" <= (m.month + interval '1 month - 1 day')
            AND s.status IN ('CANCELLED','EXPIRED')
            AND date_trunc('month', COALESCE(s."endDate", s."startDate")) = m.month
        )::int  AS cancelled,
        COUNT(*) FILTER (
          WHERE date_trunc('month', s."startDate") = m.month
        )::int  AS new_subs
      FROM months m
      CROSS JOIN "MembershipSubscription" s
      JOIN "MembershipPlan" p ON p.id = s."planId"
      WHERE ${sfPlan}
      GROUP BY m.month
      ORDER BY m.month
    `

    return {
      months: rows.map(r => ({
        month: r.month.toISOString(),
        active: r.active,
        paused: r.paused,
        cancelled: r.cancelled,
        newSubs: r.new_subs,
      })),
    }
  })

  // ── Churn risk — members who haven't booked recently vs their cadence ─────
  app.get('/churn-risk', {
    preHandler: requireStudioAdmin,
    config: { studioIdFrom: 'querystring' },
    schema: { querystring: StudioIdQuery },
  }, async (request, reply) => {
    const { studioId } = request.query as { studioId: string }
    const user = getUser(request)
    if (!await canSeeAnalytics(user.id, user.role, studioId)) return reply.forbidden()
    const sf = studioId === 'all' ? Prisma.sql`1=1` : Prisma.sql`m."studioId" = ${studioId}`

    const rows = await prisma.$queryRaw<{
      memberId: string; firstName: string; lastName: string; email: string
      totalBookings: number; lastBookedAt: Date | null
      avgDaysBetween: number | null; daysSinceLast: number | null
    }[]>`
      SELECT
        m.id                                                              AS "memberId",
        u."firstName",
        u."lastName",
        u.email,
        COUNT(b.id)::int                                                  AS "totalBookings",
        MAX(b."bookedAt")                                                 AS "lastBookedAt",
        AVG(gap)                                                          AS "avgDaysBetween",
        EXTRACT(EPOCH FROM (now() - MAX(b."bookedAt")))::float / 86400   AS "daysSinceLast"
      FROM "Member" m
      JOIN "User" u ON u.id = m."userId"
      LEFT JOIN (
        SELECT "memberId", "bookedAt",
               EXTRACT(EPOCH FROM ("bookedAt" - LAG("bookedAt") OVER (PARTITION BY "memberId" ORDER BY "bookedAt")))::float / 86400 AS gap
        FROM "Booking" WHERE status = 'CONFIRMED'
      ) b ON b."memberId" = m.id
      WHERE ${sf} AND m."staffRoles" = '{}'
      GROUP BY m.id, u."firstName", u."lastName", u.email
      HAVING COUNT(b.id) >= 3
         AND MAX(b."bookedAt") < now() - interval '21 days'
         AND EXTRACT(EPOCH FROM (now() - MAX(b."bookedAt")))::float / 86400
             > COALESCE(AVG(gap) * 2.5, 30)
      ORDER BY "daysSinceLast" DESC
      LIMIT 50
    `

    return {
      members: rows.map(r => ({
        memberId: r.memberId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        email: r.email,
        totalBookings: r.totalBookings,
        lastBookedAt: r.lastBookedAt?.toISOString() ?? null,
        avgDaysBetween: r.avgDaysBetween ? Math.round(r.avgDaysBetween) : null,
        daysSinceLast: r.daysSinceLast ? Math.round(r.daysSinceLast) : null,
      })),
    }
  })
}
