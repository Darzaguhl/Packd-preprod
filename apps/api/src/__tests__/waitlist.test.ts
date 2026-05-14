import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => ({
  prisma: {
    member: { findUniqueOrThrow: vi.fn() },
    waitlistEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    booking: { create: vi.fn() },
    creditBalance: { update: vi.fn() },
    creditTransaction: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        booking: { create: vi.fn() },
        creditBalance: { update: vi.fn() },
        creditTransaction: { create: vi.fn() },
        waitlistEntry: { update: vi.fn() },
      }),
    ),
  },
}))

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'test@test.com', role: 'client' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { waitlistRoutes } from '../routes/waitlist.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(waitlistRoutes, { prefix: '/waitlist' })
  return app
}

describe('POST /waitlist', () => {
  beforeEach(() => vi.clearAllMocks())

  it('joins waitlist at position 1 when empty', async () => {
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.waitlistEntry.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.waitlistEntry.create).mockResolvedValue({
      id: 'wl-1', sessionId: 'session-1', memberId: 'member-1', position: 1, status: 'WAITING',
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).data.position).toBe(1)
  })

  it('joins at next position when queue exists', async () => {
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.waitlistEntry.findFirst).mockResolvedValue({ position: 3 } as never)
    vi.mocked(prisma.waitlistEntry.create).mockResolvedValue({
      id: 'wl-2', position: 4, status: 'WAITING',
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/waitlist',
      body: { sessionId: 'session-1' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).data.position).toBe(4)
  })
})

describe('POST /waitlist/:id/confirm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('confirms a notified entry and creates a booking', async () => {
    vi.mocked(prisma.waitlistEntry.findUniqueOrThrow).mockResolvedValue({
      id: 'wl-1',
      sessionId: 'session-1',
      memberId: 'member-1',
      status: 'NOTIFIED',
      expiresAt: new Date(Date.now() + 600000),
      member: { userId: 'user-1', creditBalance: { balance: 5 } },
      session: { creditsRequired: 1 },
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waitlist/wl-1/confirm' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true })
  })

  it('rejects confirmation when window has expired', async () => {
    vi.mocked(prisma.waitlistEntry.findUniqueOrThrow).mockResolvedValue({
      id: 'wl-1',
      status: 'NOTIFIED',
      expiresAt: new Date(Date.now() - 1000), // already expired
      member: { userId: 'user-1', creditBalance: { balance: 5 } },
      session: { creditsRequired: 1 },
    } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waitlist/wl-1/confirm' })

    expect(res.statusCode).toBe(410)
  })
})
