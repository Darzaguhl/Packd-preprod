/**
 * Booking flow — member perspective.
 *
 * Prerequisites:
 *  - global-setup.ts has seeded the test member with credits AND created a synthetic
 *    future session (source='e2e-test') in a room without a layout so book-btn renders.
 *  - Tests run serially (workers: 1) because they share real DB state.
 *
 * Schedule view rendering tests live in schedule.spec.ts; this file covers the
 * actual book/cancel flows and credit accounting.
 */

import { test, expect } from './fixtures'

test.describe('Credit balance', () => {
  test('booking a class decrements credit balance; cancelling restores it', async ({ authedPage: page }) => {
    test.setTimeout(90_000) // card-scanning loop can be slow across 7 days

    // Read initial credit balance from the account page
    await page.goto('/account')
    const balanceEl = page.locator('[data-testid="credit-balance"]')
    await expect(balanceEl).toBeVisible({ timeout: 8000 })
    const initialText = await balanceEl.textContent()
    const initialBalance = parseInt(initialText?.match(/\d+/)?.[0] ?? '-1', 10)
    if (initialBalance < 1) { test.skip(); return } // need at least 1 credit

    // Navigate to schedule and find a class that costs credits and is bookable
    await page.goto('/schedule')
    const tabs = page.locator('[data-testid="day-tab"]')
    let sessionCost = -1
    let booked = false

    for (let dayIdx = 0; dayIdx < 7 && !booked; dayIdx++) {
      await tabs.nth(dayIdx).click()
      // Wait for schedule to settle before reading card texts
      await expect(
        page.locator('[data-testid="class-card"]').first()
          .or(page.locator('text=/no classes/i'))
      ).toBeVisible({ timeout: 6000 }).catch(() => {})

      const cards = page.locator('[data-testid="class-card"][data-past="false"]')
      // Fetch all card texts in one round-trip to avoid O(N) individual calls
      const texts: string[] = await cards.evaluateAll(
        (els: Element[]) => els.map(el => el.textContent ?? '')
      )

      for (let i = 0; i < texts.length && !booked; i++) {
        const text = texts[i]
        if (text.toLowerCase().includes('booked')) continue
        const costMatch = text.match(/(\d+)\s*cr/)
        if (!costMatch) continue
        sessionCost = parseInt(costMatch[1], 10)
        if (sessionCost > initialBalance) continue

        await cards.nth(i).click()
        // Wait for SessionDetailView to mount before checking for book-btn.
        // The 'Back to schedule' button is always present once the detail renders,
        // so we use it as a proxy for "the detail is open".
        const backBtn = page.locator('button', { hasText: /back to schedule/i })
        const detailVisible = await backBtn.isVisible({ timeout: 4000 }).catch(() => false)
        if (!detailVisible) {
          // Detail never opened (navigation may still be in progress) — hard-navigate
          // back to schedule rather than relying on browser history which can overshoot.
          await page.goto('/schedule')
          continue
        }
        const bookBtn = page.locator('[data-testid="book-btn"]')
        // Session may have a room layout (spot-picker instead of book-btn) — skip those.
        const btnVisible = await bookBtn.isVisible({ timeout: 500 }).catch(() => false)
        if (!btnVisible || !await bookBtn.isEnabled()) {
          await backBtn.click()
          // Wait for detail to close before trying the next card
          await expect(backBtn).not.toBeVisible({ timeout: 4000 }).catch(() => {})
          continue
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
        // Wait for the schedule to load before looking for the booked card
        await expect(
          page.locator('[data-testid="class-card"]').first()
            .or(page.locator('text=/no classes/i'))
        ).toBeVisible({ timeout: 6000 }).catch(() => {})
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
