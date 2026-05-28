import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const classSession = {
    findUniqueOrThrow: vi.fn(),
    findUnique: vi.fn().mockResolvedValue({ studioId: 'studio-1' }),
  }
  const member = { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() }
  const booking = {
    create: vi.fn().mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' }),
    update: vi.fn().mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' }),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn(),
  }
  const creditBalance = { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() }
  const creditTransaction = { create: vi.fn() }
  const cancellationPolicy = { findUnique: vi.fn().mockResolvedValue(null) }
  const waitlistEntry = { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() }
  const studioNetworkMembership = { findFirst: vi.fn().mockResolvedValue(null) }
  const classSessionExtra = { findUnique: vi.fn() }  // for email fetch
  const user = { findUnique: vi.fn() }

  return {
    prisma: {
      classSession,
      member,
      booking,
      creditBalance,
      creditTransaction,
      cancellationPolicy,
      waitlistEntry,
      studioNetworkMembership,
      user,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          classSession, member, booking, creditBalance,
          creditTransaction, cancellationPolicy, waitlistEntry,
        }),
      ),
    },
    Prisma: { PrismaClientKnownRequestError: class {} },
  }
})

// ── Auth mock — member ────────────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'member@test.com', role: 'member' })),
}))

vi.mock('../jobs/index.js', () => ({ enqueueLateCancelCheck: vi.fn() }))
vi.mock('../routes/members.js', () => ({ ensureMemberForAdmin: vi.fn() }))

// ── Email mock — capture calls ────────────────────────────────────────────────

vi.mock('../lib/email.js', () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue(true),
  sendBookingCancellation: vi.fn().mockResolvedValue(true),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { bookingRoutes } from '../routes/bookings.js'
import { prisma } from '@packd/db'
import { sendBookingConfirmation, sendBookingCancellation } from '../lib/email.js'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(bookingRoutes, { prefix: '/bookings' })
  return app
}

// ── Factories ─────────────────────────────────────────────────────────────────

function mockSession(overrides = {}) {
  return {
    id: 'session-1',
    studioId: 'studio-1',
    status: 'SCHEDULED',
    startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),  // 2h from now
    endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    capacity: 20,
    creditsRequired: 1,
    _count: { bookings: 5 },
    template: { name: 'Morning Ride' },
    room: { name: 'Ride Room' },
    studio: { name: 'Packd Demo Studio' },
    ...overrides,
  }
}

function mockMember(overrides = {}) {
  return {
    id: 'member-1',
    userId: 'user-1',
    studioId: 'studio-1',
    user: { email: 'member@test.com', firstName: 'Alice' },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /bookings — booking confirmation email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires sendBookingConfirmation after a successful booking', async () => {
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.booking.create).mockResolvedValue({ id: 'booking-1' } as never)
    vi.mocked(prisma.creditBalance.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    // Stub the post-booking session fetch (for email)
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: 'member@test.com', firstName: 'Alice' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bookings',
      payload: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(201)

    // Give the async email chain a tick to fire
    await new Promise(r => setImmediate(r))

    expect(vi.mocked(sendBookingConfirmation)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@test.com',
        firstName: 'Alice',
        className: 'Morning Ride',
      }),
    )
  })
})

describe('DELETE /bookings/:id — cancellation email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires sendBookingCancellation after on-time cancel', async () => {
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000)  // 48h out → on-time

    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      memberId: 'member-1',
      sessionId: 'session-1',
      status: 'CONFIRMED',
      session: {
        studioId: 'studio-1',
        startsAt: futureStart,
        creditsRequired: 1,
        template: { name: 'Yoga Flow' },
        studio: { name: 'Packd Demo Studio' },
      },
      member: {
        userId: 'user-1',
        creditBalance: { balance: 2 },
        user: { email: 'member@test.com', firstName: 'Alice' },
      },
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.booking.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditBalance.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    // Post-cancel fetch for email
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      session: {
        startsAt: futureStart,
        template: { name: 'Yoga Flow' },
        studio: { name: 'Packd Demo Studio' },
      },
      member: { user: { email: 'member@test.com', firstName: 'Alice' } },
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.isLateCancel).toBe(false)

    await new Promise(r => setImmediate(r))

    expect(vi.mocked(sendBookingCancellation)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@test.com',
        firstName: 'Alice',
        className: 'Yoga Flow',
        reason: undefined,  // on-time cancel has no reason
      }),
    )
  })

  it('includes a late-cancellation reason in the email', async () => {
    const imminent = new Date(Date.now() + 2 * 60 * 60 * 1000)  // 2h out → within 12h window

    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue({
      id: 'booking-1',
      memberId: 'member-1',
      sessionId: 'session-1',
      status: 'CONFIRMED',
      session: {
        studioId: 'studio-1',
        startsAt: imminent,
        creditsRequired: 1,
        template: { name: 'Spin' },
        studio: { name: 'Packd Demo Studio' },
      },
      member: {
        userId: 'user-1',
        creditBalance: { balance: 5 },
        user: { email: 'member@test.com', firstName: 'Alice' },
      },
    } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue(null) // defaults: 12h window, 1 credit fee
    vi.mocked(prisma.booking.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditBalance.findUnique).mockResolvedValue({ balance: 5 } as never)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({} as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      session: {
        startsAt: imminent,
        template: { name: 'Spin' },
        studio: { name: 'Packd Demo Studio' },
      },
      member: { user: { email: 'member@test.com', firstName: 'Alice' } },
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/bookings/booking-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).isLateCancel).toBe(true)

    await new Promise(r => setImmediate(r))

    expect(vi.mocked(sendBookingCancellation)).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringMatching(/late cancellation/i),
      }),
    )
  })
})
