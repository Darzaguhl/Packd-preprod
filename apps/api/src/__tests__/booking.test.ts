import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing routes
vi.mock('@packd/db', () => ({
  prisma: {
    classSession: { findUniqueOrThrow: vi.fn() },
    member: { findUniqueOrThrow: vi.fn() },
    booking: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    creditBalance: { update: vi.fn() },
    creditTransaction: { create: vi.fn() },
    cancellationPolicy: { findUnique: vi.fn() },
    waitlistEntry: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: { create: vi.fn().mockResolvedValue({ id: 'booking-1' }), update: vi.fn() },
        creditBalance: { update: vi.fn() },
        creditTransaction: { create: vi.fn() },
        waitlistEntry: { update: vi.fn() },
      }),
    ),
  },
}))

vi.mock('../jobs/index.js', () => ({ enqueueLateCancelCheck: vi.fn() }))
vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'test@test.com', role: 'client' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { bookingRoutes } from '../routes/bookings.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(bookingRoutes, { prefix: '/bookings' })
  return app
}

const mockSession = (overrides = {}) => ({
  id: 'session-1',
  studioId: 'studio-1',
  status: 'SCHEDULED',
  capacity: 20,
  creditsRequired: 1,
  startsAt: new Date(Date.now() + 3600000),
  _count: { bookings: 5 },
  ...overrides,
})

const mockMember = (credits = 5) => ({
  id: 'member-1',
  userId: 'user-1',
  creditBalance: { balance: credits },
})

describe('POST /bookings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('books a class and returns 201', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ success: true })
  })

  it('rejects booking when class is full', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ capacity: 10, _count: { bookings: 10 } }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).message).toMatch(/full/i)
  })

  it('rejects booking when member has insufficient credits', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ creditsRequired: 3 }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember(1) as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(402)
  })

  it('rejects booking for a cancelled session', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ status: 'CANCELLED' }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /bookings/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cancels on-time with refund', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      memberId: 'member-1',
      sessionId: 'session-1',
      member: { userId: 'user-1', creditBalance: { balance: 4 } },
      session: {
        studioId: 'studio-1',
        creditsRequired: 1,
        startsAt: new Date(Date.now() + 25 * 3600000), // 25h away
      },
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({
      lateCancelWindowHours: 12,
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, isLateCancel: false })
  })

  it('flags late cancellation within window', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      memberId: 'member-1',
      sessionId: 'session-1',
      member: { userId: 'user-1', creditBalance: { balance: 4 } },
      session: {
        studioId: 'studio-1',
        creditsRequired: 1,
        startsAt: new Date(Date.now() + 2 * 3600000), // 2h away — within 12h window
      },
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({
      lateCancelWindowHours: 12,
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, isLateCancel: true })
  })
})
