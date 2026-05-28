import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const promoCode           = { findUnique: vi.fn(), update: vi.fn() }
  const promoCodeRedemption = { findUnique: vi.fn(), create: vi.fn() }
  const creditBalance       = { upsert: vi.fn() }
  const creditTransaction   = { create: vi.fn() }
  const member              = { findFirst: vi.fn() }

  return {
    prisma: {
      promoCode,
      promoCodeRedemption,
      creditBalance,
      creditTransaction,
      member,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ promoCode, promoCodeRedemption, creditBalance, creditTransaction }),
      ),
    },
  }
})

// ── Auth mock — member role ───────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'member' })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { promoRoutes } from '../routes/promos.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(promoRoutes, { prefix: '/promos' })
  return app
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date()
const PAST = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
const FUTURE = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

function makePromo(overrides = {}) {
  return {
    id: 'promo-1',
    code: 'SAVE10',
    type: 'CREDIT_GRANT',
    value: 5,
    isActive: true,
    validFrom: PAST,
    validUntil: null,
    maxUses: null,
    usageCount: 0,
    ...overrides,
  }
}

function makeMember(overrides = {}) {
  return {
    id: 'member-1',
    userId: 'user-1',
    creditBalance: { balance: 10 },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /promos/redeem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('grants credits for a CREDIT_GRANT code', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo() as never)
    vi.mocked(prisma.promoCodeRedemption.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({ balance: 15 } as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'SAVE10', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.type).toBe('CREDIT_GRANT')
    expect(body.creditsAdded).toBe(5)
    expect(body.discount).toBeNull()
    expect(body.message).toContain('5 credits')
  })

  it('grants exactly 1 credit for a FREE_CLASS code', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo({ type: 'FREE_CLASS', value: 0 }) as never)
    vi.mocked(prisma.promoCodeRedemption.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.creditBalance.upsert).mockResolvedValue({ balance: 11 } as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'FREECLASS', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.creditsAdded).toBe(1)
  })

  it('returns discount info without creating redemption for MEMBERSHIP_PCT', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(
      makePromo({ type: 'MEMBERSHIP_PCT', value: 20 }) as never,
    )
    vi.mocked(prisma.promoCodeRedemption.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'MEMBER20', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.creditsAdded).toBe(0)
    expect(body.discount).toMatchObject({ type: 'MEMBERSHIP_PCT', value: 20, promoCodeId: 'promo-1' })
    // Should NOT have called $transaction (no immediate consumption)
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it('returns discount info for MEMBERSHIP_FLAT', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(
      makePromo({ type: 'MEMBERSHIP_FLAT', value: 500 }) as never,
    )
    vi.mocked(prisma.promoCodeRedemption.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'FLAT5', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.discount).toMatchObject({ type: 'MEMBERSHIP_FLAT', value: 500 })
    expect(body.message).toContain('5.00 off')
  })

  it('returns 422 when code is inactive', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo({ isActive: false }) as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'OLD', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i)
  })

  it('returns 422 when code has not started yet', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo({ validFrom: FUTURE }) as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'NOTYET', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/not active yet/i)
  })

  it('returns 422 when code has expired', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo({ validUntil: PAST }) as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'EXPIRED', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/expired/i)
  })

  it('returns 422 when max uses reached', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(
      makePromo({ maxUses: 100, usageCount: 100 }) as never,
    )

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'FULL', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/usage limit/i)
  })

  it('returns 422 when member already redeemed the code', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(makeMember() as never)
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(makePromo() as never)
    vi.mocked(prisma.promoCodeRedemption.findUnique).mockResolvedValue({ id: 'existing' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'SAVE10', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/already redeemed/i)
  })

  it('returns 400 when code or studioId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { studioId: 'studio-1' }, // missing code
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when member not found', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/promos/redeem',
      payload: { code: 'SAVE10', studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(404)
  })
})
