import { prisma } from './index.js'

async function main() {
  console.log('Seeding database...')

  // Studio
  const studio = await prisma.studio.upsert({
    where: { slug: 'packd-demo' },
    update: {},
    create: {
      name: 'Packd Demo Studio',
      slug: 'packd-demo',
      primaryColor: '#000000',
      timezone: 'Europe/Stockholm',
      currency: 'SEK',
      cancellationPolicy: {
        create: {
          lateCancelWindowHours: 12,
          lateCancelFeeCredits: 1,
          noShowFeeCredits: 1,
          waitlistWindowMinutes: 15,
        },
      },
    },
  })
  console.log(`Studio: ${studio.name} (${studio.id})`)

  // Location
  const location = await prisma.location.upsert({
    where: { id: 'seed-location-01' },
    update: {},
    create: {
      id: 'seed-location-01',
      studioId: studio.id,
      name: 'Stockholm City',
      address: 'Drottninggatan 1',
      city: 'Stockholm',
      country: 'Sweden',
      timezone: 'Europe/Stockholm',
    },
  })
  console.log(`Location: ${location.name}`)

  // Rooms
  const cyclingRoom = await prisma.room.upsert({
    where: { id: 'seed-room-cycling' },
    update: {},
    create: {
      id: 'seed-room-cycling',
      locationId: location.id,
      name: 'The Ride Room',
      capacity: 20,
    },
  })

  const hiitRoom = await prisma.room.upsert({
    where: { id: 'seed-room-hiit' },
    update: {},
    create: {
      id: 'seed-room-hiit',
      locationId: location.id,
      name: 'The Floor',
      capacity: 16,
    },
  })
  console.log(`Rooms: ${cyclingRoom.name}, ${hiitRoom.name}`)

  // Class templates
  const templates = await Promise.all([
    prisma.classTemplate.upsert({
      where: { id: 'seed-tpl-ride' },
      update: {},
      create: {
        id: 'seed-tpl-ride',
        studioId: studio.id,
        name: 'The Ride',
        description: '45 minutes of high-energy indoor cycling',
        durationMin: 45,
        sport: 'CYCLING',
        color: '#f97316',
      },
    }),
    prisma.classTemplate.upsert({
      where: { id: 'seed-tpl-hiit' },
      update: {},
      create: {
        id: 'seed-tpl-hiit',
        studioId: studio.id,
        name: 'HIIT 50',
        description: '50 minutes of interval training',
        durationMin: 50,
        sport: 'HIIT',
        color: '#ef4444',
      },
    }),
    prisma.classTemplate.upsert({
      where: { id: 'seed-tpl-yoga' },
      update: {},
      create: {
        id: 'seed-tpl-yoga',
        studioId: studio.id,
        name: 'Flow Yoga',
        description: '60 minutes of vinyasa flow',
        durationMin: 60,
        sport: 'YOGA',
        color: '#22c55e',
      },
    }),
  ])
  console.log(`Templates: ${templates.map((t) => t.name).join(', ')}`)

  // Membership plans
  await prisma.membershipPlan.upsert({
    where: { id: 'seed-plan-unlimited' },
    update: {},
    create: {
      id: 'seed-plan-unlimited',
      studioId: studio.id,
      name: 'Unlimited Monthly',
      description: 'Unlimited classes every month',
      priceInCents: 129900,
      intervalMonths: 1,
      creditsPerCycle: null,
    },
  })

  await prisma.membershipPlan.upsert({
    where: { id: 'seed-plan-10pack' },
    update: {},
    create: {
      id: 'seed-plan-10pack',
      studioId: studio.id,
      name: '10 Class Pack',
      description: '10 credits, valid for 3 months',
      priceInCents: 99900,
      intervalMonths: 0,
      creditsPerCycle: 10,
    },
  })

  await prisma.membershipPlan.upsert({
    where: { id: 'seed-plan-5pack' },
    update: {},
    create: {
      id: 'seed-plan-5pack',
      studioId: studio.id,
      name: '5 Class Pack',
      description: 'Perfect for trying us out',
      priceInCents: 54900,
      intervalMonths: 0,
      creditsPerCycle: 5,
    },
  })
  console.log('Membership plans created')

  // Primary instructor (Alex Rivera)
  const instructorUser = await prisma.user.upsert({
    where: { email: 'instructor@packd.demo' },
    update: {},
    create: {
      id: 'seed-user-instructor',
      email: 'instructor@packd.demo',
      firstName: 'Alex',
      lastName: 'Rivera',
    },
  })

  const instructor = await prisma.instructor.upsert({
    where: { userId_studioId: { userId: instructorUser.id, studioId: studio.id } },
    update: {},
    create: {
      userId: instructorUser.id,
      studioId: studio.id,
      bio: 'Certified cycling and HIIT instructor with 8 years experience.',
    },
  })
  console.log(`Instructor: ${instructorUser.firstName} ${instructorUser.lastName}`)

  // Generate class sessions for the next 7 days
  const sessions = buildWeekSchedule({
    studioId: studio.id,
    instructorId: instructor.id,
    cyclingRoomId: cyclingRoom.id,
    hiitRoomId: hiitRoom.id,
    rideTemplateId: templates[0].id,
    hiitTemplateId: templates[1].id,
    yogaTemplateId: templates[2].id,
  })

  let created = 0
  for (const session of sessions) {
    const exists = await prisma.classSession.findFirst({
      where: { studioId: studio.id, startsAt: session.startsAt, roomId: session.roomId },
    })
    if (!exists) {
      await prisma.classSession.create({ data: session })
      created++
    }
  }
  console.log(`Sessions: ${created} created for the next 7 days`)

  // ── Analytics seed data ──────────────────────────────────────────────────────
  await seedAnalyticsData({
    studioId: studio.id,
    baseInstructorId: instructor.id,
    cyclingRoomId: cyclingRoom.id,
    hiitRoomId: hiitRoom.id,
    rideTemplateId: templates[0].id,
    hiitTemplateId: templates[1].id,
    yogaTemplateId: templates[2].id,
  })

  console.log('\nDone! Studio ID to use in .env:')
  console.log(`NEXT_PUBLIC_STUDIO_ID=${studio.id}`)
  console.log(`EXPO_PUBLIC_STUDIO_ID=${studio.id}`)
}

// ─── Analytics seed ───────────────────────────────────────────────────────────

// Deterministic pseudo-random (sin hash) — same inputs always produce same output
function rng(seed: number): number {
  const x = Math.sin(seed + 1) * 10000
  return x - Math.floor(x)
}

// Member profiles: [firstName, lastName, cyclingAffinity, hiitAffinity, yogaAffinity, activityLevel]
// activityLevel: chance per session slot to book (scaled by sport affinity)
const MEMBER_PROFILES: [string, string, number, number, number, number][] = [
  ['Emma',    'Lindqvist',  0.90, 0.20, 0.20, 0.75],  // cycling obsessed, high activity
  ['David',   'Svensson',   0.70, 0.60, 0.20, 0.85],  // all-rounder power user
  ['Maria',   'Johansson',  0.30, 0.70, 0.70, 0.65],  // HIIT + yoga
  ['Lucas',   'Eriksson',   0.90, 0.40, 0.10, 0.90],  // cycling addict
  ['Anna',    'Karlsson',   0.40, 0.30, 0.90, 0.55],  // yoga lover
  ['Oscar',   'Nilsson',    0.60, 0.90, 0.20, 0.70],  // HIIT specialist
  ['Maja',    'Andersson',  0.50, 0.50, 0.50, 0.40],  // casual, balanced
  ['Erik',    'Persson',    0.80, 0.50, 0.30, 0.80],  // power user, cycling lean
  ['Sara',    'Larsson',    0.20, 0.40, 0.90, 0.60],  // yoga devotee
  ['Johan',   'Berg',       0.70, 0.80, 0.30, 0.70],  // cycling + HIIT
  ['Lena',    'Holm',       0.60, 0.30, 0.70, 0.50],  // cycling + yoga blend
  ['Martin',  'Dahl',       0.40, 0.90, 0.20, 0.75],  // HIIT specialist
  ['Karin',   'Strand',     0.90, 0.30, 0.40, 0.65],  // cycling fan, some yoga
  ['Peter',   'Nyman',      0.50, 0.60, 0.50, 0.35],  // occasional, mixed
  ['Hanna',   'Lund',       0.70, 0.40, 0.60, 0.50],  // moderate, varied
  ['Fredrik', 'Ek',         0.30, 0.80, 0.30, 0.65],  // HIIT heavy
  ['Ida',     'Blomqvist',  0.50, 0.40, 0.80, 0.55],  // yoga-leaning
  ['Simon',   'Forsberg',   0.80, 0.60, 0.20, 0.45],  // irregular, cycling
  ['Petra',   'Lindberg',   0.60, 0.50, 0.60, 0.60],  // balanced regular
  ['Anders',  'Holm',       0.90, 0.70, 0.10, 0.55],  // cycling + HIIT, solid
]

// Slot definitions: [hour, minute, durationMin, sport (CYCLING|HIIT|YOGA), roomKey, templateKey, capacity]
type SlotDef = {
  hour: number; minute: number; durationMin: number
  sport: 'CYCLING' | 'HIIT' | 'YOGA'
  roomKey: 'cycling' | 'hiit'
  templateKey: 'ride' | 'hiit' | 'yoga'
  capacity: number
  weekdayOnly: boolean
}
const SLOTS: SlotDef[] = [
  { hour: 7,  minute: 0,  durationMin: 45, sport: 'CYCLING', roomKey: 'cycling', templateKey: 'ride', capacity: 20, weekdayOnly: false },
  { hour: 12, minute: 0,  durationMin: 50, sport: 'HIIT',    roomKey: 'hiit',    templateKey: 'hiit', capacity: 16, weekdayOnly: false },
  { hour: 18, minute: 0,  durationMin: 45, sport: 'CYCLING', roomKey: 'cycling', templateKey: 'ride', capacity: 20, weekdayOnly: false },
  { hour: 19, minute: 30, durationMin: 60, sport: 'YOGA',    roomKey: 'hiit',    templateKey: 'yoga', capacity: 16, weekdayOnly: true  },
]

// Instructor rotation per slot index
// 0=morning ride, 1=noon HIIT, 2=evening ride, 3=yoga
// [instructorKey]: 0=Alex, 1=Sofia, 2=Marcus
const SLOT_INSTRUCTOR: number[][] = [
  [0, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0], // morning ride — Alex mainly, Marcus alternates
  [1, 2, 1, 2, 1, 1, 2, 1, 2, 1, 1, 2], // noon HIIT — Sofia + Marcus
  [0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2], // evening ride — Alex mainly, Marcus 1/3
  [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0], // yoga — Sofia mostly, Alex occasionally
]

async function seedAnalyticsData(params: {
  studioId: string
  baseInstructorId: string
  cyclingRoomId: string
  hiitRoomId: string
  rideTemplateId: string
  hiitTemplateId: string
  yogaTemplateId: string
}) {
  const {
    studioId, baseInstructorId,
    cyclingRoomId, hiitRoomId,
    rideTemplateId, hiitTemplateId, yogaTemplateId,
  } = params

  console.log('\n── Analytics seed ──────────────────────────────────')

  // ── Step 1: Additional instructors ────────────────────────────────────────
  const sofiaUser = await prisma.user.upsert({
    where: { email: 'sofia@packd.demo' },
    update: {},
    create: { id: 'seed-user-sofia', email: 'sofia@packd.demo', firstName: 'Sofia', lastName: 'Chen' },
  })
  const sofiaInstructor = await prisma.instructor.upsert({
    where: { userId_studioId: { userId: sofiaUser.id, studioId } },
    update: {},
    create: { userId: sofiaUser.id, studioId, bio: 'Yoga and HIIT specialist, 6 years teaching.' },
  })

  const marcusUser = await prisma.user.upsert({
    where: { email: 'marcus@packd.demo' },
    update: {},
    create: { id: 'seed-user-marcus', email: 'marcus@packd.demo', firstName: 'Marcus', lastName: 'Berg' },
  })
  const marcusInstructor = await prisma.instructor.upsert({
    where: { userId_studioId: { userId: marcusUser.id, studioId } },
    update: {},
    create: { userId: marcusUser.id, studioId, bio: 'Cycling coach and functional fitness trainer.' },
  })

  const instructorIds = [baseInstructorId, sofiaInstructor.id, marcusInstructor.id]
  console.log(`Instructors: Alex Rivera, Sofia Chen, Marcus Berg`)

  // ── Step 2: Members ───────────────────────────────────────────────────────
  const memberIds: string[] = []
  for (let i = 0; i < MEMBER_PROFILES.length; i++) {
    const [firstName, lastName] = MEMBER_PROFILES[i]
    const idx = String(i + 1).padStart(2, '0')
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@member.demo`

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: `seed-user-m${idx}`,
        email,
        firstName,
        lastName,
      },
    })

    const member = await prisma.member.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        id: `seed-member-m${idx}`,
        userId: user.id,
        studioId,
        joinedAt: weeksAgo(12),
      },
    })
    memberIds.push(member.id)
  }
  console.log(`Members: ${memberIds.length} created`)

  // ── Step 3: Past sessions (12 weeks, Mon–Fri) ────────────────────────────
  const roomIds = { cycling: cyclingRoomId, hiit: hiitRoomId }
  const templateIds = { ride: rideTemplateId, hiit: hiitTemplateId, yoga: yogaTemplateId }

  const pastSessionMap: Map<string, string> = new Map() // key → sessionId
  let sessionsCreated = 0

  for (let week = 12; week >= 1; week--) {
    // Mon–Fri of `week` weeks ago
    for (let day = 0; day < 5; day++) {
      const date = mondayOfWeeksAgo(week)
      date.setDate(date.getDate() + day)

      for (let slotIdx = 0; slotIdx < SLOTS.length; slotIdx++) {
        const slot = SLOTS[slotIdx]
        if (slot.weekdayOnly && (date.getDay() === 0 || date.getDay() === 6)) continue

        const startsAt = new Date(date)
        startsAt.setHours(slot.hour, slot.minute, 0, 0)
        const endsAt = new Date(startsAt.getTime() + slot.durationMin * 60_000)

        // Instructor rotation: use week index (12-week cycles per slot)
        const weekIndex = (12 - week) % SLOT_INSTRUCTOR[slotIdx].length
        const instrKey = SLOT_INSTRUCTOR[slotIdx][weekIndex]
        const instructorId = instructorIds[instrKey]

        const sessionKey = `w${week}-d${day}-s${slotIdx}`
        const seedId = `seed-hist-${sessionKey}`

        const existing = await prisma.classSession.findFirst({
          where: { id: seedId },
          select: { id: true },
        })

        if (!existing) {
          await prisma.classSession.create({
            data: {
              id: seedId,
              studioId,
              templateId: templateIds[slot.templateKey],
              instructorId,
              roomId: roomIds[slot.roomKey],
              startsAt,
              endsAt,
              capacity: slot.capacity,
              status: 'COMPLETED',
              creditsRequired: 1,
            },
          })
          sessionsCreated++
        }
        pastSessionMap.set(sessionKey, seedId)
      }
    }
  }
  console.log(`Past sessions: ${sessionsCreated} created (${pastSessionMap.size} total)`)

  // ── Step 4: Bookings ──────────────────────────────────────────────────────
  let bookingsCreated = 0
  let bookingsSkipped = 0

  for (const [sessionKey, sessionId] of pastSessionMap) {
    const weekNum = Number(sessionKey.match(/w(\d+)/)?.[1] ?? 12)
    const slotIdx = Number(sessionKey.split('-s')[1])
    const sport = SLOTS[slotIdx].sport

    // Studio growth: older weeks have lower fill rates
    // week 12 ago = 55% of base, week 1 ago = 100% of base
    const growthFactor = 0.55 + (0.45 * (12 - weekNum) / 11)

    for (let mIdx = 0; mIdx < MEMBER_PROFILES.length; mIdx++) {
      const [,, cyclingAff, hiitAff, yogaAff, activityLevel] = MEMBER_PROFILES[mIdx]
      const sportAffinity = sport === 'CYCLING' ? cyclingAff : sport === 'HIIT' ? hiitAff : yogaAff

      // Probability this member books this session
      const bookProbability = sportAffinity * activityLevel * growthFactor

      const r1 = rng(mIdx * 10000 + slotIdx * 1000 + weekNum * 17)
      if (r1 > bookProbability) continue

      const memberId = memberIds[mIdx]

      // Already exists?
      const existing = await prisma.booking.findUnique({
        where: { sessionId_memberId: { sessionId, memberId } },
        select: { id: true },
      })
      if (existing) { bookingsSkipped++; continue }

      // Determine outcome
      const r2 = rng(mIdx * 10000 + slotIdx * 1000 + weekNum * 17 + 333)
      let status: 'CONFIRMED' | 'CANCELLED' | 'LATE_CANCELLED' | 'NO_SHOW'
      let checkedIn = false

      if (r2 < 0.05) {
        status = 'CANCELLED'
      } else if (r2 < 0.08) {
        status = 'LATE_CANCELLED'
      } else if (r2 < 0.10) {
        status = 'NO_SHOW'
      } else {
        status = 'CONFIRMED'
        // 90% of confirmed bookings check in
        const r3 = rng(mIdx * 10000 + slotIdx * 1000 + weekNum * 17 + 666)
        checkedIn = r3 < 0.90
      }

      // Book 1-5 days before the session
      const sessionDate = mondayOfWeeksAgo(weekNum)
      sessionDate.setDate(sessionDate.getDate() + Number(sessionKey.split('-d')[1].split('-')[0]))
      sessionDate.setHours(SLOTS[slotIdx].hour, SLOTS[slotIdx].minute, 0, 0)
      const bookedAt = new Date(sessionDate.getTime() - 24 * 60 * 60 * 1000 * Math.floor(rng(mIdx + weekNum) * 5 + 1))

      await prisma.booking.create({
        data: {
          sessionId,
          memberId,
          status,
          checkedIn,
          checkedInAt: checkedIn ? new Date(bookedAt.getTime() + 5 * 60 * 1000) : null,
          bookedAt,
        },
      })
      bookingsCreated++
    }
  }
  console.log(`Bookings: ${bookingsCreated} created, ${bookingsSkipped} already existed`)

  // ── Step 5: Credit transactions & balances ───────────────────────────────
  let txCreated = 0

  for (let mIdx = 0; mIdx < MEMBER_PROFILES.length; mIdx++) {
    const memberId = memberIds[mIdx]

    // Skip if this member already has transactions
    const existingTxCount = await prisma.creditTransaction.count({ where: { memberId } })
    if (existingTxCount > 0) continue

    // Count their confirmed + late_cancelled bookings (debits) in past sessions
    const debitBookings = await prisma.booking.findMany({
      where: {
        memberId,
        status: { in: ['CONFIRMED', 'LATE_CANCELLED', 'NO_SHOW'] },
        session: { studioId },
      },
      select: { id: true, bookedAt: true, status: true },
      orderBy: { bookedAt: 'asc' },
    })

    if (debitBookings.length === 0) continue

    // Create purchase transactions: one per ~10 debits (simulate buying class packs)
    const txData: {
      memberId: string; amount: number; type: 'PURCHASE' | 'CLASS_DEBIT' | 'REFUND'; note: string; createdAt: Date
    }[] = []

    let runningBalance = 0
    let nextPurchaseAt = 0

    for (let bIdx = 0; bIdx < debitBookings.length; bIdx++) {
      const booking = debitBookings[bIdx]

      // Top up before going negative
      if (runningBalance <= 1 || bIdx === nextPurchaseAt) {
        const purchaseAmount = rng(mIdx * 100 + bIdx) < 0.4 ? 10 : 20
        const purchaseDate = new Date(booking.bookedAt.getTime() - 2 * 24 * 60 * 60 * 1000)
        txData.push({
          memberId,
          amount: purchaseAmount,
          type: 'PURCHASE',
          note: `${purchaseAmount} class pack`,
          createdAt: purchaseDate,
        })
        runningBalance += purchaseAmount
        nextPurchaseAt = bIdx + Math.floor(purchaseAmount * 0.8)
      }

      // Debit or refund
      if (booking.status === 'CONFIRMED' || booking.status === 'NO_SHOW') {
        txData.push({
          memberId,
          amount: -1,
          type: 'CLASS_DEBIT',
          note: 'Class booking',
          createdAt: new Date(booking.bookedAt.getTime() + 1000),
        })
        runningBalance--
      } else if (booking.status === 'LATE_CANCELLED') {
        // Late cancel: deduct fee
        txData.push({
          memberId,
          amount: -1,
          type: 'CLASS_DEBIT',
          note: 'Late cancel fee',
          createdAt: new Date(booking.bookedAt.getTime() + 1000),
        })
        runningBalance--
      }
    }

    // Bulk insert transactions
    await prisma.creditTransaction.createMany({ data: txData })
    txCreated += txData.length

    // Set final balance
    const finalBalance = Math.max(0, runningBalance)
    await prisma.creditBalance.upsert({
      where: { memberId },
      update: { balance: finalBalance },
      create: { memberId, balance: finalBalance },
    })
  }
  console.log(`Credit transactions: ${txCreated} created`)
  console.log('── Analytics seed complete ─────────────────────────')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Monday of `n` weeks ago at 00:00:00 local */
function mondayOfWeeksAgo(n: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay() === 0 ? 6 : d.getDay() - 1 // Mon=0
  d.setDate(d.getDate() - dayOfWeek - n * 7)
  return d
}

/** Date exactly `n` weeks ago */
function weeksAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n * 7)
  return d
}

function buildWeekSchedule(ids: {
  studioId: string
  instructorId: string
  cyclingRoomId: string
  hiitRoomId: string
  rideTemplateId: string
  hiitTemplateId: string
  yogaTemplateId: string
}) {
  const sessions = []
  const now = new Date()

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(now)
    day.setDate(day.getDate() + dayOffset)

    // 7:00 AM ride
    sessions.push(makeSession(day, 7, 0, 45, ids.rideTemplateId, ids.cyclingRoomId, ids.studioId, ids.instructorId, 20))
    // 12:00 PM HIIT
    sessions.push(makeSession(day, 12, 0, 50, ids.hiitTemplateId, ids.hiitRoomId, ids.studioId, ids.instructorId, 16))
    // 6:00 PM ride
    sessions.push(makeSession(day, 18, 0, 45, ids.rideTemplateId, ids.cyclingRoomId, ids.studioId, ids.instructorId, 20))
    // 7:30 PM yoga (weekdays only)
    if (day.getDay() !== 0 && day.getDay() !== 6) {
      sessions.push(makeSession(day, 19, 30, 60, ids.yogaTemplateId, ids.hiitRoomId, ids.studioId, ids.instructorId, 16))
    }
  }

  return sessions
}

function makeSession(
  day: Date,
  hour: number,
  minute: number,
  durationMin: number,
  templateId: string,
  roomId: string,
  studioId: string,
  instructorId: string,
  capacity: number,
) {
  const startsAt = new Date(day)
  startsAt.setHours(hour, minute, 0, 0)
  const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000)
  return { studioId, templateId, instructorId, roomId, startsAt, endsAt, capacity, creditsRequired: 1 }
}

function generateBikeLayout(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bike-${i + 1}`,
    row: Math.floor(i / 5),
    col: i % 5,
    label: `${i + 1}`,
  }))
}

function generateGridLayout(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `spot-${i + 1}`,
    row: Math.floor(i / 4),
    col: i % 4,
    label: String.fromCharCode(65 + Math.floor(i / 4)) + (i % 4 + 1),
  }))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
