import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@packd/db'
import { ROLE_RANK } from '@packd/types'
import { requireRole, requireAuth, getUser } from '../lib/auth.js'

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
  // Staff carry their assigned studio IDs in the JWT — no Member record needed
  if (jwtStudioIds && jwtStudioIds.length > 0) {
    if (jwtStudioIds.includes(room.location.studioId)) return true
    reply.code(403).send({ error: 'Access denied' })
    return false
  }
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member || member.studioId !== room.location.studioId) {
    reply.code(403).send({ error: 'Access denied' })
    return false
  }
  return true
}

export async function roomRoutes(app: FastifyInstance) {
  // GET /rooms/:roomId/layout — active layout with stations
  app.get<{ Params: { roomId: string } }>(
    '/:roomId/layout',
    { preHandler: requireAuth },
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

  // GET /rooms/:roomId/layouts — all saved layouts for this room (active + inactive), most recent first
  app.get<{ Params: { roomId: string } }>(
    '/:roomId/layouts',
    { preHandler: requireAuth },
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

  // POST /rooms/:roomId/layouts/:layoutId/activate — switch the active layout without creating a new record
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

  // PATCH /rooms/:roomId/layouts/:layoutId — update an existing layout in place (name, dimensions, stations)
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
    { preHandler: requireRole('studio_admin') },
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

      // Delete old stations, update layout fields, create new stations in a transaction
      const layout = await prisma.$transaction(async tx => {
        await tx.station.deleteMany({ where: { layoutId } })
        return tx.roomLayout.update({
          where: { id: layoutId },
          data: {
            ...(name !== undefined && { name }),
            widthM,
            lengthM,
            stations: {
              create: stations.map(s => ({
                type: s.type as import('@packd/db').StationType,
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

      return reply.send(layout)
    },
  )

  // DELETE /rooms/:roomId/layouts/:layoutId — delete a saved layout (cannot delete the active one)
  app.delete<{ Params: { roomId: string; layoutId: string } }>(
    '/:roomId/layouts/:layoutId',
    { preHandler: requireRole('studio_admin') },
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

  // POST /rooms/:roomId/layout — create/replace active layout
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
    { preHandler: requireRole('studio_admin') },
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

      // Deactivate previous layouts and create the new one atomically
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
                type: s.type as import('@packd/db').StationType,
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

  // GET /rooms/:roomId/sessions/:sessionId/spots — stations + assignments
  app.get<{ Params: { roomId: string; sessionId: string } }>(
    '/:roomId/sessions/:sessionId/spots',
    { preHandler: requireAuth },
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

      // If no layout snapshot, use the room's active layout
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

      return reply.send({ layout, assignments })
    },
  )

  // POST /rooms/:roomId/sessions/:sessionId/spots — assign member to station
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

      // Verify the booking belongs to this session (prevent cross-session reassignment)
      const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { sessionId: true } })
      if (!booking || booking.sessionId !== sessionId) return reply.notFound('Booking not found in this session')

      // clear any existing booking on that station for this session
      if (stationId) {
        await prisma.booking.updateMany({
          where: { sessionId, stationId, id: { not: bookingId } },
          data: { stationId: null },
        })
      }

      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { stationId },
      })

      return reply.send({ bookingId: updated.id, stationId: updated.stationId })
    },
  )

  // POST /rooms/:roomId/sessions/:sessionId/my-spot — member picks their own spot
  app.post<{
    Params: { roomId: string; sessionId: string }
    Body: { stationId: string | null }
  }>(
    '/:roomId/sessions/:sessionId/my-spot',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId } = request.params
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

      // check station isn't taken
      if (stationId) {
        const conflict = await prisma.booking.findUnique({
          where: { sessionId_stationId: { sessionId, stationId } },
        })
        if (conflict && conflict.id !== booking.id) {
          return reply.code(409).send({ error: 'Station already taken' })
        }
      }

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { stationId },
      })

      return reply.send({ stationId: updated.stationId })
    },
  )
}
