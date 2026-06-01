/**
 * Staff shift management — admin perspective.
 *
 * Prerequisite: global-setup.ts has run and assigned the fronthost role to
 * e2e-member@packd.test so they appear in the StaffTab.
 *
 * Tests are serial because they share DB state (shifts created then deleted).
 *
 * Flow:
 *  - Open Staff tab → find the fronthost member → open their drawer
 *  - Add a one-off shift, verify it appears, edit the time, delete it
 *  - Add a recurring pattern (Mon every 2 weeks), verify the card, delete it
 */

import { test, expect } from './fixtures'

const FRONTHOST_EMAIL = process.env.E2E_EMAIL ?? 'e2e-member@packd.test'

async function goToStaffTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  // Wait for the management/live mode switcher — confirms the dashboard loaded
  await expect(page.getByRole('button', { name: /^live$/i })).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: /^staff$/i }).click()
  // Wait for the staff member list to appear
  await expect(page.locator('[data-testid="staff-member-row"]').first()).toBeVisible({ timeout: 10_000 })
}

async function openFronthostDrawer(page: import('@playwright/test').Page) {
  const row = page.locator(`[data-testid="staff-member-row"][data-email="${FRONTHOST_EMAIL}"]`)
  await expect(row).toBeVisible({ timeout: 8_000 })
  await row.click()
  // Drawer opens — shifts section should appear
  await expect(page.getByTestId('add-shift-btn')).toBeVisible({ timeout: 5_000 })
}

// Delete all leftover shifts so retries start from a clean state
async function deleteAllShifts(page: import('@playwright/test').Page) {
  while (await page.getByTestId('delete-shift-btn').first().isVisible().catch(() => false)) {
    await page.getByTestId('delete-shift-btn').first().click()
    await expect(page.getByTestId('delete-shift-btn').first()).not.toBeVisible({ timeout: 3_000 }).catch(() => {})
  }
}

test.describe('Staff shifts — one-off', () => {
  test.use({ testIdAttribute: 'data-testid' })

  test('adds a shift, edits its time, then deletes it', async ({ adminPage: page }) => {
    await goToStaffTab(page)
    await openFronthostDrawer(page)
    await deleteAllShifts(page)

    // ── Add shift ──────────────────────────────────────────────────────────
    await page.getByTestId('add-shift-btn').click()

    // Modal opens — fill tomorrow's date, 09:00–17:00
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await page.locator('input[type="date"]').fill(tomorrow)
    await page.locator('input[type="time"]').nth(0).fill('09:00')
    await page.locator('input[type="time"]').nth(1).fill('17:00')
    await page.getByTestId('shift-save-btn').click()
    // Wait for add modal to close (confirms the save completed and load() was triggered)
    await expect(page.getByTestId('shift-save-btn')).not.toBeVisible({ timeout: 8_000 })

    // Wait for the shift row to show the expected time (retries until UI refreshes)
    await expect(page.getByTestId('shift-time').first()).toHaveText(/9.*(am|:00).*5.*(pm|:00)/i, { timeout: 10_000 })

    // ── Edit shift ─────────────────────────────────────────────────────────
    await page.getByTestId('edit-shift-btn').first().click()
    // Wait for the edit modal's save button to confirm the modal is open
    await expect(page.getByTestId('shift-save-btn')).toBeVisible({ timeout: 5_000 })

    // Change end time to 18:00
    await page.locator('input[type="time"]').nth(1).fill('18:00')
    await page.getByTestId('shift-save-btn').click()
    // Wait for modal to close (confirms onSaved() fired and load() was triggered)
    await expect(page.getByTestId('shift-save-btn')).not.toBeVisible({ timeout: 8_000 })

    // Wait for the time to update to 6 PM (retries until UI refreshes)
    await expect(page.getByTestId('shift-time').first()).toHaveText(/6.*(pm|:00)/i, { timeout: 10_000 })

    // ── Delete shift ───────────────────────────────────────────────────────
    await page.getByTestId('delete-shift-btn').first().click()
    await expect(page.getByTestId('shift-row').first()).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Staff shifts — recurring pattern', () => {
  test.use({ testIdAttribute: 'data-testid' })

  test('adds a recurring pattern and then deletes it', async ({ adminPage: page }) => {
    await goToStaffTab(page)
    await openFronthostDrawer(page)

    // ── Add recurring pattern ──────────────────────────────────────────────
    await page.getByTestId('add-recurring-btn').click()

    // Modal — Mon is selected by default; change interval to every 2 weeks
    await page.getByRole('button', { name: '2 weeks' }).click()
    await page.locator('input[type="time"]').nth(0).fill('08:00')
    await page.locator('input[type="time"]').nth(1).fill('16:00')

    // validFrom — today
    const today = new Date().toISOString().slice(0, 10)
    await page.locator('input[type="date"]').first().fill(today)

    await page.getByRole('button', { name: /create pattern/i }).click()

    // Pattern card should appear
    await expect(page.getByTestId('pattern-row').first()).toBeVisible({ timeout: 6_000 })
    const intervalBadge = await page.getByTestId('pattern-interval').first().textContent()
    expect(intervalBadge?.toLowerCase()).toMatch(/every 2 week/i)
    const daysBadge = await page.getByTestId('pattern-days').first().textContent()
    expect(daysBadge).toMatch(/Mon/i)

    // ── Delete pattern ─────────────────────────────────────────────────────
    await page.getByTestId('delete-pattern-btn').first().click()
    await expect(page.getByTestId('pattern-row').first()).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Staff shifts — audit trail', () => {
  test.use({ testIdAttribute: 'data-testid' })

  test('shift actions appear in the audit log', async ({ adminPage: page }) => {
    await goToStaffTab(page)
    await openFronthostDrawer(page)

    // Add a shift so there's something to audit
    await page.getByTestId('add-shift-btn').click()
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await page.locator('input[type="date"]').fill(tomorrow)
    await page.locator('input[type="time"]').nth(0).fill('10:00')
    await page.locator('input[type="time"]').nth(1).fill('14:00')
    await page.getByTestId('shift-save-btn').click()
    await expect(page.getByTestId('shift-row').first()).toBeVisible({ timeout: 6_000 })

    // Delete the shift
    await page.getByTestId('delete-shift-btn').first().click()
    await expect(page.getByTestId('shift-row').first()).not.toBeVisible({ timeout: 5_000 })

    // Navigate to Audit Log tab
    await page.getByRole('button', { name: /audit log/i }).click()
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 5_000 })

    // Should have at least one shift-related entry
    const entries = page.getByTestId('audit-entry')
    await expect(entries.first()).toBeVisible({ timeout: 8_000 })
    const shiftEntry = page.locator('[data-testid="audit-entry"][data-action^="shift."]')
    await expect(shiftEntry.first()).toBeVisible({ timeout: 5_000 })
  })
})
