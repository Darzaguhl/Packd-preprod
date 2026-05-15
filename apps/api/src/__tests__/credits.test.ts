import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const creditBalance = { upsert: vi.fn() }
  const creditTransaction = { create: vi.fn() }
  return {
    prisma: {
      member: { findUnique: vi.fn() },
      creditBalance,
      creditTransaction,
      $transaction: vi.fn(async (arr: unknown[]) => Promise.all(arr)),
    },
  }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'staff@packd.test', role: 'fronthost' })),
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

describe('POST /admin/members/:memberId/credits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds credits and returns new balance', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', studioId: 'studio-1', creditBalance: null } as never)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({ balance: 15 } as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/members/member-1/credits',
      body: { amount: 10, note: 'Walk-in purchase' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, newBalance: 15 })
    expect(vi.mocked(prisma.creditBalance.upsert).mock.calls[0][0].update.balance.increment).toBe(10)
  })

  it('deducts credits with a negative amount', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', studioId: 'studio-1', creditBalance: { balance: 8 } } as never)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({ balance: 3 } as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/members/member-1/credits',
      body: { amount: -5 },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ success: true, newBalance: 3 })
    expect(vi.mocked(prisma.creditBalance.upsert).mock.calls[0][0].update.balance.increment).toBe(-5)
  })

  it('rejects amount of zero', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/members/member-1/credits',
      body: { amount: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects non-integer amount', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/members/member-1/credits',
      body: { amount: 1.5 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when member does not exist', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/members/nonexistent/credits',
      body: { amount: 10 },
    })
    expect(res.statusCode).toBe(404)
  })
})
