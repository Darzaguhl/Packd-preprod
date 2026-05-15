/**
 * Usage: npx tsx scripts/set-admin.ts <user-email>
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx scripts/set-admin.ts <email>')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) { console.error(listErr.message); process.exit(1) }

  const user = users.find(u => u.email === email)
  if (!user) { console.error(`No user found: ${email}`); process.exit(1) }

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, role: 'admin' },
  })

  if (error) { console.error(error.message); process.exit(1) }
  console.log(`✓ Set role=admin for ${email}`)
  console.log('Sign out and sign back in for the new JWT to take effect.')
}

main()
