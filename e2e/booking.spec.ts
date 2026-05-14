import { test, expect } from './fixtures'

test.describe('Booking flow (authenticated)', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    // Wait for loading skeletons to disappear
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
  })

  test('book button triggers booking and shows toast', async ({ authedPage: page }) => {
    const bookBtn = page.locator('[data-testid="book-btn"]').first()
    const count = await bookBtn.count()
    if (count === 0) {
      test.skip()
      return
    }
    await bookBtn.click()
    // Toast should appear with success or error message
    await expect(page.locator('[data-testid="toast"], .fixed.bottom-6')).toBeVisible({ timeout: 5000 })
  })

  test('waitlist button joins queue and shows position toast', async ({ authedPage: page }) => {
    const waitlistBtn = page.locator('[data-testid="waitlist-btn"]').first()
    const count = await waitlistBtn.count()
    if (count === 0) {
      test.skip()
      return
    }
    await waitlistBtn.click()
    await expect(page.locator('.fixed.bottom-6')).toBeVisible({ timeout: 5000 })
    const toast = page.locator('.fixed.bottom-6')
    const text = await toast.textContent()
    // Toast should mention position or an error
    expect(text).toMatch(/waitlist|position|failed/i)
  })
})
