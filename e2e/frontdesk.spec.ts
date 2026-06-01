/**
 * Front-desk / admin flows.
 *
 * The admin user (studio_admin) lands on StudioManagerDashboard in "Management"
 * mode by default. Click "Live" to switch to LiveDashboard which has
 * the session-row, member search, check-in, etc.
 */

import { test, expect } from './fixtures'

const MEMBER_EMAIL = process.env.E2E_EMAIL ?? 'e2e-member@packd.test'

// Helper: navigate admin to the Live (front-desk) mode
async function goToFrontDesk(page: import('@playwright/test').Page) {
  const liveBtn = page.getByRole('button', { name: /^live$/i })
  await expect(liveBtn).toBeVisible({ timeout: 8000 })
  await liveBtn.click()
  // Wait for the live dashboard to finish loading — session rows or empty state
  await expect(
    page.locator('[data-testid="session-row"]').first()
      .or(page.locator('text=/no sessions scheduled|no classes assigned/i'))
  ).toBeVisible({ timeout: 12000 })
}

test.describe('Admin dashboard', () => {
  test('loads and shows Management / Live mode switcher', async ({ adminPage: page }) => {
    await expect(page.getByRole('button', { name: /management/i })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /^live$/i })).toBeVisible()
  })

  test('Live mode shows session list for today', async ({ adminPage: page }) => {
    await goToFrontDesk(page)
    // Either session rows or an empty state — never blank
    const rows  = page.locator('[data-testid="session-row"]')
    const empty = page.locator('text=/no classes|no sessions/i')
    await expect(rows.first().or(empty)).toBeVisible({ timeout: 8000 })
  })

  test('clicking a session row expands its booking list', async ({ adminPage: page }) => {
    await goToFrontDesk(page)
    const rows = page.locator('[data-testid="session-row"]')
    if (await rows.count() === 0) { test.skip(); return }

    await rows.first().click()
    await expect(
      page.locator('text=/booked|attendees|check.?in|no bookings/i').first()
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Member search and drawer', () => {
  test('searching for the E2E member returns a result', async ({ adminPage: page }) => {
    await goToFrontDesk(page)

    // Open the member search drawer via the "Find member" button
    const findBtn = page.getByRole('button', { name: /find member/i })
    await expect(findBtn).toBeVisible({ timeout: 6000 })
    await findBtn.click()

    // Drawer opens — type in the search input
    const drawerInput = page.locator('[data-testid="member-drawer"] input').first()
    await expect(drawerInput).toBeVisible({ timeout: 5000 })

    const searchTerm = MEMBER_EMAIL.split('@')[0].slice(0, 6)
    await drawerInput.fill(searchTerm)
    await page.waitForTimeout(600) // debounce

    const results = page.locator('[data-testid="member-row"]')
    await expect(results.first()).toBeVisible({ timeout: 6000 })
  })

  test('clicking a member row shows their credit balance', async ({ adminPage: page }) => {
    await goToFrontDesk(page)

    const findBtn = page.getByRole('button', { name: /find member/i })
    await expect(findBtn).toBeVisible({ timeout: 6000 })
    await findBtn.click()

    const drawerInput = page.locator('[data-testid="member-drawer"] input').first()
    await expect(drawerInput).toBeVisible({ timeout: 5000 })
    await drawerInput.fill(MEMBER_EMAIL.split('@')[0].slice(0, 6))
    await page.waitForTimeout(600)

    const result = page.locator('[data-testid="member-row"]').first()
    await expect(result).toBeVisible({ timeout: 5000 })
    await result.click()

    // Drawer should now show credit balance
    const drawer = page.locator('[data-testid="member-drawer"]')
    await expect(drawer).toContainText(/cr|credit/i, { timeout: 5000 })
  })
})

test.describe('Check-in flow', () => {
  test('check-in button appears when a member is selected for a session with a booking', async ({ adminPage: page }) => {
    await goToFrontDesk(page)

    const rows = page.locator('[data-testid="session-row"]')
    if (await rows.count() === 0) { test.skip(); return }

    // Click each session until one has bookings
    let found = false
    const count = await rows.count()
    for (let i = 0; i < count && !found; i++) {
      await rows.nth(i).click()
      await page.waitForTimeout(400)

      // If this session has bookings, a member avatar/row should appear
      // Click it to open the drawer with the check-in button
      const bookingEntry = page.locator('[data-testid="booking-row"]').first()
      if (await bookingEntry.isVisible({ timeout: 2000 })) {
        await bookingEntry.click()
        const checkinBtn = page.locator('[data-testid="checkin-btn"]')
        if (await checkinBtn.isVisible({ timeout: 3000 })) {
          found = true
          const before = await checkinBtn.textContent()
          await checkinBtn.click()
          await page.waitForTimeout(600)
          const after = await checkinBtn.textContent()
          expect(after).not.toBe(before)
        }
      }
    }
    if (!found) test.skip()
  })
})
