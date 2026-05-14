import { test as base, expect } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_EMAIL ?? 'e2e@packd.test'
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword123'

export const test = base.extend({
  // Authenticated page — logs in once via UI and stores session in storageState
  authedPage: async ({ page }, use) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill(TEST_EMAIL)
    await page.getByPlaceholder(/password/i).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/schedule/, { timeout: 10_000 })
    await use(page)
  },
})

export { expect }
