#!/usr/bin/env tsx
/**
 * Access Review Script
 *
 * Queries the DB for all members with elevated staff roles, cross-references
 * against Supabase app_metadata, and flags mismatches.
 *
 * Usage:
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/access-review.ts [--format=csv]
 *
 * Or via npm:
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npm run access-review -- --format=csv
 */

import { PrismaClient } from '@packd/db'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupabaseUser {
  id: string
  email: string
  app_metadata: {
    role?: string
    roles?: string[]
    studioIds?: string[]
  }
  last_sign_in_at?: string | null
}

interface SupabaseListResponse {
  users: SupabaseUser[]
  total?: number
  next_page?: number
}

interface ReviewRow {
  memberId: string
  name: string
  email: string
  dbRoles: string[]
  dbStudioId: string
  dbStudioIds: string[]
  metaRole: string | null
  metaRoles: string[]
  metaStudioIds: string[]
  lastActive: string
  mismatch: boolean
  mismatchDetail: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(): { format: 'table' | 'csv' } {
  const fmt = process.argv.find(a => a.startsWith('--format='))?.split('=')[1]
  if (fmt === 'csv') return { format: 'csv' }
  return { format: 'table' }
}

function envOrDie(key: string): string {
  const val = process.env[key]
  if (!val) {
    console.error(`ERROR: ${key} environment variable is required.`)
    process.exit(1)
  }
  return val
}

/** Fetch all users from Supabase Admin API (paginates automatically). */
async function fetchSupabaseUsers(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<SupabaseUser[]> {
  const users: SupabaseUser[] = []
  let page = 1
  const perPage = 1000

  while (true) {
    const url = `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(
        `Supabase Admin API error (${res.status}): ${body.message ?? res.statusText}`,
      )
    }

    const data = await res.json() as SupabaseListResponse
    const batch = data.users ?? []
    users.push(...batch)

    // Stop when we get fewer results than requested (last page)
    if (batch.length < perPage) break
    page++
  }

  return users
}

/** Build mismatch description between DB staffRoles and Supabase app_metadata. */
function detectMismatch(row: Omit<ReviewRow, 'mismatch' | 'mismatchDetail'>): {
  mismatch: boolean
  detail: string
} {
  const issues: string[] = []

  // 1. DB has roles but Supabase metadata has no role at all
  if (row.dbRoles.length > 0 && !row.metaRole && row.metaRoles.length === 0) {
    issues.push('DB has roles but metadata is empty')
  }

  // 2. Primary role mismatch — DB primary vs metadata primary
  const dbPrimary = getPrimaryRole(row.dbRoles)
  if (row.metaRole && row.metaRole !== dbPrimary) {
    issues.push(`primary role: DB="${dbPrimary}" vs meta="${row.metaRole}"`)
  }

  // 3. Any DB role not present in metadata roles[]
  if (row.metaRoles.length > 0) {
    for (const r of row.dbRoles) {
      if (!row.metaRoles.includes(r)) {
        issues.push(`DB role "${r}" missing from metadata roles[]`)
      }
    }
    // Any metadata role not reflected in DB
    for (const r of row.metaRoles) {
      if (r === 'member') continue // member is not stored in staffRoles
      if (!row.dbRoles.includes(r)) {
        issues.push(`metadata role "${r}" not in DB staffRoles`)
      }
    }
  }

  // 4. studioIds mismatch — DB vs metadata
  const dbSorted = [...row.dbStudioIds].sort()
  const metaSorted = [...row.metaStudioIds].sort()
  const dbSet = new Set(dbSorted)
  const metaSet = new Set(metaSorted)

  const inDbNotMeta = dbSorted.filter(id => !metaSet.has(id))
  const inMetaNotDb = metaSorted.filter(id => !dbSet.has(id))

  if (inDbNotMeta.length > 0) {
    issues.push(`studioIds in DB but not metadata: ${inDbNotMeta.join(', ')}`)
  }
  if (inMetaNotDb.length > 0) {
    issues.push(`studioIds in metadata but not DB: ${inMetaNotDb.join(', ')}`)
  }

  return {
    mismatch: issues.length > 0,
    detail: issues.join(' | '),
  }
}

const ROLE_PRIORITY = [
  'admin',
  'brand_admin',
  'franchise_admin',
  'studio_admin',
  'instructor',
  'fronthost',
]

function getPrimaryRole(roles: string[]): string {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r
  }
  return 'member'
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length)
}

function printTable(rows: ReviewRow[]): void {
  const cols = {
    name: 22,
    email: 34,
    roles: 24,
    studios: 16,
    lastActive: 22,
    mismatch: 10,
    detail: 0, // variable
  }

  const header =
    padRight('Name', cols.name) +
    padRight('Email', cols.email) +
    padRight('DB Roles', cols.roles) +
    padRight('Studios', cols.studios) +
    padRight('Last Active', cols.lastActive) +
    padRight('Mismatch', cols.mismatch) +
    'Detail'

  const divider = '-'.repeat(header.length + 20)

  console.log(divider)
  console.log(header)
  console.log(divider)

  for (const r of rows) {
    const line =
      padRight(r.name, cols.name) +
      padRight(r.email, cols.email) +
      padRight(r.dbRoles.join(', ') || '(none)', cols.roles) +
      padRight(
        r.dbStudioIds.length > 0
          ? `${r.dbStudioIds.length} studio(s)`
          : r.dbStudioId
            ? '1 studio'
            : '-',
        cols.studios,
      ) +
      padRight(r.lastActive, cols.lastActive) +
      padRight(r.mismatch ? 'YES' : 'no', cols.mismatch) +
      (r.mismatch ? r.mismatchDetail : '')

    console.log(line)
  }

  console.log(divider)
}

function printCsv(rows: ReviewRow[]): void {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`

  const headers = [
    'member_id',
    'name',
    'email',
    'db_roles',
    'db_studio_id',
    'db_studio_ids',
    'meta_role',
    'meta_roles',
    'meta_studio_ids',
    'last_active',
    'mismatch',
    'mismatch_detail',
  ]

  console.log(headers.map(escape).join(','))

  for (const r of rows) {
    const values = [
      r.memberId,
      r.name,
      r.email,
      r.dbRoles.join(';'),
      r.dbStudioId,
      r.dbStudioIds.join(';'),
      r.metaRole ?? '',
      r.metaRoles.join(';'),
      r.metaStudioIds.join(';'),
      r.lastActive,
      r.mismatch ? 'YES' : 'no',
      r.mismatchDetail,
    ]
    console.log(values.map(escape).join(','))
  }
}

function printSummary(rows: ReviewRow[], mismatchCount: number): void {
  console.log('\n=== SUMMARY ===')
  console.log(`Total elevated users : ${rows.length}`)
  console.log(`Mismatches detected  : ${mismatchCount}`)

  // By role
  const roleCounts: Record<string, number> = {}
  for (const r of rows) {
    for (const role of r.dbRoles) {
      roleCounts[role] = (roleCounts[role] ?? 0) + 1
    }
  }
  console.log('\nBy role (DB):')
  for (const [role, count] of Object.entries(roleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padRight(role, 20)} ${count}`)
  }

  // By studio
  const studioCounts: Record<string, number> = {}
  for (const r of rows) {
    const studios = r.dbStudioIds.length > 0 ? r.dbStudioIds : [r.dbStudioId]
    for (const s of studios) {
      if (s) studioCounts[s] = (studioCounts[s] ?? 0) + 1
    }
  }
  console.log('\nBy studio (DB):')
  for (const [studioId, count] of Object.entries(studioCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padRight(studioId, 32)} ${count}`)
  }

  if (mismatchCount > 0) {
    console.log('\n[!] Action required: review mismatches above.')
    console.log('    See docs/access-review.md for remediation steps.')
  } else {
    console.log('\n[ok] No mismatches found.')
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { format } = parseArgs()

  const supabaseUrl = envOrDie('SUPABASE_URL')
  const serviceRoleKey = envOrDie('SUPABASE_SERVICE_ROLE_KEY')
  // DATABASE_URL consumed by Prisma via env — just validate it's present
  envOrDie('DATABASE_URL')

  const prisma = new PrismaClient()

  try {
    // 1. Fetch all staff members from DB
    if (format === 'table') {
      process.stderr.write('Fetching staff members from DB...\n')
    }

    const members = await prisma.member.findMany({
      where: {
        staffRoles: { isEmpty: false },
      },
      include: {
        user: true,
      },
      orderBy: [
        { studioId: 'asc' },
        { user: { lastName: 'asc' } },
      ],
    })

    if (format === 'table') {
      process.stderr.write(`Found ${members.length} staff member(s) in DB.\n`)
      process.stderr.write('Fetching users from Supabase Admin API...\n')
    }

    // 2. Fetch all Supabase auth users
    const supabaseUsers = await fetchSupabaseUsers(supabaseUrl, serviceRoleKey)

    if (format === 'table') {
      process.stderr.write(`Found ${supabaseUsers.length} user(s) in Supabase.\n\n`)
    }

    // Index Supabase users by their ID for fast lookup
    const supabaseById = new Map<string, SupabaseUser>()
    for (const u of supabaseUsers) {
      supabaseById.set(u.id, u)
    }

    // 3. Build review rows
    const rows: ReviewRow[] = []

    for (const member of members) {
      const supaUser = supabaseById.get(member.userId)
      const meta = supaUser?.app_metadata ?? {}

      // Last active: prefer Supabase last_sign_in_at, fall back to user.updatedAt
      const lastActive = supaUser?.last_sign_in_at
        ? new Date(supaUser.last_sign_in_at).toISOString().slice(0, 10)
        : member.user.updatedAt.toISOString().slice(0, 10)

      const base = {
        memberId: member.id,
        name: `${member.user.firstName} ${member.user.lastName}`,
        email: member.user.email,
        dbRoles: member.staffRoles,
        dbStudioId: member.studioId,
        dbStudioIds: member.studioIds,
        metaRole: meta.role ?? null,
        metaRoles: meta.roles ?? [],
        metaStudioIds: meta.studioIds ?? [],
        lastActive,
        mismatch: false,
        mismatchDetail: '',
      }

      // Special case: user not found in Supabase at all
      if (!supaUser) {
        rows.push({
          ...base,
          mismatch: true,
          mismatchDetail: 'User not found in Supabase Auth — orphaned DB record',
        })
        continue
      }

      const { mismatch, detail } = detectMismatch(base)
      rows.push({ ...base, mismatch, mismatchDetail: detail })
    }

    const mismatchCount = rows.filter(r => r.mismatch).length

    // 4. Output
    if (format === 'csv') {
      printCsv(rows)
    } else {
      const runDate = new Date().toISOString().slice(0, 10)
      console.log(`\nPackd Access Review — ${runDate}`)
      console.log('Elevated users (staffRoles is non-empty in DB)\n')

      if (rows.length === 0) {
        console.log('No elevated users found.')
      } else {
        // Sort mismatches to the top
        const sorted = [...rows].sort((a, b) => Number(b.mismatch) - Number(a.mismatch))
        printTable(sorted)
        printSummary(rows, mismatchCount)
      }
    }

    process.exit(mismatchCount > 0 ? 1 : 0)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : err)
  process.exit(2)
})
