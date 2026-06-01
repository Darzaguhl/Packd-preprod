import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => ({
  prisma: {
    classSession: { findMany: vi.fn() },
  },
}))

// ── Auth mock — studio_admin by default ──────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({
    id: 'user-1',
    email: 'admin@test.com',
    role: 'studio_admin',
    studioIds: ['studio-1'],
  })),
  assertStudioAccess: vi.fn().mockResolvedValue(undefined),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { classScheduleRoutes } from '../routes/schedules.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(classScheduleRoutes, { prefix: '/schedules' })
  return app
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    startsAt: new Date('2026-06-15T09:00:00Z'),
    status: 'SCHEDULED',
    template: { sport: 'CYCLING', name: 'Morning Ride' },
    instructor: { user: { firstName: 'Alex', lastName: 'Rivera' } },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /schedules/month', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns sessions grouped by date with rich fields', async () => {
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([makeSession()] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/schedules/month?studioId=studio-1&year=2026&month=6',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.year).toBe(2026)
    expect(body.month).toBe(6)

    const day = body.days['2026-06-15']
    expect(day).toHaveLength(1)
    expect(day[0]).toMatchObject({
      id: 'session-1',
      sport: 'CYCLING',
      name: 'Morning Ride',
      instructorName: 'Alex Rivera',
      status: 'SCHEDULED',
    })
    expect(day[0].startsAt).toBeDefined()
  })

  it('groups multiple sessions on the same day', async () => {
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([
      makeSession({ id: 'session-1', startsAt: new Date('2026-06-15T09:00:00Z') }),
      makeSession({ id: 'session-2', startsAt: new Date('2026-06-15T18:00:00Z'), template: { sport: 'YOGA', name: 'Evening Flow' } }),
    ] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/schedules/month?studioId=studio-1&year=2026&month=6',
    })

    expect(res.statusCode).toBe(200)
    const day = res.json().days['2026-06-15']
    expect(day).toHaveLength(2)
    expect(day.map((s: { id: string }) => s.id)).toEqual(['session-1', 'session-2'])
  })

  it('handles missing instructor gracefully', async () => {
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([
      makeSession({ instructor: null }),
    ] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/schedules/month?studioId=studio-1&year=2026&month=6',
    })

    expect(res.statusCode).toBe(200)
    const day = res.json().days['2026-06-15']
    expect(day[0].instructorName).toBe('')
  })

  it('returns empty days object when no sessions exist', async () => {
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/schedules/month?studioId=studio-1&year=2026&month=6',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().days).toEqual({})
  })
})
