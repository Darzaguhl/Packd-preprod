import { test, expect } from '@playwright/test'
import { test as authedTest } from './fixtures'

test.describe('Auth flow', () => {
  test('unauthenticated root redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders sign-in form', async ({ page }) => {
    await page.goto('/login')
    // Brand name is a styled span, not a heading role
    await expect(page.locator('text=PACKD')).toBeVisible()
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('toggle between sign-in and sign-up modes', async ({ page }) => {
    await page.goto('/login')
    // Toggle link says "Don't have an account? Sign up"
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('invalid@example.com')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.locator('text=/invalid|credentials|wrong/i')).toBeVisible({ timeout: 5000 })
  })

  test('unauthenticated /schedule is publicly accessible', async ({ page }) => {
    await page.goto('/schedule')
    // Schedule is now public — stays on schedule, shows class cards or day tabs
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('[data-testid="class-card"]').first()
      .or(page.getByText(/no classes/i))
      .or(page.locator('[data-testid="day-tab"]').first())
    ).toBeVisible({ timeout: 8000 })
  })
})

// ── Role-based access control ──────────────────────────────────────────────────
//
// These tests verify the API's auth model directly, which is faster and more
// reliable than navigating the UI. Unauthenticated → 401. Member → 403 on admin
// endpoints. Both are enforced by requireAuth/requireRole in the API.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID ?? ''

test.describe('API role guards', () => {
  test('unauthenticated requests to admin endpoints return 401', async ({ request }) => {
    const res = await request.get(`${API_URL}/admin/members/search?studioId=${STUDIO_ID}&q=test`)
    expect(res.status()).toBe(401)
  })

  test('unauthenticated POST to bookings returns 401', async ({ request }) => {
    const res = await request.post(`${API_URL}/bookings`, {
      data: { sessionId: 'fake-id', studioId: STUDIO_ID },
    })
    expect(res.status()).toBe(401)
  })

  authedTest('member token is rejected by admin endpoints (403)', async ({ authedPage: page, request }) => {
    // Extract the Supabase access token from the member's localStorage
    const token = await page.evaluate((): string => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? ''
        if (!key.includes('supabase') && !key.includes('auth')) continue
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
          const t = parsed?.access_token ?? parsed?.session?.access_token ?? ''
          if (t) return t
        } catch { /* skip */ }
      }
      return ''
    })
    if (!token) { authedTest.skip(); return }

    // Member should get 403 on studio admin endpoints
    const res = await request.get(
      `${API_URL}/admin/members/search?studioId=${STUDIO_ID}&q=test`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(res.status()).toBe(403)
  })

  authedTest('member token can access their own profile (200)', async ({ authedPage: page, request }) => {
    const token = await page.evaluate((): string => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? ''
        if (!key.includes('supabase') && !key.includes('auth')) continue
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
          const t = parsed?.access_token ?? parsed?.session?.access_token ?? ''
          if (t) return t
        } catch { /* skip */ }
      }
      return ''
    })
    if (!token) { authedTest.skip(); return }

    const res = await request.get(`${API_URL}/members/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ email: expect.any(String), studioId: expect.any(String) })
  })
})
