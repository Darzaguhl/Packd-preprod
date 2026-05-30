import { test, expect } from '@playwright/test'

test.describe('Auth flow', () => {
  test('unauthenticated root redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders sign-in form', async ({ page }) => {
    await page.goto('/login')
    // Brand name is a styled span, not a heading role
    await expect(page.locator('text=PACKD')).toBeVisible()
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('toggle between sign-in and sign-up modes', async ({ page }) => {
    await page.goto('/login')
    // Toggle link says "Don't have an account? Sign up"
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('invalid@example.com')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.locator('text=/invalid|credentials|wrong/i')).toBeVisible({ timeout: 5000 })
  })

  test('unauthenticated /schedule is publicly accessible', async ({ page }) => {
    await page.goto('/schedule')
    // Schedule is now public — stays on schedule, shows class cards or day tabs
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('[data-testid="class-card"]').first()
      .or(page.getByText(/no classes/i))
      .or(page.locator('[data-testid="day-tab"]').first())
    ).toBeVisible({ timeout: 8000 })
  })
})
