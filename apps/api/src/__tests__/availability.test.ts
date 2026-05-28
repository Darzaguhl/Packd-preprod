import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const instructorAvailabilityBlock = {
    findMany:  vi.fn(),
    findUnique: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
  }
  const instructor = { findUnique: vi.fn() }

  return { prisma: { instructorAvailabilityBlock, instructor } }
})

// ── Auth mock — studio_admin by default ──────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(() => ({ id: 'user-admin', role: 'studio_admin', studioIds: ['studio-1'] })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { availabilityRoutes } from '../routes/availability.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(availabilityRoutes, { prefix: '/availability' })
  return app
}

function makeBlock(overrides = {}) {
  return {
    id: 'block-1',
    instructorId: 'instr-1',
    studioId: 'studio-1',
    title: 'Holiday',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate:   new Date('2026-07-07T00:00:00Z'),
    createdAt:  new Date('2026-06-01T00:00:00Z'),
    instructor: {
      user: { firstName: 'Alex', lastName: 'Rivera' },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /availability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns blocks for a studio (studio_admin)', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.findMany).mockResolvedValue([makeBlock()] as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/availability?studioId=studio-1' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].title).toBe('Holiday')
    expect(body[0].instructorName).toBe('Alex Rivera')
  })

  it('returns 400 when studioId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/availability' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 403 for a member (insufficient role)', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-member', role: 'member', studioIds: [] } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/availability?studioId=studio-1' })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /availability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a block when caller is studio_admin', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.create).mockResolvedValue(makeBlock() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/availability',
      payload: {
        instructorId: 'instr-1',
        studioId: 'studio-1',
        title: 'Holiday',
        startDate: '2026-07-01T00:00:00Z',
        endDate:   '2026-07-07T00:00:00Z',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).title).toBe('Holiday')
  })

  it('returns 400 when startDate >= endDate', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/availability',
      payload: {
        instructorId: 'instr-1',
        studioId: 'studio-1',
        title: 'Bad dates',
        startDate: '2026-07-07T00:00:00Z',
        endDate:   '2026-07-01T00:00:00Z',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/availability',
      payload: { studioId: 'studio-1', title: 'No dates' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 403 when instructor tries to create a block for another instructor', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-instr', role: 'instructor', studioIds: [] } as never)
    // canManageBlock resolves to false — instructor's userId != callerId
    vi.mocked(prisma.instructor.findUnique).mockResolvedValue({ userId: 'different-user' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/availability',
      payload: {
        instructorId: 'instr-other',
        studioId: 'studio-1',
        title: 'Holiday',
        startDate: '2026-07-01T00:00:00Z',
        endDate:   '2026-07-07T00:00:00Z',
      },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /availability/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates title for studio_admin', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.findUnique).mockResolvedValue(makeBlock() as never)
    vi.mocked(prisma.instructorAvailabilityBlock.update).mockResolvedValue(
      makeBlock({ title: 'Updated' }) as never,
    )

    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/availability/block-1',
      payload: { title: 'Updated' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).title).toBe('Updated')
  })

  it('returns 404 when block does not exist', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/availability/missing', payload: { title: 'X' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /availability/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes block for studio_admin', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.findUnique).mockResolvedValue(makeBlock() as never)
    vi.mocked(prisma.instructorAvailabilityBlock.delete).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/availability/block-1' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('returns 404 when block does not exist', async () => {
    vi.mocked(prisma.instructorAvailabilityBlock.findUnique).mockResolvedValue(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/availability/missing' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when instructor tries to delete another instructor\'s block', async () => {
    vi.mocked(getUser).mockReturnValueOnce({ id: 'user-instr', role: 'instructor', studioIds: [] } as never)
    vi.mocked(prisma.instructorAvailabilityBlock.findUnique).mockResolvedValue(makeBlock() as never)
    vi.mocked(prisma.instructor.findUnique).mockResolvedValue({ userId: 'different-user' } as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/availability/block-1' })
    expect(res.statusCode).toBe(403)
  })
})
