// All APIs are read-only mocks, including deleted records and deliberately failing details.
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
const edit = { id: 2, source: 'AUDIT_LOG', actorName: 'Original Admin', actorRole: 'ADMIN', createdAt: '2026-10-25T16:01:00Z', entityName: 'UNIT', entityId: 10, action: 'UPDATE', oldValues: { unitNumber: '232', billableAreaSqm: 12, passwordHash: 'private-credential' }, newValues: { unitNumber: '232', billableAreaSqm: 14, passwordHash: 'private-credential' }, context: { version: 1, target: { unitNumber: '232' }, affectedRecords: [] } }
const legacy = { id: 3, source: 'AUDIT_LOG', actorName: 'Former Resident', actorRole: 'RESIDENT', createdAt: '2026-10-25T14:00:00Z', entityName: 'UNIT_BILL', entityId: 99, action: 'UPDATE', oldValues: null, newValues: null, context: { version: 0, target: {}, affectedRecords: [] } }

try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 1000 } })
    const user = { id: 1, role: 'ADMIN', fullName: 'Audit Tester', isActive: true, approvalStatus: 'APPROVED' }
    let detailsRequested = 0, failDetails = true
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
        const logs = filtered ? [batch] : page > 1 ? [legacy] : [batch, edit, legacy]
        data = { logs: logs.map(log => ({ ...log, oldValues: undefined, newValues: undefined, context: { ...log.context, affectedRecords: undefined } })), pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total }, summary: { total, admin: filtered ? 0 : 100, collector: filtered ? 1 : 100, resident: filtered ? 0 : 35 }, filters: { entities: ['BILLING_PERIOD', 'UNIT', 'UNIT_BILL'], actions: ['DELETED', 'UPDATE'] } }
      } else if (/\/api\/audit-logs\/\d+$/.test(path)) {
        detailsRequested++
        if (failDetails) { failDetails = false; return route.fulfill({ status: 503, json: { message: 'Details temporarily unavailable.' } }) }
        data = { log: [batch, edit, legacy].find(log => String(log.id) === path.split('/').at(-1)) }
      } else assert.fail(path)
      return route.fulfill({ json: data })
    })
    const page = await context.newPage(); page.on('pageerror', error => runtimeErrors.push(error.message))
    await page.goto('http://127.0.0.1:5173/admin/audit-logs')
    const toggle = page.locator('[aria-controls="audit-details-1"]')
    await toggle.waitFor()
    assert.match(await toggle.innerText(), /Deleted Billing batch #42/i)
    assert.match(await toggle.innerText(), /Oct.*Nov/s)
    assert.equal(detailsRequested, 0, 'Details must be lazy loaded')
    assert.equal(await page.getByLabel('What happened?', { exact: true }).count(), 0, 'Filters start hidden')
    assert.equal(await page.getByRole('button', { name: 'Show filters', exact: true }).getAttribute('aria-expanded'), 'false')
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-compact-overview.png`, fullPage: true })
    await toggle.focus(); await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Retry details', exact: true }).click()
    const details = page.locator('#audit-details-1')
    await details.getByRole('region', { name: 'Affected records' }).count() // Section has its own accessible label.
    await details.getByRole('heading', { name: 'Affected records (63)' }).waitFor()
    assert.equal(await details.getByRole('table').last().locator('tbody tr').count(), 25)
    await details.getByRole('button', { name: 'Next units', exact: true }).click()
    assert.match(await details.innerText(), /Page 2 of 3/)
    await details.getByRole('searchbox', { name: 'Search affected units', exact: true }).fill('262')
    assert.equal(await details.getByRole('table').last().locator('tbody tr').count(), 1)
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-expanded-batch.png`, fullPage: true })
    await toggle.click(); await toggle.click()
    assert.equal(detailsRequested, 2, 'Reopening cached details must not fetch again')
    await page.locator('[aria-controls="audit-details-2"]').click()
    await page.locator('#audit-details-2').getByRole('table').waitFor()
    assert.ok(!(await page.locator('#audit-details-2').innerText()).includes('private-credential'))
    await page.locator('[aria-controls="audit-details-3"]').click()
    await page.getByText(/Historical entry: details that were not captured/).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    while (await page.locator('button[aria-controls^="audit-details-"][aria-expanded="true"]').count()) await page.locator('button[aria-controls^="audit-details-"][aria-expanded="true"]').first().click()
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
    await page.getByLabel('What happened?', { exact: true }).selectOption('DELETE')
    await page.waitForTimeout(350)
    assert.equal(requests.at(-1).action, 'DELETE')
    await page.getByLabel('Who made the change?', { exact: true }).selectOption('COLLECTOR')
    await page.waitForTimeout(350)
    assert.equal(requests.at(-1).actorRole, 'COLLECTOR')
    await page.getByRole('button', { name: /^Hide filters/ }).click()
    assert.equal(await page.getByLabel('What happened?', { exact: true }).count(), 0)
    await page.getByRole('button', { name: /^Show filters/ }).click()
    assert.equal(await page.getByLabel('Who made the change?', { exact: true }).inputValue(), 'COLLECTOR')
    await page.getByLabel('From date', { exact: true }).fill('2026-10-27')
    await page.getByLabel('To date', { exact: true }).fill('2026-10-26')
    await page.getByRole('alert').filter({ hasText: 'To date must be on or after' }).waitFor()
    await context.close()
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: detailed batch identity, keyboard expansion, retry, caching, field redaction, affected-unit paging/search, hidden filters, compact cards and stationary full-history pagination`)
  }
  assert.deepEqual(runtimeErrors, [])
} finally { await browser.close() }
