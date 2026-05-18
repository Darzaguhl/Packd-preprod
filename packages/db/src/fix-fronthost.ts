import 'dotenv/config'
import { prisma } from './index.js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  // Fetch user from Supabase Auth
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=fronthost@packd.test`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  })
  const data = await res.json() as { users?: Array<{ id: string; email: string; app_metadata?: Record<string, unknown> }> }
  const user = data.users?.[0]
  if (!user) { console.error('User not found'); process.exit(1) }
  console.log('Found user:', user.id, user.email)
  console.log('app_metadata:', JSON.stringify(user.app_metadata))

  // Get studio
  const studio = await prisma.studio.findFirst({ select: { id: true, name: true } })
  if (!studio) { console.error('No studio found'); process.exit(1) }
  console.log('Studio:', studio.id, studio.name)

  // Ensure User row exists (FK requirement)
  const emailParts = user.email.split('@')[0].split(/[._-]/)
  const firstName = emailParts[0] ? emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1) : 'Front'
  const lastName = emailParts[1] ? emailParts[1].charAt(0).toUpperCase() + emailParts[1].slice(1) : 'Host'
  await prisma.user.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email, firstName, lastName },
    update: { email: user.email },
  })
  console.log('✅ User row upserted:', user.id)

  // Create Member record
  const member = await prisma.member.create({
    data: {
      userId: user.id,
      studioId: studio.id,
      staffRoles: ['fronthost'],
      source: 'packd',
    },
  })
  console.log('✅ Created member:', member.id)

  // Ensure app_metadata has studioIds
  const meta = (user.app_metadata ?? {}) as { studioIds?: string[] }
  const studioIds = [...new Set([...(meta.studioIds ?? []), studio.id])]
  const putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { role: 'fronthost', roles: ['fronthost'], studioIds } }),
  })
  const updated = await putRes.json() as { app_metadata?: unknown }
  console.log('✅ app_metadata updated:', JSON.stringify(updated.app_metadata))
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
