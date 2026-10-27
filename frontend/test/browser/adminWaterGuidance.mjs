// Read-only mocked dashboard APIs: the guidance itself uses the real calculator.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildAdminWaterGuidance } from "../../../backend/services/analytics.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/admin-water-guidance/', import.meta.url))
await mkdir(output, { recursive: true })
const source = { id: 5, periodStart: '2026-10-05', periodEnd: '2026-11-05', periodType: 'HISTORICAL_ANALYTICS', waterRate: 23 }
const units = [{ id: 1, occupancyStatus: 'OCCUPIED' }, { id: 2, occupancyStatus: 'VACANT' }, { id: 3, occupancyStatus: 'OCCUPIED' }]
const history = [1, 2, 3].flatMap(unitId => [8, 9, 10].map(month => ({ unitId, billingPeriodId: month === 10 ? 5 : month, periodStart: `2026-${String(month).padStart(2, '0')}-05`, consumption: unitId === 2 ? 100 : 10, validationStatus: 'VALID' })))
const forecasts = [13, 50].map((predictedConsumption, index) => ({ unitId: index + 1, basedOnPeriodId: 5, forecastForMonth: '2026-11-01', status: 'READY', predictedConsumption }))
const cases = [
  ['partial-decline', buildAdminWaterGuidance({ source, units, history, forecasts })],
  ['no-data', buildAdminWaterGuidance({ units })],
  ['no-forecasts', buildAdminWaterGuidance({ source, units, history })],
  ['zero-baseline', buildAdminWaterGuidance({ source, units: units.slice(0, 1), history: history.filter(row => row.unitId === 1).map(row => ({ ...row, consumption: 0 })), forecasts: forecasts.slice(0, 1) })],
]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) {
    for (const [scenario, guidance] of cases) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const user = { id: 1, role: 'ADMIN', fullName: 'Water Guidance Tester', isActive: true, approvalStatus: 'APPROVED' }
      await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
      await context.route('**/api/**', async route => {
        assert.equal(route.request().method(), 'GET', 'Displaying guidance must not trigger writes')
        const path = new URL(route.request().url()).pathname
        const data = path === '/api/auth/me' ? { user } : path === '/api/dashboard/overview' ? { metrics: {}, monthly: [], billStatus: [] } : path === '/api/analytics/overview' ? { adminWaterGuidance: guidance, chartSeries: [6, 7, 8, 9, 10, 11].map(month => ({ month: `2026-${String(month).padStart(2, '0')}-01`, actualWaterBill: month < 11 ? 2500 : null, projectedWaterBill: month === 11 ? 1449 : null })) } : { notifications: [], unreadCount: 0 }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('http://127.0.0.1:5173/admin/dashboard')
      const section = page.getByRole('region', { name: 'Recommended admin actions' })
      await section.waitFor()
      const waterCard = page.locator('.collector-chart-panel').filter({ has: page.getByRole('heading', { name: 'Historical vs Projected Water Bill', exact: true }) })
      assert.equal(await waterCard.getByRole('region', { name: 'Recommended admin actions' }).count(), 1)
      const toggle = section.getByRole('button', { name: /show details/i })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await section.getByRole('listitem').count(), 0, 'Recommendation details start hidden')
      assert.equal(await section.getByRole('link', { name: 'Review Water Analytics' }).count(), 0)
      if (scenario === 'partial-decline') await waterCard.screenshot({ path: `${output}/${width}px-water-guidance-collapsed.png` })
      await toggle.focus(); await page.keyboard.press('Enter')
      assert.equal(await section.getByRole('button', { name: /hide details/i }).getAttribute('aria-expanded'), 'true')
      assert.ok(await section.locator('li').count() <= 3)
      const link = section.getByRole('link', { name: 'Review Water Analytics' })
      assert.equal(await link.getAttribute('href'), '/admin/analytics')
      await link.focus(); assert.equal(await link.evaluate(el => el === document.activeElement), true)
      const initialText = await section.innerText()
      if (scenario === 'partial-decline') {
        assert.match(initialText, /Oct 2026 actual → Nov 2026 forecast/)
        assert.match(initialText, /Based on historical readings/)
        assert.match(initialText, /Monitor the projected decrease/)
        assert.match(initialText, /Review 2 units/)
        assert.match(initialText, /2 of 3 units/)
        assert.match(initialText, /Same 2 units: 110 → 63 m³/)
        assert.match(initialText, /1,449/)
      } else if (scenario === 'no-data') assert.match(initialText, /No eligible actual billing month/)
      else if (scenario === 'no-forecasts') assert.match(initialText, /No units have both a ready forecast/)
      else { assert.match(initialText, /percentage change is unavailable/); assert.ok(!initialText.includes('%')) }
      await waterCard.getByRole('button', { name: '6 months', exact: true }).click()
      await waterCard.getByRole('option', { name: '2 months', exact: true }).click()
      assert.equal(await section.innerText(), initialText, 'Range selection cannot change the guidance period')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
      assert.deepEqual(errors, [])
      if (scenario === 'partial-decline') await waterCard.screenshot({ path: `${output}/${width}px-water-guidance.png` })
      const hide = section.getByRole('button', { name: /hide details/i })
      await hide.focus(); await page.keyboard.press('Space')
      assert.equal(await section.getByRole('button', { name: /show details/i }).getAttribute('aria-expanded'), 'false')
      assert.equal(await section.getByRole('listitem').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      console.log(`${width}px ${scenario}: passed`)
      await context.close()
    }
  }
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const user = { id: 2, role: 'COLLECTOR', fullName: 'Billing Tester', isActive: true, approvalStatus: 'APPROVED' }
  await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
  await context.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET')
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: path === '/api/auth/me' ? { user } : path === '/api/analytics/overview' ? { adminWaterGuidance: cases[0][1], chartSeries: [] } : { metrics: {}, notifications: [], unreadCount: 0 } })
  })
  const page = await context.newPage(); await page.goto('http://127.0.0.1:5173/collector/dashboard')
  await page.getByRole('heading', { name: 'Historical vs Projected Water Bill', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Recommended admin actions' }).count(), 0)
  await context.close()
  console.log('Collector: Admin guidance is hidden')
} finally { await browser.close() }
