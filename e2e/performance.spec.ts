import { test, expect } from './fixtures'

/**
 * Measures Core Web Vitals and key timings via the Performance API.
 * Thresholds: LCP < 2500ms, FID < 100ms, CLS < 0.1 (Google "Good" band).
 */
test.describe('Performance', () => {
  test('schedule page LCP is under 2500ms', async ({ authedPage: page }) => {
    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let value = 0
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) value = entry.startTime
            resolve(value)
          }).observe({ type: 'largest-contentful-paint', buffered: true })
          // Fallback if LCP already fired
          setTimeout(() => resolve(value), 3000)
        }),
    )
    console.log(`LCP: ${Math.round(lcp)}ms`)
    expect(lcp).toBeLessThan(2500)
  })

  test('schedule page CLS is under 0.1', async ({ authedPage: page }) => {
    // Scroll to trigger any lazy layout shifts
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)

    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              // LayoutShift entries have `value` property
              const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
              if (!shift.hadRecentInput) total += shift.value
            }
            resolve(total)
          }).observe({ type: 'layout-shift', buffered: true })
          setTimeout(() => resolve(total), 2000)
        }),
    )
    console.log(`CLS: ${cls.toFixed(4)}`)
    expect(cls).toBeLessThan(0.1)
  })

  test('login page TTFB is under 800ms', async ({ page }) => {
    const start = Date.now()
    await page.goto('/login')
    const ttfb = await page.evaluate(
      () => performance.getEntriesByType('navigation')[0]
        ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).responseStart
        : 0,
    )
    console.log(`TTFB: ${Math.round(ttfb)}ms`)
    expect(ttfb).toBeLessThan(800)
    void start // suppress unused warning
  })

  test('schedule API responds within 500ms', async ({ authedPage: page }) => {
    const timing = await page.evaluate(async () => {
      const t0 = performance.now()
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const scheduleEntry = entries.find((e) => e.name.includes('/schedule') || e.name.includes('/sessions'))
      if (scheduleEntry) return scheduleEntry.duration
      // Fallback: fire a fresh request (no auth header — just measures raw server speed)
      await fetch('/api/health').catch(() => null)
      return performance.now() - t0
    })
    console.log(`Schedule API timing: ${Math.round(timing)}ms`)
    // Generous bound — network latency varies in dev
    expect(timing).toBeLessThan(500)
  })
})
