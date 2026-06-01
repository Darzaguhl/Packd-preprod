import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    studio: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

// ── Auth mock — studio_admin by default ──────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({
    id: 'admin-user-1',
    email: 'admin@packd.test',
    role: 'studio_admin',
    studioIds: ['studio-1'],
  })),
}))

// ── Email mock — prevent real sends ──────────────────────────────────────────

vi.mock('../lib/email.js', () => ({
  sendStaffInvite: vi.fn().mockResolvedValue(true),
}))

// ── Supabase admin mock ───────────────────────────────────────────────────────

vi.mock('../lib/supabase-admin.js', () => ({
  getSupabaseAppMeta: vi.fn(),
  setSupabaseAppMeta: vi.fn().mockResolvedValue(undefined),
  getPrimaryRole: vi.fn(() => 'fronthost'),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { staffRoutes } from '../routes/staff.js'
import { prisma } from '@packd/db'
import { sendStaffInvite } from '../lib/email.js'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(staffRoutes, { prefix: '/staff' })
  return app
}

describe('POST /staff/invite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends an invitation email and returns success', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue({ name: 'Packd Demo Studio' } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ firstName: 'Admin', lastName: 'User' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/staff/invite',
      payload: { email: 'new@example.com', firstName: 'Jane', role: 'fronthost', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.message).toContain('new@example.com')
    expect(vi.mocked(sendStaffInvite)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        firstName: 'Jane',
        role: 'fronthost',
        studioName: 'Packd Demo Studio',
      }),
    )
  })

  it('rejects an invalid role', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/staff/invite',
      payload: { email: 'new@example.com', firstName: 'Jane', role: 'superadmin', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/staff/invite',
      payload: { role: 'fronthost', studioId: 'studio-1' }, // missing email + firstName
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when studio does not exist', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.studio.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ firstName: 'Admin', lastName: 'User' } as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/staff/invite',
      payload: { email: 'new@example.com', firstName: 'Jane', role: 'instructor', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(404)
  })
})
