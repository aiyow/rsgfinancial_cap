import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ExcelJS from '../../../backend/node_modules/exceljs/excel.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const directory = fileURLToPath(new URL('../../../artifacts/history-readings-only/', import.meta.url))
await mkdir(directory, { recursive: true })
const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('Readings').addRows([['UNIT', 'PREVIOUS', 'CURRENT'], ['101', 100, 110], ['102', 200, 205]])
const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const user = { id: 1, role: 'COLLECTOR', fullName: 'History Import Tester', isActive: true, approvalStatus: 'APPROVED' }
    await context.addInitScript(user => { localStorage.setItem('condo_user', JSON.stringify(user)); localStorage.setItem('condo_token', 'mock-only') }, user)
    let imported = false, releaseImport, failImport = false
    const rows = [{ rowNumber: 2, unitId: 1, unitNumber: '101', previousReading: 100, currentReading: 110, consumption: 10, errors: [], warnings: [] },
      { rowNumber: 3, unitId: 2, unitNumber: '102', previousReading: 200, currentReading: 205, consumption: 5, errors: [], warnings: [] }]
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      if (path === '/api/auth/me') return route.fulfill({ json: { user } })
      if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], unreadCount: 0 } })
      if (path === '/api/analytics/imports/preview') return route.fulfill({ json: { periodMonth: '2026-09', valid: true, rows, errors: [], warnings: [], summary: { rowCount: 2, unitCount: 2, errorCount: 0, warningCount: 0 } } })
      if (path === '/api/analytics/imports') {
        if (req.method() === 'POST') {
          assert.equal(req.postDataBuffer().toString('latin1').includes('name="waterRatePerCubicM"'), false)
          await new Promise(resolve => { releaseImport = resolve })
          if (failImport) return route.fulfill({ status: 500, json: { message: 'Fixture import failed. Please try again.' } })
          imported = true
          return route.fulfill({ status: 201, json: { message: 'Imported 2 readings for September 2026.' } })
        }
        return route.fulfill({ json: { imports: imported ? [{ id: 1, periodMonth: '2026-09', readingCount: 2, flaggedCount: 0, readyForecastCount: 0 }] : [] } })
      }
      throw new Error('Unexpected fixture route: ' + path)
    })
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:5173/collector/history-import')
    await page.locator('input[type="month"]').fill('2026-09')
    await page.locator('input[type="file"]').setInputFiles({ name: 'september.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Confirm import', exact: true })
    await confirm.waitFor()
    assert.equal(await confirm.isEnabled(), true)
    assert.equal(await page.getByRole('columnheader', { name: 'Current', exact: true }).count(), 1)
    assert.equal(await page.getByRole('columnheader', { name: /Water charge/i }).count(), 0)
    assert.equal(await page.getByText(/WRATE|WATER BILLED|Water rate:/i).count(), 0)
    assert.equal(await page.getByText(/Consumption is calculated automatically/).count(), 1)
    await page.getByRole('heading', { name: 'Preview readings', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: directory + '/' + width + 'px-preview.png' })
    await confirm.click()
    const importing = page.getByRole('button', { name: 'Importing readings…', exact: true })
    await importing.waitFor()
    assert.equal(await importing.isDisabled(), true)
    assert.equal(await importing.getAttribute('aria-busy'), 'true')
    assert.equal(await page.locator('input[type="month"]').isDisabled(), true)
    assert.equal(await page.locator('input[type="file"]').isDisabled(), true)
    await page.getByText('Processing 2 readings for September 2026…', { exact: true }).waitFor()
    assert.equal(await importing.locator('svg').evaluate(el => getComputedStyle(el).animationName), 'spin')
    await page.screenshot({ path: directory + '/' + width + 'px-importing.png' })
    releaseImport()
    await page.getByText('Imported 2 readings for September 2026.').waitFor()
    assert.equal(await importing.count(), 0)
    assert.equal(imported, true)
    failImport = true
    await page.locator('input[type="file"]').setInputFiles({ name: 'september.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await confirm.click()
    await importing.waitFor()
    releaseImport()
    await page.getByText('Fixture import failed. Please try again.').waitFor()
    assert.equal(await importing.count(), 0)
    assert.equal(await confirm.isEnabled(), true)
    assert.equal(await page.locator('input[type="file"]').isEnabled(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await context.close()
    console.log(width + 'px: three-column preview, automatic consumption and confirmation passed')
  }
} finally { await browser.close() }
