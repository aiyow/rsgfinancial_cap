import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const chartSeries = [6, 7, 8, 9, 10, 11].map(month => ({
  month: '2026-' + String(month).padStart(2, '0') + '-01',
  actualConsumption: month < 11 ? 30 : null,
  actualWaterBill: month < 11 ? 690 : null,
  projectedConsumption: month === 11 ? 19 : null,
  projectedWaterBill: month === 11 ? 437 : null,
}))
const user = { id: 1, role: 'ADMIN', fullName: 'Analytics Tester', isActive: true, approvalStatus: 'APPROVED' }
const responses = {
  '/api/auth/me': { user },
  '/api/notifications': { notifications: [], unreadCount: 0 },
  '/api/units': { units: [] },
  '/api/prescriptive-recommendations': { recommendations: [] },
  '/api/analytics/overview': {
    latestForecast: { total: 3, ready: 2, excluded: 1, forecastForMonth: '2026-11-01' },
    evaluationHistory: [],
    diagnostics: [],
    flaggedReadings: [],
    metrics: {},
    chartSeries,
  },
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(user => {
      localStorage.setItem('condo_token', 'mock-only')
      localStorage.setItem('condo_user', JSON.stringify(user))
    }, user)
    await context.route('**/api/**', async route => {
      assert.equal(route.request().method(), 'GET')
      const path = new URL(route.request().url()).pathname
      assert.ok(Object.hasOwn(responses, path), 'Unexpected request to ' + path)
      await route.fulfill({ json: responses[path] })
    })

    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/admin/analytics')
    const cards = ['Historical vs Projected Water Consumption', 'Historical vs Projected Water Bill']
      .map(title => page.locator('.collector-chart-panel').filter({
        has: page.getByRole('heading', { name: title, exact: true }),
      }))

    for (const card of cards) {
      await card.getByText('Historical actual', { exact: true }).waitFor()
      await card.getByText('Projected forecast', { exact: true }).waitFor()
      assert.equal(await card.getByText('Prescriptive insights', { exact: true }).count(), 0)
      assert.equal(await card.getByRole('button', { name: 'Show details', exact: true }).count(), 0)
    }

    const [consumption, bill] = cards
    await consumption.getByRole('button', { name: /Last 6 months/i }).click()
    await consumption.getByRole('option', { name: /Last 2 months/i }).click()
    await consumption.getByRole('button', { name: /Last 2 months/i }).waitFor()
    await bill.getByRole('button', { name: /Last 6 months/i }).waitFor()
    await page.getByRole('heading', { name: 'Prescriptive Recommendations', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    assert.deepEqual(errors, [])
    await context.close()
    console.log(width + 'px: charts and filters work without the insights panels')
  }
} finally {
  await browser.close()
}
