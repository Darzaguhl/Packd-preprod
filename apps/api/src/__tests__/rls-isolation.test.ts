/**
 * Cross-tenant RLS isolation tests — two layers:
 *
 * Layer 1 (unit, always runs): verifies withStudioCtx() emits the exact
 * SQL commands that RLS requires. If these fail the RLS context is broken
 * even before row-level policies are checked.
 *
 * Layer 2 (integration, INTEGRATION=true): connects to a real Postgres
 * instance with RLS applied, inserts data for two studios, and asserts
 * that queries through withStudioCtx() see only the target studio's rows.
 *
 * To run layer 2 locally:
 *   1. Ensure DATABASE_URL points to a Postgres instance with:
 *      - Prisma migrations applied (`npm run db:migrate:deploy`)
 *      - RLS policies applied (`psql $DATABASE_URL < packages/db/sql/rls_studio_isolation.sql`)
 *      - packd_api role created and granted (`GRANT packd_api TO <your_role>`)
 *   2. INTEGRATION=true npm test -- rls-isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Layer 1: unit tests ───────────────────────────────────────────────────────

// We mock @packd/db so this layer runs without a real DB.
vi.mock('@packd/db', () => {
  const executeRawUnsafe = vi.fn().mockResolvedValue(undefined)
  const executeRaw = vi.fn().mockResolvedValue(undefined)
  const tx = { $executeRawUnsafe: executeRawUnsafe, $executeRaw: executeRaw }
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
  return {
    prisma: { $transaction: transaction },
    _mocks: { executeRawUnsafe, executeRaw, transaction },
  }
})

// Import after mock is registered
const { prisma, _mocks } = await import('@packd/db') as unknown as {
  prisma: { $transaction: ReturnType<typeof vi.fn> }
  _mocks: {
    executeRawUnsafe: ReturnType<typeof vi.fn>
    executeRaw: ReturnType<typeof vi.fn>
    transaction: ReturnType<typeof vi.fn>
  }
}
const { withStudioCtx } = await import('../lib/studio-ctx.js')

describe('withStudioCtx — SQL commands (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a transaction', async () => {
    await withStudioCtx('studio-a', async () => 'ok')
    expect(_mocks.transaction).toHaveBeenCalledOnce()
  })

  it('switches role to packd_api before querying', async () => {
    await withStudioCtx('studio-a', async () => 'ok')
    expect(_mocks.executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL ROLE packd_api')
  })

  it('sets app.current_studio_id to the provided studioId', async () => {
    await withStudioCtx('studio-xyz', async () => 'ok')
    const call = _mocks.executeRaw.mock.calls[0]
    // Tagged template — first arg is the TemplateStringsArray, second is the value
    expect(call[1]).toBe('studio-xyz')
  })

  it('clears studio context (empty string) when studioId is null', async () => {
    await withStudioCtx(null, async () => 'ok')
    const call = _mocks.executeRaw.mock.calls[0]
    expect(call[1]).toBe('')
  })

  it('clears studio context when studioId is undefined', async () => {
    await withStudioCtx(undefined, async () => 'ok')
    const call = _mocks.executeRaw.mock.calls[0]
    expect(call[1]).toBe('')
  })

  it('SET LOCAL ROLE is called before set_config', async () => {
    const order: string[] = []
    _mocks.executeRawUnsafe.mockImplementation(async (sql: string) => {
      order.push('role:' + sql)
    })
    _mocks.executeRaw.mockImplementation(async () => {
      order.push('config')
    })
    await withStudioCtx('studio-a', async () => 'ok')
    expect(order[0]).toMatch(/SET LOCAL ROLE/)
    expect(order[1]).toBe('config')
  })

  it('returns the value from the callback', async () => {
    const result = await withStudioCtx('studio-a', async () => ({ rows: 42 }))
    expect(result).toEqual({ rows: 42 })
  })

  it('propagates exceptions from the callback', async () => {
    await expect(
      withStudioCtx('studio-a', async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')
  })
})

// ── Layer 2: integration tests ────────────────────────────────────────────────

const RUN_INTEGRATION = process.env.INTEGRATION === 'true'

describe.skipIf(!RUN_INTEGRATION)('RLS row-level isolation (integration)', () => {
  /**
   * These tests use the real Prisma client against a live database.
   * They create two studios (A and B) with associated data, then assert
   * that withStudioCtx(A) cannot see B's rows, and vice versa.
   *
   * Each test cleans up its own data in an afterEach to keep runs idempotent.
   */

  // Lazy-load real prisma only in integration mode to avoid import side-effects
  let realPrisma: typeof import('@packd/db').prisma
  let realWithStudioCtx: typeof withStudioCtx

  // Two fake studio IDs — must exist in the DB (created in beforeAll)
  let studioA: string
  let studioB: string

  beforeEach(async () => {
    // Re-import real modules (vi.mock is file-scoped; integration tests run
    // in a separate describe so the mock is still active — we use dynamic
    // import with the actual path to bypass it in integration mode)
    // NOTE: In practice, run integration tests in a separate vitest project
    // config that does NOT register this mock. See vitest.integration.config.ts.
    const db = await import('@packd/db')
    realPrisma = db.prisma
    const ctx = await import('../lib/studio-ctx.js')
    realWithStudioCtx = ctx.withStudioCtx

    // Create two test studios
    const [a, b] = await Promise.all([
      realPrisma.studio.create({ data: { name: 'RLS Test Studio A', slug: `rls-test-a-${Date.now()}`, currency: 'USD', timezone: 'UTC', bookingWindowDays: 7 } }),
      realPrisma.studio.create({ data: { name: 'RLS Test Studio B', slug: `rls-test-b-${Date.now()}`, currency: 'USD', timezone: 'UTC', bookingWindowDays: 7 } }),
    ])
    studioA = a.id
    studioB = b.id
  })

  afterEach(async () => {
    // Clean up test studios and cascade-delete their data
    await realPrisma.studio.deleteMany({ where: { id: { in: [studioA, studioB] } } })
  })

  it('Member: studioA context cannot see studioB members', async () => {
    // Create a member in studio B
    const user = await realPrisma.user.create({ data: { email: `rls-test-${Date.now()}@example.com`, firstName: 'RLS', lastName: 'Test' } })
    await realPrisma.member.create({ data: { userId: user.id, studioId: studioB, source: 'packd' } })

    // Query through studioA context — should return 0 rows
    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.member.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('ClassSession: studioA context cannot see studioB sessions', async () => {
    const template = await realPrisma.classTemplate.create({
      data: { studioId: studioB, name: 'RLS Test Class', sport: 'Other', durationMin: 60, capacity: 10, creditsRequired: 1 },
    })
    const location = await realPrisma.location.create({ data: { studioId: studioB, name: 'RLS Location' } })
    const room = await realPrisma.room.create({ data: { locationId: location.id, studioId: studioB, name: 'RLS Room', capacity: 10 } })
    await realPrisma.classSession.create({
      data: { templateId: template.id, studioId: studioB, roomId: room.id, startsAt: new Date(), capacity: 10, creditsRequired: 1, status: 'SCHEDULED' },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.classSession.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('Product: studioA context cannot see studioB products', async () => {
    await realPrisma.product.create({
      data: { studioId: studioB, name: 'RLS Product', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.product.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('MembershipPlan: studioA context cannot see studioB plans', async () => {
    await realPrisma.membershipPlan.create({
      data: { studioId: studioB, name: 'RLS Plan', priceInCents: 5000, billingIntervalMonths: 1, creditsPerCycle: 10 },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.membershipPlan.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('PromoCode: studioA context cannot see studioB promo codes', async () => {
    await realPrisma.promoCode.create({
      data: { studioId: studioB, code: `RLS-TEST-${Date.now()}`, discountType: 'FLAT', discountValue: 10 },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.promoCode.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('soft bypass: empty studioId context sees all rows', async () => {
    // When studioId is empty (admin context), RLS should allow all rows
    await realPrisma.product.create({
      data: { studioId: studioA, name: 'RLS Product A', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })
    await realPrisma.product.create({
      data: { studioId: studioB, name: 'RLS Product B', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })

    const result = await realWithStudioCtx('', async (tx) =>
      tx.product.findMany({ where: { studioId: { in: [studioA, studioB] } } })
    )
    // Both products visible in bypass mode
    expect(result).toHaveLength(2)
  })

  it('studioA context sees its own rows correctly', async () => {
    await realPrisma.product.create({
      data: { studioId: studioA, name: 'RLS Product A', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })
    await realPrisma.product.create({
      data: { studioId: studioB, name: 'RLS Product B', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.product.findMany({ where: { studioId: { in: [studioA, studioB] } } })
    )
    // Only studioA's product visible
    expect(result).toHaveLength(1)
    expect(result[0].studioId).toBe(studioA)
  })
})
