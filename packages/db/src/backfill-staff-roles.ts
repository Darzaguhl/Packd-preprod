/**
 * One-off backfill script: sync staffRoles from Supabase app_metadata → Member.staffRoles
 *
 * Run from repo root:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx packages/db/src/backfill-staff-roles.ts
 *
 * Or add SUPABASE_SERVICE_ROLE_KEY to apps/api/.env and run:
 *   npx tsx packages/db/src/backfill-staff-roles.ts
 */

import 'dotenv/config'
import { prisma } from './index.js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ghayufxnbqubecgblvtg.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_SERVICE_ROLE_KEY is not set')
  process.exit(1)
}

const VALID_STAFF_ROLES = ['fronthost', 'instructor']

interface SupabaseUser {
  id: string
  email: string
  app_metadata?: {
    role?: string
    roles?: string[]
    studioIds?: string[]
  }
}

interface PagedUsers {
  users: SupabaseUser[]
  aud: string
  nextPage?: number
  lastPage?: number
}

async function fetchAllUsers(): Promise<SupabaseUser[]> {
  const all: SupabaseUser[] = []
  let page = 1
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY!,
      },
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Supabase Admin API error: ${err}`)
    }
    const data = await res.json() as PagedUsers
    all.push(...data.users)
    if (!data.nextPage || data.nextPage > (data.lastPage ?? 1)) break
    page++
  }
  return all
}

async function main() {
  console.log('Fetching users from Supabase Auth…')
  const users = await fetchAllUsers()
  console.log(`  Found ${users.length} users`)

  const staffUsers = users.filter(u => {
    const meta = u.app_metadata ?? {}
    const roles = meta.roles ?? (meta.role && meta.role !== 'member' ? [meta.role] : [])
    return roles.some(r => VALID_STAFF_ROLES.includes(r))
  })
  console.log(`  ${staffUsers.length} users have staff roles in app_metadata`)

  if (staffUsers.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  let updated = 0
  let skipped = 0

  for (const u of staffUsers) {
    const meta = u.app_metadata ?? {}
    const roles: string[] = meta.roles ?? (meta.role && meta.role !== 'member' ? [meta.role] : [])
    const staffRoles = roles.filter(r => VALID_STAFF_ROLES.includes(r))

    const member = await prisma.member.findUnique({ where: { userId: u.id } })
    if (!member) {
      console.log(`  ⚠  No Member record for ${u.email} — skipping`)
      skipped++
      continue
    }

    // Only update if staffRoles is currently empty (don't overwrite intentional changes)
    if (member.staffRoles.length > 0) {
      console.log(`  ✓  ${u.email} already has staffRoles [${member.staffRoles.join(', ')}] — skipping`)
      skipped++
      continue
    }

    await prisma.member.update({
      where: { id: member.id },
      data: { staffRoles },
    })
    console.log(`  ✅  ${u.email} → staffRoles: [${staffRoles.join(', ')}]`)
    updated++

    // Ensure Instructor record exists if they have the instructor role
    if (staffRoles.includes('instructor')) {
      await prisma.instructor.upsert({
        where: { userId: u.id },
        create: { userId: u.id, studioId: member.studioId },
        update: {},
      })
    }
  }

  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
