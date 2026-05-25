import { describe, it, expect, vi, beforeEach } from 'vitest'

// Share the same vi.fn() instances between direct prisma calls and the tx proxy,
// so vi.mocked(prisma.x.y).mockResolvedValue(...) works inside transactions too.
vi.mock('@packd/db', () => {
  const classSession = { findUniqueOrThrow: vi.fn() }
  const member = { findUniqueOrThrow: vi.fn() }
  const booking = {
    create: vi.fn().mockResolvedValue({ id: 'booking-1' }),
    update: vi.fn().mockResolvedValue({ id: 'booking-1' }),
    findUnique: vi.fn().mockResolvedValue(null),   // no existing booking by default
    findUniqueOrThrow: vi.fn(),
  }
  const creditBalance = { findUnique: vi.fn(), update: vi.fn() }
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
import { getUser } from '../lib/auth.js'

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

const mockMember = (overrides = {}) => ({
  id: 'member-1',
  userId: 'user-1',
  ...overrides,
})

describe('POST /bookings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a booking and returns 201', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
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
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 1 } as never)

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

  it('rejects booking a past class for a member', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ startsAt: new Date(Date.now() - 3_600_000) }) as never, // 1 hour ago
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toMatch(/already started/i)
  })

  it('allows booking a past class for an admin', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-1', email: 'admin@test.com', role: 'admin' } as never)
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(
      mockSession({ startsAt: new Date(Date.now() - 3_600_000) }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-1' } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(201)
  })

  it('re-activates a LATE_CANCELLED booking instead of creating a duplicate', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    // Simulate an existing LATE_CANCELLED booking row
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      { id: 'existing-1', status: 'LATE_CANCELLED' } as never,
    )
    vi.mocked(prisma.booking.update).mockResolvedValue({ id: 'existing-1' } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/bookings', body: { sessionId: 'session-1' } })

    expect(res.statusCode).toBe(201)
    // Must update the existing row, not create a new one (which would hit the unique constraint)
    expect(vi.mocked(prisma.booking.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-1' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    )
    expect(vi.mocked(prisma.booking.create)).not.toHaveBeenCalled()
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

  it('clears stationId when cancelling a booking', async () => {
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      ...mockBooking(25),
      stationId: 'station-1',
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({ lateCancelWindowHours: 12 } as never)

    const app = await buildApp()
    await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(vi.mocked(prisma.booking.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stationId: null }),
      }),
    )
  })
})

describe('POST /bookings — on-behalf booking (walk-in)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fronthost can book on behalf of another member via memberId', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'staff-user', email: 'desk@packd.test', role: 'fronthost' } as never)
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    // On-behalf: member looked up by ID, not by userId
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember({ id: 'member-99', userId: 'other-user' }) as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-99' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1', memberId: 'member-99' },
    })

    expect(res.statusCode).toBe(201)
    // Should have looked up member by { id: 'member-99' }, not by userId
    expect(vi.mocked(prisma.member.findUniqueOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-99' } }),
    )
  })

  it('studio_admin can book on behalf of another member', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'admin-user', email: 'admin@packd.test', role: 'studio_admin' } as never)
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember({ id: 'member-99', userId: 'other-user' }) as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-99' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1', memberId: 'member-99' },
    })

    expect(res.statusCode).toBe(201)
    expect(vi.mocked(prisma.member.findUniqueOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-99' } }),
    )
  })

  it('member role cannot use memberId override — books for themselves instead', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'user-1', email: 'member@packd.test', role: 'member' } as never)
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-1' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      body: { sessionId: 'session-1', memberId: 'member-99' },
    })

    expect(res.statusCode).toBe(201)
    // Member role: memberId is ignored — should look up by userId, not by id
    expect(vi.mocked(prisma.member.findUniqueOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
  })
})
