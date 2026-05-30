/**
 * Front-desk / admin flows.
 *
 * Prerequisite: global-setup.ts has run. The test admin has studio_admin role.
 * The test member (e2e-member@packd.test) has a Member record in this studio.
 */

import { test, expect } from './fixtures'

const MEMBER_EMAIL = process.env.E2E_EMAIL ?? 'e2e-member@packd.test'

test.describe('Admin dashboard', () => {
  test('loads with session list and navigation tabs', async ({ adminPage: page }) => {
    // The dashboard should show at least a heading
    await expect(
      page.getByRole('heading').first()
        .or(page.locator('text=/today|sessions|dashboard/i').first())
    ).toBeVisible({ timeout: 5000 })
  })

  test('session list shows rows for today', async ({ adminPage: page }) => {
    // Either session rows appear or a "no classes today" state — never blank
    const rows  = page.locator('[data-testid="session-row"]')
    const empty = page.locator('text=/no classes|no sessions/i')
    await expect(rows.first().or(empty)).toBeVisible({ timeout: 8000 })
  })

  test('clicking a session row shows booking list', async ({ adminPage: page }) => {
    const rows = page.locator('[data-testid="session-row"]')
    if (await rows.count() === 0) { test.skip(); return }

    await rows.first().click()
    // After clicking a session, the booking list or "no bookings" should appear
    await expect(
      page.locator('text=/booked|attendees|check.?in|no bookings/i').first()
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Member search and drawer', () => {
  test('searching for the E2E member returns a result', async ({ adminPage: page }) => {
    // Open the member search / front-desk drawer
    const findBtn = page.locator('button', { hasText: /find member/i })
      .or(page.locator('[placeholder*="member" i], [placeholder*="search" i]').first())
    await expect(findBtn).toBeVisible({ timeout: 6000 })

    // Type a few characters from the E2E member email
    const searchTerm = MEMBER_EMAIL.split('@')[0].slice(0, 6)
    const input = page.locator('[placeholder*="search" i], [placeholder*="member" i], [placeholder*="name" i]').first()

    if (await findBtn.evaluate(el => el.tagName) === 'BUTTON') {
      await (findBtn as import('@playwright/test').Locator).click()
    }

    // If a modal/drawer opened, look for an input inside it
    const drawerInput = page.locator('[data-testid="member-drawer"] input').first()
    const activeInput = await drawerInput.count() > 0 ? drawerInput : input
    await activeInput.fill(searchTerm)
    await page.waitForTimeout(500) // debounce

    // At least one result row should appear
    const results = page.locator('[data-testid="member-row"]')
    await expect(results.first()).toBeVisible({ timeout: 6000 })
  })

  test('clicking a member row shows their credit balance', async ({ adminPage: page }) => {
    // Open the drawer by clicking "Find member"
    const findBtn = page.locator('button', { hasText: /find member/i })
    if (await findBtn.count() === 0) { test.skip(); return }
    await findBtn.click()

    const searchTerm = MEMBER_EMAIL.split('@')[0].slice(0, 6)
    const input = page.locator('[data-testid="member-drawer"] input').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill(searchTerm)
    await page.waitForTimeout(500)

    const result = page.locator('[data-testid="member-row"]').first()
    await expect(result).toBeVisible({ timeout: 5000 })
    await result.click()

    // Drawer should show the member's credit balance
    const drawer = page.locator('[data-testid="member-drawer"]')
    await expect(drawer).toContainText(/cr|credit/i, { timeout: 5000 })
  })
})

test.describe('Check-in flow', () => {
  test('check-in button appears when a member is booked into the selected session', async ({ adminPage: page }) => {
    // Select a session that has at least one booking
    const rows = page.locator('[data-testid="session-row"]')
    if (await rows.count() === 0) { test.skip(); return }

    // Try each session row until we find one with bookings
    let checkinFound = false
    const count = await rows.count()
    for (let i = 0; i < count && !checkinFound; i++) {
      await rows.nth(i).click()
      await page.waitForTimeout(400)

      const attendees = page.locator('text=/booked|checked.?in/i').first()
      if (await attendees.isVisible({ timeout: 2000 })) {
        // Open the drawer for this member and look for check-in button
        const memberClickable = page.locator('[data-testid="booking-row"], [class*="booking"]').first()
        if (await memberClickable.count() > 0) {
          await memberClickable.click()
          const checkinBtn = page.locator('[data-testid="checkin-btn"]')
          if (await checkinBtn.isVisible({ timeout: 3000 })) {
            checkinFound = true
            // Toggle check-in and verify button text changes
            const before = await checkinBtn.textContent()
            await checkinBtn.click()
            await page.waitForTimeout(500)
            const after = await checkinBtn.textContent()
            expect(after).not.toBe(before)
          }
        }
      }
    }
    if (!checkinFound) test.skip()
  })
})
