import type { FastifyInstance } from 'fastify'
import { createHmac } from 'crypto'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

// ─── Token helpers ────────────────────────────────────────────────────────────

const ICAL_SECRET = process.env.ICAL_SECRET ?? 'packd-ical-secret-change-in-production'

function makeToken(userId: string): string {
  return createHmac('sha256', ICAL_SECRET).update(userId).digest('hex')
}

function verifyToken(userId: string, token: string): boolean {
  return makeToken(userId) === token
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

    // Determine if the user is an instructor
    const instructor = await prisma.instructor.findFirst({
      where: { userId: user.id },
      select: { id: true },
    })

    const urls: Record<string, string> = {
      member: `${base}/ical/member/${token}`,
    }
    if (instructor) {
      urls.instructor = `${base}/ical/instructor/${token}`
    }

    return reply.send({ token, urls })
  })

  // GET /ical/instructor/:token — public, no auth required
  app.get<{ Params: { token: string } }>(
    '/instructor/:token',
    async (request, reply) => {
      const { token } = request.params

      // Find user by matching derived token
      const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } })
      const user = users.find(u => verifyToken(u.id, token))
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

  // GET /ical/member/:token — public, no auth required
  app.get<{ Params: { token: string } }>(
    '/member/:token',
    async (request, reply) => {
      const { token } = request.params

      const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } })
      const user = users.find(u => verifyToken(u.id, token))
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
}
