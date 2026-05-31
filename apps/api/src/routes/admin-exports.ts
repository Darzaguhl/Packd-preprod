import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { assertStudioAccess, validateSelectQuery } from './admin-shared.js'

const requireStudioAdmin = requireRole('studio_admin')

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`
  return str
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) lines.push(row.map(csvEscape).join(','))
  return lines.join('\r\n')
}

export async function adminExportsRoutes(app: FastifyInstance) {
  // POST /admin/query — run a SELECT query against the database (studio_admin+)
  // Rate-limited to 10/min per IP — queries can be expensive and block the DB.
  app.post<{ Body: { sql: string; studioId: string } }>(
    '/query',
    { preHandler: requireStudioAdmin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { sql, studioId } = request.body
      if (!studioId) return reply.badRequest('studioId is required')
      if (!sql || typeof sql !== 'string') return reply.badRequest('sql is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const err = validateSelectQuery(sql)
      if (err) return reply.badRequest(err)

      const capped = `SELECT * FROM (${sql}) AS _result LIMIT 500`

      const t0 = Date.now()
      let rows: Record<string, unknown>[]
      try {
        rows = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 10000')
          return tx.$queryRawUnsafe(capped) as Promise<Record<string, unknown>[]>
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return reply.badRequest(msg.replace(/^.*\n/, '').trim())
      }
      const duration = Date.now() - t0

      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      const data = rows.map(r => columns.map(c => {
        const v = r[c]
        if (v instanceof Date) return v.toISOString()
        if (typeof v === 'bigint') return Number(v)
        return v ?? null
      }))

      return reply.send({ columns, rows: data, rowCount: rows.length, duration })
    },
  )

  // GET /admin/export/members?studioId=
  app.get<{ Querystring: { studioId: string } }>(
    '/export/members',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const members = await prisma.member.findMany({
        where: { studioId, staffRoles: { isEmpty: true } },
        include: {
          user: { select: { email: true, firstName: true, lastName: true, createdAt: true } },
          creditBalance: { select: { balance: true } },
          memberships: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            select: { plan: { select: { name: true } }, status: true, endDate: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { user: { lastName: 'asc' } },
      })

      const headers = ['First Name', 'Last Name', 'Email', 'Credits', 'Plan', 'Status', 'Plan End', 'Joined']
      const rows = members.map(m => {
        const sub = m.memberships[0]
        return [
          m.user.firstName, m.user.lastName, m.user.email,
          m.creditBalance?.balance ?? 0,
          sub?.plan.name ?? '', sub?.status ?? '',
          sub?.endDate?.toISOString().slice(0, 10) ?? '',
          m.user.createdAt.toISOString().slice(0, 10),
        ]
      })

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="members.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/attendance?studioId=&from=&to=
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/attendance',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate   = to   ? new Date(to)   : new Date()

      const bookings = await prisma.booking.findMany({
        where: {
          session: { studioId, startsAt: { gte: fromDate, lte: toDate } },
          status: { in: ['CONFIRMED', 'NO_SHOW', 'LATE_CANCELLED'] },
        },
        include: {
          session: { include: { template: { select: { name: true } } } },
          member: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        },
        orderBy: { session: { startsAt: 'asc' } },
      })

      const headers = ['Date', 'Class', 'Member First', 'Member Last', 'Email', 'Status', 'Checked In']
      const rows = bookings.map(b => [
        b.session.startsAt.toISOString().slice(0, 10),
        b.session.template.name,
        b.member.user.firstName, b.member.user.lastName, b.member.user.email,
        b.status,
        b.checkedIn ? 'Yes' : 'No',
      ])

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="attendance.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/revenue?studioId=&from=&to=
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/revenue',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate   = to   ? new Date(to)   : new Date()

      const sales = await prisma.productSale.findMany({
        where: { studioId, soldAt: { gte: fromDate, lte: toDate }, failedAt: null },
        include: { member: { include: { user: { select: { firstName: true, lastName: true, email: true } } } } },
        orderBy: { soldAt: 'asc' },
      })

      const headers = ['Date', 'Member First', 'Member Last', 'Email', 'Items', 'Total (cents)', 'Payment Method', 'Refunded']
      const rows = sales.map(s => [
        s.soldAt.toISOString().slice(0, 10),
        s.member.user.firstName, s.member.user.lastName, s.member.user.email,
        (s.items as { name: string; qty: number }[]).map(i => `${i.name}×${i.qty}`).join('; '),
        s.totalCents, s.paymentMethod,
        s.refundedAt ? 'Yes' : 'No',
      ])

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="revenue.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/instructor-pay?studioId=&from=&to=
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/instructor-pay',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate   = to   ? new Date(to)   : new Date()

      const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { currency: true } })
      const currency = studio?.currency ?? 'USD'

      const sessions = await prisma.classSession.findMany({
        where: { studioId, status: { not: 'CANCELLED' }, startsAt: { gte: fromDate, lte: toDate } },
        include: {
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          substitute:  { include: { user: { select: { firstName: true, lastName: true } } } },
          bookings: { select: { status: true, checkedIn: true } },
        },
        orderBy: { startsAt: 'asc' },
      })

      type InstructorRow = { name: string; sessions: number; totalAttendees: number; checkedIn: number; payRatePerHeadCents: number | null }
      const byInstructor = new Map<string, InstructorRow>()

      for (const s of sessions) {
        const instr = s.instructor
        if (!instr) continue
        const name = `${instr.user.firstName} ${instr.user.lastName}`
        if (!byInstructor.has(instr.id)) {
          byInstructor.set(instr.id, { name, sessions: 0, totalAttendees: 0, checkedIn: 0, payRatePerHeadCents: instr.payRatePerHeadCents ?? null })
        }
        const row = byInstructor.get(instr.id)!
        const confirmed = s.bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'NO_SHOW' || b.checkedIn)
        row.sessions++
        row.totalAttendees += confirmed.length
        row.checkedIn += s.bookings.filter(b => b.checkedIn).length
      }

      const headers = ['Instructor', 'Sessions', 'Total Bookings', 'Checked In', `Rate/Head (${currency})`, `Est. Pay (${currency})`]
      const rows = [...byInstructor.values()].map(r => {
        const rate = r.payRatePerHeadCents != null ? r.payRatePerHeadCents / 100 : null
        const pay  = rate != null ? (rate * r.checkedIn).toFixed(2) : 'N/A'
        return [r.name, r.sessions, r.totalAttendees, r.checkedIn, rate != null ? rate.toFixed(2) : 'Not set', pay]
      })

      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', 'attachment; filename="instructor-pay.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )

  // GET /admin/export/staff-pay?studioId=&from=&to=
  // Combined payroll for all staff: instructor per-head + fronthost hourly shifts.
  app.get<{ Querystring: { studioId: string; from?: string; to?: string } }>(
    '/export/staff-pay',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, from, to } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)

      const isAll = studioId === 'all'
      if (isAll && ROLE_RANK[user.role] < ROLE_RANK['franchise_admin']) {
        return reply.forbidden('franchise_admin required to export all studios')
      }
      if (!isAll && !await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const toDate   = to   ? new Date(to)   : new Date()

      const studio = isAll ? null : await prisma.studio.findUnique({ where: { id: studioId }, select: { currency: true } })
      const currency = studio?.currency ?? 'USD'
      const sym = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
        .format(0).replace(/[\d,.\s]/g, '').trim() || currency

      const studioFilter = isAll ? {} : { studioId }

      // ── Instructors: per-head pay ──────────────────────────────────────────
      const sessions = await prisma.classSession.findMany({
        where: { ...studioFilter, status: { not: 'CANCELLED' }, startsAt: { gte: fromDate, lte: toDate } },
        include: {
          instructor: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
          bookings: { select: { status: true, checkedIn: true } },
        },
      })

      type StaffRow = { name: string; email: string; role: string; sessions: number; attendees: number; shiftHours: number; rateCents: number | null; totalCents: number }
      const byStaff = new Map<string, StaffRow>()

      for (const s of sessions) {
        const instr = s.instructor
        if (!instr) continue
        const key = instr.id
        if (!byStaff.has(key)) {
          byStaff.set(key, { name: `${instr.user.firstName} ${instr.user.lastName}`, email: instr.user.email, role: 'Instructor', sessions: 0, attendees: 0, shiftHours: 0, rateCents: instr.payRatePerHeadCents ?? null, totalCents: 0 })
        }
        const row = byStaff.get(key)!
        const checkedIn = s.bookings.filter(b => b.checkedIn).length
        row.sessions++
        row.attendees += checkedIn
        if (row.rateCents != null) row.totalCents += row.rateCents * checkedIn
      }

      // ── Fronthosts: hourly shift pay ───────────────────────────────────────
      const shifts = await prisma.staffShift.findMany({
        where: { ...studioFilter, startsAt: { gte: fromDate, lte: toDate } },
        include: {
          member: {
            select: {
              id: true, payRateHourlyCents: true,
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
      })

      for (const sh of shifts) {
        const m = sh.member
        const key = `fh-${m.id}`
        if (!byStaff.has(key)) {
          byStaff.set(key, { name: `${m.user.firstName} ${m.user.lastName}`, email: m.user.email, role: 'Front Desk', sessions: 0, attendees: 0, shiftHours: 0, rateCents: m.payRateHourlyCents ?? null, totalCents: 0 })
        }
        const row = byStaff.get(key)!
        const hrs = (sh.endsAt.getTime() - sh.startsAt.getTime()) / 3600000
        row.shiftHours += hrs
        if (row.rateCents != null) row.totalCents += row.rateCents * hrs
      }

      const headers = ['Name', 'Email', 'Role', 'Sessions', 'Attendees (checked in)', `Shift Hours`, `Rate`, `Est. Pay (${currency})`]
      const rows = [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name)).map(r => {
        const rateLabel = r.rateCents != null
          ? r.role === 'Instructor' ? `${sym}${(r.rateCents / 100).toFixed(2)}/head` : `${sym}${(r.rateCents / 100).toFixed(2)}/hr`
          : 'Not set'
        const pay = r.rateCents != null ? `${sym}${(r.totalCents / 100).toFixed(2)}` : 'N/A'
        return [r.name, r.email, r.role, r.sessions || '', r.attendees || '', r.shiftHours > 0 ? r.shiftHours.toFixed(2) : '', rateLabel, pay]
      })

      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', 'attachment; filename="staff-pay.csv"')
      return reply.send(toCsv(headers, rows))
    },
  )
}
