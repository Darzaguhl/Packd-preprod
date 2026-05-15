import { test as base, expect } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@packd.test'
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword123'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@packd.test'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123'

export const test = base.extend<{
  authedPage: import('@playwright/test').Page
  adminPage: import('@playwright/test').Page
}>({
  // Member-level authenticated page — lands on /schedule
  authedPage: async ({ page }, use) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill(TEST_EMAIL)
    await page.getByPlaceholder(/password/i).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/schedule/, { timeout: 10_000 })
    await use(page)
  },

  // Admin-level authenticated page — lands on /dashboard
  adminPage: async ({ page }, use) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL)
    await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
    await use(page)
  },
})

export { expect }
