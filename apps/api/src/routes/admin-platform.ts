import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireRole } from '../lib/auth.js'

export async function adminPlatformRoutes(app: FastifyInstance) {

  // ── Platform stats ─────────────────────────────────────────────────────────
  app.get('/platform/stats', { preHandler: requireRole('admin') }, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      brands,
      franchises,
      studios,
      members,
      bookings30d,
      revenue30d,
      activeStudios30d,
    ] = await Promise.all([
      prisma.brand.count(),
      prisma.franchise.count(),
      prisma.studio.count(),
      prisma.member.count({ where: { staffRoles: { isEmpty: true } } }),
      prisma.booking.count({ where: { bookedAt: { gte: thirtyDaysAgo }, status: { not: 'CANCELLED' } } }),
      prisma.productSale.aggregate({
        where: { soldAt: { gte: thirtyDaysAgo }, refundedAt: null },
        _sum: { totalCents: true },
      }),
      prisma.booking.groupBy({
        by: ['sessionId'],
        where: { bookedAt: { gte: thirtyDaysAgo }, status: { not: 'CANCELLED' } },
        _count: true,
      }).then(async rows => {
        if (!rows.length) return 0
        const sessionIds = rows.map(r => r.sessionId)
        const sessions = await prisma.classSession.findMany({
          where: { id: { in: sessionIds } },
          select: { studioId: true },
        })
        return new Set(sessions.map(s => s.studioId)).size
      }),
    ])

    return {
      brands,
      franchises,
      studios,
      members,
      bookings30d,
      revenueThisMonth: (revenue30d._sum ?? {}).totalCents ?? 0,
      activeStudios30d,
    }
  })

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/platform/health', { preHandler: requireRole('admin') }, async (_request, _reply) => {
    const startMs = Date.now()

    const [db, jobs, stripe, resend] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const),

      prisma.$queryRaw`SELECT 1 FROM pgboss.job LIMIT 1`.then(() => 'ok' as const),

      process.env.STRIPE_SECRET_KEY
        ? fetch('https://api.stripe.com/v1/account', {
            headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            signal: AbortSignal.timeout(5000),
          }).then(r => (r.ok || r.status === 401 ? 'ok' : 'degraded'))
        : Promise.resolve('unconfigured'),

      process.env.RESEND_API_KEY
        ? fetch('https://api.resend.com/domains', {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            signal: AbortSignal.timeout(5000),
          }).then(r => (r.ok || r.status === 403 ? 'ok' : 'degraded'))
        : Promise.resolve('unconfigured'),
    ])

    function resolve(result: PromiseSettledResult<string>): { status: string; error?: string } {
      if (result.status === 'fulfilled') return { status: result.value }
      return { status: 'error', error: String(result.reason?.message ?? result.reason) }
    }

    return {
      latencyMs: Date.now() - startMs,
      services: {
        api:      { status: 'ok' },
        database: resolve(db),
        jobs:     resolve(jobs),
        stripe:   resolve(stripe),
        resend:   resolve(resend),
      },
      timestamp: new Date().toISOString(),
    }
  })

  // ── Job queue stats ────────────────────────────────────────────────────────
  app.get('/platform/jobs', { preHandler: requireRole('admin') }, async () => {
    const [stats, failed] = await Promise.all([
      prisma.$queryRaw<{ name: string; state: string; count: number }[]>`
        SELECT name, state, count(*)::int AS count
        FROM pgboss.job
        WHERE createdon > now() - interval '7 days'
        GROUP BY name, state
        ORDER BY name, state
      `,
      prisma.$queryRaw<{ id: string; name: string; data: unknown; output: unknown; createdon: Date; completedon: Date | null; retrycount: number }[]>`
        SELECT id::text, name, data, output, createdon, completedon, retrycount
        FROM pgboss.job
        WHERE state = 'failed'
        ORDER BY COALESCE(completedon, createdon) DESC
        LIMIT 100
      `,
    ])
    return { stats, failed }
  })

  // ── Retry a failed job ────────────────────────────────────────────────────
  app.post('/platform/jobs/:id/retry', {
    preHandler: requireRole('admin'),
    schema: { params: z.object({ id: z.string() }) },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await prisma.$queryRaw<{ count: number }[]>`
      UPDATE pgboss.job
      SET state = 'created',
          startedon = NULL,
          completedon = NULL,
          output = NULL,
          retrylimit = GREATEST(retrylimit, retrycount + 1)
      WHERE id = ${id}::uuid AND state = 'failed'
      RETURNING id
    `
    if (!Array.isArray(result) || result.length === 0) return reply.notFound('Job not found or not in failed state')
    return { success: true }
  })

  // ── Purge a failed job ────────────────────────────────────────────────────
  app.delete('/platform/jobs/:id', {
    preHandler: requireRole('admin'),
    schema: { params: z.object({ id: z.string() }) },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.$queryRaw`
      DELETE FROM pgboss.job WHERE id = ${id}::uuid AND state = 'failed'
    `
    return { success: true }
  })

  // ── Platform audit log ─────────────────────────────────────────────────────
  app.get('/platform/audit', {
    preHandler: requireRole('admin'),
    schema: {
      querystring: z.object({
        cursor: z.string().optional(),
        take: z.coerce.number().min(1).max(200).default(50),
        action: z.string().optional(),
      }),
    },
  }, async (request) => {
    const { cursor, take, action } = request.query as { cursor?: string; take: number; action?: string }

    const items = await prisma.auditLog.findMany({
      where: {
        studioId: null,
        ...(action ? { action: { contains: action } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = items.length > take
    const result = hasMore ? items.slice(0, take) : items

    return { items: result, nextCursor: hasMore ? result[result.length - 1]?.id ?? null : null, hasMore }
  })
}
