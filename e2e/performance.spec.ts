import { test, expect } from './fixtures'

/**
 * Core Web Vitals + API latency benchmarks.
 * Thresholds: LCP < 2500ms, CLS < 0.1 (Google "Good" band).
 * API thresholds are generous to account for dev-mode overhead.
 */

// ── Helper ────────────────────────────────────────────────────────────────────

async function measureLCP(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let value = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) value = entry.startTime
          resolve(value)
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        setTimeout(() => resolve(value), 3000)
      }),
  )
}

async function measureCLS(page: import('@playwright/test').Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(500)
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
            if (!shift.hadRecentInput) total += shift.value
          }
          resolve(total)
        }).observe({ type: 'layout-shift', buffered: true })
        setTimeout(() => resolve(total), 2000)
      }),
  )
}

// ── Page load ─────────────────────────────────────────────────────────────────

test.describe('Page load performance', () => {
  test('schedule page LCP is under 2500ms', async ({ authedPage: page }) => {
    const lcp = await measureLCP(page)
    console.log(`[LCP] schedule: ${Math.round(lcp)}ms`)
    expect(lcp).toBeLessThan(2500)
  })

  test('schedule page CLS is under 0.1', async ({ authedPage: page }) => {
    const cls = await measureCLS(page)
    console.log(`[CLS] schedule: ${cls.toFixed(4)}`)
    expect(cls).toBeLessThan(0.1)
  })

  test('login page TTFB is under 800ms', async ({ page }) => {
    await page.goto('/login')
    const ttfb = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return nav?.responseStart ?? 0
    })
    console.log(`[TTFB] login: ${Math.round(ttfb)}ms`)
    expect(ttfb).toBeLessThan(800)
  })

  test('dashboard page LCP is under 3000ms', async ({ adminPage: page }) => {
    const lcp = await measureLCP(page)
    console.log(`[LCP] dashboard: ${Math.round(lcp)}ms`)
    expect(lcp).toBeLessThan(3000)
  })

  test('dashboard page CLS is under 0.1', async ({ adminPage: page }) => {
    const cls = await measureCLS(page)
    console.log(`[CLS] dashboard: ${cls.toFixed(4)}`)
    expect(cls).toBeLessThan(0.1)
  })
})

// ── API latency ───────────────────────────────────────────────────────────────

test.describe('API latency', () => {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

  test('schedule API responds within 500ms', async ({ authedPage: page }) => {
    const duration = await page.evaluate(async () => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const entry = entries.find(e => e.name.includes('/schedule') || e.name.includes('/sessions'))
      if (entry) return entry.duration
      return 0
    })
    console.log(`[API] schedule resource: ${Math.round(duration)}ms`)
    expect(duration).toBeLessThan(500)
  })

  test('admin sessions API responds within 600ms', async ({ adminPage: page, request }) => {
    const studioId = process.env.NEXT_PUBLIC_STUDIO_ID ?? ''
    if (!studioId) {
      console.log('[SKIP] NEXT_PUBLIC_STUDIO_ID not set')
      return
    }

    const token = await page.evaluate(() =>
      Object.entries(localStorage)
        .find(([k]) => k.includes('access_token'))?.[1] ?? '',
    )

    const start = Date.now()
    const res = await request.get(
      `${API_URL}/admin/sessions?studioId=${studioId}&date=${new Date().toISOString().slice(0, 10)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
    const duration = Date.now() - start
    console.log(`[API] admin sessions: ${duration}ms (status ${res.status()})`)
    expect(duration).toBeLessThan(600)
  })

  test('member search API responds within 500ms', async ({ adminPage: page, request }) => {
    const studioId = process.env.NEXT_PUBLIC_STUDIO_ID ?? ''
    if (!studioId) {
      console.log('[SKIP] NEXT_PUBLIC_STUDIO_ID not set')
      return
    }

    const token = await page.evaluate(() =>
      Object.entries(localStorage)
        .find(([k]) => k.includes('access_token'))?.[1] ?? '',
    )

    const start = Date.now()
    const res = await request.get(
      `${API_URL}/admin/members/search?studioId=${studioId}&q=alex`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
    const duration = Date.now() - start
    console.log(`[API] member search: ${duration}ms (status ${res.status()})`)
    expect(duration).toBeLessThan(500)
  })
})
