import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { prisma } from '@packd/db'
import { requireAuth, getUser } from '../lib/auth.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function stripeRoutes(app: FastifyInstance) {
  // POST /stripe/checkout — buy a credit pack or membership
  app.post<{ Body: { planId: string; studioId: string } }>(
    '/checkout',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { planId, studioId } = request.body
      const user = getUser(request)

      const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: planId } })

      const session = await stripe.checkout.sessions.create({
        mode: plan.intervalMonths > 0 ? 'subscription' : 'payment',
        line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
        success_url: `${process.env.WEB_URL}/booking?success=1`,
        cancel_url: `${process.env.WEB_URL}/plans`,
        metadata: { userId: user.id, planId, studioId },
      })

      return { url: session.url }
    },
  )

  // POST /stripe/webhook — handle Stripe events
  app.post('/webhook', async (request, reply) => {
    const sig = request.headers['stripe-signature'] as string
    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody as Buffer,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      )
    } catch {
      return reply.badRequest('Invalid signature')
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.CheckoutSession
      const { userId, planId, studioId } = session.metadata!

      const [plan, member] = await Promise.all([
        prisma.membershipPlan.findUniqueOrThrow({ where: { id: planId } }),
        prisma.member.findUniqueOrThrow({
          where: { userId },
          include: { creditBalance: true },
        }),
      ])

      await prisma.$transaction(async (tx) => {
        // Add credits if pack-based
        if (plan.creditsPerCycle) {
          await tx.creditBalance.upsert({
            where: { memberId: member.id },
            create: { memberId: member.id, balance: plan.creditsPerCycle },
            update: { balance: { increment: plan.creditsPerCycle } },
          })
          await tx.creditTransaction.create({
            data: {
              memberId: member.id,
              amount: plan.creditsPerCycle,
              type: 'PURCHASE',
              note: `Purchased: ${plan.name}`,
            },
          })
        }

        // Create subscription record
        await tx.membershipSubscription.create({
          data: {
            memberId: member.id,
            planId: plan.id,
            status: 'ACTIVE',
            startDate: new Date(),
            stripeSubId: session.subscription as string | undefined,
          },
        })
      })
    }

    return { received: true }
  })
}
