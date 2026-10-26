// Mocked APIs only. No real drafts, SOAs, readings or payments are changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/billing-period-validation/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const pageErrors = []
const valid = { periodStart: '2026-01-31', periodEnd: '2026-02-28', dueDate: '2026-03-28', waterRatePerCubicM: '23', associationDuesRatePerSqm: '134.07', latePenaltyPercent: '0' }

async function open({ mobile = false, edit = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } })
  const user = { id: 1, role: 'COLLECTOR', fullName: 'Billing Tester', isActive: true, approvalStatus: 'APPROVED' }
  const periods = edit ? [{ ...valid, id: 42, status: 'DRAFT' }] : []
  const writes = []
  await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      assert.equal(request.method(), edit ? 'PATCH' : 'POST')
      assert.equal(path, edit ? '/api/billing-periods/42' : '/api/billing-periods')
      const body = request.postDataJSON(); writes.push(body)
      const period = { ...body, id: 42, status: 'DRAFT' }
      periods.splice(0, periods.length, period)
      return route.fulfill({ status: edit ? 200 : 201, json: { period, message: 'Draft saved.' } })
    }
    const data = path === '/api/auth/me' ? { user }
      : path === '/api/notifications' ? { notifications: [], unreadCount: 0 }
        : path === '/api/billing-periods' ? { periods }
          : path === '/api/billing-periods/42/readings' ? { readings: [] } : null
    assert.ok(data, path)
    return route.fulfill({ json: data })
  })
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:5173/collector/billing${edit ? '?periodId=42' : ''}`)
  const form = page.getByRole('form', { name: 'Billing period settings' })
  await form.waitFor()
  if (edit) await form.getByRole('button', { name: 'Save settings', exact: true }).waitFor()
  async function fill(body) { for (const [field, value] of Object.entries(body)) await form.locator(`[name="${field}"]`).fill(String(value)) }
  return { context, page, form, writes, fill }
}

try {
  for (const mobile of [false, true]) {
    const { context, page, form, writes, fill } = await open({ mobile })
    await form.getByRole('button', { name: 'Create draft', exact: true }).click()
    assert.equal(await form.getByLabel('Period start', { exact: true }).getAttribute('aria-invalid'), 'true')
    assert.equal(await form.getByLabel('Due date', { exact: true }).getAttribute('aria-invalid'), 'true')
    for (const [overrides, field, message] of [
      [{ waterRatePerCubicM: '0' }, 'waterRatePerCubicM', /greater than zero/],
      [{ associationDuesRatePerSqm: '0' }, 'associationDuesRatePerSqm', /greater than zero/],
      [{ periodEnd: '2025-12-31' }, 'periodEnd', /after period start/],
      [{ periodEnd: '2026-01-31' }, 'periodEnd', /after period start/],
      [{ periodEnd: '2026-02-27' }, 'periodEnd', /at least 1/],
      [{ periodEnd: '2026-04-01', dueDate: '2026-04-02' }, 'periodEnd', /not exceed 2/],
      [{ dueDate: '2026-02-28' }, 'dueDate', /after period end/],
      [{ dueDate: '2026-03-29' }, 'dueDate', /within 1/],
    ]) {
      await fill({ ...valid, ...overrides })
      await form.getByRole('button', { name: 'Create draft', exact: true }).click()
      assert.equal(writes.length, 0, 'Invalid drafts must not reach the API')
      assert.match(await form.locator(`#${field}-error`).innerText(), message)
    }
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-invalid-due-date.png`, fullPage: true })
    await fill({ ...valid, waterRatePerCubicM: '0', associationDuesRatePerSqm: '0' })
    await form.getByRole('button', { name: 'Create draft', exact: true }).click()
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-zero-rates.png`, fullPage: true })
    await fill(valid)
    assert.equal(await form.locator('[name="periodEnd"]').getAttribute('min'), '2026-02-28')
    assert.equal(await form.locator('[name="periodEnd"]').getAttribute('max'), '2026-03-31')
    assert.equal(await form.locator('[name="dueDate"]').getAttribute('min'), '2026-03-01')
    assert.equal(await form.locator('[name="dueDate"]').getAttribute('max'), '2026-03-28')
    assert.equal(await form.locator('[aria-invalid="true"]').count(), 0)
    await form.getByRole('button', { name: 'Create draft', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[name="periodStart"]')?.value === '')
    assert.equal(writes.length, 1)
    for (const [field, value] of Object.entries(valid)) assert.equal(String(writes[0][field]), value)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await context.close()
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: inline field errors, blocked requests, calendar bounds, and valid February draft`)
  }
  const { context, page, form, writes, fill } = await open({ edit: true })
  await fill({ dueDate: '2026-03-29' })
  await form.getByRole('button', { name: 'Save settings', exact: true }).click()
  assert.equal(writes.length, 0)
  await fill({ dueDate: '2026-03-01' })
  await form.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[name="periodStart"]')?.value === '')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].dueDate, '2026-03-01')
  await context.close()
  assert.deepEqual(pageErrors, [])
  console.log('PASS draft edit validates the saved period dates and accepts corrected settings')
} finally { await browser.close() }
