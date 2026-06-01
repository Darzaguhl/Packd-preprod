import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const user        = { findUnique: vi.fn() }
  const instructor  = { findFirst: vi.fn() }
  const member      = { findFirst: vi.fn(), findUnique: vi.fn() }
  const classSession = { findMany: vi.fn() }
  const booking     = { findMany: vi.fn() }
  const staffShift  = { findMany: vi.fn() }

  return { prisma: { user, instructor, member, classSession, booking, staffShift } }
})

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'member', studioIds: [] })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { icalRoutes } from '../routes/ical.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'
import { createHmac } from 'crypto'

// Use the same default secret as the route (no ICAL_SECRET in test env)
const SECRET = process.env.ICAL_SECRET ?? 'packd-ical-secret-change-in-production'
const makeToken = (userId: string) =>
  createHmac('sha256', SECRET).update(userId).digest('hex')

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(icalRoutes, { prefix: '/ical' })
  return app
}

const NOW = new Date()
const FUTURE = new Date(NOW.getTime() + 2 * 60 * 60 * 1000)
const FUTURE_END = new Date(NOW.getTime() + 3 * 60 * 60 * 1000)

function mockSession(overrides = {}) {
  return {
    id: 'session-1',
    startsAt: FUTURE,
    endsAt: FUTURE_END,
    capacity: 20,
    status: 'SCHEDULED',
    template: { name: 'Morning Ride', sport: 'cycling' },
    room: { name: 'Ride Room' },
    studio: { name: 'Packd Demo Studio' },
    substituteInstructorId: null,
    instructorId: 'instr-1',
    instructor: { user: { firstName: 'Alex', lastName: 'Rivera' } },
    ...overrides,
  }
}

// ── GET /ical/token ───────────────────────────────────────────────────────────

describe('GET /ical/token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns member URL for a regular member', async () => {
    vi.mocked(prisma.instructor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1', staffRoles: [] } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ical/token' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.urls.member).toContain('/ical/member/user-1/')
    expect(body.urls.instructor).toBeUndefined()
    expect(body.urls.fronthost).toBeUndefined()
  })

  it('includes instructor URL when user is an instructor', async () => {
    vi.mocked(prisma.instructor.findFirst).mockResolvedValue({ id: 'instr-1' } as never)
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1', staffRoles: [] } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ical/token' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.urls.member).toContain('/ical/member/user-1/')
    expect(body.urls.instructor).toContain('/ical/instructor/user-1/')
  })

  it('includes fronthost URL when user is a fronthost', async () => {
    vi.mocked(prisma.instructor.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1', staffRoles: ['fronthost'] } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ical/token' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.urls.fronthost).toContain('/ical/fronthost/user-1/')
  })
})

// ── GET /ical/member/:userId/:token ──────────────────────────────────────────

describe('GET /ical/member/:userId/:token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a valid iCal feed for a member with upcoming bookings', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', firstName: 'Alice', lastName: 'Smith',
    } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      { id: 'b-1', session: mockSession() },
    ] as never)
    // member lookup
    ;(prisma as unknown as { member: { findUnique: ReturnType<typeof vi.fn> } }).member = {
      findUnique: vi.fn().mockResolvedValue({ id: 'member-1', studio: { name: 'Demo' } }),
    }

    const token = makeToken('user-1')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/ical/member/user-1/${token}` })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.body).toContain('BEGIN:VCALENDAR')
    expect(res.body).toContain('BEGIN:VEVENT')
    expect(res.body).toContain('Morning Ride')
    expect(res.body).toContain('END:VCALENDAR')
  })

  it('returns 404 for an invalid token', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ical/member/user-1/badtoken' })
    expect(res.statusCode).toBe(404)
    // Should not have attempted a DB lookup
    expect(vi.mocked(prisma.user.findUnique)).not.toHaveBeenCalled()
  })

  it('returns 404 when userId does not exist in DB', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    const token = makeToken('ghost-user')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/ical/member/ghost-user/${token}` })
    expect(res.statusCode).toBe(404)
  })
})

// ── GET /ical/instructor/:userId/:token ───────────────────────────────────────

describe('GET /ical/instructor/:userId/:token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns iCal feed for an instructor with upcoming sessions', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', firstName: 'Alex', lastName: 'Rivera',
    } as never)
    vi.mocked(prisma.instructor.findFirst).mockResolvedValue({
      id: 'instr-1',
      studio: { name: 'Demo' },
      userId: 'user-1',
    } as never)
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([mockSession()] as never)

    const token = makeToken('user-1')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/ical/instructor/user-1/${token}` })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.body).toContain('Morning Ride')
    expect(res.body).toContain('BEGIN:VEVENT')
  })

  it('returns 404 for invalid token', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ical/instructor/user-1/wrongtoken' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when user is not an instructor', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1', firstName: 'Alice', lastName: 'Smith',
    } as never)
    vi.mocked(prisma.instructor.findFirst).mockResolvedValue(null)

    const token = makeToken('user-1')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/ical/instructor/user-1/${token}` })
    expect(res.statusCode).toBe(404)
  })
})
