import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tests the side-effects added to PATCH /admin/sessions/:id when status=CANCELLED:
// bookings are cancelled, credits are refunded, and cancellation emails are sent.

vi.mock('@packd/db', () => {
  const classSession = {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  }
  const booking = {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  }
  const creditBalance = { upsert: vi.fn() }
  const creditTransaction = { create: vi.fn() }
  const classTemplate = { findUnique: vi.fn() }
  const studio = { findUnique: vi.fn() }

  return {
    prisma: {
      classSession,
      booking,
      creditBalance,
      creditTransaction,
      classTemplate,
      studio,
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ booking, creditBalance, creditTransaction }),
      ),
    },
  }
})

vi.mock('../lib/auth.js', () => ({
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-admin', role: 'studio_admin', studioIds: ['studio-1'] })),
}))

vi.mock('../routes/admin-shared.js', () => ({
  assertStudioAccess: vi.fn().mockResolvedValue(true),
}))

vi.mock('../lib/email.js', () => ({
  sendSessionAnnouncement: vi.fn().mockResolvedValue(undefined),
  sendBookingCancellation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../jobs/index.js', () => ({
  enqueueNoShowCheck: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  AUDIT: { SESSION_CANCEL: 'session.cancel', SESSION_RESCHEDULE: 'session.reschedule', SESSION_CHECKIN: 'session.checkin', SCHEDULE_BULK: 'schedule.bulk' },
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { adminSessionRoutes } from '../routes/admin-sessions.js'
import { prisma } from '@packd/db'
import { sendBookingCancellation } from '../lib/email.js'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(adminSessionRoutes, { prefix: '/admin' })
  return app
}

function mockExistingSession(overrides = {}) {
  return {
    id: 'session-1',
    studioId: 'studio-1',
    templateId: 'tmpl-1',
    creditsRequired: 2,
    startsAt: new Date('2026-07-01T09:00:00Z'),
    endsAt: new Date('2026-07-01T10:00:00Z'),
    status: 'SCHEDULED',
    instructorId: 'instr-1',
    substituteInstructorId: null,
    ...overrides,
  }
}

function mockMemberBooking(memberId: string) {
  return {
    id: `booking-${memberId}`,
    memberId,
    sessionId: 'session-1',
    status: 'CONFIRMED',
    member: {
      user: { email: `${memberId}@test.com`, firstName: 'Test' },
      studio: { name: 'Test Studio' },
    },
  }
}

describe('PATCH /admin/sessions/:id — status=CANCELLED side-effects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cancels confirmed bookings and refunds credits when session is cancelled', async () => {
    const bookings = [mockMemberBooking('member-1'), mockMemberBooking('member-2')]
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockExistingSession() as never)
    vi.mocked(prisma.classSession.update).mockResolvedValue({ ...mockExistingSession(), status: 'CANCELLED' } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue(bookings as never)
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 2 } as never)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({} as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)
    vi.mocked(prisma.classTemplate.findUnique).mockResolvedValue({ name: 'Cycling' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ name: 'Test Studio' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/sessions/session-1',
      payload: { status: 'CANCELLED' },
    })

    expect(res.statusCode).toBe(200)

    // Bookings cancelled
    expect(vi.mocked(prisma.booking.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED', stationId: null } }),
    )

    // Credits refunded for each member
    expect(vi.mocked(prisma.creditBalance.upsert)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.creditTransaction.create)).toHaveBeenCalledTimes(2)

    // Cancellation emails sent
    expect(vi.mocked(sendBookingCancellation)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendBookingCancellation)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'member-1@test.com', reason: expect.stringContaining('cancelled') }),
    )
  })

  it('skips credit refund when session has 0 creditsRequired', async () => {
    const bookings = [mockMemberBooking('member-1')]
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockExistingSession({ creditsRequired: 0 }) as never)
    vi.mocked(prisma.classSession.update).mockResolvedValue({ ...mockExistingSession(), status: 'CANCELLED' } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue(bookings as never)
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.classTemplate.findUnique).mockResolvedValue({ name: 'Yoga' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ name: 'Test Studio' } as never)

    const app = await buildApp()
    await app.inject({ method: 'PATCH', url: '/admin/sessions/session-1', payload: { status: 'CANCELLED' } })

    expect(vi.mocked(prisma.creditBalance.upsert)).not.toHaveBeenCalled()
    expect(vi.mocked(sendBookingCancellation)).toHaveBeenCalledTimes(1)
  })

  it('skips email and credit steps when no confirmed bookings exist', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockExistingSession() as never)
    vi.mocked(prisma.classSession.update).mockResolvedValue({ ...mockExistingSession(), status: 'CANCELLED' } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/sessions/session-1',
      payload: { status: 'CANCELLED' },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.booking.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(sendBookingCancellation)).not.toHaveBeenCalled()
  })

  it('does not trigger cancellation side-effects for other status changes', async () => {
    vi.mocked(prisma.classSession.findUniqueOrThrow).mockResolvedValue(mockExistingSession() as never)
    vi.mocked(prisma.classSession.update).mockResolvedValue({ ...mockExistingSession(), status: 'COMPLETED' } as never)

    const app = await buildApp()
    await app.inject({ method: 'PATCH', url: '/admin/sessions/session-1', payload: { status: 'COMPLETED' } })

    expect(vi.mocked(prisma.booking.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(sendBookingCancellation)).not.toHaveBeenCalled()
  })
})
