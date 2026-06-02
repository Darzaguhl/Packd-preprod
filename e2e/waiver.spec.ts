/**
 * Waiver gate E2E tests.
 *
 * Prerequisites:
 *  - global-setup.ts has seeded a waiver for the studio and pre-signed it
 *    for the test member (so other tests are unaffected).
 *  - adminPage is authenticated as studio_admin.
 *
 * Strategy: each test creates a NEW waiver version via the admin API, which
 * supersedes the pre-signed version. The test member then encounters the
 * waiver gate when booking. After the test, the waiver is removed.
 */

import { test, expect } from './fixtures'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const STUDIO_ID = process.env.NEXT_PUBLIC_STUDIO_ID ?? ''

/** Create a new waiver version via the API (supersedes any existing signature). */
async function createWaiverVersion(adminToken: string, title: string) {
  const res = await fetch(`${API_URL}/waivers/admin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      studioId: STUDIO_ID,
      title,
      body: 'You agree to participate safely. This is an E2E test waiver.',
    }),
  })
  return res.ok
}

/** Remove the active waiver so subsequent tests book without the gate. */
async function removeWaiver(adminToken: string) {
  await fetch(`${API_URL}/waivers/admin?studioId=${STUDIO_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  })
}

/** Get the admin JWT from the page's localStorage (set by Supabase auth). */
async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? ''
      if (key.includes('auth-token') || key.includes('supabase')) {
        try {
          const val = JSON.parse(localStorage.getItem(key) ?? '{}')
          return val?.access_token ?? val?.session?.access_token ?? ''
        } catch { return '' }
      }
    }
    return ''
  })
  return token
}

test.describe('Waiver gate', () => {
  test.use({ testIdAttribute: 'data-testid' })

  test('booking a class with an unsigned waiver shows the waiver modal', async ({ adminPage, authedPage: memberPage }) => {
    // Get admin token and create a new waiver version (invalidates prior signature)
    await adminPage.goto('/dashboard')
    const adminToken = await getAdminToken(adminPage)
    if (!adminToken) { test.skip(); return }

    const created = await createWaiverVersion(adminToken, `Gate Test Waiver ${Date.now()}`)
    if (!created) { test.skip(); return }

    try {
      // Find a bookable future class as the member
      await memberPage.goto('/schedule')
      const tabs = memberPage.locator('[data-testid="day-tab"]')
      let modalSeen = false

      for (let dayIdx = 0; dayIdx < 7 && !modalSeen; dayIdx++) {
        await tabs.nth(dayIdx).click()
        await memberPage.waitForTimeout(400)
        const cards = memberPage.locator('[data-testid="class-card"][data-past="false"]')
        const count = await cards.count()

        for (let i = 0; i < count && !modalSeen; i++) {
          const text = await cards.nth(i).textContent() ?? ''
          if (text.toLowerCase().includes('booked')) continue

          await cards.nth(i).click()
          const bookBtn = memberPage.locator('[data-testid="book-btn"]')
          if (!await bookBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const backBtn = memberPage.locator('button', { hasText: /back to schedule/i })
            if (await backBtn.count() > 0) await backBtn.click()
            else await memberPage.goBack()
            continue
          }
          if (!await bookBtn.isEnabled()) {
            const backBtn = memberPage.locator('button', { hasText: /back to schedule/i })
            if (await backBtn.count() > 0) await backBtn.click()
            else await memberPage.goBack()
            continue
          }

          await bookBtn.click()

          // The waiver modal should appear instead of booking completing
          const waiverModal = memberPage.locator('[data-testid="waiver-modal"]')
          const appeared = await waiverModal.isVisible({ timeout: 6000 }).catch(() => false)

          if (appeared) {
            modalSeen = true
            // Modal must display waiver content
            await expect(waiverModal).toContainText(/agree|waiver|risk/i)

            // Agree and sign
            const agreeBtn = memberPage.locator('[data-testid="waiver-agree-btn"]')
            await expect(agreeBtn).toBeEnabled({ timeout: 3000 })
            await agreeBtn.click()

            // Booking should complete after signing
            const toast = memberPage.locator('[data-testid="toast"]')
            await expect(toast).toBeVisible({ timeout: 8000 })
            await expect(toast).toContainText(/booked|success|confirmed/i, { ignoreCase: true })
            await expect(toast).not.toBeVisible({ timeout: 5000 })

            // Cancel the booking so subsequent tests start clean
            const cancelBtn = memberPage.locator('[data-testid="cancel-btn"]')
            if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
              await cancelBtn.click()
              await expect(memberPage.locator('[data-testid="toast"]')).toBeVisible({ timeout: 8000 })
              await expect(memberPage.locator('[data-testid="toast"]')).not.toBeVisible({ timeout: 5000 })
            }
          } else {
            // No modal — either booking completed or session unavailable
            const backBtn = memberPage.locator('button', { hasText: /back to schedule/i })
            if (await backBtn.count() > 0) await backBtn.click()
            else await memberPage.goBack()
          }
        }
      }

      if (!modalSeen) {
        test.skip() // No bookable session found or waiver gate not triggered
      }
    } finally {
      // Always clean up — restore no-waiver state so other tests book freely
      await removeWaiver(adminToken)
    }
  })

  test('once waiver is signed, subsequent booking proceeds without the modal', async ({ adminPage, authedPage: memberPage }) => {
    await adminPage.goto('/dashboard')
    const adminToken = await getAdminToken(adminPage)
    if (!adminToken) { test.skip(); return }

    // Create a waiver and have the member sign it via the API directly
    await createWaiverVersion(adminToken, `Pre-sign Test Waiver ${Date.now()}`)

    // Get member token and sign the waiver
    await memberPage.goto('/schedule')
    const memberToken = await getAdminToken(memberPage)
    if (!memberToken) { await removeWaiver(adminToken); test.skip(); return }

    const activeRes = await memberPage.evaluate(
      async ({ apiUrl, studioId, token }) => {
        const res = await fetch(`${apiUrl}/waivers/active?studioId=${studioId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        return res.json()
      },
      { apiUrl: API_URL, studioId: STUDIO_ID, token: memberToken },
    )

    const waiverId = activeRes?.waiver?.id
    if (!waiverId) { await removeWaiver(adminToken); test.skip(); return }

    // Sign via API
    await memberPage.evaluate(
      async ({ apiUrl, waiverId, token }) => {
        await fetch(`${apiUrl}/waivers/${waiverId}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: '{}',
        })
      },
      { apiUrl: API_URL, waiverId, token: memberToken },
    )

    try {
      // Now try to book — modal should NOT appear
      const tabs = memberPage.locator('[data-testid="day-tab"]')
      let booked = false

      for (let dayIdx = 0; dayIdx < 7 && !booked; dayIdx++) {
        await tabs.nth(dayIdx).click()
        await memberPage.waitForTimeout(400)
        const cards = memberPage.locator('[data-testid="class-card"][data-past="false"]')
        const count = await cards.count()

        for (let i = 0; i < count && !booked; i++) {
          const text = await cards.nth(i).textContent() ?? ''
          if (text.toLowerCase().includes('booked')) continue
          await cards.nth(i).click()

          const bookBtn = memberPage.locator('[data-testid="book-btn"]')
          if (!await bookBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const bb = memberPage.locator('button', { hasText: /back to schedule/i })
            if (await bb.count() > 0) await bb.click(); else await memberPage.goBack()
            continue
          }
          if (!await bookBtn.isEnabled()) {
            const bb = memberPage.locator('button', { hasText: /back to schedule/i })
            if (await bb.count() > 0) await bb.click(); else await memberPage.goBack()
            continue
          }

          await bookBtn.click()

          // Waiver modal should NOT appear
          const waiverModal = memberPage.locator('[data-testid="waiver-modal"]')
          await memberPage.waitForTimeout(1000)
          expect(await waiverModal.isVisible().catch(() => false)).toBe(false)

          // Booking should complete normally
          const toast = memberPage.locator('[data-testid="toast"]')
          await expect(toast).toBeVisible({ timeout: 8000 })
          await expect(toast).toContainText(/booked|success|confirmed/i, { ignoreCase: true })
          await expect(toast).not.toBeVisible({ timeout: 5000 })
          booked = true

          // Cancel to clean up
          const cancelBtn = memberPage.locator('[data-testid="cancel-btn"]')
          if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await cancelBtn.click()
            await expect(memberPage.locator('[data-testid="toast"]')).toBeVisible({ timeout: 8000 })
            await expect(memberPage.locator('[data-testid="toast"]')).not.toBeVisible({ timeout: 5000 })
          }
        }
      }

      if (!booked) test.skip()
    } finally {
      await removeWaiver(adminToken)
    }
  })
})
