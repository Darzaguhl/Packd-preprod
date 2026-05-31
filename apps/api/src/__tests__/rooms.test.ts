import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Prisma mock ─────────────────────────────────────────────────────────────
vi.mock('@packd/db', () => {
  const classSession = {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  }
  const roomLayout = {
    findFirst: vi.fn(),
  }
  const booking = {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  }
  const member = { findUnique: vi.fn() }
  const auditLog = { create: vi.fn().mockResolvedValue({}) }
  // assertRoomAccess queries room — return a matching studio so access is granted
  const room = {
    findUnique: vi.fn().mockResolvedValue({
      id: 'room-1', location: { studioId: 'studio-1' },
    }),
  }

  // $transaction callback form — forward same mock instances
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ classSession, roomLayout, booking, member }),
  )

  return { prisma: { classSession, roomLayout, booking, member, room, auditLog, $transaction } }
})

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({ id: 'user-1', role: 'studio_admin', studioIds: ['studio-1'] })),
}))

// ─── imports ──────────────────────────────────────────────────────────────────
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { roomRoutes } from '../routes/rooms.js'
import { prisma } from '@packd/db'
import { getUser } from '../lib/auth.js'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(roomRoutes, { prefix: '/rooms' })
  return app
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const mockStation = (id = 'station-1') => ({
  id, type: 'BIKE', label: '1', xM: 1, yM: 1, rotation: 0, layoutId: 'layout-1',
})

const mockLayout = (id = 'layout-1') => ({
  id, roomId: 'room-1', name: 'Main', widthM: 10, lengthM: 8, isActive: true,
  stations: [mockStation('station-1'), mockStation('station-2')],
})

const mockBooking = (overrides = {}) => ({
  id: 'booking-1', sessionId: 'session-1', memberId: 'member-1',
  stationId: null, status: 'CONFIRMED', checkedIn: false,
  ...overrides,
})

const mockMember = (overrides = {}) => ({
  id: 'member-1', userId: 'user-1', studioId: 'studio-1', ...overrides,
})

const mockSession = (overrides = {}) => ({
  id: 'session-1', studioId: 'studio-1', roomId: 'room-1', layoutId: null,
  layout: null,
  bookings: [],
  ...overrides,
})

beforeEach(() => { vi.clearAllMocks() })

// ─── GET /rooms/:roomId/sessions/:sessionId/spots ─────────────────────────────
describe('GET /spots', () => {
  it('returns layout + assignments + myBookingId/myStationId for the caller', async () => {
    const app = await buildApp()

    vi.mocked(prisma.classSession.findUnique).mockResolvedValue({
      ...mockSession({ layoutId: 'layout-1', layout: mockLayout() }),
      bookings: [
        {
          id: 'booking-1', memberId: 'member-1', stationId: 'station-1',
          checkedIn: false,
          member: {
            user: { firstName: 'Max', lastName: 'Smith' },
            creditBalance: { balance: 5 },
            memberships: [],
          },
          station: mockStation('station-1'),
        },
      ],
    } as any)
    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)

    const res = await app.inject({
      method: 'GET',
      url: '/rooms/room-1/sessions/session-1/spots',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.assignments).toHaveLength(1)
    expect(body.myBookingId).toBe('booking-1')
    expect(body.myStationId).toBe('station-1')
  })

  it('returns myBookingId null when caller has no booking', async () => {
    const app = await buildApp()

    vi.mocked(prisma.classSession.findUnique).mockResolvedValue({
      ...mockSession({ layoutId: 'layout-1', layout: mockLayout() }),
      bookings: [],
    } as any)
    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)

    const res = await app.inject({ method: 'GET', url: '/rooms/room-1/sessions/session-1/spots' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.myBookingId).toBeNull()
    expect(body.myStationId).toBeNull()
  })

  it('falls back to active layout when session has no layoutId', async () => {
    const app = await buildApp()

    vi.mocked(prisma.classSession.findUnique).mockResolvedValue({
      ...mockSession(), bookings: [],
    } as any)
    vi.mocked(prisma.roomLayout.findFirst).mockResolvedValue(mockLayout() as any)
    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)

    const res = await app.inject({ method: 'GET', url: '/rooms/room-1/sessions/session-1/spots' })

    expect(res.statusCode).toBe(200)
    expect(res.json().layout).not.toBeNull()
    expect(vi.mocked(prisma.roomLayout.findFirst)).toHaveBeenCalled()
  })

  it('returns 404 when session not found', async () => {
    const app = await buildApp()
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/rooms/room-1/sessions/session-1/spots' })
    expect(res.statusCode).toBe(404)
  })
})

// ─── POST /rooms/:roomId/sessions/:sessionId/my-spot ─────────────────────────
describe('POST /my-spot', () => {
  it('assigns station to booking', async () => {
    const app = await buildApp()

    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockBooking() as any)
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: 'layout-1' }) as any,
    )
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ stationId: 'station-1' }) as any,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().stationId).toBe('station-1')
  })

  it('snapshots layout on first spot pick when session has no layoutId', async () => {
    const app = await buildApp()

    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockBooking() as any)
    // Session has no layout snapshot yet
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: null }) as any,
    )
    vi.mocked(prisma.roomLayout.findFirst).mockResolvedValue(mockLayout() as any)
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ stationId: 'station-1' }) as any,
    )

    await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })

    // Should have snapshotted the layout
    expect(vi.mocked(prisma.classSession.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { layoutId: 'layout-1' } }),
    )
  })

  it('does not snapshot when session already has a layoutId', async () => {
    const app = await buildApp()

    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockBooking() as any)
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: 'layout-1' }) as any,
    )
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ stationId: 'station-1' }) as any,
    )

    await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })

    expect(vi.mocked(prisma.classSession.update)).not.toHaveBeenCalled()
  })

  it('clears station when stationId is null (no snapshot needed)', async () => {
    const app = await buildApp()

    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      mockBooking({ stationId: 'station-1' }) as any,
    )
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as any)

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: null },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().stationId).toBeNull()
    // No snapshot when clearing
    expect(vi.mocked(prisma.classSession.update)).not.toHaveBeenCalled()
  })

  it('returns 409 when station is already taken by another member', async () => {
    const app = await buildApp()
    const { PrismaClientKnownRequestError } = await import(
      '@prisma/client/runtime/library.js'
    )

    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockBooking() as any)
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: 'layout-1' }) as any,
    )
    // Simulate DB unique constraint violation (once only — don't poison later tests)
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      Object.assign(new PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002', clientVersion: '5',
      }), {}),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('Station already taken')
  })

  it('returns 404 when caller has no confirmed booking', async () => {
    const app = await buildApp()
    vi.mocked(prisma.member.findUnique).mockResolvedValue(mockMember() as any)
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when caller is not a member', async () => {
    const app = await buildApp()
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/my-spot',
      body: { stationId: 'station-1' },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ─── POST /rooms/:roomId/sessions/:sessionId/spots (admin assign) ─────────────
describe('POST /spots (admin)', () => {
  it('assigns station to booking and evicts previous occupant', async () => {
    const app = await buildApp()

    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      mockBooking({ sessionId: 'session-1' }) as any,
    )
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: 'layout-1' }) as any,
    )
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ stationId: 'station-2' }) as any,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/spots',
      body: { bookingId: 'booking-1', stationId: 'station-2' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().stationId).toBe('station-2')
    // Should have evicted any previous occupant of station-2
    expect(vi.mocked(prisma.booking.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stationId: 'station-2' }),
        data: { stationId: null },
      }),
    )
  })

  it('snapshots layout on first spot assignment', async () => {
    const app = await buildApp()

    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      mockBooking({ sessionId: 'session-1' }) as any,
    )
    vi.mocked(prisma.classSession.findUnique).mockResolvedValue(
      mockSession({ layoutId: null }) as any,
    )
    vi.mocked(prisma.roomLayout.findFirst).mockResolvedValue(mockLayout() as any)
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ stationId: 'station-1' }) as any,
    )

    await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/spots',
      body: { bookingId: 'booking-1', stationId: 'station-1' },
    })

    expect(vi.mocked(prisma.classSession.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { layoutId: 'layout-1' } }),
    )
  })

  it('returns 404 when booking not in this session', async () => {
    const app = await buildApp()
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      mockBooking({ sessionId: 'other-session' }) as any,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/rooms/room-1/sessions/session-1/spots',
      body: { bookingId: 'booking-1', stationId: 'station-1' },
    })
    expect(res.statusCode).toBe(404)
  })
})
