import { describe, it, expect, vi, beforeEach } from 'vitest'

// Share the same vi.fn() instances between direct prisma calls and the tx proxy,
// so vi.mocked(prisma.x.y).mockResolvedValue(...) works inside transactions too.
vi.mock('@packd/db', () => {
  const classSession = { findUniqueOrThrow: vi.fn() }
  const member = { findUniqueOrThrow: vi.fn() }
  const booking = { create: vi.fn().mockResolvedValue({ id: 'booking-1' }), update: vi.fn(), findUniqueOrThrow: vi.fn() }
  const creditBalance = { update: vi.fn() }
  const creditTransaction = { create: vi.fn() }
  const cancellationPolicy = { findUnique: vi.fn() }
  const waitlistEntry = { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() }

  return {
    prisma: {
      classSession,
      member,
      booking,
      creditBalance,
      creditTransaction,
      cancellationPolicy,
      waitlistEntry,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ classSession, member, booking, creditBalance, creditTransaction, waitlistEntry }),
      ),
    },
  }
})

vi.mock('../jobs/index.js', () => ({ enqueueLateCancelCheck: vi.fn() }))
vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'test@test.com', role: 'member' })),
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
  startsAt: new Date(Date.now() + 3_600_000),
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

  it('creates a booking and returns 201', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-1' } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ success: true })
  })

  it('rejects when class is full', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ capacity: 10, _count: { bookings: 10 } }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).message).toMatch(/full/i)
  })

  it('rejects when member has insufficient credits', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ creditsRequired: 3 }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember(1) as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(402)
  })

  it('rejects booking for a cancelled session', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ status: 'CANCELLED' }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(400)
  })

  it('rejects booking with missing body field', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: {} })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /bookings/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  const mockBooking = (hoursUntil: number) => ({
    id: 'booking-1',
    memberId: 'member-1',
    sessionId: 'session-1',
    status: 'CONFIRMED',
    member: { userId: 'user-1', creditBalance: { balance: 4 } },
    session: {
      studioId: 'studio-1',
      creditsRequired: 1,
      startsAt: new Date(Date.now() + hoursUntil * 3_600_000),
    },
  })

  it('cancels on-time and refunds credits', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(mockBooking(25) as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({ lateCancelWindowHours: 12 } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, isLateCancel: false })
  })

  it('flags late cancellation inside the window', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(mockBooking(2) as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({ lateCancelWindowHours: 12 } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, isLateCancel: true })
  })

  it('rejects cancellation by a different user', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      ...mockBooking(25),
      member: { userId: 'other-user', creditBalance: { balance: 4 } },
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({ lateCancelWindowHours: 12 } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(403)
  })
})
