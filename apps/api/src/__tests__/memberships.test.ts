import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const membershipSubscription = {
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  }
  const member = { findUnique: vi.fn() }

  return { prisma: { membershipSubscription, member } }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'member', studioIds: [] })),
}))

vi.mock('../lib/stripe-sync.js', () => ({
  syncStripePrice: vi.fn(),
  archiveStripeProduct: vi.fn(),
}))

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

// Lazy Stripe — never called in self-pause (no stripeSubId in default mock sub)
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscriptions: { update: vi.fn().mockResolvedValue({}) },
  })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { membershipRoutes } from '../routes/memberships.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(membershipRoutes, { prefix: '/memberships' })
  return app
}

function mockSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    memberId: 'member-1',
    status: 'ACTIVE',
    stripeSubId: null,
    plan: {
      studio: {
        id: 'studio-1',
        allowMemberPause: true,
        maxPauseDays: 30,
        maxPausesPerYear: 2,
      },
    },
    ...overrides,
  }
}

const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
const farFutureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

describe('POST /memberships/subscriptions/:id/self-pause', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauses an active subscription within limits', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', userId: 'user-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(mockSub() as never)
    vi.mocked(prisma.membershipSubscription.count).mockResolvedValue(0)
    vi.mocked(prisma.membershipSubscription.update).mockResolvedValue({ ...mockSub(), status: 'PAUSED' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: futureDate },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
    expect(vi.mocked(prisma.membershipSubscription.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED' }) }),
    )
  })

  it('returns 403 when studio disallows member self-pause', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(
      mockSub({ plan: { studio: { id: 'studio-1', allowMemberPause: false, maxPauseDays: 30, maxPausesPerYear: 2 } } }) as never,
    )

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: futureDate },
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when subscription belongs to a different member', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'other-user', role: 'member', studioIds: [] } as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'other-member' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(mockSub() as never) // memberId = 'member-1'

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: futureDate },
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 400 when pause would exceed maxPauseDays', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(mockSub() as never) // maxPauseDays = 30

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: farFutureDate }, // 60 days > 30 max
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toMatch(/30 days/)
  })

  it('returns 400 when member has reached maxPausesPerYear', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(mockSub() as never) // maxPausesPerYear = 2
    vi.mocked(prisma.membershipSubscription.count).mockResolvedValue(2) // already paused twice

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: futureDate },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toMatch(/maximum/)
  })

  it('returns 400 when trying to pause a non-ACTIVE subscription', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(
      mockSub({ status: 'PAUSED' }) as never,
    )

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: futureDate },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toMatch(/active/)
  })

  it('returns 400 when pauseUntil is in the past', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.findUnique).mockResolvedValue(mockSub() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/memberships/subscriptions/sub-1/self-pause',
      payload: { pauseUntil: '2020-01-01T00:00:00Z' },
    })

    expect(res.statusCode).toBe(400)
  })
})
