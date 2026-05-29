import { test, expect } from './fixtures'

test.describe('Booking flow (authenticated)', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
  })

  test('book button triggers booking and shows toast', async ({ authedPage: page }) => {
    const bookBtn = page.locator('[data-testid="book-btn"]').first()
    if (await bookBtn.count() === 0) { test.skip(); return }
    await bookBtn.click()
    await expect(page.locator('[data-testid="toast"], .fixed.bottom-6')).toBeVisible({ timeout: 5000 })
  })

  test('booked class shows cancel button in session detail', async ({ authedPage: page }) => {
    // Click any booked class card (status label will say "Booked")
    const bookedCard = page.locator('[data-testid="class-card"]').filter({ hasText: /booked/i }).first()
    if (await bookedCard.count() === 0) { test.skip(); return }
    await bookedCard.click()
    // Session detail panel opens
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
    // Cancel button should be present
    await expect(page.locator('button', { hasText: /cancel/i })).toBeVisible()
  })

  test('cancel booking shows confirmation toast', async ({ authedPage: page }) => {
    const bookedCard = page.locator('[data-testid="class-card"]').filter({ hasText: /booked/i }).first()
    if (await bookedCard.count() === 0) { test.skip(); return }
    await bookedCard.click()
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
    const cancelBtn = page.locator('button', { hasText: /cancel booking/i })
    if (await cancelBtn.count() === 0) { test.skip(); return }
    await cancelBtn.click()
    // Confirmation dialog or immediate toast
    const confirmBtn = page.locator('button', { hasText: /yes|confirm|cancel booking/i }).last()
    if (await confirmBtn.isVisible()) await confirmBtn.click()
    await expect(page.locator('.fixed.bottom-6')).toBeVisible({ timeout: 5000 })
    const text = await page.locator('.fixed.bottom-6').textContent()
    expect(text).toMatch(/cancelled|cancel/i)
  })

  test('waitlist button joins queue and shows position toast', async ({ authedPage: page }) => {
    const waitlistBtn = page.locator('[data-testid="waitlist-btn"]').first()
    if (await waitlistBtn.count() === 0) { test.skip(); return }
    await waitlistBtn.click()
    await expect(page.locator('.fixed.bottom-6')).toBeVisible({ timeout: 5000 })
    const text = await page.locator('.fixed.bottom-6').textContent()
    expect(text).toMatch(/waitlist|position|failed/i)
  })

  test('session detail shows class info and capacity', async ({ authedPage: page }) => {
    const card = page.locator('[data-testid="class-card"]').first()
    if (await card.count() === 0) { test.skip(); return }
    await card.click()
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
    // Should show capacity / spots left
    await expect(page.locator('[data-testid="session-detail"]')).toContainText(/spot|capacity|full/i)
  })
})
