/**
 * Playwright global setup — runs once before all E2E tests.
 *
 * What it does:
 *  1. Creates two Supabase test users (member + studio_admin) via the admin API.
 *  2. Logs each in via the browser and saves their auth state to .auth/.
 *  3. After login, calls POST /members/ensure so each user has a Member record.
 *  4. Gives the test member 20 credits via the admin API so booking tests can run.
 *
 * Requires (in apps/web/.env.local and apps/api/.env):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STUDIO_ID
 *   NEXT_PUBLIC_API_URL (default http://localhost:4000)
 */

import { chromium } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import path from 'path'
import fs from 'fs/promises'

// Load env from both app env files (order matters — api wins on conflict)
loadEnv({ path: path.resolve('apps/web/.env.local') })
loadEnv({ path: path.resolve('apps/api/.env') })

const BASE_URL     = process.env.BASE_URL                  ?? 'http://localhost:3000'
const API_URL      = process.env.NEXT_PUBLIC_API_URL       ?? 'http://localhost:4000'
const SB_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const SB_ANON      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SB_SERVICE   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const STUDIO_ID    = process.env.NEXT_PUBLIC_STUDIO_ID     ?? ''

export const E2E_MEMBER_EMAIL    = process.env.E2E_EMAIL          ?? 'e2e-member@packd.test'
export const E2E_MEMBER_PASSWORD = process.env.E2E_PASSWORD       ?? 'E2ePass123!'
export const E2E_ADMIN_EMAIL     = process.env.E2E_ADMIN_EMAIL    ?? 'e2e-admin@packd.test'
export const E2E_ADMIN_PASSWORD  = process.env.E2E_ADMIN_PASSWORD ?? 'E2ePass123!'

// ─── Supabase admin helpers ────────────────────────────────────────────────────

async function sbAdminPost(endpoint: string, body: object) {
  const res = await fetch(`${SB_URL}/auth/v1/admin${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SB_SERVICE}`,
      apikey: SB_SERVICE,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function sbAdminPut(endpoint: string, body: object) {
  const res = await fetch(`${SB_URL}/auth/v1/admin${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SB_SERVICE}`,
      apikey: SB_SERVICE,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function sbAdminGet(endpoint: string) {
  const res = await fetch(`${SB_URL}/auth/v1/admin${endpoint}`, {
    headers: {
      Authorization: `Bearer ${SB_SERVICE}`,
      apikey: SB_SERVICE,
    },
  })
  return res.json()
}

/** Create user in Supabase, or find and update if already exists. */
async function ensureSupabaseUser(
  email: string,
  password: string,
  appMeta: Record<string, unknown>,
): Promise<{ id: string }> {
  // Try to create — returns 422 if email already exists
  const created = await sbAdminPost('/users', {
    email,
    password,
    email_confirm: true,
    app_metadata: appMeta,
  })

  if (created.id) return created

  // Find existing user
  const list = await sbAdminGet('/users?page=1&per_page=1000')
  const existing = list.users?.find((u: { email: string }) => u.email === email)
  if (!existing) throw new Error(`Could not create or find Supabase user: ${email}`)

  // Update app_metadata to ensure role is correct
  await sbAdminPut(`/users/${existing.id}`, { app_metadata: appMeta })
  return existing
}

/** Sign in via Supabase password flow; returns access_token. */
async function sbSignIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_ANON },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(data)}`)
  return data.access_token
}

/** Call POST /members/ensure to create the Member record for this user. */
async function ensureMemberRecord(token: string) {
  const res = await fetch(`${API_URL}/members/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ studioId: STUDIO_ID }),
  })
  if (!res.ok) {
    const txt = await res.text()
    console.warn(`[setup] /members/ensure returned ${res.status}: ${txt}`)
  }
  return res.json().catch(() => null)
}

/** Give the test member credits so booking tests don't fail on insufficient funds. */
async function seedMemberCredits(adminToken: string, memberEmail: string, credits: number) {
  // Find the member
  const searchRes = await fetch(
    `${API_URL}/admin/members/search?studioId=${STUDIO_ID}&q=${encodeURIComponent(memberEmail)}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  )
  const members = await searchRes.json().catch(() => [])
  const member = Array.isArray(members) ? members[0] : null
  if (!member) { console.warn('[setup] Could not find test member to seed credits'); return }

  await fetch(`${API_URL}/admin/members/${member.id}/credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ amount: credits, note: 'E2E test seed' }),
  })
}

// ─── Browser-based auth state save ────────────────────────────────────────────

async function saveAuthState(
  email: string,
  password: string,
  outputPath: string,
  waitForUrl: RegExp,
): Promise<void> {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`${BASE_URL}/login`)
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // Wait for redirect — either to the expected URL or to onboarding
  await page.waitForURL(/(schedule|dashboard|onboarding)/, { timeout: 15_000 })

  // If landed on onboarding (admin first-time setup), skip it — admin users don't
  // need the full studio wizard since the seed already created the studio.
  // Members don't have an onboarding flow; they go straight to /schedule.

  await ctx.storageState({ path: outputPath })
  await browser.close()
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default async function globalSetup() {
  if (!SB_URL || !SB_SERVICE) {
    console.warn('[setup] SUPABASE vars missing — skipping E2E user provisioning')
    return
  }

  await fs.mkdir('.auth', { recursive: true })

  console.log('[setup] Provisioning E2E test users…')

  // 1. Ensure Supabase users exist with correct roles
  await ensureSupabaseUser(E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD, {
    role: 'member',
    studioId: STUDIO_ID,
    studioIds: [STUDIO_ID],
  })

  await ensureSupabaseUser(E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, {
    role: 'studio_admin',
    studioId: STUDIO_ID,
    studioIds: [STUDIO_ID],
  })

  // 2. Ensure Member records exist (call /members/ensure with their tokens)
  const memberToken = await sbSignIn(E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD)
  const adminToken  = await sbSignIn(E2E_ADMIN_EMAIL,  E2E_ADMIN_PASSWORD)

  await ensureMemberRecord(memberToken)
  await ensureMemberRecord(adminToken)

  // 3. Give the member 20 credits so booking tests pass
  await seedMemberCredits(adminToken, E2E_MEMBER_EMAIL, 20)

  // 4. Save browser auth states
  console.log('[setup] Saving auth states…')
  await saveAuthState(E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD, '.auth/member.json', /schedule/)
  await saveAuthState(E2E_ADMIN_EMAIL,  E2E_ADMIN_PASSWORD,  '.auth/admin.json',  /dashboard/)

  console.log('[setup] Done.')
}
