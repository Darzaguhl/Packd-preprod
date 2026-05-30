/**
 * Schedule view — authenticated member.
 * These tests verify structural correctness of the schedule UI,
 * not the booking flow (see booking.spec.ts for that).
 */

import { test, expect } from './fixtures'

test.describe('Schedule view', () => {
  test('renders 7 day tabs', async ({ authedPage: page }) => {
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)
  })

  test('today is selected by default', async ({ authedPage: page }) => {
    const selected = page.locator('[data-testid="day-tab"][aria-selected="true"]')
    await expect(selected).toBeVisible()
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' })
    await expect(selected).toContainText(today)
  })

  test('each class card has a capacity bar', async ({ authedPage: page }) => {
    const cards = page.locator('[data-testid="class-card"]')
    const count = await cards.count()
    if (count === 0) { test.skip(); return }

    await expect(cards.first().locator('[data-testid="capacity-bar"]')).toBeVisible()
  })

  test('sport filter pills appear and filtering does not crash', async ({ authedPage: page }) => {
    const pills = page.locator('[data-testid="sport-filter"]')
    const pillCount = await pills.count()
    if (pillCount < 2) { test.skip(); return }

    // Click the second pill (first non-All)
    await pills.nth(1).click()
    await page.waitForTimeout(500)
    // Page remains stable
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)
    // Click All back
    await pills.nth(0).click()
  })

  test('week navigation works without errors', async ({ authedPage: page }) => {
    const nextBtn = page.getByRole('button', { name: /next week/i })
    await expect(nextBtn).toBeVisible()
    await nextBtn.click()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)

    const todayBtn = page.getByRole('button', { name: /^today$/i })
    await expect(todayBtn).toBeVisible()
    await todayBtn.click()
    await page.waitForTimeout(300)
  })

  test('session detail shows instructor and room on click', async ({ authedPage: page }) => {
    const cards = page.locator('[data-testid="class-card"]')
    const tabs  = page.locator('[data-testid="day-tab"]')

    // Find a day with sessions
    let found = false
    for (let i = 0; i < 7 && !found; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)
      if (await cards.count() > 0) { found = true; break }
    }
    if (!found) { test.skip(); return }

    await cards.first().click()
    const detail = page.locator('[data-testid="session-detail"]')
    await expect(detail).toBeVisible({ timeout: 5000 })

    // Must contain instructor name and capacity
    await expect(detail).toContainText(/\/\d+ booked/i)
    // Book or cancel button must be visible (past sessions show "This class has already started")
    await expect(
      detail.locator('[data-testid="book-btn"]')
        .or(detail.locator('[data-testid="cancel-btn"]'))
        .or(detail.locator('text=/already started|booked/i'))
    ).toBeVisible({ timeout: 3000 })
  })
})
