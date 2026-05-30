/**
 * Schedule view — authenticated member.
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
    await pills.nth(1).click()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)
    await pills.nth(0).click()
  })

  test('week navigation arrows work without errors', async ({ authedPage: page }) => {
    // Wait for day tabs to be ready before interacting with navigation
    await expect(page.locator('[data-testid="day-tab"]').first()).toBeVisible({ timeout: 8000 })
    const nextBtn = page.getByRole('button', { name: /next week/i })
    await expect(nextBtn).toBeVisible({ timeout: 5000 })
    await nextBtn.click()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)

    const prevBtn = page.getByRole('button', { name: /previous week/i })
    await prevBtn.click()
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)
  })

  test('session detail shows capacity on card click', async ({ authedPage: page }) => {
    const futureCards = page.locator('[data-testid="class-card"][data-past="false"]')
    const tabs  = page.locator('[data-testid="day-tab"]')

    let found = false
    for (let i = 0; i < 7 && !found; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)
      if (await futureCards.count() > 0) { found = true; break }
    }
    if (!found) { test.skip(); return }

    await futureCards.first().click()
    const detail = page.locator('[data-testid="session-detail"]')
    await expect(detail).toBeVisible({ timeout: 8000 })
    await expect(detail).toContainText(/\/\d+ booked/i)

    // Action area is present — cancel-btn is always rendered (disabled if not booked)
    await expect(detail.locator('[data-testid="cancel-btn"]')).toBeVisible({ timeout: 3000 })
  })
})
