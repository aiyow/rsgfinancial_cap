// All API requests are mocked GETs; guidance uses the existing backend calculator.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildAdminWaterGuidance } from '../../../backend/services/adminWaterGuidance.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/analytics-chart-insights/', import.meta.url))
await mkdir(output, { recursive: true })
const source = { id: 5, periodStart: '2026-10-05', periodEnd: '2026-11-05', periodType: 'HISTORICAL_ANALYTICS', waterRate: 23 }
const units = [{ id: 1, occupancyStatus: 'OCCUPIED' }, { id: 2, occupancyStatus: 'VACANT' }, { id: 3, occupancyStatus: 'OCCUPIED' }]
const history = units.flatMap(unit => [8, 9, 10].map(month => ({ unitId: unit.id, billingPeriodId: month === 10 ? 5 : month, periodStart: `2026-${String(month).padStart(2, '0')}-05`, consumption: 10, validationStatus: 'VALID' })))
const forecasts = [13, 6].map((predictedConsumption, index) => ({ unitId: index + 1, basedOnPeriodId: 5, forecastForMonth: '2026-11-01', predictedConsumption, status: 'READY' }))
const cases = [
  ['ready', buildAdminWaterGuidance({ source, units, history, forecasts })],
  ['no-forecasts', buildAdminWaterGuidance({ source, units, history })],
  ['missing-rate', buildAdminWaterGuidance({ source: { ...source, waterRate: null }, units, history, forecasts })],
]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) for (const [scenario, guidance] of cases) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const user = { id: 1, role: 'ADMIN', fullName: 'Analytics Tester', isActive: true, approvalStatus: 'APPROVED' }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    await context.route('**/api/**', async route => {
      assert.equal(route.request().method(), 'GET', 'Opening chart insights must not mutate data')
      const path = new URL(route.request().url()).pathname
      let data
      if (path === '/api/auth/me') data = { user }
      else if (path === '/api/notifications') data = { notifications: [], unreadCount: 0 }
      else if (path === '/api/units') data = { units: [] }
      else if (path === '/api/prescriptive-recommendations') data = { recommendations: [] }
      else if (path === '/api/analytics/overview') data = {
        adminWaterGuidance: guidance, latestForecast: { total: 3, ready: guidance.coverage.readyUnits, excluded: 3 - guidance.coverage.readyUnits, forecastForMonth: '2026-11-01' },
        evaluationHistory: [], diagnostics: [], flaggedReadings: [], metrics: {},
        chartSeries: [6, 7, 8, 9, 10, 11].map(month => ({ month: `2026-${String(month).padStart(2, '0')}-01`, actualConsumption: month < 11 ? 30 : null, actualWaterBill: month < 11 ? 690 : null, projectedConsumption: month === 11 ? 19 : null, projectedWaterBill: month === 11 ? 437 : null })),
      }
      else assert.fail(path)
      await route.fulfill({ json: data })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/admin/analytics')
    const card = title => page.locator('.collector-chart-panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    const consumptionCard = card('Historical vs Projected Water Consumption'), billCard = card('Historical vs Projected Water Bill')
    const consumption = consumptionCard.getByRole('region', { name: 'Prescriptive insights' }), bill = billCard.getByRole('region', { name: 'Prescriptive insights' })
    await consumption.waitFor(); await bill.waitFor()
    assert.equal(await page.getByRole('region', { name: 'Prescriptive insights' }).count(), 2)
    assert.notEqual(await consumption.getAttribute('aria-labelledby'), await bill.getAttribute('aria-labelledby'))
    const consumptionShow = consumption.getByRole('button', { name: /show details/i }), billShow = bill.getByRole('button', { name: /show details/i })
    assert.notEqual(await consumptionShow.getAttribute('aria-controls'), await billShow.getAttribute('aria-controls'))
    assert.equal(await consumptionShow.getAttribute('aria-expanded'), 'false'); assert.equal(await billShow.getAttribute('aria-expanded'), 'false')
    assert.equal(await consumption.getByRole('listitem').count(), 0); assert.equal(await bill.getByRole('listitem').count(), 0)
    assert.match(await consumption.innerText(), /Suggested actions for projected water use/)
    assert.match(await bill.innerText(), /Suggested billing checks for projected charges/)
    if (scenario === 'ready') await consumptionCard.locator('..').screenshot({ path: `${output}/${width}px-collapsed.png` })
    await consumptionShow.focus(); await page.keyboard.press('Enter')
    assert.equal(await consumption.getByRole('button', { name: /hide details/i }).getAttribute('aria-expanded'), 'true')
    assert.equal(await billShow.getAttribute('aria-expanded'), 'false', 'The two toggles are independent')
    await billShow.click()
    if (scenario === 'no-forecasts') {
      assert.match(await consumption.innerText(), /No units have both a ready water-use forecast/)
      assert.match(await bill.innerText(), /No comparable units have usable actual and projected water charges/)
    } else {
      assert.match(await consumption.innerText(), /Same 2 units: 20 → 19 m³/)
      assert.ok(!(await consumption.innerText()).includes('₱'))
      if (scenario === 'missing-rate') { assert.match(await bill.innerText(), /Water-charge estimates are unavailable/); assert.ok(!(await bill.innerText()).includes('NaN')) }
      else {
        assert.match(await bill.innerText(), /₱460.00 → ₱437.00/)
        assert.match(await bill.innerText(), /₱23.00 decrease/)
        assert.match(await bill.innerText(), /Confirm the rate for the next billing period/)
      }
    }
    const usageHeadings = await consumption.getByRole('heading', { level: 4 }).allTextContents()
    const billHeadings = await bill.getByRole('heading', { level: 4 }).allTextContents()
    assert.ok(!billHeadings.some(title => usageHeadings.includes(title)), 'The two charts must not repeat recommendation cards')
    assert.ok(!/vacant|leak|Forecast consumption|meter-reading schedule/.test(await bill.innerText()), 'Physical inspection recommendations belong to the consumption graph')
    assert.equal(await page.getByRole('link', { name: 'Review Water Analytics' }).count(), 0, 'Do not link to the page already open')
    const consumptionText = await consumption.innerText(), billText = await bill.innerText()
    await consumptionCard.getByRole('button', { name: /Last 6 months/i }).click()
    await consumptionCard.getByRole('option', { name: /Last 2 months/i }).click()
    assert.equal(await consumption.innerText(), consumptionText); assert.equal(await bill.innerText(), billText)
    if (scenario === 'ready') await consumptionCard.screenshot({ path: `${output}/${width}px-consumption-expanded.png` })
    if (scenario === 'ready') await consumptionCard.locator('..').screenshot({ path: `${output}/${width}px-distinct-insights-expanded.png` })
    await consumption.getByRole('button', { name: /hide details/i }).focus(); await page.keyboard.press('Space')
    assert.equal(await consumption.getByRole('button', { name: /show details/i }).getAttribute('aria-expanded'), 'false')
    assert.equal(await bill.getByRole('button', { name: /hide details/i }).getAttribute('aria-expanded'), 'true')
    await bill.getByRole('button', { name: /hide details/i }).click()
    assert.equal(await bill.getByRole('button', { name: /show details/i }).getAttribute('aria-expanded'), 'false')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`${width}px ${scenario}: independent collapsed insights, metric-specific values, keyboard controls and stable periods passed`)
  }
} finally { await browser.close() }
