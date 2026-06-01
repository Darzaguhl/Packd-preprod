import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => ({
  prisma: {
    classSession: { findUniqueOrThrow: vi.fn() },
    member: { findUnique: vi.fn() },
    booking: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    studio: { findUnique: vi.fn().mockResolvedValue({ selfCheckInEnabled: true }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'staff@packd.test', role: 'instructor' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { adminRoutes } from '../routes/admin.js'
import { bookingRoutes } from '../routes/bookings.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'


vi.mock('../jobs/index.js', () => ({ enqueueLateCancelCheck: vi.fn() }))
vi.mock('../routes/members.js', () => ({ ensureMemberForAdmin: vi.fn() }))

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

const mockSession = (overrides = {}) => ({
  id: 'session-1',
  studioId: 'studio-1',
  ...overrides,
})

describe('POST /admin/sessions/:id/checkin/:bookingId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks in a member and returns checkedIn: true', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      sessionId: 'session-1',
      status: 'CONFIRMED',
      checkedIn: false,
    } as never)
    vi.mocked(prisma.booking.update).mockResolvedValue({ id: 'booking-1', checkedIn: true } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/checkin/booking-1',
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, checkedIn: true })
  })

  it('toggles a checked-in member back to not checked in', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      sessionId: 'session-1',
      status: 'CONFIRMED',
      checkedIn: true,
    } as never)
    vi.mocked(prisma.booking.update).mockResolvedValue({ id: 'booking-1', checkedIn: false } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/checkin/booking-1',
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, checkedIn: false })
    // Verify checkedInAt is cleared on un-check (updateMany is used for atomic toggle)
    expect(vi.mocked(prisma.booking.updateMany).mock.calls[0][0].data.checkedInAt).toBeNull()
  })

  it('returns 404 when booking belongs to a different session', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      sessionId: 'OTHER-session',
      checkedIn: false,
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/checkin/booking-1',
    })

    expect(res.statusCode).toBe(404)
  })
})

// ── Self-checkin role guard (POST /bookings/:id/checkin) ─────────────────────

describe('POST /bookings/:id/checkin', () => {
  async function buildBookingApp() {
    const app = Fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(sensible)
    await app.register(bookingRoutes, { prefix: '/bookings' })
    return app
  }

  beforeEach(() => vi.clearAllMocks())

  it('allows a member to check into their own booking', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'user-1', role: 'member', studioIds: [] } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      member: { userId: 'user-1' },
      session: { studioId: 'studio-1' },
    } as never)
    vi.mocked(prisma.booking.update).mockResolvedValue({ id: 'booking-1', checkedIn: true } as never)

    const app = await buildBookingApp()
    const res = await app.inject({ method: 'POST', url: '/bookings/booking-1/checkin' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('returns 403 when a member tries to check in another member\'s booking', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'user-member', role: 'member', studioIds: [] } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-other',
      member: { userId: 'user-other' },
      session: { studioId: 'studio-1' },
    } as never)

    const app = await buildBookingApp()
    const res = await app.inject({ method: 'POST', url: '/bookings/booking-other/checkin' })

    expect(res.statusCode).toBe(403)
  })

  it('allows a fronthost to check in any member\'s booking', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'user-staff', role: 'fronthost', studioIds: ['studio-1'] } as never)
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      member: { userId: 'user-other' },
      session: { studioId: 'studio-1' },
    } as never)
    vi.mocked(prisma.booking.update).mockResolvedValue({ id: 'booking-1', checkedIn: true } as never)

    const app = await buildBookingApp()
    const res = await app.inject({ method: 'POST', url: '/bookings/booking-1/checkin' })

    expect(res.statusCode).toBe(200)
  })
})
