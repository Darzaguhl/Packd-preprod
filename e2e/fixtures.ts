/**
 * Playwright test fixtures.
 *
 * `authedPage`  — browser page pre-authenticated as the E2E member
 * `adminPage`   — browser page pre-authenticated as the E2E studio_admin
 *
 * Auth state is written by global-setup.ts to .auth/{member,admin}.json.
 * If the files don't exist (e.g. first run without setup), the fixture falls
 * back to interactive login so individual specs can still be run manually.
 */

import { test as base, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const MEMBER_AUTH = path.resolve('.auth/member.json')
const ADMIN_AUTH  = path.resolve('.auth/admin.json')

export const test = base.extend<{
  authedPage: import('@playwright/test').Page
  adminPage:  import('@playwright/test').Page
}>({
  authedPage: async ({ browser }, use) => {
    const hasState = fs.existsSync(MEMBER_AUTH)
    const ctx = await browser.newContext(
      hasState ? { storageState: MEMBER_AUTH } : {},
    )
    const page = await ctx.newPage()

    if (!hasState) {
      // Fallback: interactive login
      const email    = process.env.E2E_EMAIL    ?? 'e2e-member@packd.test'
      const password = process.env.E2E_PASSWORD ?? 'E2ePass123!'
      await page.goto('/login')
      await page.getByPlaceholder(/email/i).fill(email)
      await page.getByPlaceholder(/password/i).fill(password)
      await page.getByRole('button', { name: /sign in/i }).click()
      await page.waitForURL(/schedule/, { timeout: 15_000 })
    } else {
      await page.goto('/schedule')
      // Ensure loaded — not redirected back to login
      await page.waitForURL(/schedule/, { timeout: 10_000 })
    }

    // Wait for skeletons to clear
    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })

    await use(page)
    await ctx.close()
  },

  adminPage: async ({ browser }, use) => {
    const hasState = fs.existsSync(ADMIN_AUTH)
    const ctx = await browser.newContext(
      hasState ? { storageState: ADMIN_AUTH } : {},
    )
    const page = await ctx.newPage()

    if (!hasState) {
      const email    = process.env.E2E_ADMIN_EMAIL    ?? 'e2e-admin@packd.test'
      const password = process.env.E2E_ADMIN_PASSWORD ?? 'E2ePass123!'
      await page.goto('/login')
      await page.getByPlaceholder(/email/i).fill(email)
      await page.getByPlaceholder(/password/i).fill(password)
      await page.getByRole('button', { name: /sign in/i }).click()
      await page.waitForURL(/dashboard/, { timeout: 15_000 })
    } else {
      await page.goto('/dashboard')
      await page.waitForURL(/dashboard/, { timeout: 10_000 })
    }

    await expect(page.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 })

    await use(page)
    await ctx.close()
  },
})

export { expect }
