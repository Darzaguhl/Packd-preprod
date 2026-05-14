import { test, expect } from '@playwright/test'

test.describe('Auth flow', () => {
  test('unauthenticated root redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders sign-in form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Packd' })).toBeVisible()
    await expect(page.getByPlaceholder(/email/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('toggle between sign-in and sign-up modes', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /create account/i }).click()
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
    await page.getByRole('button', { name: /sign in instead/i }).click()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder(/email/i).fill('invalid@example.com')
    await page.getByPlaceholder(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.locator('text=/invalid|credentials|wrong/i')).toBeVisible({ timeout: 5000 })
  })

  test('unauthenticated /schedule redirects to /login', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page).toHaveURL(/\/login/)
  })
})
