import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'
import { logger } from '../lib/logger.js'
import { Id } from '../schemas.js'

// ─── Token helpers ────────────────────────────────────────────────────────────

const _ICAL_SECRET  = process.env.ICAL_SECRET          ?? 'packd-ical-secret-change-in-production'
const _ICAL_PREV    = process.env.ICAL_SECRET_PREVIOUS  ?? null   // set during key rotation

if (!process.env.ICAL_SECRET) {
  logger.warn('[ical] ICAL_SECRET env var is not set — iCal feed tokens are insecure. Set ICAL_SECRET in production.')
}

function makeToken(userId: string, secret = _ICAL_SECRET): string {
  return createHmac('sha256', secret).update(userId).digest('hex')
}

/**
 * Verify an iCal feed token against the current secret and optionally the
 * previous secret (ICAL_SECRET_PREVIOUS). Supporting two keys allows zero-
 * downtime rotation: set ICAL_SECRET=<new>, ICAL_SECRET_PREVIOUS=<old>,
 * deploy — existing calendar subscriptions keep working while new tokens
 * are signed with the new key. Drop ICAL_SECRET_PREVIOUS after ~30 days.
 *
 * Uses constant-time comparison on both checks to prevent timing attacks.
 */
function verifyToken(userId: string, token: string): boolean {
  const expected = Buffer.from(makeToken(userId, _ICAL_SECRET))
  const provided  = Buffer.from(token)
  if (expected.length !== provided.length) {
    // Check previous key too before returning false
    if (_ICAL_PREV) {
      const prevExpected = Buffer.from(makeToken(userId, _ICAL_PREV))
      if (prevExpected.length === provided.length) {
        return timingSafeEqual(prevExpected, provided)
      }
    }
    return false
  }
  if (timingSafeEqual(expected, provided)) return true
  // Check previous key on mismatch (token was signed before rotation)
  if (_ICAL_PREV) {
    const prevExpected = Buffer.from(makeToken(userId, _ICAL_PREV))
    if (prevExpected.length === provided.length) {
      return timingSafeEqual(prevExpected, provided)
    }
  }
  return false
}

// ─── iCal helpers ─────────────────────────────────────────────────────────────

function foldLine(line: string): string {
  // RFC 5545 §3.1: fold lines longer than 75 octets
  if (line.length <= 75) return line
  const chunks: string[] = []
  let i = 0
  chunks.push(line.slice(i, 75)); i = 75
  while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74 }
  return chunks.join('\r\n')
}

function icalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icalEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function icalRoutes(app: FastifyInstance) {

  // GET /ical/token — returns the caller's stable iCal URLs
  app.get('/token', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    const token = makeToken(user.id)
    const base = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:4000`

    // Determine if the user is an instructor or fronthost
    const [instructor, member] = await Promise.all([
      prisma.instructor.findFirst({ where: { userId: user.id }, select: { id: true } }),
      prisma.member.findFirst({ where: { userId: user.id }, select: { id: true, staffRoles: true } }),
    ])

    // userId is embedded in the URL so validation is O(1) — no full-table scan needed
    const urls: Record<string, string> = {
      member: `${base}/ical/member/${user.id}/${token}`,
    }
    if (instructor) {
      urls.instructor = `${base}/ical/instructor/${user.id}/${token}`
    }
    if (member?.staffRoles.includes('fronthost')) {
      urls.fronthost = `${base}/ical/fronthost/${user.id}/${token}`
    }

    return reply.send({ token, urls })
  })

  // GET /ical/instructor/:userId/:token — public, no auth required
  app.get<{ Params: { userId: string; token: string } }>(
    '/instructor/:userId/:token',
    { schema: { params: z.object({ userId: Id, token: Id }) } },
    async (request, reply) => {
      const { userId, token } = request.params

      // O(1) token validation — derive expected token from userId, compare
      if (!verifyToken(userId, token)) return reply.status(404).send('Not found')

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      })
      if (!user) return reply.status(404).send('Not found')

      const instructor = await prisma.instructor.findFirst({
        where: { userId: user.id },
        include: { studio: { select: { name: true } } },
      })
      if (!instructor) return reply.status(404).send('Not an instructor')

      // Fetch upcoming sessions (as primary or substitute)
      const now = new Date()
      const sessions = await prisma.classSession.findMany({
        where: {
          OR: [
            { instructorId: instructor.id },
            { substituteInstructorId: instructor.id },
          ],
          startsAt: { gte: now },
          status: { not: 'CANCELLED' },
        },
        include: {
          template: { select: { name: true, sport: true } },
          room: { select: { name: true } },
          studio: { select: { name: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 200,
      })

      const calName = `${user.firstName} ${user.lastName} – Packd`
      const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Packd//Studio//EN',
        `X-WR-CALNAME:${icalEscape(calName)}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
      ]

      for (const s of sessions) {
        const isSub = s.substituteInstructorId === instructor.id
        const summary = `${s.template.name} – ${s.studio.name}${isSub ? ' (Sub)' : ''}`
        const desc = `Room: ${s.room.name} · Capacity: ${s.capacity} · Sport: ${s.template.sport}`
        lines.push(
          'BEGIN:VEVENT',
          `UID:session-${s.id}@packd`,
          `DTSTART:${icalDate(s.startsAt)}`,
          `DTEND:${icalDate(s.endsAt)}`,
          foldLine(`SUMMARY:${icalEscape(summary)}`),
          foldLine(`DESCRIPTION:${icalEscape(desc)}`),
          `STATUS:CONFIRMED`,
          `END:VEVENT`,
        )
      }

      lines.push('END:VCALENDAR')

      reply.header('Content-Type', 'text/calendar; charset=utf-8')
      reply.header('Content-Disposition', 'inline; filename="packd-schedule.ics"')
      return reply.send(lines.join('\r\n'))
    },
  )

  // GET /ical/member/:userId/:token — public, no auth required
  app.get<{ Params: { userId: string; token: string } }>(
    '/member/:userId/:token',
    { schema: { params: z.object({ userId: Id, token: Id }) } },
    async (request, reply) => {
      const { userId, token } = request.params

      // O(1) token validation — derive expected token from userId, compare
      if (!verifyToken(userId, token)) return reply.status(404).send('Not found')

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      })
      if (!user) return reply.status(404).send('Not found')

      const member = await prisma.member.findUnique({
        where: { userId: user.id },
        select: { id: true, studio: { select: { name: true } } },
      })
      if (!member) return reply.status(404).send('No member profile')

      const now = new Date()
      const bookings = await prisma.booking.findMany({
        where: {
          memberId: member.id,
          status: 'CONFIRMED',
          session: { startsAt: { gte: now }, status: { not: 'CANCELLED' } },
        },
        include: {
          session: {
            include: {
              template: { select: { name: true, sport: true } },
              room: { select: { name: true } },
              studio: { select: { name: true } },
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
        orderBy: { session: { startsAt: 'asc' } },
        take: 200,
      })

      const calName = `${user.firstName} – My Packd Classes`
      const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Packd//Studio//EN',
        `X-WR-CALNAME:${icalEscape(calName)}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
      ]

      for (const b of bookings) {
        const s = b.session
        const instrName = `${s.instructor.user.firstName} ${s.instructor.user.lastName}`
        const summary = `${s.template.name} – ${s.studio.name}`
        const desc = `Instructor: ${instrName} · Room: ${s.room.name} · Sport: ${s.template.sport}`
        lines.push(
          'BEGIN:VEVENT',
          `UID:booking-${b.id}@packd`,
          `DTSTART:${icalDate(s.startsAt)}`,
          `DTEND:${icalDate(s.endsAt)}`,
          foldLine(`SUMMARY:${icalEscape(summary)}`),
          foldLine(`DESCRIPTION:${icalEscape(desc)}`),
          `STATUS:CONFIRMED`,
          `END:VEVENT`,
        )
      }

      lines.push('END:VCALENDAR')

      reply.header('Content-Type', 'text/calendar; charset=utf-8')
      reply.header('Content-Disposition', 'inline; filename="my-classes.ics"')
      return reply.send(lines.join('\r\n'))
    },
  )

  // GET /ical/fronthost/:userId/:token — public, no auth required
  app.get<{ Params: { userId: string; token: string } }>(
    '/fronthost/:userId/:token',
    { schema: { params: z.object({ userId: Id, token: Id }) } },
    async (request, reply) => {
      const { userId, token } = request.params

      if (!verifyToken(userId, token)) return reply.status(404).send('Not found')

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      })
      if (!user) return reply.status(404).send('Not found')

      const member = await prisma.member.findFirst({
        where: { userId: user.id, staffRoles: { has: 'fronthost' } },
        select: { id: true, studioId: true },
      })
      if (!member) return reply.status(404).send('Not a fronthost')

      const now = new Date()
      const shifts = await prisma.staffShift.findMany({
        where: { memberId: member.id, startsAt: { gte: now } },
        include: { studio: { select: { name: true } } },
        orderBy: { startsAt: 'asc' },
        take: 200,
      })

      const calName = `${user.firstName} – Packd Shifts`
      const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Packd//Studio//EN',
        `X-WR-CALNAME:${icalEscape(calName)}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
      ]

      for (const s of shifts) {
        const summary = `Shift – ${s.studio.name}`
        const desc = s.note ? icalEscape(s.note) : ''
        lines.push(
          'BEGIN:VEVENT',
          `UID:shift-${s.id}@packd`,
          `DTSTART:${icalDate(s.startsAt)}`,
          `DTEND:${icalDate(s.endsAt)}`,
          foldLine(`SUMMARY:${icalEscape(summary)}`),
          ...(desc ? [foldLine(`DESCRIPTION:${desc}`)] : []),
          'STATUS:CONFIRMED',
          'END:VEVENT',
        )
      }

      lines.push('END:VCALENDAR')

      reply.header('Content-Type', 'text/calendar; charset=utf-8')
      reply.header('Content-Disposition', 'inline; filename="my-shifts.ics"')
      return reply.send(lines.join('\r\n'))
    },
  )
}
