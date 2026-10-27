// Read-only API mocks verify specific summaries without expandable detail requests.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/detailed-audit/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const runtimeErrors = []
const records = Array.from({ length: 63 }, (_, index) => ({ entityName: 'METER_READING', entityId: 100 + index, unitId: 100 + index, unitNumber: String(200 + index), before: { previousReading: 650, currentReading: 660 }, after: null }))
const batch = { id: 1, source: 'AUDIT_LOG', actorName: 'Jerry Crispe', actorRole: 'COLLECTOR', createdAt: '2026-10-26T14:47:14Z', entityName: 'BILLING_PERIOD', entityId: 42, action: 'DELETED', remarks: 'Removed the duplicate October billing batch.', oldValues: { periodStart: '2026-10-05', periodEnd: '2026-11-05', status: 'GENERATED', billCount: 63, readingCount: 63 }, context: { version: 1, target: { periodStart: '2026-10-05', periodEnd: '2026-11-05' }, counts: { billCount: 63, readingCount: 63 }, affectedCount: 63, affectedRecords: records } }
const edit = { id: 2, source: 'AUDIT_LOG', actorName: 'Original Admin', actorRole: 'ADMIN', createdAt: '2026-10-25T16:01:00Z', entityName: 'UNIT', entityId: 10, action: 'UPDATE', oldValues: { unitNumber: '232', billableAreaSqm: 12, passwordHash: 'private-credential' }, newValues: { unitNumber: '232', billableAreaSqm: 14, passwordHash: 'private-credential' }, context: { version: 1, target: { unitNumber: '232' }, changes: [{ field: 'billableAreaSqm', before: 12, after: 14 }], changeCount: 1, affectedRecords: [] } }
const legacy = { id: 3, source: 'AUDIT_LOG', actorName: 'Former Resident', actorRole: 'RESIDENT', createdAt: '2026-10-25T14:00:00Z', entityName: 'UNIT_BILL', entityId: 99, action: 'UPDATE', oldValues: null, newValues: null, context: { version: 0, target: {}, affectedRecords: [] } }
const payment = { id: 4, actorName: 'Original Admin', actorRole: 'ADMIN', createdAt: '2026-10-25T13:00:00Z', entityName: 'PAYMENT_SUBMISSION', entityId: 174, action: 'EDIT_INVOICES', context: { version: 1, target: { fullName: 'Juan Dela Cruz', paymentReference: 'REF-0000174', unitNumber: '232', amount: 1500, paymentPurpose: 'COMBINED', periodStart: '2026-10-05', periodEnd: '2026-11-05' }, changes: [{ field: 'invoiceNumber', category: 'ASSOCIATION_DUES', before: '2312', after: '#2312' }], changeCount: 1 } }

try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 1000 } })
    const user = { id: 1, role: 'ADMIN', fullName: 'Audit Tester', isActive: true, approvalStatus: 'APPROVED' }
    let detailsRequested = 0
    const requests = []
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      assert.equal(request.method(), 'GET', 'Audit display checks cannot mutate records')
      let data
      if (path === '/api/auth/me') data = { user }
      else if (path === '/api/notifications') data = { notifications: [], unreadCount: 0 }
      else if (path === '/api/audit-logs') {
        requests.push(Object.fromEntries(url.searchParams))
        const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 10)
        const filtered = Boolean(url.searchParams.get('q') || url.searchParams.get('entity') || url.searchParams.get('action') || url.searchParams.get('actorRole'))
        const total = filtered ? 1 : 235
        const logs = filtered ? [batch] : page > 1 ? [legacy] : [batch, edit, legacy, payment]
        data = { logs: logs.map(log => ({ ...log, oldValues: undefined, newValues: undefined, context: { ...log.context, affectedRecords: undefined } })), pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total }, summary: { total, admin: filtered ? 0 : 100, collector: filtered ? 1 : 100, resident: filtered ? 0 : 35 }, filters: { entities: ['BILLING_PERIOD', 'UNIT', 'UNIT_BILL'], actions: ['DELETED', 'UPDATE'] } }
      } else if (/\/api\/audit-logs\/\d+$/.test(path)) {
        detailsRequested++
        return route.fulfill({ status: 503, json: { message: 'Summary rows must not request details.' } })
      } else assert.fail(path)
      return route.fulfill({ json: data })
    })
    const page = await context.newPage(); page.on('pageerror', error => runtimeErrors.push(error.message))
    await page.goto('http://127.0.0.1:5173/admin/audit-logs')
    const row = page.locator('.audit-entry').first()
    await row.waitFor()
    assert.match(await row.innerText(), /Jerry Crispe/)
    assert.match(await row.innerText(), /Deleted Billing batch/i)
    assert.match(await row.innerText(), /Oct.*Nov/s)
    assert.equal(await row.locator('time:visible').count(), 1)
    assert.match(await page.locator('.audit-entry').nth(1).innerText(), /Updated Unit 232/)
    assert.match(await page.locator('.audit-entry').nth(1).innerText(), /Billable area.*12 → 14/)
    assert.match(await page.locator('.audit-entry').nth(2).innerText(), /SOA.*Identifying details not recorded/)
    const paymentText = await page.locator('.audit-entry').nth(3).innerText()
    assert.match(paymentText, /Updated invoices for Juan Dela Cruz.*Unit 232.*REF-0000174.*₱1,500.00/s)
    assert.match(paymentText, /Association dues invoice: 2312 → #2312/)
    assert.ok(!paymentText.includes('Payment #174'))
    assert.equal(await page.locator('.audit-entry button, .audit-entry [aria-expanded], [id^="audit-details-"]').count(), 0)
    assert.equal(detailsRequested, 0)
    assert.equal(await page.getByLabel('What happened?', { exact: true }).count(), 0, 'Filters start hidden')
    assert.equal(await page.getByRole('button', { name: 'Show filters', exact: true }).getAttribute('aria-expanded'), 'false')
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-compact-overview.png`, fullPage: true })
    const summaryBeforeClick = await row.innerText()
    await row.click()
    assert.equal(await row.innerText(), summaryBeforeClick)
    assert.equal(await page.getByRole('table').count(), 0)
    assert.equal(await page.getByRole('region', { name: 'Affected records' }).count(), 0)
    assert.equal(detailsRequested, 0, 'Clicking a summary must not fetch details')
    assert.ok(!(await page.locator('body').innerText()).includes('private-credential'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await next.scrollIntoViewIfNeeded(); await next.hover()
    assert.equal(await next.evaluate(el => getComputedStyle(el).transform), 'none')
    const scrollBefore = await page.evaluate(() => scrollY)
    await next.click()
    await page.waitForFunction(() => document.body.textContent.includes('Page 2 of 24'))
    assert.equal(requests.at(-1).page, '2')
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scrollBefore) <= 6, 'Paging must not collapse the feed or jump the viewport')
    const previous = page.getByRole('button', { name: 'Previous', exact: true })
    await previous.hover(); assert.equal(await previous.evaluate(el => getComputedStyle(el).transform), 'none')
    const first = page.getByRole('button', { name: 'First page', exact: true }), last = page.getByRole('button', { name: 'Last page', exact: true })
    await last.click(); await page.waitForFunction(() => document.body.textContent.includes('Page 24 of 24'))
    assert.equal(requests.at(-1).page, '24'); assert.equal(await last.isDisabled(), true)
    await first.click(); await page.waitForFunction(() => document.body.textContent.includes('Page 1 of 24'))
    assert.equal(requests.at(-1).page, '1'); assert.equal(await first.isDisabled(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('searchbox', { name: 'Search activity', exact: true }).fill('2026-10-05')
    await page.waitForFunction(() => document.body.textContent.includes('Page 1 of 1'))
    assert.equal(requests.at(-1).q, '2026-10-05'); assert.equal(requests.at(-1).page, '1')
    assert.equal(await first.isDisabled(), true); assert.equal(await last.isDisabled(), true)
    await page.getByRole('button', { name: 'Show filters', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Hide filters', exact: true }).getAttribute('aria-expanded'), 'true')
    assert.equal(await page.getByLabel('Who made the change?', { exact: true }).locator('option').count(), 4)
    const actionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audit-logs' && new URL(response.url()).searchParams.get('action') === 'DELETE')
    await page.getByLabel('What happened?', { exact: true }).selectOption('DELETE')
    await actionResponse
    assert.equal(requests.at(-1).action, 'DELETE')
    const roleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audit-logs' && new URL(response.url()).searchParams.get('actorRole') === 'COLLECTOR')
    await page.getByLabel('Who made the change?', { exact: true }).selectOption('COLLECTOR')
    await roleResponse
    assert.equal(requests.at(-1).actorRole, 'COLLECTOR')
    await page.getByRole('button', { name: /^Hide filters/ }).click()
    assert.equal(await page.getByLabel('What happened?', { exact: true }).count(), 0)
    await page.getByRole('button', { name: /^Show filters/ }).click()
    assert.equal(await page.getByLabel('Who made the change?', { exact: true }).inputValue(), 'COLLECTOR')
    await page.getByLabel('From date', { exact: true }).fill('2026-10-27')
    await page.getByLabel('To date', { exact: true }).fill('2026-10-26')
    await page.getByRole('alert').filter({ hasText: 'To date must be on or after' }).waitFor()
    assert.equal(detailsRequested, 0, 'The feed never requests expanded audit data')
    await context.close()
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: specific batch/unit/payment summaries, no expansion or detail requests, hidden filters, compact cards and stationary full-history pagination`)
  }
  assert.deepEqual(runtimeErrors, [])
} finally { await browser.close() }
