import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Prisma mock ───────────────────────────────────────────────────────────────

vi.mock('@packd/db', () => {
  const member      = { findUnique: vi.fn(), findMany: vi.fn() }
  const booking     = { findMany: vi.fn() }
  const productSale = { findMany: vi.fn() }
  const classSession = { findMany: vi.fn() }
  const staffShift  = { findMany: vi.fn() }
  const studio      = { findUnique: vi.fn().mockResolvedValue({ currency: 'USD' }) }
  const auditLog    = { create: vi.fn().mockResolvedValue({}) }

  return { prisma: { member, booking, productSale, classSession, staffShift, studio, auditLog } }
})

// ── Auth mock — studio_admin ──────────────────────────────────────────────────

vi.mock('../lib/auth.js', () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
  requireRole: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  getUser: vi.fn(() => ({
    id: 'admin-1',
    role: 'studio_admin',
    studioIds: ['studio-1'],
  })),
}))

vi.mock('../jobs/index.js', () => ({ enqueueNoShowCheck: vi.fn() }))

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { adminRoutes } from '../routes/admin.js'
import { prisma } from '@packd/db'

async function buildApp() {
  const app = Fastify()
  await app.register(sensible)
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

// ── Data factories ────────────────────────────────────────────────────────────

function makeMember(overrides = {}) {
  return {
    id: 'member-1',
    userId: 'user-1',
    studioId: 'studio-1',
    staffRoles: [],
    user: {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@test.com',
      createdAt: new Date('2025-01-01'),
    },
    creditBalance: { balance: 10 },
    memberships: [],
    ...overrides,
  }
}

function makeBooking(overrides = {}) {
  return {
    id: 'booking-1',
    status: 'CONFIRMED',
    checkedIn: true,
    session: {
      startsAt: new Date('2026-06-10T09:00:00Z'),
      template: { name: 'Morning Ride' },
    },
    member: {
      user: { firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
    },
    ...overrides,
  }
}

function makeSale(overrides = {}) {
  return {
    id: 'sale-1',
    soldAt: new Date('2026-06-10T10:00:00Z'),
    totalCents: 1000,
    paymentMethod: 'card',
    refundedAt: null,
    failedAt: null,
    items: [{ name: 'Protein Shake', qty: 1 }],
    member: {
      user: { firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /admin/export/members', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a CSV with header row and one data row', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.member.findMany).mockResolvedValue([makeMember()] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export/members?studioId=studio-1',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('members.csv')

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('First Name')
    expect(lines[0]).toContain('Email')
    expect(lines[1]).toContain('Alice')
    expect(lines[1]).toContain('alice@test.com')
    expect(lines[1]).toContain('10')  // credit balance
  })

  it('returns 400 when studioId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/admin/export/members' })
    expect(res.statusCode).toBe(400)
  })

  it('handles CSV escaping for values containing commas', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      makeMember({ user: { firstName: 'Alice, Jr.', lastName: 'Smith', email: 'alice@test.com', createdAt: new Date() } }),
    ] as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/admin/export/members?studioId=studio-1' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"Alice, Jr."')  // comma inside value → quoted
  })
})

describe('GET /admin/export/attendance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns attendance CSV with check-in status', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([makeBooking()] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export/attendance?studioId=studio-1',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('attendance.csv')

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Class')
    expect(lines[0]).toContain('Checked In')
    expect(lines[1]).toContain('Morning Ride')
    expect(lines[1]).toContain('Yes')
  })

  it('marks no-shows as not checked in', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      makeBooking({ checkedIn: false, status: 'NO_SHOW' }),
    ] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export/attendance?studioId=studio-1',
    })

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines[1]).toContain('NO_SHOW')
    expect(lines[1]).toContain('No')
  })
})

describe('GET /admin/export/revenue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns revenue CSV with sale details', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.productSale.findMany).mockResolvedValue([makeSale()] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export/revenue?studioId=studio-1',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('revenue.csv')

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Total (cents)')
    expect(lines[0]).toContain('Payment Method')
    expect(lines[1]).toContain('1000')
    expect(lines[1]).toContain('card')
    expect(lines[1]).toContain('Protein Shake×1')
    expect(lines[1]).toContain('No')  // not refunded
  })

  it('marks refunded sales with Yes', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.productSale.findMany).mockResolvedValue([
      makeSale({ refundedAt: new Date('2026-06-11'), refundedCents: 1000, stripeRefundId: 're_abc' }),
    ] as never)

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export/revenue?studioId=studio-1',
    })

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines[1]).toContain('Yes')
  })
})

// ── GET /admin/export/staff-pay ───────────────────────────────────────────────

describe('GET /admin/export/staff-pay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns CSV with instructor and fronthost rows', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)

    // Instructor: 1 session, 2 checked-in bookings, $2.00/head
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([{
      id: 'session-1',
      instructor: {
        id: 'instr-1',
        payRatePerHeadCents: 200,
        user: { firstName: 'Alex', lastName: 'Rivera', email: 'alex@test.com' },
      },
      bookings: [
        { status: 'CONFIRMED', checkedIn: true },
        { status: 'CONFIRMED', checkedIn: true },
        { status: 'CONFIRMED', checkedIn: false },
      ],
    }] as never)

    // Fronthost: 1 shift of 4 hours, $15.00/hr
    vi.mocked(prisma.staffShift.findMany).mockResolvedValue([{
      id: 'shift-1',
      startsAt: new Date('2026-06-10T09:00:00Z'),
      endsAt:   new Date('2026-06-10T13:00:00Z'),
      member: {
        id: 'member-fh-1',
        payRateHourlyCents: 1500,
        user: { firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
      },
    }] as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/admin/export/staff-pay?studioId=studio-1' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('staff-pay.csv')

    const lines = res.body.split('\r\n').filter(Boolean)
    // Header + 2 data rows
    expect(lines.length).toBe(3)
    // Instructor row: 2 checked in × $2.00 = $4.00
    const instrRow = lines.find(l => l.includes('Alex'))
    expect(instrRow).toBeDefined()
    expect(instrRow).toContain('Instructor')
    expect(instrRow).toContain('4.00')  // $4.00 pay
    // Fronthost row: 4 hours × $15.00 = $60.00
    const fhRow = lines.find(l => l.includes('Jane'))
    expect(fhRow).toBeDefined()
    expect(fhRow).toContain('Front Desk')
    expect(fhRow).toContain('60.00')  // $60.00 pay
  })

  it('shows N/A pay when rate is not set', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ studioId: 'studio-1' } as never)
    vi.mocked(prisma.classSession.findMany).mockResolvedValue([{
      id: 'session-1',
      instructor: {
        id: 'instr-1',
        payRatePerHeadCents: null,
        user: { firstName: 'Sam', lastName: 'Lee', email: 'sam@test.com' },
      },
      bookings: [{ status: 'CONFIRMED', checkedIn: true }],
    }] as never)
    vi.mocked(prisma.staffShift.findMany).mockResolvedValue([] as never)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/admin/export/staff-pay?studioId=studio-1' })

    const lines = res.body.split('\r\n').filter(Boolean)
    expect(lines[1]).toContain('N/A')
    expect(lines[1]).toContain('Not set')
  })
})
