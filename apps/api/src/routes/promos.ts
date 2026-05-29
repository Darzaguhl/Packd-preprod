import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'

const requireStudioAdmin = requireRole('studio_admin')

const VALID_TYPES = ['CREDIT_GRANT', 'FREE_CLASS', 'MEMBERSHIP_PCT', 'MEMBERSHIP_FLAT'] as const
type PromoType = typeof VALID_TYPES[number]

export async function promoRoutes(app: FastifyInstance) {

  // GET /promos?studioId= — list all promo codes for a studio (studio_admin+)
  app.get<{ Querystring: { studioId: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const codes = await prisma.promoCode.findMany({
        where: { studioId },
        include: { _count: { select: { redemptions: true } } },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(codes.map(c => ({
        id: c.id,
        code: c.code,
        description: c.description,
        type: c.type,
        value: c.value,
        maxUses: c.maxUses,
        usageCount: c.usageCount,
        validFrom: c.validFrom.toISOString(),
        validUntil: c.validUntil?.toISOString() ?? null,
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
      })))
    },
  )

  // POST /promos — create a promo code (studio_admin+)
  app.post<{
    Body: {
      studioId: string
      code: string
      description?: string
      type: PromoType
      value: number
      maxUses?: number | null
      validFrom?: string
      validUntil?: string | null
    }
  }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, code, description, type, value, maxUses, validFrom, validUntil } = request.body

      if (!studioId || !code || !type) return reply.badRequest('studioId, code and type are required')
      if (!VALID_TYPES.includes(type)) return reply.badRequest(`type must be one of: ${VALID_TYPES.join(', ')}`)
      if (typeof value !== 'number') return reply.badRequest('value must be a number')
      if (code.trim().length < 3) return reply.badRequest('code must be at least 3 characters')

      const upperCode = code.trim().toUpperCase()

      try {
        const promo = await prisma.promoCode.create({
          data: {
            studioId,
            code: upperCode,
            description: description?.trim() ?? null,
            type,
            value,
            maxUses: maxUses ?? null,
            validFrom: validFrom ? new Date(validFrom) : new Date(),
            validUntil: validUntil ? new Date(validUntil) : null,
            isActive: true,
          },
        })

        return reply.code(201).send({
          id: promo.id,
          code: promo.code,
          type: promo.type,
          value: promo.value,
          maxUses: promo.maxUses,
          usageCount: promo.usageCount,
          validFrom: promo.validFrom.toISOString(),
          validUntil: promo.validUntil?.toISOString() ?? null,
          isActive: promo.isActive,
          createdAt: promo.createdAt.toISOString(),
        })
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002') {
          return reply.conflict('A promo code with this code already exists for this studio')
        }
        throw e
      }
    },
  )

  // PATCH /promos/:id — update or disable (studio_admin+)
  app.patch<{
    Params: { id: string }
    Body: {
      description?: string
      value?: number
      maxUses?: number | null
      validFrom?: string
      validUntil?: string | null
      isActive?: boolean
    }
  }>(
    '/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { id } = request.params
      const { description, value, maxUses, validFrom, validUntil, isActive } = request.body

      const promo = await prisma.promoCode.findUnique({ where: { id } })
      if (!promo) return reply.notFound()

      const updated = await prisma.promoCode.update({
        where: { id },
        data: {
          ...(description !== undefined && { description: description?.trim() ?? null }),
          ...(value       !== undefined && { value }),
          ...(maxUses     !== undefined && { maxUses }),
          ...(validFrom   !== undefined && { validFrom: new Date(validFrom) }),
          ...(validUntil  !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
          ...(isActive    !== undefined && { isActive }),
        },
      })

      return reply.send({
        id: updated.id,
        code: updated.code,
        type: updated.type,
        value: updated.value,
        maxUses: updated.maxUses,
        usageCount: updated.usageCount,
        isActive: updated.isActive,
        validFrom: updated.validFrom.toISOString(),
        validUntil: updated.validUntil?.toISOString() ?? null,
      })
    },
  )

  // DELETE /promos/:id (studio_admin+)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const promo = await prisma.promoCode.findUnique({ where: { id: request.params.id } })
      if (!promo) return reply.notFound()
      await prisma.promoCode.delete({ where: { id: request.params.id } })
      return reply.send({ success: true })
    },
  )

  // POST /promos/redeem — member or fronthost redeems a code
  // Body: { code, studioId }
  app.post<{ Body: { code: string; studioId: string; memberId?: string } }>(
    '/redeem',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { code, studioId, memberId: bodyMemberId } = request.body
      const user = getUser(request)

      if (!code || !studioId) return reply.badRequest('code and studioId are required')

      // Resolve the member being redeemed for
      let member = await prisma.member.findFirst({
        where: bodyMemberId
          ? { id: bodyMemberId, studioId }
          : { userId: user.id, studioId },
        include: { creditBalance: true },
      })
      if (!member) return reply.notFound('Member not found')

      const upperCode = code.trim().toUpperCase()

      const promo = await prisma.promoCode.findUnique({
        where: { studioId_code: { studioId, code: upperCode } },
      })

      if (!promo || !promo.isActive) {
        return reply.status(422).send({ error: 'Invalid or expired promo code' })
      }

      const now = new Date()
      if (promo.validFrom > now) {
        return reply.status(422).send({ error: 'This promo code is not active yet' })
      }
      if (promo.validUntil && promo.validUntil < now) {
        return reply.status(422).send({ error: 'This promo code has expired' })
      }
      if (promo.maxUses !== null && promo.usageCount >= promo.maxUses) {
        return reply.status(422).send({ error: 'This promo code has reached its usage limit' })
      }

      // Check if already redeemed by this member
      const existing = await prisma.promoCodeRedemption.findUnique({
        where: { promoCodeId_memberId: { promoCodeId: promo.id, memberId: member.id } },
      })
      if (existing) {
        return reply.status(422).send({ error: 'You have already redeemed this code' })
      }

      let creditsAdded = 0
      let discount: { type: string; value: number; promoCodeId: string } | null = null

      if (promo.type === 'MEMBERSHIP_PCT' || promo.type === 'MEMBERSHIP_FLAT') {
        // Write a provisional redemption immediately to prevent the member from using
        // the same discount code in multiple concurrent Stripe checkout sessions.
        // The webhook's own redemption write (stripe.ts) has an !alreadyRedeemed guard
        // so it will safely skip if this record already exists.
        await prisma.$transaction(async (tx) => {
          await tx.promoCodeRedemption.create({
            data: { promoCodeId: promo.id, memberId: member!.id },
          })
          await tx.promoCode.update({
            where: { id: promo.id },
            data: { usageCount: { increment: 1 } },
          })
        })
        discount = { type: promo.type, value: promo.value, promoCodeId: promo.id }
      } else {
        // CREDIT_GRANT / FREE_CLASS — consume immediately
        await prisma.$transaction(async (tx) => {
          await tx.promoCodeRedemption.create({
            data: { promoCodeId: promo.id, memberId: member!.id },
          })
          await tx.promoCode.update({
            where: { id: promo.id },
            data: { usageCount: { increment: 1 } },
          })

          const credits = promo.type === 'FREE_CLASS' ? 1 : promo.value
          await tx.creditBalance.upsert({
            where: { memberId: member!.id },
            create: { memberId: member!.id, balance: credits },
            update: { balance: { increment: credits } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId: member!.id,
              amount: credits,
              type: 'PURCHASE',
              note: `Promo: ${promo.code}`,
            },
          })
          creditsAdded = credits
        })
      }

      const message = creditsAdded > 0
        ? `${creditsAdded} credit${creditsAdded !== 1 ? 's' : ''} added to your balance`
        : `Discount applied: ${promo.type === 'MEMBERSHIP_PCT' ? `${promo.value}% off` : `${(promo.value / 100).toFixed(2)} off`} your next membership`

      return reply.send({ success: true, type: promo.type, creditsAdded, discount, message })
    },
  )
}
