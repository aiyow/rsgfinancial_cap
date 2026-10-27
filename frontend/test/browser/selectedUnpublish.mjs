// Mock-only acceptance: never changes real SOA visibility or sends email.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/selected-unpublish/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const user = { id: 1, role: 'ADMIN', fullName: 'Selected Unpublish Tester', isActive: true, approvalStatus: 'APPROVED' }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    let bills = Array.from({ length: 12 }, (_, i) => ({ id: 1001 + i, unitNumber: String(231 + i), payerName: 'Fixture Resident',
      dueDate: '2026-11-10', totalAmount: 100, publishedAt: [0, 1, 10, 11].includes(i) ? '2026-10-27T00:00:00Z' : null, emailDelivery: { sent: 1 } }))
    let mode = 'wrong', calls = 0, release
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      if (req.method() === 'GET') {
        if (path === '/api/auth/me') return route.fulfill({ json: { user } })
        if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], unreadCount: 0 } })
        if (path === '/api/bills') return route.fulfill({ json: { bills } })
      }
      assert.equal(path, '/api/billing-periods/42/unpublish-selected')
      const body = req.postDataJSON()
      assert.deepEqual(body.billIds, [1001, 1002, 1011], 'Only selected published SOAs, including selections across pages')
      calls++
      if (mode === 'wrong') return route.fulfill({ status: 403, json: { message: 'Your current password is incorrect. No SOAs were unpublished.' } })
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { message: 'Every selected SOA must belong to this batch and still be published. Refresh the batch and try again.' } })
      await new Promise(resolve => { release = resolve })
      bills = bills.map(bill => body.billIds.includes(bill.id) ? { ...bill, publishedAt: null, emailDelivery: null } : bill)
      return route.fulfill({ json: { message: 'Unpublished 3 SOAs.', unpublishedCount: 3 } })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/admin/soa/batches/42')
    const selected = () => page.getByRole('button', { name: /^Unpublish selected(?: \(\d+\))?$/i })
    await selected().waitFor()
    assert.equal(await selected().isDisabled(), true)
    // Match the reported case: search narrows the list to published SOAs.
    const search = page.getByPlaceholder('e.g. 401 or owner name')
    await search.fill('231')
    const publishedCheckbox = page.getByRole('checkbox', { name: 'Select SOA for Unit 231', exact: true })
    assert.equal(await publishedCheckbox.isEnabled(), true)
    await page.getByRole('button', { name: 'Select page', exact: true }).click()
    assert.equal(await publishedCheckbox.isChecked(), true)
    await page.getByRole('button', { name: /^Unpublish selected \(1\)$/i }).waitFor()
    await page.getByRole('button', { name: 'Deselect page', exact: true }).click()
    assert.equal(await publishedCheckbox.isChecked(), false)
    await search.fill('')
    await page.getByRole('checkbox', { name: 'Select SOA for Unit 231', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Select SOA for Unit 232', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Select SOA for Unit 233', exact: true }).check()
    await page.getByRole('button', { name: /^Publish selected \(1\)$/i }).waitFor()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Select SOA for Unit 241', exact: true }).check()
    await selected().click()
    const dialog = page.getByRole('dialog', { name: 'Unpublish selected SOAs?', exact: true })
    const password = () => dialog.getByLabel('Your current Admin password', { exact: true })
    const confirm = () => dialog.getByRole('button', { name: 'Confirm unpublish selected', exact: true })
    await dialog.getByText('Units: 231, 232, 241', { exact: true }).waitFor()
    assert.equal(await confirm().isDisabled(), true)
    await page.screenshot({ path: output + '/' + width + 'px-confirm.png' })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(calls, 0)
    await selected().click()
    await password().fill('wrong-fixture-password'); await confirm().click()
    await dialog.getByRole('alert').waitFor(); assert.equal(await password().inputValue(), '')
    mode = 'conflict'; await password().fill('fixture-only-password'); await confirm().click()
    await dialog.getByText(/Refresh the batch/).waitFor()
    mode = 'success'; await password().fill('fixture-only-password'); await confirm().click()
    await dialog.getByRole('button', { name: 'Unpublishing...', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true)
    release(); await dialog.waitFor({ state: 'hidden' })
    await page.getByText('1 published to Residents | 11 still hidden', { exact: true }).waitFor()
    assert.ok(bills.find(bill => bill.id === 1012).publishedAt, 'Unselected SOA remains published')
    assert.equal(await page.getByRole('button', { name: /^Publish selected \(1\)$/i }).isEnabled(), true, 'Hidden selections remain available to publish')
    assert.equal(await selected().isDisabled(), true)
    assert.equal(calls, 3)
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-only-password')), false)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    await context.close()
    console.log(width + 'px: mixed selection, pagination, password, stale state, loading and exact subset success passed')
  }
} finally { await browser.close() }
