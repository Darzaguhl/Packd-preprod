/**
 * Member account page (/account).
 *
 * Verifies: iCal subscribe card visible, credit balance shown,
 * basic page structure intact.
 */

import { test, expect } from './fixtures'

test.describe('Account page', () => {
  test('loads and shows credit balance', async ({ authedPage: page }) => {
    await page.goto('/account')
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })

    // Either a credit balance number or a zero-state — never blank
    await expect(
      page.locator('text=/credit/i').first()
    ).toBeVisible({ timeout: 8_000 })
  })

  test('shows iCal subscribe card for member', async ({ authedPage: page }) => {
    await page.goto('/account')
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })

    const icalCard = page.getByTestId('ical-member-card')
    await expect(icalCard).toBeVisible({ timeout: 8_000 })
    await expect(icalCard.getByRole('button', { name: /copy ical url/i })).toBeVisible()
    await expect(icalCard.getByRole('link', { name: /open in calendar/i })).toBeVisible()
  })

  test('upcoming bookings section is present', async ({ authedPage: page }) => {
    await page.goto('/account')
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })

    // Upcoming section or empty state — never blank
    await expect(
      page.locator('text=/upcoming|no upcoming|no classes/i').first()
    ).toBeVisible({ timeout: 8_000 })
  })
})
