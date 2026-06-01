import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { syncStripePrice, archiveStripeProduct } from '../lib/stripe-sync.js'
import { logger } from '../lib/logger.js'
import { Id, NonNegativeInt, StudioIdQuery } from '../schemas.js'

function ownsStudio(user: ReturnType<typeof getUser>, studioId: string): boolean {
  return ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin'] ||
    (user.studioIds?.includes(studioId) ?? false)
}

export async function productRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { studioId: string; all?: string } }>(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        querystring: StudioIdQuery.extend({ all: z.string().optional() }),
      },
    },
    async (request, reply) => {
      const { studioId, all } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      const isStudioAdmin = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['studio_admin']

      const products = await prisma.product.findMany({
        where: {
          studioId,
          ...(all === 'true' ? {} : { inStock: true }),
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      })

      if (!isStudioAdmin) {
        return products.map(({ stripeProductId: _sp, stripePriceId: _spr, ...rest }) => rest)
      }

      return products
    },
  )

  app.post<{ Body: { studioId: string; name: string; category?: string; priceInCents: number; creditsRequired?: number; imageUrl?: string } }>(
    '/',
    {
      preHandler: requireRole('studio_admin'),
      schema: {
        body: z.object({
          studioId: Id,
          name: z.string().min(1),
          category: z.string().min(1).optional(),
          priceInCents: NonNegativeInt,
          creditsRequired: NonNegativeInt.optional(),
          imageUrl: z.string().url().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, name, category, priceInCents, creditsRequired, imageUrl } = request.body
      if (!studioId || !name || priceInCents == null) return reply.badRequest('studioId, name and priceInCents are required')

      let stripeProductId: string | undefined
      let stripePriceId: string | undefined
      if (priceInCents > 0) {
        try {
          const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { currency: true } })
          const synced = await syncStripePrice({
            name: name.trim(),
            priceInCents,
            currency: studio?.currency ?? 'usd',
          })
          stripeProductId = synced.stripeProductId
          stripePriceId = synced.stripePriceId
        } catch (e) {
          logger.error({ err: e }, 'Stripe sync failed (product create)')
        }
      }

      const product = await prisma.product.create({
        data: {
          studioId,
          name: name.trim(),
          category: category?.trim() ?? 'Other',
          priceInCents,
          creditsRequired: creditsRequired ?? 0,
          imageUrl: imageUrl ?? null,
          stripeProductId,
          stripePriceId,
        },
      })
      return reply.code(201).send(product)
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { name?: string; category?: string; priceInCents?: number; creditsRequired?: number; imageUrl?: string | null; inStock?: boolean }
  }>(
    '/:id',
    {
      preHandler: requireRole('studio_admin'),
      schema: {
        params: z.object({ id: Id }),
        body: z.object({
          name: z.string().min(1).optional(),
          category: z.string().min(1).optional(),
          priceInCents: NonNegativeInt.optional(),
          creditsRequired: NonNegativeInt.optional(),
          imageUrl: z.string().url().nullable().optional(),
          inStock: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { name, category, priceInCents, creditsRequired, imageUrl, inStock } = request.body
      const existing = await prisma.product.findUnique({ where: { id: request.params.id } })
      if (!existing) return reply.notFound()
      if (!ownsStudio(getUser(request), existing.studioId)) return reply.forbidden()

      let stripeProductId = existing.stripeProductId ?? undefined
      let stripePriceId = existing.stripePriceId ?? undefined
      const newPrice = priceInCents ?? existing.priceInCents
      if (newPrice > 0 && (name !== undefined || priceInCents !== undefined)) {
        try {
          const studio = await prisma.studio.findUnique({ where: { id: existing.studioId }, select: { currency: true } })
          const synced = await syncStripePrice({
            stripeProductId: existing.stripeProductId,
            stripePriceId: existing.stripePriceId,
            name: name?.trim() ?? existing.name,
            priceInCents: newPrice,
            currency: studio?.currency ?? 'usd',
          })
          stripeProductId = synced.stripeProductId
          stripePriceId = synced.stripePriceId
        } catch (e) {
          logger.error({ err: e }, 'Stripe sync failed (product update)')
        }
      }

      const product = await prisma.product.update({
        where: { id: request.params.id },
        data: {
          ...(name != null && { name: name.trim() }),
          ...(category != null && { category: category.trim() }),
          ...(priceInCents != null && { priceInCents }),
          ...(creditsRequired != null && { creditsRequired }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(inStock != null && { inStock }),
          stripeProductId,
          stripePriceId,
        },
      })
      return product
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('studio_admin'), schema: { params: z.object({ id: Id }) } },
    async (request, reply) => {
      const existing = await prisma.product.findUnique({ where: { id: request.params.id } })
      if (!existing) return reply.notFound()
      if (!ownsStudio(getUser(request), existing.studioId)) return reply.forbidden()
      await prisma.product.delete({ where: { id: request.params.id } })
      if (existing.stripeProductId) {
        archiveStripeProduct(existing.stripeProductId).catch(e => logger.error({ err: e }, 'Stripe archive failed'))
      }
      return { success: true }
    },
  )
}
