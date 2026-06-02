import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js'
import { ROLE_RANK } from '@packd/types'
import { requireRole, requireAuth, getUser } from '../lib/auth.js'
import { Id } from '../schemas.js'
import { RoomLayoutSchema, SessionSpotsSchema } from '../schemas/responses.js'

async function snapshotLayoutIfNeeded(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
  roomId: string,
) {
  const session = await tx.classSession.findUnique({
    where: { id: sessionId },
    select: { layoutId: true },
  })
  if (session?.layoutId) return

  const activeLayout = await tx.roomLayout.findFirst({
    where: { roomId, isActive: true },
    select: { id: true },
  })
  if (!activeLayout) return

  await tx.classSession.update({
    where: { id: sessionId },
    data: { layoutId: activeLayout.id },
  })
}

async function assertRoomAccess(
  userId: string,
  userRole: string,
  roomId: string,
  reply: FastifyReply,
  jwtStudioIds?: string[],
): Promise<boolean> {
  if (ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) {
    return true
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { location: { select: { studioId: true } } },
  })
  if (!room) {
    reply.code(404).send({ error: 'Room not found' })
    return false
  }
  if (jwtStudioIds && jwtStudioIds.length > 0) {
    if (jwtStudioIds.includes(room.location.studioId)) return true
    reply.code(403).send({ error: 'Access denied' })
    return false
  }
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member) {
    reply.code(403).send({ error: 'Access denied' })
    return false
  }
  if (member.studioId === room.location.studioId) return true
  const [homeMembership, targetMembership] = await Promise.all([
    prisma.studioNetworkMembership.findFirst({ where: { studioId: member.studioId }, select: { networkId: true } }),
    prisma.studioNetworkMembership.findFirst({ where: { studioId: room.location.studioId }, select: { networkId: true } }),
  ])
  if (homeMembership && targetMembership && homeMembership.networkId === targetMembership.networkId) {
    return true
  }
  reply.code(403).send({ error: 'Access denied' })
  return false
}

const stationSchema = z.object({
  type: z.enum(['BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER']),
  label: z.string().min(1),
  xM: z.number(),
  yM: z.number(),
  rotation: z.number().optional(),
})

const layoutBodySchema = z.object({
  name: z.string().min(1).optional(),
  widthM: z.number().positive(),
  lengthM: z.number().positive(),
  stations: z.array(stationSchema),
})

export async function roomRoutes(app: FastifyInstance) {
  app.get<{ Params: { roomId: string } }>(
    '/:roomId/layout',
    { preHandler: requireAuth, schema: { params: z.object({ roomId: Id }), response: { 200: RoomLayoutSchema.nullable() } } },
    async (request, reply) => {
      const { roomId } = request.params
      const user = getUser(request)

      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const layout = await prisma.roomLayout.findFirst({
        where: { roomId, isActive: true },
        include: { stations: true },
      })

      if (!layout) return reply.send(null)
      return reply.send(layout)
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/layouts',
    { preHandler: requireAuth, schema: { params: z.object({ roomId: Id }), response: { 200: z.array(RoomLayoutSchema) } } },
    async (request, reply) => {
      const { roomId } = request.params
      const user = getUser(request)
      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return
      const layouts = await prisma.roomLayout.findMany({
        where: { roomId },
        include: { stations: true },
        orderBy: { id: 'desc' },
      })
      return reply.send(layouts)
    },
  )

  app.post<{ Params: { roomId: string; layoutId: string } }>(
    '/:roomId/layouts/:layoutId/activate',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { roomId, layoutId } = request.params
      const user = getUser(request)
      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const target = await prisma.roomLayout.findFirst({ where: { id: layoutId, roomId } })
      if (!target) return reply.notFound('Layout not found')

      await prisma.$transaction([
        prisma.roomLayout.updateMany({ where: { roomId, isActive: true }, data: { isActive: false } }),
        prisma.roomLayout.update({ where: { id: layoutId }, data: { isActive: true } }),
      ])

      const layout = await prisma.roomLayout.findUnique({
        where: { id: layoutId },
        include: { stations: true },
      })
      return reply.send(layout)
    },
  )

  app.patch<{
    Params: { roomId: string; layoutId: string }
    Body: {
      name?: string
      widthM: number
      lengthM: number
      stations: Array<{ type: string; label: string; xM: number; yM: number; rotation?: number }>
    }
  }>(
    '/:roomId/layouts/:layoutId',
    {
      preHandler: requireRole('studio_admin'),
      schema: {
        params: z.object({ roomId: Id, layoutId: Id }),
        body: layoutBodySchema,
      },
    },
    async (request, reply) => {
      const { roomId, layoutId } = request.params
      const { name, widthM, lengthM, stations } = request.body
      const user = getUser(request)

      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const existing = await prisma.roomLayout.findFirst({ where: { id: layoutId, roomId } })
      if (!existing) return reply.notFound('Layout not found')

      const validTypes = ['BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER']
      for (const s of stations) {
        if (!validTypes.includes(s.type)) return reply.code(400).send({ error: `Invalid station type: ${s.type}` })
      }

      const layout = await prisma.$transaction(async tx => {
        // Match incoming stations to existing ones by (type, label) so we can
        // UPDATE position in-place rather than delete+recreate. This preserves
        // station IDs — and therefore Booking.stationId assignments — when a
        // station is merely moved or the layout is resized.
        const existing = await tx.station.findMany({ where: { layoutId } })
        const remaining = [...existing]
        const toUpdate: { id: string; s: typeof stations[number] }[] = []
        const toCreate: typeof stations[number][] = []

        for (const s of stations) {
          const idx = remaining.findIndex(e => e.type === s.type && e.label === s.label)
          if (idx >= 0) {
            toUpdate.push({ id: remaining[idx].id, s })
            remaining.splice(idx, 1)
          } else {
            toCreate.push(s)
          }
        }
        // remaining = stations removed from the layout → safe to delete
        if (remaining.length > 0) {
          await tx.station.deleteMany({ where: { id: { in: remaining.map(e => e.id) } } })
        }
        for (const { id, s } of toUpdate) {
          await tx.station.update({
            where: { id },
            data: { xM: s.xM, yM: s.yM, rotation: s.rotation ?? 0 },
          })
        }
        if (toCreate.length > 0) {
          await tx.station.createMany({
            data: toCreate.map(s => ({
              layoutId,
              type: s.type as 'BIKE' | 'TREADMILL' | 'BENCH' | 'ROWER' | 'MAT' | 'REFORMER' | 'BARRE' | 'OTHER',
              label: s.label,
              xM: s.xM,
              yM: s.yM,
              rotation: s.rotation ?? 0,
            })),
          })
        }

        return tx.roomLayout.update({
          where: { id: layoutId },
          data: {
            ...(name !== undefined && { name }),
            widthM,
            lengthM,
          },
          include: { stations: true },
        })
      })

      return reply.send(layout)
    },
  )

  app.delete<{ Params: { roomId: string; layoutId: string } }>(
    '/:roomId/layouts/:layoutId',
    { preHandler: requireRole('studio_admin'), schema: { params: z.object({ roomId: Id, layoutId: Id }) } },
    async (request, reply) => {
      const { roomId, layoutId } = request.params
      const user = getUser(request)
      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const layout = await prisma.roomLayout.findFirst({ where: { id: layoutId, roomId } })
      if (!layout) return reply.notFound('Layout not found')
      if (layout.isActive) return reply.code(400).send({ error: 'Cannot delete the active layout. Activate another layout first.' })

      await prisma.roomLayout.delete({ where: { id: layoutId } })
      return reply.send({ success: true })
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: {
      name?: string
      widthM: number
      lengthM: number
      stations: Array<{ type: string; label: string; xM: number; yM: number; rotation?: number }>
    }
  }>(
    '/:roomId/layout',
    {
      preHandler: requireRole('studio_admin'),
      schema: {
        params: z.object({ roomId: Id }),
        body: layoutBodySchema,
      },
    },
    async (request, reply) => {
      const { roomId } = request.params
      const { name = 'Default', widthM, lengthM, stations } = request.body
      const user = getUser(request)

      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const validTypes = ['BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER']
      for (const s of stations) {
        if (!validTypes.includes(s.type)) {
          return reply.code(400).send({ error: `Invalid station type: ${s.type}` })
        }
      }

      const layout = await prisma.$transaction(async (tx) => {
        await tx.roomLayout.updateMany({ where: { roomId, isActive: true }, data: { isActive: false } })
        return tx.roomLayout.create({
          data: {
            roomId,
            name,
            widthM,
            lengthM,
            isActive: true,
            stations: {
              create: stations.map(s => ({
                type: s.type as 'BIKE' | 'TREADMILL' | 'BENCH' | 'ROWER' | 'MAT' | 'REFORMER' | 'BARRE' | 'OTHER',
                label: s.label,
                xM: s.xM,
                yM: s.yM,
                rotation: s.rotation ?? 0,
              })),
            },
          },
          include: { stations: true },
        })
      })

      return reply.code(201).send(layout)
    },
  )

  app.get<{ Params: { roomId: string; sessionId: string } }>(
    '/:roomId/sessions/:sessionId/spots',
    { preHandler: requireAuth, schema: { params: z.object({ roomId: Id, sessionId: Id }), response: { 200: SessionSpotsSchema } } },
    async (request, reply) => {
      const { roomId, sessionId } = request.params
      const user = getUser(request)

      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const session = await prisma.classSession.findUnique({
        where: { id: sessionId },
        include: {
          layout: { include: { stations: true } },
          bookings: {
            where: { status: 'CONFIRMED' },
            include: {
              member: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                  creditBalance: { select: { balance: true } },
                  memberships: {
                    where: { status: { in: ['ACTIVE', 'PAUSED'] } },
                    orderBy: { startDate: 'desc' },
                    take: 1,
                    select: { status: true },
                  },
                },
              },
              station: true,
            },
          },
        },
      })

      if (!session) return reply.code(404).send({ error: 'Session not found' })

      let layout = session.layout
      if (!layout) {
        layout = await prisma.roomLayout.findFirst({
          where: { roomId, isActive: true },
          include: { stations: true },
        }) as typeof layout
      }

      const assignments = session.bookings.map(b => ({
        bookingId: b.id,
        memberId: b.memberId,
        memberName: `${b.member.user.firstName} ${b.member.user.lastName}`,
        checkedIn: b.checkedIn,
        stationId: b.stationId ?? null,
        creditBalance: b.member.creditBalance?.balance ?? 0,
        membershipStatus: b.member.memberships[0]?.status ?? null,
      }))

      const myMember = user.id
        ? await prisma.member.findUnique({ where: { userId: user.id }, select: { id: true } })
        : null
      const myBooking = myMember
        ? session.bookings.find(b => b.memberId === myMember.id)
        : null

      return reply.send({
        layout,
        assignments,
        myBookingId: myBooking?.id ?? null,
        myStationId: myBooking?.stationId ?? null,
      })
    },
  )

  app.post<{
    Params: { roomId: string; sessionId: string }
    Body: { bookingId: string; stationId: string | null }
  }>(
    '/:roomId/sessions/:sessionId/spots',
    { preHandler: requireRole('instructor') },
    async (request, reply) => {
      const { roomId, sessionId } = request.params
      const { bookingId, stationId } = request.body
      const user = getUser(request)

      if (!await assertRoomAccess(user.id, user.role, roomId, reply, user.studioIds)) return

      const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { sessionId: true } })
      if (!booking || booking.sessionId !== sessionId) return reply.notFound('Booking not found in this session')

      const updated = await prisma.$transaction(async (tx) => {
        if (stationId) {
          await snapshotLayoutIfNeeded(tx, sessionId, roomId)
          await tx.booking.updateMany({
            where: { sessionId, stationId, id: { not: bookingId } },
            data: { stationId: null },
          })
        }
        return tx.booking.update({ where: { id: bookingId }, data: { stationId } })
      })

      return reply.send({ bookingId: updated.id, stationId: updated.stationId })
    },
  )

  app.post<{
    Params: { roomId: string; sessionId: string }
    Body: { stationId: string | null }
  }>(
    '/:roomId/sessions/:sessionId/my-spot',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId, sessionId } = request.params
      const { stationId } = request.body
      const user = getUser(request)

      const member = await prisma.member.findUnique({ where: { userId: user.id } })
      if (!member) return reply.code(403).send({ error: 'Not a member' })

      const booking = await prisma.booking.findUnique({
        where: { sessionId_memberId: { sessionId, memberId: member.id } },
      })
      if (!booking || booking.status !== 'CONFIRMED') {
        return reply.code(404).send({ error: 'No confirmed booking found' })
      }

      try {
        const updated = await prisma.$transaction(async (tx) => {
          if (stationId) await snapshotLayoutIfNeeded(tx, sessionId, roomId)
          return tx.booking.update({ where: { id: booking.id }, data: { stationId } })
        })
        return reply.send({ stationId: updated.stationId })
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          return reply.code(409).send({ error: 'Station already taken' })
        }
        throw e
      }
    },
  )
}
