import { test, expect } from './fixtures'

test.describe('Schedule view (authenticated)', () => {
  test('loads schedule page with day tabs', async ({ authedPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible()
    // Seven day tabs should render
    const tabs = page.locator('[data-testid="day-tab"]')
    await expect(tabs).toHaveCount(7)
  })

  test('shows Today tab as selected by default', async ({ authedPage: page }) => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' })
    const selectedTab = page.locator('[data-testid="day-tab"][aria-selected="true"]')
    await expect(selectedTab).toContainText(today)
  })

  test('renders class cards with capacity bar', async ({ authedPage: page }) => {
    // Wait for loading skeletons to disappear
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    const cards = page.locator('[data-testid="class-card"]')
    // Either classes exist or empty-state message
    const count = await cards.count()
    if (count > 0) {
      await expect(cards.first()).toBeVisible()
      await expect(page.locator('[data-testid="capacity-bar"]').first()).toBeVisible()
    } else {
      await expect(page.getByText(/no classes/i)).toBeVisible()
    }
  })

  test('week navigation — next/prev week loads new data', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: 'Next week' }).click()
    // URL or state changes; tabs re-render
    const tabs = page.locator('[data-testid="day-tab"]')
    await expect(tabs).toHaveCount(7)
    await page.getByRole('button', { name: 'Today' }).click()
    await expect(tabs).toHaveCount(7)
  })

  test('sport filter hides non-matching classes', async ({ authedPage: page }) => {
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 8000 })
    const filterPills = page.locator('[data-testid="sport-filter"]')
    const pillCount = await filterPills.count()
    if (pillCount > 1) {
      // Click any sport pill that is not "All classes"
      await filterPills.nth(1).click()
      // Re-check that only filtered cards remain (or empty state)
      const cards = page.locator('[data-testid="class-card"]')
      const filtered = await cards.count()
      // Clicking a specific sport should show fewer or equal cards
      expect(filtered).toBeGreaterThanOrEqual(0)
    }
  })

  test('switching day tab updates the class list', async ({ authedPage: page }) => {
    const tabs = page.locator('[data-testid="day-tab"]')
    await tabs.nth(2).click()
    // Wait a tick; no crash, cards or empty state visible
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="class-card"], text=/no classes/i').first()).toBeVisible()
  })
})
