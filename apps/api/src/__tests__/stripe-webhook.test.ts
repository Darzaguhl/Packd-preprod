import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Stripe mock — vi.hoisted so the instance is available before vi.mock runs ─

const mockStripe = vi.hoisted(() => ({
  webhooks:      { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}))

vi.mock('stripe', () => ({ default: vi.fn(() => mockStripe) }))

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const stripeEvent              = { create: vi.fn() }
  const member                   = { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }
  const membershipPlan           = { findUniqueOrThrow: vi.fn(), findFirst: vi.fn() }
  const membershipSubscription   = { updateMany: vi.fn(), create: vi.fn(), count: vi.fn() }
  const creditBalance            = { upsert: vi.fn(), update: vi.fn() }
  const creditTransaction        = { create: vi.fn() }
  const productSale              = { findFirst: vi.fn(), update: vi.fn() }
  const promoCodeRedemption      = { findUnique: vi.fn(), create: vi.fn() }
  const promoCode                = { update: vi.fn() }
  const user                     = { findUnique: vi.fn() }
  const studio                   = { findUnique: vi.fn() }

  return {
    prisma: {
      stripeEvent,
      member,
      membershipPlan,
      membershipSubscription,
      creditBalance,
      creditTransaction,
      productSale,
      promoCodeRedemption,
      promoCode,
      user,
      studio,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          member, membershipPlan, membershipSubscription,
          creditBalance, creditTransaction,
          promoCodeRedemption, promoCode, user, studio,
          productSale,
        }),
      ),
    },
  }
})

// ── Email mock ────────────────────────────────────────────────────────────────

vi.mock('../lib/email.js', () => ({
  sendWelcome: vi.fn().mockResolvedValue(true),
}))

// ── Auth mock (checkout + refund routes use requireAuth) ─────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'fronthost', studioIds: ['studio-1'] })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { stripeRoutes } from '../routes/stripe.js'
import { prisma } from '@packd/db'

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify()
  // Expose rawBody for webhook signature check
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    ;(req as unknown as { rawBody: Buffer }).rawBody = body as Buffer
    try { done(null, JSON.parse(body.toString())) } catch (e) { done(e as Error) }
  })
  await app.register(sensible)
  await app.register(stripeRoutes, { prefix: '/stripe' })
  return app
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(type: string, data: object, id = 'evt_test_1'): object {
  return { id, type, data: { object: data } }
}

async function postWebhook(app: Awaited<ReturnType<typeof buildApp>>, event: object) {
  return app.inject({
    method: 'POST',
    url: '/stripe/webhook',
    headers: { 'stripe-signature': 'test-sig', 'content-type': 'application/json' },
    payload: JSON.stringify(event),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: constructEvent just returns the parsed body, stripeEvent.create succeeds
    vi.mocked(prisma.stripeEvent.create).mockResolvedValue({} as never)
  })

  // ─── Idempotency ────────────────────────────────────────────────────────────

  it('returns received:true without processing when event ID already seen', async () => {
    const event = makeEvent('invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' })
    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)

    // First call succeeds, second throws (unique constraint)
    vi.mocked(prisma.stripeEvent.create)
      .mockResolvedValueOnce({} as never)  // first delivery — processed
      .mockRejectedValueOnce(Object.assign(new Error('Unique violation'), { code: 'P2002' }))

    // First delivery
    await postWebhook(app, event)
    const findFirstCallsBefore = vi.mocked(prisma.member.findFirst).mock.calls.length

    // Duplicate delivery
    const res = await postWebhook(app, event)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ received: true })

    // member.findFirst should NOT have been called again on the duplicate
    expect(vi.mocked(prisma.member.findFirst).mock.calls.length).toBe(findFirstCallsBefore)
  })

  it('returns 400 when stripe-signature is invalid', async () => {
    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig') })

    const res = await postWebhook(app, {})
    expect(res.statusCode).toBe(400)
  })

  // ─── invoice.payment_failed → PAST_DUE ──────────────────────────────────────

  it('sets subscription to PAST_DUE on invoice.payment_failed', async () => {
    const event = makeEvent('invoice.payment_failed', {
      subscription: 'sub_abc',
      customer: 'cus_abc',
    }, 'evt_pf_1')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)

    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.membershipSubscription.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await postWebhook(app, event)

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.membershipSubscription.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeSubId: 'sub_abc', status: 'ACTIVE' }),
        data: { status: 'PAST_DUE' },
      }),
    )
  })

  it('does nothing on invoice.payment_failed when no member found', async () => {
    const event = makeEvent('invoice.payment_failed', {
      subscription: 'sub_xyz',
      customer: 'cus_unknown',
    }, 'evt_pf_2')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null)

    const res = await postWebhook(app, event)

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.membershipSubscription.updateMany)).not.toHaveBeenCalled()
  })

  // ─── customer.subscription.deleted → CANCELLED ──────────────────────────────

  it('cancels subscription on customer.subscription.deleted', async () => {
    const event = makeEvent('customer.subscription.deleted', { id: 'sub_del_1' }, 'evt_del_1')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)
    vi.mocked(prisma.membershipSubscription.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await postWebhook(app, event)

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.membershipSubscription.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeSubId: 'sub_del_1' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    )
  })

  // ─── payment_intent.payment_failed → marks sale, restores credits ───────────

  it('marks sale failedAt and restores credits on payment_intent.payment_failed', async () => {
    const event = makeEvent('payment_intent.payment_failed', { id: 'pi_failed_1' }, 'evt_pi_1')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)

    vi.mocked(prisma.productSale.findFirst).mockResolvedValue({
      id: 'sale-1',
      memberId: 'member-1',
      totalCredits: 2,
      failedAt: null,
    } as never)
    vi.mocked(prisma.productSale.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditBalance.update).mockResolvedValue({} as never)
    vi.mocked(prisma.creditTransaction.create).mockResolvedValue({} as never)

    const res = await postWebhook(app, event)

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.productSale.update)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sale-1' }, data: expect.objectContaining({ failedAt: expect.any(Date) }) }),
    )
    // Credits should be restored
    expect(vi.mocked(prisma.creditBalance.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'member-1' },
        data: { balance: { increment: 2 } },
      }),
    )
  })

  it('skips credit restore when sale has no credit component', async () => {
    const event = makeEvent('payment_intent.payment_failed', { id: 'pi_nocredits' }, 'evt_pi_2')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)

    vi.mocked(prisma.productSale.findFirst).mockResolvedValue({
      id: 'sale-2',
      memberId: 'member-1',
      totalCredits: 0,   // pure cash sale — no credits to restore
      failedAt: null,
    } as never)
    vi.mocked(prisma.productSale.update).mockResolvedValue({} as never)

    await postWebhook(app, event)

    expect(vi.mocked(prisma.creditBalance.update)).not.toHaveBeenCalled()
  })

  it('does nothing when sale already marked failed', async () => {
    const event = makeEvent('payment_intent.payment_failed', { id: 'pi_already' }, 'evt_pi_3')

    const app = await buildApp()
    mockStripe.webhooks.constructEvent.mockReturnValue(event)

    // findFirst returns null because failedAt is filtered out (failedAt: null in where clause)
    vi.mocked(prisma.productSale.findFirst).mockResolvedValue(null)

    await postWebhook(app, event)

    expect(vi.mocked(prisma.productSale.update)).not.toHaveBeenCalled()
  })
})
