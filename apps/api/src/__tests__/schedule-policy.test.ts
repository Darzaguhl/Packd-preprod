import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────
// All vi.fn() instances must be defined INSIDE the factory to survive hoisting.

vi.mock('@packd/db', () => {
  const member = { findUnique: vi.fn() }
  const studio = { findUnique: vi.fn() }
  const classSession = { findMany: vi.fn().mockResolvedValue([]) }
  const booking = { findMany: vi.fn().mockResolvedValue([]) }
  const waitlistEntry = { findMany: vi.fn().mockResolvedValue([]) }
  const studioNetworkMembership = { findFirst: vi.fn().mockResolvedValue(null) }
  const cancellationPolicy = { findUnique: vi.fn() }

  return {
    prisma: {
      member,
      studio,
      classSession,
      booking,
      waitlistEntry,
      studioNetworkMembership,
      cancellationPolicy,
    },
  }
})

// ── Auth mock — member role ───────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  tryAuth: vi.fn().mockImplementation(async (request: { user?: unknown }) => {
    request.user = { id: 'user-1', role: 'member' }
  }),
  getUser: vi.fn((request: { user?: unknown }) => request.user ?? { id: 'user-1', role: 'member' }),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { scheduleRoutes } from '../routes/schedule.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(scheduleRoutes, { prefix: '/schedule' })
  return app
}

const FROM = new Date('2026-06-16T00:00:00Z').toISOString()
const TO   = new Date('2026-06-23T00:00:00Z').toISOString()

describe('GET /schedule/:studioId — cancellation policy fields', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the studio timezone and cancellation policy', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ name: 'Test Studio', timeFormat: '24h', timezone: 'Europe/Stockholm' } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue({
      lateCancelWindowHours: 24,
      lateCancelFeeCredits: 2,
    } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/schedule/studio-1?from=${FROM}&to=${TO}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.timezone).toBe('Europe/Stockholm')
    expect(body.lateCancelWindowHours).toBe(24)
    expect(body.lateCancelFeeCredits).toBe(2)
  })

  it('falls back to UTC and defaults when no policy is configured', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ name: 'Test Studio', timeFormat: '24h', timezone: null } as never)
    vi.mocked(prisma.cancellationPolicy.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/schedule/studio-1?from=${FROM}&to=${TO}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.timezone).toBe('UTC')
    expect(body.lateCancelWindowHours).toBe(12)  // default
    expect(body.lateCancelFeeCredits).toBe(1)    // default
  })

  it('blocks a member from accessing a studio outside their network', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-2' } as never)
    vi.mocked(prisma.studioNetworkMembership.findFirst).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/schedule/studio-1?from=${FROM}&to=${TO}`,
    })

    expect(res.statusCode).toBe(403)
  })
})
