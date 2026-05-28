import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}))

// ── Auth mock — studio_admin by default ──────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({
    id: 'user-1',
    email: 'admin@test.com',
    role: 'studio_admin',
    studioIds: ['studio-1'],
  })),
}))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { adminRoutes } from '../routes/admin.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /admin/query', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    vi.mocked(prisma.$queryRawUnsafe).mockReset()
  })

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('200 — executes a valid SELECT and returns structured results', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { name: 'Cycling', count: 42n },
      { name: 'HIIT', count: 18n },
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT name, count FROM "ClassTemplate"', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.columns).toEqual(['name', 'count'])
    expect(body.rowCount).toBe(2)
    expect(body.rows[0]).toEqual(['Cycling', 42])   // bigint → number
    expect(body.rows[1]).toEqual(['HIIT', 18])
    expect(typeof body.duration).toBe('number')
  })

  it('200 — accepts a WITH … SELECT (CTE)', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ total: 5 }])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: {
        sql: 'WITH cte AS (SELECT 1 AS n) SELECT COUNT(*) AS total FROM cte',
        studioId: 'studio-1',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().rowCount).toBe(1)
  })

  it('200 — returns empty rows when query yields no results', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT 1 WHERE false', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rowCount).toBe(0)
    expect(body.columns).toEqual([])
    expect(body.rows).toEqual([])
  })

  it('200 — serialises Date values to ISO strings', async () => {
    const ts = new Date('2026-05-27T10:00:00.000Z')
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ created_at: ts }])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT "createdAt" AS created_at FROM "Booking" LIMIT 1', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().rows[0][0]).toBe(ts.toISOString())
  })

  // ── SQL validation — blocked statements ────────────────────────────────────

  it('400 — rejects INSERT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "INSERT INTO \"Booking\" (id) VALUES ('x')", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects UPDATE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "UPDATE \"Member\" SET notes = 'x' WHERE id = 'y'", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects DELETE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "DELETE FROM \"Booking\" WHERE id = 'x'", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects DROP TABLE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'DROP TABLE "Booking"', studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects TRUNCATE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'TRUNCATE "Booking"', studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects multi-statement (semicolon mid-query)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: {
        sql: "SELECT 1; DROP TABLE \"Booking\"",
        studioId: 'studio-1',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — rejects DML hidden behind a line comment bypass attempt', async () => {
    // Attacker tries to hide DELETE after a comment
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: {
        sql: "SELECT 1 -- safe\nDELETE FROM \"Booking\"",
        studioId: 'studio-1',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('400 — allows trailing semicolon (common editor habit)', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ n: 1 }])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT 1 AS n;', studioId: 'studio-1' },
    })
    // Trailing semicolon is stripped before multi-statement check — should pass validation
    expect(res.statusCode).toBe(200)
  })

  // ── Missing / malformed body ────────────────────────────────────────────────

  it('400 — missing studioId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT 1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 — missing sql', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 — empty sql string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: '   ', studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  // ── Dangerous function blocking ────────────────────────────────────────────

  it('400 — rejects pg_sleep (DoS vector)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "SELECT pg_sleep(10)", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 — rejects dblink (SSRF vector)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "SELECT dblink('host=evil.com', 'SELECT 1')", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 — rejects set_config (session manipulation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: "SELECT set_config('app.current_studio_id', '', false)", studioId: 'studio-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  // ── DB error forwarding ────────────────────────────────────────────────────

  it('400 — forwards Postgres error message to client', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(
      new Error('column "bogus_col" does not exist'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/admin/query',
      body: { sql: 'SELECT bogus_col FROM "Booking"', studioId: 'studio-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('bogus_col')
  })
})
