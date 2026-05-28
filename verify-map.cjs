const { chromium } = require('playwright')
const BASE = 'http://localhost:3002'

;(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()

  const consoleErrors = []
  const apiCalls = []

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('response', async resp => {
    const url = resp.url()
    if (url.includes('localhost:4000')) {
      const status = resp.status()
      const method = resp.request().method()
      let body = ''
      try { body = await resp.text() } catch {}
      apiCalls.push({ method, url: url.replace('http://localhost:4000',''), status, body: body.slice(0,500) })
      if (status >= 400) console.log(`❌ ${status} ${method} ${url}\n   ${body.slice(0,300)}`)
    }
  })

  // Login
  console.log('1. Login...')
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('domcontentloaded')
  await page.locator('input[type="email"]').fill('admin@packd.test')
  await page.locator('input[type="password"]').fill('testpassword123')
  await page.locator('button[type="submit"]').click()
  // Wait for navigation by polling URL
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const url = page.url()
    if (url.includes('/dashboard') || url.includes('/schedule')) break
    if (i === 29) { console.log('Login timeout, URL:', url); await page.screenshot({ path: '/tmp/v0-login-fail.png' }); await browser.close(); process.exit(1) }
  }
  console.log('   At:', page.url())
  await page.screenshot({ path: '/tmp/v1.png' })

  // Front Desk
  console.log('2. Front Desk...')
  const fdBtn = page.getByRole('button', { name: /front desk/i })
  if (await fdBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await fdBtn.click()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: '/tmp/v2.png' })

  // Click session
  console.log('3. Session...')
  // Try time-formatted text first, then any clickable item
  let sessionClicked = false
  const timeText = page.locator('text=/^\\d{2}:\\d{2}$/').first()
  if (await timeText.isVisible({ timeout: 3000 }).catch(() => false)) {
    await timeText.click()
    sessionClicked = true
  } else {
    const anySession = page.locator('[class*="cursor-pointer"]').first()
    if (await anySession.isVisible({ timeout: 3000 }).catch(() => false)) {
      await anySession.click()
      sessionClicked = true
    }
  }
  console.log('   Session clicked:', sessionClicked)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/v3.png' })

  // Find "add" station
  console.log('4. Looking for empty station...')
  const addText = page.locator('text="+ add"').first()
  if (!(await addText.isVisible({ timeout: 6000 }).catch(() => false))) {
    console.log('   ⚠️  No station found. Page content:')
    const txt = await page.evaluate(() => document.body.innerText)
    console.log(txt.slice(0, 600))
    await page.screenshot({ path: '/tmp/v4-fail.png' })
    await browser.close()
    process.exit(0)
  }

  await addText.click({ force: true })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: '/tmp/v4.png' })

  const h2 = page.locator('h2').first()
  console.log('   Drawer h2:', await h2.textContent().catch(() => 'none'))

  // Search
  console.log('5. Search "Alex"...')
  const textInputs = page.locator('input[type="text"]')
  const inputCount = await textInputs.count()
  console.log('   Text inputs found:', inputCount)
  await textInputs.last().fill('Alex')
  await page.waitForTimeout(800)
  await page.screenshot({ path: '/tmp/v5.png' })

  // Pick result
  const results = page.locator('button').filter({ hasText: /Alex/i })
  const rCount = await results.count()
  console.log('   Results:', rCount)
  if (rCount === 0) {
    console.log('   ⚠️  No results. Checking all button texts...')
    console.log(await page.locator('button').allTextContents())
    await browser.close(); process.exit(0)
  }
  await results.first().click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/v6.png' })

  // Check in
  const checkinBtn = page.getByRole('button', { name: /check in at/i })
  if (!(await checkinBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    console.log('   ⚠️  Check-in button not found. Buttons:', await page.locator('button').allTextContents())
    await browser.close(); process.exit(0)
  }

  console.log('6. Clicking:', await checkinBtn.textContent())
  apiCalls.length = 0
  await checkinBtn.click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: '/tmp/v7-after.png' })

  console.log('\n=== API calls ===')
  apiCalls.forEach(c => console.log(`  ${c.method} ${c.url} → ${c.status}`))

  const alexCount = await page.locator('text=/Alex/i').count()
  console.log(`\n"Alex" on page: ${alexCount} occurrences`)

  const stationPanelText = await page.locator('[class*="w-52"]').textContent().catch(() => 'N/A')
  console.log('Station panel:', stationPanelText?.slice(0, 500))

  if (consoleErrors.length) {
    console.log('\n=== CONSOLE ERRORS ===')
    consoleErrors.forEach(e => console.log(' ', e.slice(0, 300)))
  }

  await browser.close()
  console.log('\nScreenshots: /tmp/v*.png')
})().catch(e => { console.error('FATAL:', e.message, '\n', e.stack?.split('\n').slice(0,5).join('\n')); process.exit(1) })
