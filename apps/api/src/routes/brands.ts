import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { getSupabaseAppMeta, setSupabaseAppMeta, getPrimaryRole, createSupabaseUser } from '../lib/supabase-admin.js'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Inferred Prisma include types for brand relations
type BrandWithStudios = Prisma.BrandGetPayload<{
  include: {
    studios: {
      include: { studio: { select: { id: true; name: true; slug: true; timezone: true; currency: true; primaryColor: true; logoUrl: true } } }
    }
  }
}>
type BrandStudioMembership = BrandWithStudios['studios'][number]

const CreateBrandBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  logoUrl: z.string().url().optional(),
  description: z.string().optional(),
})

const UpdateBrandBody = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  description: z.string().optional(),
})

/** Collect all studioIds under a brand by going through its franchises */
async function getStudioIdsForBrand(brandId: string): Promise<string[]> {
  const franchises = await prisma.franchiseStudio.findMany({
    where: { franchise: { brandId } },
    select: { studioId: true },
  })
  return franchises.map(f => f.studioId)
}

/** Verify the caller is admin, OR is a brand_admin for this brandId */
async function assertBrandAccess(brandId: string, userId: string, userRole: string, userBrandId?: string) {
  if (userRole === 'admin') return
  if (userRole === 'brand_admin' && userBrandId === brandId) return
  throw { statusCode: 403, message: 'Access denied to this brand' }
}

export async function brandRoutes(app: FastifyInstance) {
  // ── List all brands (admin only) ──────────────────────────────────────────
  app.get('/', { preHandler: requireRole('admin') }, async () => {
    const brands = await prisma.brand.findMany({
      include: {
        studios: {
          include: { studio: { select: { id: true, name: true, slug: true, timezone: true } } },
        },
      },
      orderBy: { name: 'asc' },
    })
    type ListBrand = Prisma.BrandGetPayload<{
      include: { studios: { include: { studio: { select: { id: true; name: true; slug: true; timezone: true } } } } }
    }>
    return { success: true, data: (brands as ListBrand[]).map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      logoUrl: b.logoUrl,
      description: b.description,
      createdAt: b.createdAt,
      studios: b.studios.map((bs: ListBrand['studios'][number]) => ({ ...bs.studio, joinedAt: bs.joinedAt })),
    }))}
  })

  // ── Get brand for the logged-in brand_admin ───────────────────────────────
  app.get('/my', { preHandler: requireAuth }, async (request, reply) => {
    const user = getUser(request)
    if (user.role !== 'brand_admin' && user.role !== 'admin') return reply.forbidden()
    const brandId = user.brandId
    if (!brandId) return reply.badRequest('No brandId in token')

    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        franchises: {
          include: {
            studios: {
              include: {
                studio: {
                  select: {
                    id: true, name: true, slug: true, timezone: true, currency: true,
                    primaryColor: true, logoUrl: true,
                    _count: { select: { members: true } },
                  },
                },
              },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    })
    if (!brand) return reply.notFound('Brand not found')

    // Look up franchise admins from auth.users (same DB) — one query for all franchises
    const franchiseIds = brand.franchises.map(f => f.id)
    type AuthAdminRow = { id: string; email: string; firstName: string; lastName: string; franchiseId: string }
    const adminRows: AuthAdminRow[] = franchiseIds.length > 0
      ? await prisma.$queryRaw`
          SELECT
            id::text,
            email,
            coalesce(raw_user_meta_data->>'firstName', raw_user_meta_data->>'first_name', split_part(email,'@',1)) AS "firstName",
            coalesce(raw_user_meta_data->>'lastName',  raw_user_meta_data->>'last_name',  '')                       AS "lastName",
            raw_app_meta_data->>'franchiseId' AS "franchiseId"
          FROM auth.users
          WHERE raw_app_meta_data->>'role' = 'franchise_admin'
            AND raw_app_meta_data->>'franchiseId' = ANY(${franchiseIds}::text[])
        `
      : []

    // Also pull names from Prisma User table (they may have been updated there)
    const adminUserIds = adminRows.map(r => r.id)
    const prismaUsers = adminUserIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: adminUserIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
      : []
    const prismaUserMap = new Map(prismaUsers.map(u => [u.id, u]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const franchises = brand.franchises.map((f: any) => {
      const admin = adminRows.find(r => r.franchiseId === f.id)
      const adminPrisma = admin ? prismaUserMap.get(admin.id) : null
      return {
        id: f.id,
        name: f.name,
        slug: f.slug,
        description: f.description,
        createdAt: f.createdAt,
        admin: admin ? {
          id: admin.id,
          email: adminPrisma?.email ?? admin.email,
          firstName: adminPrisma?.firstName ?? admin.firstName,
          lastName: adminPrisma?.lastName ?? admin.lastName,
        } : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        studios: f.studios.map((fs: any) => ({
          ...fs.studio,
          memberCount: fs.studio._count.members,
          joinedAt: fs.joinedAt,
        })),
      }
    })

    return { success: true, data: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoUrl,
      description: brand.description,
      franchises,
    }}
  })

  // ── Get single brand ──────────────────────────────────────────────────────
  app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const brand = await prisma.brand.findUnique({
      where: { id },
      include: {
        studios: {
          include: {
            studio: {
              select: {
                id: true, name: true, slug: true, timezone: true, currency: true,
                primaryColor: true, logoUrl: true,
                _count: { select: { members: true, classSessions: true } },
              },
            },
          },
        },
      },
    })
    if (!brand) return reply.notFound('Brand not found')

    return { success: true, data: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoUrl,
      description: brand.description,
      studios: brand.studios.map((bs: typeof brand.studios[number]) => ({
        ...bs.studio,
        memberCount: bs.studio._count.members,
        sessionCount: bs.studio._count.classSessions,
        joinedAt: bs.joinedAt,
      })),
    }}
  })

  // ── Create brand (admin only) ─────────────────────────────────────────────
  app.post('/', { preHandler: requireRole('admin') }, async (request, reply) => {
    const body = CreateBrandBody.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.message)

    const brand = await prisma.brand.create({ data: body.data })
    reply.code(201)
    return { success: true, data: brand }
  })

  // ── Update brand ──────────────────────────────────────────────────────────
  app.patch('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const body = UpdateBrandBody.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.message)

    const brand = await prisma.brand.update({ where: { id }, data: body.data })
    return { success: true, data: brand }
  })

  // ── Delete brand (admin only) ─────────────────────────────────────────────
  app.delete('/:id', { preHandler: requireRole('admin') }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.brand.delete({ where: { id } })
    return { success: true }
  })

  // ── Add studio to brand (admin only) ─────────────────────────────────────
  app.post('/:id/studios', { preHandler: requireRole('admin') }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { studioId } = request.body as { studioId: string }
    if (!studioId) return reply.badRequest('studioId required')

    const membership = await prisma.brandStudio.create({
      data: { brandId: id, studioId },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    })
    reply.code(201)
    return { success: true, data: membership }
  })

  // ── Remove studio from brand (admin only) ────────────────────────────────
  app.delete('/:id/studios/:studioId', { preHandler: requireRole('admin') }, async (request, reply) => {
    const { id, studioId } = request.params as { id: string; studioId: string }
    await prisma.brandStudio.deleteMany({ where: { brandId: id, studioId } })
    return { success: true }
  })

  // ── Create franchise under brand (brand_admin or admin) ─────────────────
  app.post('/:id/franchises', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const body = z.object({
      name: z.string().min(1),
      slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.message)

    const brand = await prisma.brand.findUnique({ where: { id }, select: { id: true } })
    if (!brand) return reply.notFound('Brand not found')

    const franchise = await prisma.franchise.create({
      data: { ...body.data, brandId: id },
    })
    reply.code(201)
    return { success: true, data: franchise }
  })

  // ── Promote user to franchise_admin under a brand franchise ──────────────
  app.post('/:id/franchise-admins', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const body = z.object({
      email: z.string().email(),
      franchiseId: z.string().min(1),
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.message)

    if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured')

    // Verify franchise belongs to this brand
    const franchise = await prisma.franchise.findFirst({
      where: { id: body.data.franchiseId, brandId: id },
      include: { studios: { select: { studioId: true } } },
    })
    if (!franchise) return reply.notFound('Franchise not found in this brand')

    const studioIds = franchise.studios.map(s => s.studioId)
    const newRoles = ['franchise_admin']
    const primaryRole = 'franchise_admin'
    const meta = { role: primaryRole, roles: newRoles, studioIds, franchiseId: body.data.franchiseId }

    let targetUser = await prisma.user.findUnique({ where: { email: body.data.email } })
    let created = false

    if (!targetUser) {
      // User signed up via Supabase Auth but never completed Packd onboarding —
      // query auth.users directly (same Postgres DB) to get their UUID.
      const authRows = await prisma.$queryRaw<{ id: string; email: string; raw_user_meta_data: Record<string, unknown> }[]>`
        SELECT id::text, email, raw_user_meta_data
        FROM auth.users
        WHERE lower(email) = lower(${body.data.email})
        LIMIT 1
      `
      const authUser = authRows[0] ?? null

      if (authUser) {
        // Auth account exists — create the missing Prisma User record so we can promote them
        const meta_data = (authUser.raw_user_meta_data ?? {}) as Record<string, unknown>
        const firstName = body.data.firstName
          || (meta_data.firstName as string | undefined)
          || (meta_data.first_name as string | undefined)
          || body.data.email.split('@')[0]
        const lastName = body.data.lastName
          || (meta_data.lastName as string | undefined)
          || (meta_data.last_name as string | undefined)
          || ''
        targetUser = await prisma.user.create({
          data: { id: authUser.id, email: body.data.email, firstName, lastName },
        })
      } else {
        // No Supabase auth account at all — create one from scratch
        if (!body.data.firstName || !body.data.lastName) {
          return reply.badRequest('No account found with that email. Provide first and last name to create a new account.')
        }
        const supaUser = await createSupabaseUser(body.data.email, meta)
        targetUser = await prisma.user.create({
          data: {
            id: supaUser.id,
            email: body.data.email,
            firstName: body.data.firstName,
            lastName: body.data.lastName,
          },
        })
        created = true
      }
    }

    if (!targetUser) {
      return reply.internalServerError('Could not resolve user account')
    }

    if (!created) {
      // Existing user — promote them
      const current = await getSupabaseAppMeta(targetUser.id)
      const existingRoles: string[] = current.roles ?? (current.role && current.role !== 'member' ? [current.role] : [])
      const merged = [...new Set([...existingRoles, 'franchise_admin'])]
      meta.roles = merged
      meta.role = getPrimaryRole(merged)
      await setSupabaseAppMeta(targetUser.id, meta)
    }

    // Upsert Member record
    const existingMember = await prisma.member.findUnique({ where: { userId: targetUser.id } })
    if (existingMember) {
      await prisma.member.update({
        where: { userId: targetUser.id },
        data: { staffRoles: meta.roles, studioIds },
      })
    } else {
      const primaryStudioId = studioIds[0]
      if (primaryStudioId) {
        await prisma.member.create({
          data: {
            userId: targetUser.id,
            studioId: primaryStudioId,
            staffRoles: meta.roles,
            studioIds,
            source: 'packd',
          },
        })
      }
    }

    return reply.code(created ? 201 : 200).send({
      success: true,
      created,
      roles: meta.roles,
      franchiseId: body.data.franchiseId,
      message: created
        ? `Account created for ${body.data.email}. They can log in using "Forgot Password" to set their password.`
        : `${body.data.email} has been promoted to franchise admin.`,
    })
  })

  // ── Cross-brand analytics: aggregate stats across all studios ────────────
  app.get('/:id/stats', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { period = '30d' } = request.query as { period?: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const exists = await prisma.brand.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return reply.notFound()

    const studioIds = await getStudioIdsForBrand(id)
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
    const since = new Date(Date.now() - days * 86400000)

    const [memberCount, bookingCount, sessionCount, revenueAgg] = await Promise.all([
      prisma.member.count({ where: { studioId: { in: studioIds } } }),
      prisma.booking.count({
        where: {
          status: 'CONFIRMED',
          session: { studioId: { in: studioIds } },
          bookedAt: { gte: since },
        },
      }),
      prisma.classSession.count({
        where: { studioId: { in: studioIds }, startsAt: { gte: since } },
      }),
      prisma.creditTransaction.aggregate({
        where: {
          type: 'PURCHASE',
          member: { studioId: { in: studioIds } },
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      }),
    ])

    // Per-studio breakdown
    const perStudio = await Promise.all(
      studioIds.map(async (studioId) => {
        const [members, bookings] = await Promise.all([
          prisma.member.count({ where: { studioId } }),
          prisma.booking.count({
            where: { status: 'CONFIRMED', session: { studioId }, bookedAt: { gte: since } },
          }),
        ])
        const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, name: true, slug: true } })
        return { ...studio, members, bookings }
      })
    )

    return {
      success: true,
      data: {
        period,
        totals: {
          members: memberCount,
          bookings: bookingCount,
          sessions: sessionCount,
          creditsIssued: revenueAgg._sum.amount ?? 0,
        },
        perStudio,
      },
    }
  })

  // ── Cross-brand member search ─────────────────────────────────────────────
  app.get('/:id/members', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { q = '', studioId: filterStudio, limit = '50' } = request.query as { q?: string; studioId?: string; limit?: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const exists = await prisma.brand.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return reply.notFound()

    const allStudioIds = await getStudioIdsForBrand(id)
    const studioIds = filterStudio ? [filterStudio] : allStudioIds

    const where = q ? {
      studioId: { in: studioIds },
      OR: [
        { user: { firstName: { contains: q, mode: 'insensitive' as const } } },
        { user: { lastName:  { contains: q, mode: 'insensitive' as const } } },
        { user: { email:     { contains: q, mode: 'insensitive' as const } } },
      ],
    } : { studioId: { in: studioIds } }

    const members = await prisma.member.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        studio: { select: { id: true, name: true } },
        creditBalance: { select: { balance: true } },
        _count: { select: { bookings: true } },
      },
      take: parseInt(limit),
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
    })

    return {
      success: true,
      data: members.map(m => ({
        id: m.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        studioId: m.studioId,
        studioName: m.studio.name,
        creditBalance: m.creditBalance?.balance ?? 0,
        bookingCount: m._count.bookings,
        createdAt: m.joinedAt,
      })),
    }
  })

  // ── Cross-brand upcoming sessions ─────────────────────────────────────────
  app.get('/:id/sessions', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { studioId: filterStudio, from, to } = request.query as { studioId?: string; from?: string; to?: string }
    const user = getUser(request)
    await assertBrandAccess(id, user.id, user.role, user.brandId).catch(e => { throw reply.code(e.statusCode).send({ error: e.message }) })

    const exists = await prisma.brand.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return reply.notFound()

    const allStudioIds = await getStudioIdsForBrand(id)
    const studioIds = filterStudio ? [filterStudio] : allStudioIds
    const fromDate = from ? new Date(from) : new Date()
    const toDate = to ? new Date(to) : new Date(Date.now() + 7 * 86400000)

    const sessions = await prisma.classSession.findMany({
      where: {
        studioId: { in: studioIds },
        startsAt: { gte: fromDate, lte: toDate },
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      include: {
        template: { select: { name: true, sport: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        studio: { select: { id: true, name: true } },
        _count: { select: { bookings: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
    })

    return {
      success: true,
      data: sessions.map(s => ({
        id: s.id,
        studioId: s.studioId,
        studioName: s.studio.name,
        name: s.template.name,
        sport: s.template.sport,
        instructorName: s.instructor ? `${s.instructor.user.firstName} ${s.instructor.user.lastName}` : 'TBC',
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        capacity: s.capacity,
        bookedCount: s._count.bookings,
        status: s.status,
      })),
    }
  })
}
