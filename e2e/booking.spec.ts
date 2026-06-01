/**
 * Booking flow — member perspective.
 *
 * Prerequisite: global-setup.ts has run and seeded the test member with credits.
 * Tests run serially (workers: 1) because they share real DB state.
 *
 * Flow: browse classes → open session detail → book → verify booked → cancel → verify unbooked
 */

import { test, expect } from './fixtures'

test.describe('Schedule', () => {
  test('shows day tabs and class cards', async ({ authedPage: page }) => {
    // Seven day tabs
    await expect(page.locator('[data-testid="day-tab"]')).toHaveCount(7)

    // At least one class card OR an empty-state message — never blank
    const cards = page.locator('[data-testid="class-card"]')
    const empty = page.locator('text=/no classes/i')
    await expect(cards.first().or(empty)).toBeVisible({ timeout: 8000 })
  })

  test('today tab is selected by default', async ({ authedPage: page }) => {
    const selected = page.locator('[data-testid="day-tab"][aria-selected="true"]')
    await expect(selected).toBeVisible()
  })

  test('switching day tab updates class list without crashing', async ({ authedPage: page }) => {
    const tabs = page.locator('[data-testid="day-tab"]')
    await tabs.nth(2).click()
    await page.waitForTimeout(500)
    // Page is still functional — either cards or empty state
    await expect(
      page.locator('[data-testid="class-card"]').first()
        .or(page.locator('text=/no classes/i'))
    ).toBeVisible({ timeout: 5000 })
  })

  test('clicking a class card opens session detail with capacity info', async ({ authedPage: page }) => {
    const futureCards = page.locator('[data-testid="class-card"][data-past="false"]')
    const tabs = page.locator('[data-testid="day-tab"]')

    // Find a day with at least one future (clickable) card
    let found = false
    for (let i = 0; i < 7 && !found; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)
      if (await futureCards.count() > 0) { found = true }
    }
    if (!found) { test.skip(); return }

    await futureCards.first().click()
    const detail = page.locator('[data-testid="session-detail"]')
    await expect(detail).toBeVisible({ timeout: 5000 })
    // Must show capacity (e.g. "4/20 booked")
    await expect(detail).toContainText(/\/\d+ booked/i)
  })
})

test.describe('Credit balance', () => {
  test('booking a class decrements credit balance; cancelling restores it', async ({ authedPage: page }) => {
    // Read initial credit balance from the account page
    await page.goto('/account')
    const balanceEl = page.locator('[data-testid="credit-balance"]')
    await expect(balanceEl).toBeVisible({ timeout: 8000 })
    const initialText = await balanceEl.textContent()
    const initialBalance = parseInt(initialText?.match(/\d+/)?.[0] ?? '-1', 10)
    if (initialBalance < 1) { test.skip(); return } // need at least 1 credit

    // Navigate to schedule and find a class that costs exactly 1 credit
    await page.goto('/schedule')
    const tabs = page.locator('[data-testid="day-tab"]')
    let sessionCost = -1
    let booked = false

    for (let dayIdx = 0; dayIdx < 7 && !booked; dayIdx++) {
      await tabs.nth(dayIdx).click()
      await page.waitForTimeout(400)
      const cards = page.locator('[data-testid="class-card"][data-past="false"]')
      const count = await cards.count()

      for (let i = 0; i < count && !booked; i++) {
        const text = await cards.nth(i).textContent() ?? ''
        if (text.toLowerCase().includes('booked')) continue
        // Look for a credit cost indicator
        const costMatch = text.match(/(\d+)\s*cr/)
        if (!costMatch) continue
        sessionCost = parseInt(costMatch[1], 10)
        if (sessionCost > initialBalance) continue

        await cards.nth(i).click()
        const bookBtn = page.locator('[data-testid="book-btn"]')
        // Session may have a room layout (spot-picker instead of book-btn) — skip those
        const btnVisible = await bookBtn.isVisible({ timeout: 5000 }).catch(() => false)
        if (!btnVisible || !await bookBtn.isEnabled()) {
          await page.goBack(); continue
        }

        await bookBtn.click()
        await expect(page.locator('[data-testid="toast"]')).toBeVisible({ timeout: 8000 })
        await expect(page.locator('[data-testid="toast"]')).not.toBeVisible({ timeout: 5000 })
        booked = true

        // Verify balance decremented — poll until the account page shows the updated value
        await page.goto('/account')
        await expect(balanceEl).toContainText(String(initialBalance - sessionCost), { timeout: 10000 })

        // Cancel and verify balance restored
        await page.goto('/schedule')
        await tabs.nth(dayIdx).click()
        await page.waitForTimeout(400)
        const bookedCard = page.locator('[data-testid="class-card"][data-past="false"]').filter({ hasText: /booked/i })
        await bookedCard.first().click()
        const cancelBtn = page.locator('[data-testid="cancel-btn"]')
        await expect(cancelBtn).toBeEnabled({ timeout: 5000 })
        await cancelBtn.click()
        await expect(page.locator('[data-testid="toast"]')).toBeVisible({ timeout: 8000 })
        await expect(page.locator('[data-testid="toast"]')).not.toBeVisible({ timeout: 5000 })

        // Poll until the account page shows the restored balance
        await page.goto('/account')
        await expect(balanceEl).toContainText(String(initialBalance), { timeout: 10000 })
      }
    }

    if (!booked) test.skip()
  })
})

test.describe('Book and cancel flow', () => {
  test('can book an available class and then cancel it', async ({ authedPage: page }) => {
    // Find a future bookable class (not full, not already booked)
    let found = false
    const tabs = page.locator('[data-testid="day-tab"]')

    for (let dayIdx = 0; dayIdx < 7 && !found; dayIdx++) {
      await tabs.nth(dayIdx).click()
      await page.waitForTimeout(400)
      await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 6000 })

      const cards = page.locator('[data-testid="class-card"][data-past="false"]')
      const count = await cards.count()

      for (let i = 0; i < count && !found; i++) {
        const card = cards.nth(i)
        // Skip cards already showing as booked
        const text = await card.textContent()
        if (text?.toLowerCase().includes('booked')) continue

        await card.click()
        const detail = page.locator('[data-testid="session-detail"]')
        await expect(detail).toBeVisible({ timeout: 5000 })

        const bookBtn = page.locator('[data-testid="book-btn"]')
        if (await bookBtn.count() > 0 && await bookBtn.isEnabled()) {
          found = true

          // ── Book ──────────────────────────────────────────────────
          await bookBtn.click()
          const toast = page.locator('[data-testid="toast"]')
          await expect(toast).toBeVisible({ timeout: 8000 })
          const toastText = await toast.textContent()
          expect(toastText?.toLowerCase()).toMatch(/booked|success|confirmed/i)
          await expect(toast).not.toBeVisible({ timeout: 5000 })

          // Session detail should now show "You're booked"
          await expect(detail).toContainText(/you.re booked/i)

          // Cancel button should now be enabled
          const cancelBtn = page.locator('[data-testid="cancel-btn"]')
          await expect(cancelBtn).toBeEnabled({ timeout: 3000 })

          // ── Cancel ────────────────────────────────────────────────
          await cancelBtn.click()
          const cancelToast = page.locator('[data-testid="toast"]')
          await expect(cancelToast).toBeVisible({ timeout: 8000 })
          const cancelText = await cancelToast.textContent()
          expect(cancelText?.toLowerCase()).toMatch(/cancel|removed/i)
        } else {
          // Not bookable — go back and try next card
          const backBtn = page.locator('button', { hasText: /back to schedule/i })
          if (await backBtn.count() > 0) await backBtn.click()
          else await page.goBack()
          await page.waitForTimeout(300)
        }
      }
    }

    if (!found) {
      test.skip() // No bookable session in the 7-day window — seed issue
    }
  })
})
