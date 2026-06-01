import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Stripe mock ───────────────────────────────────────────────────────────────

const mockStripe = vi.hoisted(() => ({
  paymentMethods: { list: vi.fn() },
  paymentIntents: { create: vi.fn() },
  refunds:        { create: vi.fn() },
  webhooks:       { constructEvent: vi.fn() },
  customers:      { create: vi.fn(), list: vi.fn() },
  checkout:       { sessions: { create: vi.fn() } },
  coupons:        { create: vi.fn() },
}))

vi.mock('stripe', () => ({ default: vi.fn(() => mockStripe) }))

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const member                = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() }
  const productSale           = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }
  const creditBalance         = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() }
  const creditTransaction     = { create: vi.fn() }
  const stripeEvent           = { create: vi.fn() }
  const auditLog              = { create: vi.fn().mockResolvedValue({}) }
  const membershipPlan        = { findUniqueOrThrow: vi.fn() }
  const membershipSubscription = { count: vi.fn(), updateMany: vi.fn(), create: vi.fn() }
  const studio                = { findUnique: vi.fn() }
  const user                  = { findUniqueOrThrow: vi.fn() }

  return {
    prisma: {
      member,
      productSale,
      creditBalance,
      creditTransaction,
      stripeEvent,
      auditLog,
      membershipPlan,
      membershipSubscription,
      studio,
      user,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ member, productSale, creditBalance, creditTransaction }),
      ),
    },
  }
})

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'fronthost', studioIds: ['studio-1'] })),
}))

vi.mock('../lib/email.js', () => ({ sendWelcome: vi.fn() }))

// assertStudioAccess is called by charge-member; mock it to always allow
vi.mock('../routes/admin-shared.js', () => ({
  assertStudioAccess: vi.fn().mockResolvedValue(true),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { stripeRoutes } from '../routes/stripe.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    ;(req as unknown as { rawBody: Buffer }).rawBody = body as Buffer
    try { done(null, JSON.parse((body as Buffer).toString())) } catch (e) { done(e as Error) }
  })
  await app.register(sensible)
  await app.register(stripeRoutes, { prefix: '/stripe' })
  return app
}

// ── customer-card IDOR guard ──────────────────────────────────────────────────

describe('GET /stripe/customer-card', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns card info for a fronthost', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ stripeCustomerId: 'cus_1' } as never)
    mockStripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: 'pm_1', card: { last4: '4242', brand: 'visa' } }],
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/stripe/customer-card?memberId=member-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).hasCard).toBe(true)
    expect(JSON.parse(res.body).last4).toBe('4242')
  })

  it('returns 403 for a plain member (IDOR guard)', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-member', role: 'member', studioIds: [] } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/stripe/customer-card?memberId=member-other' })

    expect(res.statusCode).toBe(403)
    expect(mockStripe.paymentMethods.list).not.toHaveBeenCalled()
  })

  it('returns hasCard:false when member has no Stripe customer', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ stripeCustomerId: null } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/stripe/customer-card?memberId=member-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).hasCard).toBe(false)
  })
})

// ── charge-member IDOR guard ──────────────────────────────────────────────────

describe('POST /stripe/charge-member', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 for a plain member (IDOR guard)', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-member', role: 'member', studioIds: [] } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/charge-member',
      payload: {
        memberId: 'member-other',
        studioId: 'studio-1',
        items: [{ productId: 'p1', name: 'Water', qty: 1, priceInCents: 500, creditsRequired: 0 }],
        totalCents: 500,
        totalCredits: 0,
      },
    })

    expect(res.statusCode).toBe(403)
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled()
  })
})

// ── refund role guard ─────────────────────────────────────────────────────────

describe('POST /stripe/refund', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 for a plain member', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-member', role: 'member', studioIds: [] } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/refund',
      payload: { saleId: 'sale-1' },
    })

    expect(res.statusCode).toBe(403)
    expect(mockStripe.refunds.create).not.toHaveBeenCalled()
  })

  it('refunds successfully for a fronthost', async () => {
    vi.mocked(prisma.productSale.findUnique).mockResolvedValue({
      id: 'sale-1',
      studioId: 'studio-1',  // fronthost studioIds includes 'studio-1' — passes IDOR check
      refundedAt: null,
      paymentMethod: 'card',
      stripePaymentIntentId: 'pi_1',
      totalCents: 1000,
    } as never)
    mockStripe.refunds.create.mockResolvedValue({ id: 're_1' })
    vi.mocked(prisma.productSale.update).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/refund',
      payload: { saleId: 'sale-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).refundId).toBe('re_1')
    expect(mockStripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 1000 }),
    )
  })

  it('returns 400 when sale is already refunded', async () => {
    vi.mocked(prisma.productSale.findUnique).mockResolvedValue({
      id: 'sale-1',
      studioId: 'studio-1',
      refundedAt: new Date(),
      paymentMethod: 'card',
      stripePaymentIntentId: 'pi_1',
      totalCents: 1000,
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/refund',
      payload: { saleId: 'sale-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockStripe.refunds.create).not.toHaveBeenCalled()
  })

  it('returns 400 for non-card payment methods', async () => {
    vi.mocked(prisma.productSale.findUnique).mockResolvedValue({
      id: 'sale-2',
      studioId: 'studio-1',
      refundedAt: null,
      paymentMethod: 'cash',
      stripePaymentIntentId: null,
      totalCents: 500,
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/refund',
      payload: { saleId: 'sale-2' },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ── POST /stripe/checkout ─────────────────────────────────────────────────────

describe('POST /stripe/checkout', () => {
  beforeEach(() => vi.clearAllMocks())

  const mockPlan = (overrides = {}) => ({
    id: 'plan-1',
    name: 'Monthly',
    studioId: 'studio-1',  // must match the studioId in the checkout payload
    stripePriceId: 'price_123',
    intervalMonths: 1,
    isIntroOffer: false,
    maxRedemptionsPerMember: 1,
    creditsPerCycle: 10,
    creditExpiryDays: null,
    ...overrides,
  })

  const mockMember = () => ({
    id: 'member-1',
    userId: 'user-1',
    stripeCustomerId: 'cus_existing',
    creditBalance: null,
    studio: null,
    user: { email: 'test@example.com', firstName: 'Test' },
  })

  const mockUser = () => ({
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
  })

  it('returns 422 when plan has no stripePriceId', async () => {
    vi.mocked(prisma.membershipPlan.findUniqueOrThrow).mockResolvedValue(mockPlan({ stripePriceId: null }) as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ creditPurchaseEnabled: true } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      payload: { planId: 'plan-1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/not yet configured/i)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns 403 when creditPurchaseEnabled is false', async () => {
    vi.mocked(prisma.membershipPlan.findUniqueOrThrow).mockResolvedValue(mockPlan() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ creditPurchaseEnabled: false } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      payload: { planId: 'plan-1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(403)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns 422 when intro offer already used', async () => {
    vi.mocked(prisma.membershipPlan.findUniqueOrThrow).mockResolvedValue(
      mockPlan({ isIntroOffer: true, maxRedemptionsPerMember: 1 }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ creditPurchaseEnabled: true } as never)
    vi.mocked(prisma.membershipSubscription.count).mockResolvedValue(1)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      payload: { planId: 'plan-1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toMatch(/intro offer/i)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('creates checkout session and returns url for valid plan', async () => {
    vi.mocked(prisma.membershipPlan.findUniqueOrThrow).mockResolvedValue(mockPlan() as never)
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ creditPurchaseEnabled: true } as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ stripeCustomerId: 'cus_existing' } as never)
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/test' })

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      payload: { planId: 'plan-1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).url).toBe('https://checkout.stripe.com/test')
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_123', quantity: 1 }],
      }),
    )
  })

  it('uses payment mode for one-time plans (intervalMonths = 0)', async () => {
    vi.mocked(prisma.membershipPlan.findUniqueOrThrow).mockResolvedValue(
      mockPlan({ intervalMonths: 0 }) as never,
    )
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValue(mockMember() as never)
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue(mockUser() as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ creditPurchaseEnabled: true } as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ stripeCustomerId: 'cus_existing' } as never)
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/test' })

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      payload: { planId: 'plan-1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'payment' }),
    )
  })
})
