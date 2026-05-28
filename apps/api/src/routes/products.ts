import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, requireRole } from '../lib/auth.js'
import { syncStripePrice, archiveStripeProduct } from '../lib/stripe-sync.js'

export async function productRoutes(app: FastifyInstance) {
  // GET /products?studioId= — list products for a studio (all authenticated staff)
  app.get<{ Querystring: { studioId: string; all?: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studioId, all } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const products = await prisma.product.findMany({
        where: {
          studioId,
          ...(all === 'true' ? {} : { inStock: true }),
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      })
      return products
    },
  )

  // POST /products — create product (studio_admin+)
  app.post<{ Body: { studioId: string; name: string; category?: string; priceInCents: number; creditsRequired?: number; imageUrl?: string } }>(
    '/',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { studioId, name, category, priceInCents, creditsRequired, imageUrl } = request.body
      if (!studioId || !name || priceInCents == null) return reply.badRequest('studioId, name and priceInCents are required')

      // Auto-create Stripe product+price for cash products
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
          console.error('Stripe sync failed (product create):', e)
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

  // PATCH /products/:id — update product (studio_admin+)
  app.patch<{
    Params: { id: string }
    Body: { name?: string; category?: string; priceInCents?: number; creditsRequired?: number; imageUrl?: string | null; inStock?: boolean }
  }>(
    '/:id',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { name, category, priceInCents, creditsRequired, imageUrl, inStock } = request.body
      const existing = await prisma.product.findUnique({ where: { id: request.params.id } })
      if (!existing) return reply.notFound()

      // Re-sync Stripe if name or price changed
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
          console.error('Stripe sync failed (product update):', e)
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

  // DELETE /products/:id — delete product (studio_admin+)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const existing = await prisma.product.findUnique({ where: { id: request.params.id } })
      if (!existing) return reply.notFound()
      await prisma.product.delete({ where: { id: request.params.id } })
      if (existing.stripeProductId) {
        archiveStripeProduct(existing.stripeProductId).catch(e => console.error('Stripe archive failed:', e))
      }
      return { success: true }
    },
  )
}
