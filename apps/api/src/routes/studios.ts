import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'
import { assertStudioAccess } from './admin-shared.js'

const requireFranchiseAdmin = requireRole('franchise_admin')
const requireStudioAdmin = requireRole('studio_admin')

export async function studioRoutes(app: FastifyInstance) {
  // GET /studios — list all studios (franchise_admin+)
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

  // POST /studios — create studio (franchise_admin+)
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
        // Auto-link to franchise if the creating user has franchiseId in their JWT
        if (creator.franchiseId) {
          await tx.franchiseStudio.create({
            data: { franchiseId: creator.franchiseId, studioId: s.id },
          }).catch(() => {}) // ignore if already linked
        }
        return s
      })

      return reply.code(201).send({ success: true, data: { id: studio.id, name: studio.name, slug: studio.slug } })
    },
  )

  // GET /studios/:studioId — single studio with locations (studio_admin+)
  app.get<{ Params: { studioId: string } }>(
    '/:studioId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const studio = await prisma.studio.findUnique({
        where: { id: studioId },
        include: { locations: true },
      })
      if (!studio) return reply.notFound()
      return reply.send(studio)
    },
  )

  // PATCH /studios/:studioId — update studio details (studio_admin+)
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
      location?: { id: string; name?: string; address?: string; city?: string; country?: string }
    }
  }>(
    '/:studioId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const {
        name, slug, timezone, currency, timeFormat,
        websiteUrl, supportEmail,
        bookingWindowDays, bookingCloseHours,
        waitlistEnabled, guestCheckInEnabled, creditPurchaseEnabled,
        selfCheckInEnabled, classReminderHours, maxPauseDays, maxPausesPerYear,
        location,
      } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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

  // DELETE /studios/:studioId — delete studio (franchise_admin+)
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

  // GET /studios/:studioId/policy — fetch cancellation policy (studio_admin+)
  app.get<{ Params: { studioId: string } }>(
    '/:studioId/policy',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const policy = await prisma.cancellationPolicy.findUnique({ where: { studioId } })
      // Return current values or schema defaults
      return reply.send({
        lateCancelWindowHours:  policy?.lateCancelWindowHours  ?? 12,
        lateCancelFeeCredits:   policy?.lateCancelFeeCredits   ?? 1,
        noShowFeeCredits:       policy?.noShowFeeCredits        ?? 1,
        waitlistWindowMinutes:  policy?.waitlistWindowMinutes  ?? 15,
      })
    },
  )

  // PATCH /studios/:studioId/policy — upsert cancellation policy (studio_admin+)
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
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const { lateCancelWindowHours, lateCancelFeeCredits, noShowFeeCredits, waitlistWindowMinutes } = request.body

      // Validate: all values must be non-negative integers when provided
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

  // GET /studios/:studioId/rooms — list rooms for a studio
  app.get<{ Params: { studioId: string } }>(
    '/:studioId/rooms',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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

  // POST /studios/:studioId/rooms — create room
  app.post<{
    Params: { studioId: string }
    Body: { name: string; capacity: number; locationId?: string }
  }>(
    '/:studioId/rooms',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.params
      const { name, capacity, locationId } = request.body
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      if (!name || !capacity || capacity < 1) {
        return reply.badRequest('name and capacity (≥1) are required')
      }

      // Use provided locationId or fall back to first location of the studio
      let locId = locationId
      if (!locId) {
        const loc = await prisma.location.findFirst({ where: { studioId } })
        if (!loc) return reply.badRequest('Studio has no locations — create a location first')
        locId = loc.id
      }

      const room = await prisma.room.create({
        data: { locationId: locId, name, capacity },
      })

      return reply.code(201).send({ id: room.id, name: room.name, capacity: room.capacity, locationId: room.locationId })
    },
  )

  // DELETE /studios/:studioId/rooms/:roomId — delete room
  app.delete<{ Params: { studioId: string; roomId: string } }>(
    '/:studioId/rooms/:roomId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, roomId } = request.params
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const room = await prisma.room.findFirst({
        where: { id: roomId, location: { studioId } },
      })
      if (!room) return reply.notFound('Room not found')

      // Prevent deleting rooms still used by upcoming sessions
      const futureSession = await prisma.classSession.findFirst({
        where: { roomId, startsAt: { gte: new Date() }, status: { not: 'CANCELLED' } },
      })
      if (futureSession) {
        return reply.code(409).send({ error: 'Room has upcoming classes — reassign them before deleting' })
      }

      await prisma.room.delete({ where: { id: roomId } })
      return reply.send({ success: true })
    },
  )

  // GET /studios/:slug/public — public studio info (kept for onboarding)
  app.get<{ Params: { slug: string } }>('/by-slug/:slug', async (request, reply) => {
    const studio = await prisma.studio.findUnique({
      where: { slug: request.params.slug },
      include: { locations: true },
    })
    if (!studio) return reply.notFound()
    return studio
  })

  // POST /studios/onboard — full studio setup in one transaction (franchise_admin only)
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

  // GET /studios/:studioId/layouts — all active room layouts (with stations) for the studio
  // Used by the room editor to populate the "load template" picker
  app.get<{ Params: { studioId: string } }>(
    '/:studioId/layouts',
    { preHandler: requireRole('instructor') },
    async (request, reply) => {
      const { studioId } = request.params
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

  // GET /studios/:studioId/membership-plans — authenticated; stripePriceId is not exposed
  app.get<{ Params: { studioId: string } }>(
    '/:studioId/membership-plans',
    { preHandler: requireAuth },
    async (request, reply) => {
      const plans = await prisma.membershipPlan.findMany({
        where: { studioId: request.params.studioId },
        select: { id: true, studioId: true, name: true, description: true, priceInCents: true, intervalMonths: true, creditsPerCycle: true },
      })
      return plans
    },
  )
}
