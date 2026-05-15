import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => ({
  prisma: {
    classSession: { findUniqueOrThrow: vi.fn() },
    member: { findUnique: vi.fn() },
    booking: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'staff@packd.test', role: 'instructor' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { adminRoutes } from '../routes/admin.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
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
    // Verify checkedInAt is cleared on un-check
    expect(vi.mocked(prisma.booking.update).mock.calls[0][0].data.checkedInAt).toBeNull()
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
