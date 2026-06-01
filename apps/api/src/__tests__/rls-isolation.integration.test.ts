/**
 * RLS isolation integration tests — Layer 2.
 *
 * This file is intentionally separate from rls-isolation.test.ts so that
 * Vitest does NOT register the vi.mock('@packd/db') interceptor that lives
 * in the unit-test file.  Without that mock, dynamic imports here resolve to
 * the real Prisma client, which is what we need for genuine DB assertions.
 *
 * Run conditions:
 *   - Only executed when INTEGRATION=true is set in the environment.
 *   - Requires a Postgres instance with:
 *       1. Prisma migrations applied  (`npm run db:migrate:deploy`)
 *       2. packd_api role created + granted SELECT/INSERT/UPDATE/DELETE
 *       3. RLS policies applied       (`psql $DATABASE_URL -f packages/db/sql/rls_studio_isolation.sql`)
 *
 * In CI this is wired up by the "Set up packd_api role and RLS policies" step
 * in .github/workflows/ci.yml, which runs before the integration test step.
 *
 * Local usage:
 *   INTEGRATION=true npm run test:integration -- rls-isolation.integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const RUN_INTEGRATION = process.env.INTEGRATION === 'true'

describe.skipIf(!RUN_INTEGRATION)('RLS row-level isolation (integration)', () => {
  /**
   * These tests use the real Prisma client against a live database.
   * They create two studios (A and B) with associated data, then assert
   * that withStudioCtx(A) cannot see B's rows, and vice versa.
   *
   * Each test cleans up its own data in an afterEach to keep runs idempotent.
   */

  let realPrisma: typeof import('@packd/db').prisma
  let realWithStudioCtx: typeof import('../lib/studio-ctx.js').withStudioCtx

  let studioA: string
  let studioB: string

  beforeEach(async () => {
    const db = await import('@packd/db')
    realPrisma = db.prisma
    const ctx = await import('../lib/studio-ctx.js')
    realWithStudioCtx = ctx.withStudioCtx

    const [a, b] = await Promise.all([
      realPrisma.studio.create({
        data: { name: 'RLS Test Studio A', slug: `rls-test-a-${Date.now()}`, currency: 'USD', timezone: 'UTC', bookingWindowDays: 7 },
      }),
      realPrisma.studio.create({
        data: { name: 'RLS Test Studio B', slug: `rls-test-b-${Date.now()}`, currency: 'USD', timezone: 'UTC', bookingWindowDays: 7 },
      }),
    ])
    studioA = a.id
    studioB = b.id
  })

  afterEach(async () => {
    await realPrisma.studio.deleteMany({ where: { id: { in: [studioA, studioB] } } })
  })

  it('Member: studioA context cannot see studioB members', async () => {
    const uid = `rls-test-${Date.now()}`
    const user = await realPrisma.user.create({
      data: { id: uid, email: `${uid}@example.com`, firstName: 'RLS', lastName: 'Test' },
    })
    await realPrisma.member.create({ data: { userId: user.id, studioId: studioB, source: 'packd' } })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.member.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('ClassSession: studioA context cannot see studioB sessions', async () => {
    const template = await realPrisma.classTemplate.create({
      data: { studioId: studioB, name: 'RLS Test Class', sport: 'OTHER', durationMin: 60 },
    })
    const location = await realPrisma.location.create({
      data: { studioId: studioB, name: 'RLS Location', address: '1 Test St', city: 'Stockholm', country: 'SE', timezone: 'Europe/Stockholm' },
    })
    const room = await realPrisma.room.create({
      data: { locationId: location.id, name: 'RLS Room', capacity: 10 },
    })
    const startsAt = new Date(Date.now() + 86_400_000)
    const endsAt   = new Date(Date.now() + 86_400_000 + 3_600_000)
    await realPrisma.classSession.create({
      data: {
        templateId: template.id,
        studioId: studioB,
        roomId: room.id,
        startsAt,
        endsAt,
        capacity: 10,
        creditsRequired: 1,
        status: 'SCHEDULED',
        instructorId: 'placeholder',
      },
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
      data: { studioId: studioB, name: 'RLS Plan', priceInCents: 5000, intervalMonths: 1, creditsPerCycle: 10 },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.membershipPlan.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('PromoCode: studioA context cannot see studioB promo codes', async () => {
    await realPrisma.promoCode.create({
      data: { studioId: studioB, code: `RLS-TEST-${Date.now()}`, type: 'MEMBERSHIP_FLAT', value: 10 },
    })

    const result = await realWithStudioCtx(studioA, async (tx) =>
      tx.promoCode.findMany({ where: { studioId: studioB } })
    )
    expect(result).toHaveLength(0)
  })

  it('soft bypass: empty studioId context sees all rows', async () => {
    await realPrisma.product.create({
      data: { studioId: studioA, name: 'RLS Product A', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })
    await realPrisma.product.create({
      data: { studioId: studioB, name: 'RLS Product B', priceInCents: 1000, creditsRequired: 0, inStock: true },
    })

    const result = await realWithStudioCtx('', async (tx) =>
      tx.product.findMany({ where: { studioId: { in: [studioA, studioB] } } })
    )
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
    expect(result).toHaveLength(1)
    expect(result[0].studioId).toBe(studioA)
  })
})
