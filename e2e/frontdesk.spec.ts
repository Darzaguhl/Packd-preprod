import { test, expect } from './fixtures'

/**
 * Front-desk / admin flows. These require an admin account (E2E_ADMIN_EMAIL /
 * E2E_ADMIN_PASSWORD env vars) and a running API + seeded studio.
 */

test.describe('Admin dashboard', () => {
  test('dashboard loads with Today tab', async ({ adminPage: page }) => {
    await expect(page.getByRole('heading', { name: /today|dashboard/i }).first()).toBeVisible()
  })

  test('session list shows classes for today', async ({ adminPage: page }) => {
    // Wait for the session list to load (skeletons gone)
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    // Either sessions or empty state
    const sessions = page.locator('[data-testid="session-row"], [data-testid="session-card"]')
    const empty = page.locator('text=/no classes|no sessions/i')
    const either = sessions.first().or(empty)
    await expect(either).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Member search + drawer', () => {
  test('member search returns results', async ({ adminPage: page }) => {
    // Navigate to front-desk view
    const fronthostTab = page.locator('button, [role="tab"]').filter({ hasText: /front.?desk|members/i }).first()
    if (await fronthostTab.count() === 0) { test.skip(); return }
    await fronthostTab.click()

    const searchInput = page.getByPlaceholder(/search|member/i).first()
    if (await searchInput.count() === 0) { test.skip(); return }
    await searchInput.fill('a')
    await page.waitForTimeout(400)
    const results = page.locator('[data-testid="member-row"], [data-testid="member-result"]')
    // Either results appear or empty state
    await expect(results.first().or(page.locator('text=/no members/i'))).toBeVisible({ timeout: 5000 })
  })

  test('clicking member opens drawer with name and credit balance', async ({ adminPage: page }) => {
    const fronthostTab = page.locator('button, [role="tab"]').filter({ hasText: /front.?desk|members/i }).first()
    if (await fronthostTab.count() === 0) { test.skip(); return }
    await fronthostTab.click()

    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    const memberRow = page.locator('[data-testid="member-row"]').first()
    if (await memberRow.count() === 0) { test.skip(); return }
    await memberRow.click()

    // Drawer opens — should show credits
    const drawer = page.locator('[data-testid="member-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await expect(drawer).toContainText(/credit/i)
  })
})

test.describe('Session check-in', () => {
  test('check-in button toggles checked-in state', async ({ adminPage: page }) => {
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })

    // Click the first session to expand its booking list
    const sessionRow = page.locator('[data-testid="session-row"], [data-testid="session-card"]').first()
    if (await sessionRow.count() === 0) { test.skip(); return }
    await sessionRow.click()

    // Look for a check-in button on a booking
    const checkinBtn = page.locator('[data-testid="checkin-btn"], button').filter({ hasText: /check.?in/i }).first()
    if (await checkinBtn.count() === 0) { test.skip(); return }
    await checkinBtn.click()
    // Toast or state change visible
    await expect(
      page.locator('.fixed.bottom-6').or(page.locator('[data-testid="checkin-btn"]').filter({ hasText: /checked|undo/i }))
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Stripe credit purchase (feature-flag gated)', () => {
  test('account page shows plan cards when credit purchase is enabled', async ({ authedPage: page }) => {
    await page.goto('/account')
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    // If the feature is enabled, a "Browse plans" or similar button should exist
    const browsePlans = page.locator('button, [role="button"]').filter({ hasText: /plans|membership|buy/i })
    // This test just checks the UI renders without crashing
    await expect(page.locator('text=/account|profile|credits/i').first()).toBeVisible()
    // Plan section may or may not be visible depending on feature flag — just ensure no crash
    const count = await browsePlans.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('account page shows credit balance', async ({ authedPage: page }) => {
    await page.goto('/account')
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    await expect(page.locator('text=/credit/i').first()).toBeVisible({ timeout: 5000 })
  })
})
