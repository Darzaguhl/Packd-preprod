import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const member = {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const referral = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  }
  const studio = { findUnique: vi.fn() }
  const membershipSubscription = { updateMany: vi.fn() }
  const user = { update: vi.fn() }

  return { prisma: { member, referral, studio, membershipSubscription, user } }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', email: 'test@test.com', role: 'member', studioIds: [] })),
}))

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { memberRoutes } from '../routes/members.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(memberRoutes, { prefix: '/members' })
  return app
}

// ── PATCH /members/me/email-preferences ──────────────────────────────────────

describe('PATCH /members/me/email-preferences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('merges preferences and returns the updated object', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: 'member-1',
      emailPreferences: { classReminder: true, marketing: true },
    } as never)
    vi.mocked(prisma.member.update).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/members/me/email-preferences',
      payload: { marketing: false },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.emailPreferences.marketing).toBe(false)
    expect(body.emailPreferences.classReminder).toBe(true)
  })

  it('returns 404 when member profile is missing', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/members/me/email-preferences',
      payload: { marketing: false },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── GET /members/me/referral ──────────────────────────────────────────────────

describe('GET /members/me/referral', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the existing referral code without generating a new one', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', referralCode: 'ABC123' } as never)
    vi.mocked(prisma.referral.findMany).mockResolvedValue([
      { rewarded: true, rewardCredits: 5 },
      { rewarded: false, rewardCredits: 5 },
    ] as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/members/me/referral' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('ABC123')
    expect(body.totalReferrals).toBe(2)
    expect(body.creditsEarned).toBe(5)
    expect(body.pendingReward).toBe(5)
    expect(vi.mocked(prisma.member.update)).not.toHaveBeenCalled()
  })

  it('generates a new referral code when none exists', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', referralCode: null } as never)
    vi.mocked(prisma.member.update).mockResolvedValue({ id: 'member-1', referralCode: 'XYZ999' } as never)
    vi.mocked(prisma.referral.findMany).mockResolvedValue([])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/members/me/referral' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).code).toBeTruthy()
    expect(vi.mocked(prisma.member.update)).toHaveBeenCalledTimes(1)
  })

  it('retries on P2002 unique collision and succeeds on second attempt', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', referralCode: null } as never)
    vi.mocked(prisma.referral.findMany).mockResolvedValue([])

    const p2002 = new PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: '6.0.0' })
    vi.mocked(prisma.member.update)
      .mockRejectedValueOnce(p2002)       // first attempt: collision
      .mockResolvedValue({ id: 'member-1', referralCode: 'RETRY1' } as never) // second: success

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/members/me/referral' })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.member.update)).toHaveBeenCalledTimes(2)
  })
})

// ── POST /members/referral/apply ──────────────────────────────────────────────

describe('POST /members/referral/apply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies a valid referral code', async () => {
    vi.mocked(prisma.member.findUnique)
      .mockResolvedValueOnce({ id: 'member-1', studioId: 'studio-1' } as never) // caller
      .mockResolvedValueOnce({ id: 'member-2' } as never) // referrer (by referralCode)
    vi.mocked(prisma.referral.findFirst).mockResolvedValue(null) // no existing referral
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ referralRewardCredits: 5 } as never)
    vi.mocked(prisma.referral.create).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/members/referral/apply',
      payload: { code: 'FRIEND1' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('returns 409 when member tries to apply their own code', async () => {
    vi.mocked(prisma.member.findUnique)
      .mockResolvedValueOnce({ id: 'member-1', studioId: 'studio-1' } as never)
      .mockResolvedValueOnce({ id: 'member-1' } as never) // same member is referrer
    vi.mocked(prisma.referral.findFirst).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/members/referral/apply',
      payload: { code: 'MYCODE' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 409 when member has already applied a referral code', async () => {
    vi.mocked(prisma.member.findUnique)
      .mockResolvedValueOnce({ id: 'member-1', studioId: 'studio-1' } as never)
      .mockResolvedValueOnce({ id: 'member-2' } as never)
    vi.mocked(prisma.referral.findFirst).mockResolvedValue({ id: 'referral-old' } as never) // already applied

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/members/referral/apply',
      payload: { code: 'FRIEND1' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 404 when referral code does not exist', async () => {
    vi.mocked(prisma.member.findUnique)
      .mockResolvedValueOnce({ id: 'member-1', studioId: 'studio-1' } as never)
      .mockResolvedValueOnce(null) // referrer not found
    vi.mocked(prisma.referral.findFirst).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/members/referral/apply',
      payload: { code: 'NOPE99' },
    })

    expect(res.statusCode).toBe(404)
  })
})

// ── DELETE /members/me (GDPR) ─────────────────────────────────────────────────

describe('DELETE /members/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cancels active subscriptions, anonymizes user, deletes member', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: 'member-1',
      memberships: [{ id: 'sub-1', status: 'ACTIVE' }],
    } as never)
    vi.mocked(prisma.membershipSubscription.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)
    vi.mocked(prisma.member.delete).mockResolvedValue({} as never)

    // Supabase delete call — mock fetch globally
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/members/me' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)

    expect(vi.mocked(prisma.membershipSubscription.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    )
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstName: 'Deleted', lastName: 'User' }),
      }),
    )
    expect(vi.mocked(prisma.member.delete)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'member-1' } }),
    )
  })

  it('still completes deletion when member has no active subscriptions', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1', memberships: [] } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)
    vi.mocked(prisma.member.delete).mockResolvedValue({} as never)
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/members/me' })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.membershipSubscription.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.member.delete)).toHaveBeenCalled()
  })

  it('returns 404 when member profile does not exist', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/members/me' })

    expect(res.statusCode).toBe(404)
  })
})
