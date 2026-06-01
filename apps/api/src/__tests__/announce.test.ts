import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@packd/db', () => {
  const classSession = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() }
  const booking      = { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() }
  const member       = { findUnique: vi.fn(), findFirst: vi.fn() }
  const auditLog     = { create: vi.fn().mockResolvedValue({}) }
  return { prisma: { classSession, booking, member, auditLog } }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'admin-1', role: 'studio_admin', studioIds: ['studio-1'] })),
}))

vi.mock('../lib/email.js', () => ({
  sendSessionAnnouncement: vi.fn().mockResolvedValue(true),
}))

vi.mock('../jobs/index.js', () => ({ enqueueNoShowCheck: vi.fn() }))
vi.mock('../routes/members.js', () => ({ ensureMemberForAdmin: vi.fn() }))
vi.mock('../lib/stripe-sync.js', () => ({}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod'
import { adminRoutes } from '../routes/admin.js'
import { prisma } from '@packd/db'
import { sendSessionAnnouncement } from '../lib/email.js'

async function buildApp() {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(sensible)
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

function mockSession() {
  return {
    id: 'session-1',
    studioId: 'studio-1',
    startsAt: new Date('2026-06-15T09:00:00Z'),
    template: { name: 'Morning Ride' },
    studio: { id: 'studio-1', name: 'Packd Demo' },
  }
}

describe('POST /admin/sessions/:id/announce', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends email to all confirmed attendees and returns sent count', async () => {
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      { id: 'b-1', member: { user: { email: 'alice@test.com', firstName: 'Alice' } } },
      { id: 'b-2', member: { user: { email: 'bob@test.com',   firstName: 'Bob'   } } },
    ] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/announce',
      payload: { subject: 'Room change', message: 'Class moved to Studio B' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBe(2)
    expect(body.sent).toBe(2)
    expect(vi.mocked(sendSessionAnnouncement)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendSessionAnnouncement)).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@test.com', subject: 'Room change', message: 'Class moved to Studio B' }),
    )
  })

  it('returns 400 when subject or message is missing', async () => {
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(mockSession() as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/announce',
      payload: { subject: '', message: 'Some message' },
    })

    expect(res.statusCode).toBe(400)
    expect(vi.mocked(sendSessionAnnouncement)).not.toHaveBeenCalled()
  })

  it('returns sent: 0 when no confirmed bookings', async () => {
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(mockSession() as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/session-1/announce',
      payload: { subject: 'FYI', message: 'See you tomorrow' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).sent).toBe(0)
    expect(vi.mocked(sendSessionAnnouncement)).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown session', async () => {
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(null as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sessions/ghost/announce',
      payload: { subject: 'Hi', message: 'Hello' },
    })

    expect(res.statusCode).toBe(404)
  })
})
