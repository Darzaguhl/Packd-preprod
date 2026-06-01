import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { Id, StudioIdParam } from '../schemas.js'
import { RoomSummarySchema, StudioDetailSchema } from '../schemas/responses.js'

const requireFranchiseAdmin = requireRole('franchise_admin')
const requireStudioAdmin = requireRole('studio_admin')

export async function studioRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: requireFranchiseAdmin },
    async (_request, reply) => {
      const studios = await prisma.studio.findMany({
        include: {
          locations: { include: { rooms: true } },
          _count: { select: { members: true, instructors: true } },
        },
        orderBy: { name: 'asc' },
      })
      return reply.send(studios)
    },
  )

  app.post<{
    Body: {
      name: string
      slug: string
      timezone: string
      currency: string
      location: { name: string; address: string; city: string; country: string }
    }
  }>(
    '/',
    { preHandler: requireFranchiseAdmin },
    async (request, reply) => {
      const { name, slug, timezone, currency, location } = request.body
      if (!name || !slug || !timezone || !currency || !location?.city) {
        return reply.badRequest('name, slug, timezone, currency and location are required')
      }
      const existing = await prisma.studio.findUnique({ where: { slug } })
      if (existing) return reply.conflict('A studio with that slug already exists')

      const creator = getUser(request)
      const studio = await prisma.$transaction(async (tx) => {
        const s = await tx.studio.create({
          data: { name, slug, timezone, currency, cancellationPolicy: { create: {} } },
        })
        await tx.location.create({
          data: {
            studioId: s.id,
            name: location.name,
            address: location.address,
            city: location.city,
            country: location.country,
            timezone,
          },
        })
        if (creator.franchiseId) {
          await tx.franchiseStudio.create({
            data: { franchiseId: creator.franchiseId, studioId: s.id },
          }).catch(() => {})
        }
        return s
      })

      return reply.code(201).send({ success: true, data: { id: studio.id, name: studio.name, slug: studio.slug } })
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' }, schema: { response: { 200: StudioDetailSchema } } },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const studio = await prisma.studio.findUnique({
        where: { id: studioId },
        include: { locations: true },
      })
      if (!studio) return reply.notFound()
      return reply.send(studio)
    },
  )

  app.patch<{
    Params: { studioId: string }
    Body: {
      name?: string
      slug?: string
      timezone?: string
      currency?: string
      timeFormat?: string
      websiteUrl?: string | null
      supportEmail?: string | null
      bookingWindowDays?: number
      bookingCloseHours?: number
      waitlistEnabled?: boolean
      guestCheckInEnabled?: boolean
      creditPurchaseEnabled?: boolean
      selfCheckInEnabled?: boolean
      classReminderHours?: number | null
      maxPauseDays?: number
      maxPausesPerYear?: number
      allowMemberPause?: boolean
      taxRatePct?: number
      referralRewardCredits?: number
      location?: { id: string; name?: string; address?: string; city?: string; country?: string }
    }
  }>(
    '/:studioId',
    {
      preHandler: requireStudioAdmin,
      config: { studioIdFrom: 'params' },
      schema: {
        params: StudioIdParam,
        body: z.object({
          name: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
          timezone: z.string().min(1).optional(),
          currency: z.string().min(1).optional(),
          timeFormat: z.string().min(1).optional(),
          websiteUrl: z.string().url().nullable().optional(),
          supportEmail: z.string().email().nullable().optional(),
          bookingWindowDays: z.number().int().min(1).optional(),
          bookingCloseHours: z.number().int().min(0).optional(),
          waitlistEnabled: z.boolean().optional(),
          guestCheckInEnabled: z.boolean().optional(),
          creditPurchaseEnabled: z.boolean().optional(),
          selfCheckInEnabled: z.boolean().optional(),
          classReminderHours: z.number().int().min(0).nullable().optional(),
          maxPauseDays: z.number().int().min(0).optional(),
          maxPausesPerYear: z.number().int().min(0).optional(),
          allowMemberPause: z.boolean().optional(),
          taxRatePct: z.number().min(0).max(100).optional(),
          referralRewardCredits: z.number().int().min(0).optional(),
          location: z.object({
            id: Id,
            name: z.string().min(1).optional(),
            address: z.string().min(1).optional(),
            city: z.string().min(1).optional(),
            country: z.string().min(1).optional(),
          }).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { studioId } = request.params
      const {
        name, slug, timezone, currency, timeFormat,
        websiteUrl, supportEmail,
        bookingWindowDays, bookingCloseHours,
        waitlistEnabled, guestCheckInEnabled, creditPurchaseEnabled,
        selfCheckInEnabled, classReminderHours, maxPauseDays, maxPausesPerYear,
        allowMemberPause, taxRatePct, referralRewardCredits,
        location,
      } = request.body
      const user = getUser(request)

      if (slug) {
        const conflict = await prisma.studio.findFirst({ where: { slug, id: { not: studioId } } })
        if (conflict) return reply.conflict('Slug already taken by another studio')
      }

      const studio = await prisma.studio.update({
        where: { id: studioId },
        data: {
          ...(name && { name }),
          ...(slug && { slug }),
          ...(timezone && { timezone }),
          ...(currency && { currency }),
          ...(timeFormat && { timeFormat }),
          ...(websiteUrl !== undefined && { websiteUrl }),
          ...(supportEmail !== undefined && { supportEmail }),
          ...(bookingWindowDays !== undefined && { bookingWindowDays }),
          ...(bookingCloseHours !== undefined && { bookingCloseHours }),
          ...(waitlistEnabled !== undefined && { waitlistEnabled }),
          ...(guestCheckInEnabled !== undefined && { guestCheckInEnabled }),
          ...(creditPurchaseEnabled !== undefined && { creditPurchaseEnabled }),
          ...(selfCheckInEnabled !== undefined && { selfCheckInEnabled }),
          ...(classReminderHours !== undefined && { classReminderHours }),
          ...(maxPauseDays !== undefined && { maxPauseDays }),
          ...(maxPausesPerYear !== undefined && { maxPausesPerYear }),
          ...(allowMemberPause !== undefined && { allowMemberPause }),
          ...(taxRatePct !== undefined && { taxRatePct }),
          ...(referralRewardCredits !== undefined && { referralRewardCredits }),
        },
        include: { locations: true },
      })

      if (location?.id) {
        const { id, ...locFields } = location
        const filteredFields = Object.fromEntries(Object.entries(locFields).filter(([, v]) => v !== undefined))
        if (Object.keys(filteredFields).length > 0) {
          await prisma.location.update({ where: { id }, data: filteredFields })
        }
      }

      return reply.send({ success: true, studio })
    },
  )

  app.delete<{ Params: { studioId: string } }>(
    '/:studioId',
    { preHandler: requireFranchiseAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const studio = await prisma.studio.findUnique({ where: { id: studioId } })
      if (!studio) return reply.notFound('Studio not found')
      await prisma.studio.delete({ where: { id: studioId } })
      return reply.send({ success: true })
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId/policy',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const policy = await prisma.cancellationPolicy.findUnique({ where: { studioId } })
      return reply.send({
        lateCancelWindowHours:  policy?.lateCancelWindowHours  ?? 12,
        lateCancelFeeCredits:   policy?.lateCancelFeeCredits   ?? 1,
        noShowFeeCredits:       policy?.noShowFeeCredits        ?? 1,
        waitlistWindowMinutes:  policy?.waitlistWindowMinutes  ?? 15,
      })
    },
  )

  app.patch<{
    Params: { studioId: string }
    Body: {
      lateCancelWindowHours?: number
      lateCancelFeeCredits?: number
      noShowFeeCredits?: number
      waitlistWindowMinutes?: number
    }
  }>(
    '/:studioId/policy',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const { lateCancelWindowHours, lateCancelFeeCredits, noShowFeeCredits, waitlistWindowMinutes } = request.body

      const numFields = { lateCancelWindowHours, lateCancelFeeCredits, noShowFeeCredits, waitlistWindowMinutes }
      for (const [key, val] of Object.entries(numFields)) {
        if (val !== undefined && (!Number.isInteger(val) || val < 0)) {
          return reply.badRequest(`${key} must be a non-negative integer`)
        }
      }

      const policy = await prisma.cancellationPolicy.upsert({
        where: { studioId },
        create: {
          studioId,
          lateCancelWindowHours:  lateCancelWindowHours  ?? 12,
          lateCancelFeeCredits:   lateCancelFeeCredits   ?? 1,
          noShowFeeCredits:       noShowFeeCredits        ?? 1,
          waitlistWindowMinutes:  waitlistWindowMinutes  ?? 15,
        },
        update: {
          ...(lateCancelWindowHours  !== undefined && { lateCancelWindowHours }),
          ...(lateCancelFeeCredits   !== undefined && { lateCancelFeeCredits }),
          ...(noShowFeeCredits        !== undefined && { noShowFeeCredits }),
          ...(waitlistWindowMinutes  !== undefined && { waitlistWindowMinutes }),
        },
      })

      return reply.send({
        lateCancelWindowHours:  policy.lateCancelWindowHours,
        lateCancelFeeCredits:   policy.lateCancelFeeCredits,
        noShowFeeCredits:       policy.noShowFeeCredits,
        waitlistWindowMinutes:  policy.waitlistWindowMinutes,
      })
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId/rooms',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' }, schema: { response: { 200: z.array(RoomSummarySchema) } } },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const locations = await prisma.location.findMany({
        where: { studioId },
        include: {
          rooms: {
            include: {
              layouts: { where: { isActive: true }, select: { id: true, name: true, widthM: true, lengthM: true, _count: { select: { stations: true } } } },
            },
          },
        },
      })

      const rooms = locations.flatMap(loc =>
        loc.rooms.map(r => ({
          id: r.id,
          name: r.name,
          capacity: r.capacity,
          locationId: r.locationId,
          locationName: loc.name,
          activeLayout: r.layouts[0] ?? null,
        }))
      )

      return reply.send(rooms)
    },
  )

  app.post<{
    Params: { studioId: string }
    Body: { name: string; capacity: number; locationId?: string }
  }>(
    '/:studioId/rooms',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const { studioId } = request.params
      const { name, capacity, locationId } = request.body
      const user = getUser(request)

      if (!name || !capacity || capacity < 1) {
        return reply.badRequest('name and capacity (>=1) are required')
      }

      let locId = locationId
      if (!locId) {
        const loc = await prisma.location.findFirst({ where: { studioId } })
        if (!loc) return reply.badRequest('Studio has no locations -- create a location first')
        locId = loc.id
      }

      const room = await prisma.room.create({
        data: { locationId: locId, name, capacity },
      })

      return reply.code(201).send({ id: room.id, name: room.name, capacity: room.capacity, locationId: room.locationId })
    },
  )

  app.delete<{ Params: { studioId: string; roomId: string } }>(
    '/:studioId/rooms/:roomId',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const { studioId, roomId } = request.params
      const user = getUser(request)

      const room = await prisma.room.findFirst({
        where: { id: roomId, location: { studioId } },
      })
      if (!room) return reply.notFound('Room not found')

      const futureSession = await prisma.classSession.findFirst({
        where: { roomId, startsAt: { gte: new Date() }, status: { not: 'CANCELLED' } },
      })
      if (futureSession) {
        return reply.code(409).send({ error: 'Room has upcoming classes -- reassign them before deleting' })
      }

      await prisma.room.delete({ where: { id: roomId } })
      return reply.send({ success: true })
    },
  )

  app.get<{ Params: { slug: string } }>(
    '/by-slug/:slug',
    { preHandler: requireAuth },
    async (request, reply) => {
      const studio = await prisma.studio.findUnique({
        where: { slug: request.params.slug },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          timezone: true,
          currency: true,
          bookingWindowDays: true,
          locations: {
            select: {
              id: true,
              name: true,
              address: true,
              city: true,
              country: true,
              timezone: true,
            },
          },
          cancellationPolicy: {
            select: {
              lateCancelWindowHours: true,
              lateCancelFeeCredits: true,
              noShowFeeCredits: true,
              waitlistWindowMinutes: true,
            },
          },
        },
      })
      if (!studio) return reply.notFound()
      return studio
    },
  )

  app.post<{
    Body: {
      name: string
      slug: string
      timezone: string
      currency: string
      policy: { lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number }
      location: { name: string; address: string; city: string; country: string }
      rooms: { name: string; capacity: number; sport: string }[]
    }
  }>(
    '/onboard',
    { preHandler: requireFranchiseAdmin },
    async (request, reply) => {
      const { name, slug, timezone, currency, policy, location, rooms } = request.body

      const studio = await prisma.$transaction(async (tx) => {
        const s = await tx.studio.create({
          data: { name, slug, timezone, currency, cancellationPolicy: { create: policy } },
        })
        const loc = await tx.location.create({
          data: { studioId: s.id, name: location.name, address: location.address, city: location.city, country: location.country, timezone },
        })
        await Promise.all(
          rooms.map(room => tx.room.create({ data: { locationId: loc.id, name: room.name, capacity: room.capacity } }))
        )
        return s
      })

      return reply.code(201).send({ success: true, data: { id: studio.id } })
    },
  )

  app.post<{
    Params: { studioId: string; sourceStudioId: string }
    Body: { copy: ('plans' | 'products' | 'templates' | 'policy')[] }
  }>(
    '/:studioId/copy-from/:sourceStudioId',
    {
      preHandler: requireFranchiseAdmin,
      schema: {
        params: z.object({ studioId: Id, sourceStudioId: Id }),
        body: z.object({
          copy: z.array(z.enum(['plans', 'products', 'templates', 'policy'])).default([]),
        }),
      },
    },
    async (request, reply) => {
      const { studioId, sourceStudioId } = request.params
      const { copy = [] } = request.body

      if (studioId === sourceStudioId) return reply.badRequest('Source and destination must differ')
      if (!copy.length) return reply.send({ success: true, copied: [] })

      const [dest, source] = await Promise.all([
        prisma.studio.findUnique({ where: { id: studioId } }),
        prisma.studio.findUnique({ where: { id: sourceStudioId } }),
      ])
      if (!dest) return reply.notFound('Destination studio not found')
      if (!source) return reply.notFound('Source studio not found')

      const copied: string[] = []

      await prisma.$transaction(async (tx) => {
        if (copy.includes('policy')) {
          const pol = await tx.cancellationPolicy.findUnique({ where: { studioId: sourceStudioId } })
          if (pol) {
            await tx.cancellationPolicy.upsert({
              where: { studioId },
              update: { lateCancelWindowHours: pol.lateCancelWindowHours, lateCancelFeeCredits: pol.lateCancelFeeCredits, noShowFeeCredits: pol.noShowFeeCredits, waitlistWindowMinutes: pol.waitlistWindowMinutes },
              create: { studioId, lateCancelWindowHours: pol.lateCancelWindowHours, lateCancelFeeCredits: pol.lateCancelFeeCredits, noShowFeeCredits: pol.noShowFeeCredits, waitlistWindowMinutes: pol.waitlistWindowMinutes },
            })
            copied.push('policy')
          }
        }

        if (copy.includes('plans')) {
          const plans = await tx.membershipPlan.findMany({ where: { studioId: sourceStudioId } })
          await Promise.all(plans.map(p => tx.membershipPlan.create({
            data: { studioId, name: p.name, description: p.description, priceInCents: p.priceInCents, intervalMonths: p.intervalMonths, creditsPerCycle: p.creditsPerCycle, guestPassesPerCycle: p.guestPassesPerCycle, creditExpiryDays: p.creditExpiryDays, isIntroOffer: p.isIntroOffer, maxRedemptionsPerMember: p.maxRedemptionsPerMember },
          })))
          if (plans.length) copied.push('plans')
        }

        if (copy.includes('products')) {
          const products = await tx.product.findMany({ where: { studioId: sourceStudioId } })
          await Promise.all(products.map(p => tx.product.create({
            data: { studioId, name: p.name, category: p.category, priceInCents: p.priceInCents, creditsRequired: p.creditsRequired, inStock: p.inStock },
          })))
          if (products.length) copied.push('products')
        }

        if (copy.includes('templates')) {
          const templates = await tx.classTemplate.findMany({ where: { studioId: sourceStudioId } })
          await Promise.all(templates.map(t => tx.classTemplate.create({
            data: { studioId, name: t.name, description: t.description, durationMin: t.durationMin, sport: t.sport, color: t.color, isPrivate: t.isPrivate, defaultCapacity: t.defaultCapacity, defaultCreditsRequired: t.defaultCreditsRequired, defaultIntervalWeeks: t.defaultIntervalWeeks },
          })))
          if (templates.length) copied.push('templates')
        }
      })

      return reply.send({ success: true, copied })
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId/layouts',
    { preHandler: requireRole('instructor'), config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const rooms = await prisma.room.findMany({
        where: { location: { studioId } },
        include: {
          layouts: {
            where: { isActive: true },
            include: { stations: true },
            take: 1,
          },
        },
      })
      const layouts = rooms
        .filter(r => r.layouts.length > 0)
        .map(r => ({
          ...r.layouts[0],
          roomName: r.name,
        }))
      return reply.send(layouts)
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId/membership-plans',
    { preHandler: requireAuth, schema: { params: StudioIdParam } },
    async (request, reply) => {
      const plans = await prisma.membershipPlan.findMany({
        where: { studioId: request.params.studioId },
        select: { id: true, studioId: true, name: true, description: true, priceInCents: true, intervalMonths: true, creditsPerCycle: true },
      })
      return plans
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/:studioId/ai',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const user = getUser(request)
      const studio = await prisma.studio.findUnique({
        where: { id: request.params.studioId },
        select: { aiEnabled: true, anthropicApiKey: true },
      })
      if (!studio) return reply.notFound()
      return {
        aiEnabled: studio.aiEnabled,
        hasKey: !!studio.anthropicApiKey,
        keySuffix: studio.anthropicApiKey ? `...${studio.anthropicApiKey.slice(-4)}` : null,
      }
    },
  )

  app.patch<{
    Params: { studioId: string }
    Body: { aiEnabled?: boolean; anthropicApiKey?: string | null }
  }>(
    '/:studioId/ai',
    { preHandler: requireStudioAdmin, config: { studioIdFrom: 'params' } },
    async (request, reply) => {
      const user = getUser(request)
      const { aiEnabled, anthropicApiKey } = request.body
      const studio = await prisma.studio.update({
        where: { id: request.params.studioId },
        data: {
          ...(aiEnabled !== undefined && { aiEnabled }),
          ...(anthropicApiKey !== undefined && { anthropicApiKey: anthropicApiKey || null }),
        },
        select: { aiEnabled: true, anthropicApiKey: true },
      })
      return {
        aiEnabled: studio.aiEnabled,
        hasKey: !!studio.anthropicApiKey,
        keySuffix: studio.anthropicApiKey ? `...${studio.anthropicApiKey.slice(-4)}` : null,
      }
    },
  )
}
