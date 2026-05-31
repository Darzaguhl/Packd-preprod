import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const waiver = {
    findFirst:   vi.fn(),
    findUnique:  vi.fn(),
    create:      vi.fn(),
    update:      vi.fn(),
    updateMany:  vi.fn(),
  }
  const waiverSignature = {
    upsert: vi.fn(),
  }
  const member = { findUnique: vi.fn() }

  return {
    prisma: {
      waiver,
      waiverSignature,
      member,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ waiver, waiverSignature }),
      ),
    },
  }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'studio_admin', studioIds: ['studio-1'] })),
}))

vi.mock('../routes/admin-shared.js', () => ({
  assertStudioAccess: vi.fn().mockResolvedValue(true),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { waiverRoutes } from '../routes/waivers.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(waiverRoutes, { prefix: '/waivers' })
  return app
}

const mockWaiver = {
  id: 'waiver-1',
  studioId: 'studio-1',
  title: 'Liability Waiver',
  body: 'By signing you agree…',
  isActive: true,
  version: 1,
  updatedAt: new Date('2026-05-01'),
}

// ── GET /waivers/active ───────────────────────────────────────────────────────

describe('GET /waivers/active', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns active waiver for the studio', async () => {
    vi.mocked(prisma.waiver.findFirst).mockResolvedValue(mockWaiver as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/waivers/active?studioId=studio-1' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).waiver.title).toBe('Liability Waiver')
  })

  it('returns { waiver: null } when no active waiver exists', async () => {
    vi.mocked(prisma.waiver.findFirst).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/waivers/active?studioId=studio-1' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).waiver).toBeNull()
  })

  it('returns 400 when studioId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/waivers/active' })
    expect(res.statusCode).toBe(400)
  })
})

// ── POST /waivers/:id/sign ────────────────────────────────────────────────────

describe('POST /waivers/:id/sign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a signature for an active waiver', async () => {
    vi.mocked(getUser).mockReturnValue({ id: 'user-1', role: 'member', studioIds: [] } as never)
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.waiver.findUnique).mockResolvedValue({ id: 'waiver-1', isActive: true } as never)
    vi.mocked(prisma.waiverSignature.upsert).mockResolvedValue({} as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waivers/waiver-1/sign' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
    expect(vi.mocked(prisma.waiverSignature.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ waiverId: 'waiver-1', memberId: 'member-1' }) }),
    )
  })

  it('returns 404 when member profile is missing', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waivers/waiver-1/sign' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when waiver does not exist', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.waiver.findUnique).mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waivers/waiver-1/sign' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when waiver is inactive', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(prisma.waiver.findUnique).mockResolvedValue({ id: 'waiver-1', isActive: false } as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/waivers/waiver-1/sign' })
    expect(res.statusCode).toBe(400)
  })
})

// ── PUT /waivers/admin ────────────────────────────────────────────────────────

describe('PUT /waivers/admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a new waiver version 1 when none exists', async () => {
    vi.mocked(prisma.waiver.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.waiver.create).mockResolvedValue({ ...mockWaiver, version: 1 } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/waivers/admin',
      payload: { studioId: 'studio-1', title: 'Liability Waiver', body: 'By signing…' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).version).toBe(1)
  })

  it('deactivates old waiver and creates version 2 when one already exists', async () => {
    vi.mocked(prisma.waiver.findFirst).mockResolvedValue({ id: 'waiver-1', version: 1 } as never)
    vi.mocked(prisma.waiver.update).mockResolvedValue({} as never)
    vi.mocked(prisma.waiver.create).mockResolvedValue({ ...mockWaiver, version: 2 } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/waivers/admin',
      payload: { studioId: 'studio-1', title: 'Updated Waiver', body: 'New terms…' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).version).toBe(2)
    expect(vi.mocked(prisma.waiver.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    )
  })

  it('returns 400 when title or body is empty', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/waivers/admin',
      payload: { studioId: 'studio-1', title: '', body: 'something' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── DELETE /waivers/admin ─────────────────────────────────────────────────────

describe('DELETE /waivers/admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deactivates the active waiver', async () => {
    vi.mocked(prisma.waiver.updateMany).mockResolvedValue({ count: 1 } as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/waivers/admin?studioId=studio-1' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(prisma.waiver.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    )
  })
})
