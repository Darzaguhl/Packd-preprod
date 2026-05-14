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
      layout: generateBikeLayout(20),
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
      layout: generateGridLayout(16),
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

  // Demo instructor (requires a User record first)
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
    where: { userId: instructorUser.id },
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

  console.log('\nDone! Studio ID to use in .env:')
  console.log(`NEXT_PUBLIC_STUDIO_ID=${studio.id}`)
  console.log(`EXPO_PUBLIC_STUDIO_ID=${studio.id}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
