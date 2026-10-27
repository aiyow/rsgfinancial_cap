// Mock-only browser acceptance. No real email, billing or account changes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/protected-soa/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const user = { id: 1, role: 'RESIDENT', fullName: 'Protected SOA Tester', email: 'resident@example.invalid', emailVerified: true, isActive: true, approvalStatus: 'APPROVED' }
    const bill = { id: 171, unitNumber: '234', floor: '2', payerName: user.fullName, periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-10', totalAmount: 1833.63, remainingBalance: 1833.63, approvedAmount: 0, advanceBalance: 0, paymentStatus: 'UNPAID', allowedPaymentPurposes: ['COMBINED'], charges: [] }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    let scenario = 'pending', creations = [], polls = 0, files = 0, verifications = 0
    const exportId = '00000000-0000-4000-8000-000000000001'
    const ready = { exportId, reference: 'SX-FIXTURE', status: 'READY', maskedEmail: 'r***@example.invalid', filename: 'SOA-SX-FIXTURE.pdf' }
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      if (path.endsWith('/protected-exports')) {
        assert.equal(req.method(), 'POST'); assert.equal(req.postData(), null); assert.equal(req.headers().authorization, 'Bearer mock-only')
        const key = req.headers()['idempotency-key']; assert.match(key, /^[a-f\d-]{36}$/); creations.push(key)
        if (scenario === 'network') return route.abort('failed')
        if (scenario === 'unverified') return route.fulfill({ status: 403, json: { code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your account email before downloading a protected SOA.' } })
        if (scenario === 'failed') return route.fulfill({ json: { ...ready, status: 'FAILED', message: 'Password email could not be delivered.' } })
        return route.fulfill({ status: scenario === 'pending' ? 202 : 200, json: scenario === 'pending' ? { ...ready, status: 'EMAIL_PENDING' } : ready })
      }
      if (path === `/api/soa-exports/${exportId}`) { polls++; return route.fulfill({ json: ready }) }
      if (path === `/api/soa-exports/${exportId}/file`) { files++; assert.equal(req.headers().authorization, 'Bearer mock-only'); return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7 encrypted fixture placeholder' }) }
      if (path === '/api/auth/resend-verification') { verifications++; assert.deepEqual(JSON.parse(req.postData()), { email: user.email }); return route.fulfill({ json: { message: 'Verification email sent. Your account remains approved.' } }) }
      if (path.includes('/assets/')) return route.fulfill({ status: 404, json: { message: 'No fixture asset' } })
      const data = path === '/api/auth/me' ? { user } : path === '/api/bills/171' ? { bill } : path === '/api/notifications' ? { notifications: [], unreadCount: 0 } : null
      assert.ok(data, path); return route.fulfill({ json: data })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('http://127.0.0.1:5173/resident/bills/171')
    const downloadButton = () => page.getByRole('button', { name: 'Download protected SOA', exact: true })
    await downloadButton().waitFor(); assert.equal(await page.getByRole('button', { name: 'Print / PDF' }).count(), 0)
    const download = page.waitForEvent('download'); await downloadButton().click()
    assert.equal(await page.getByRole('button', { name: 'Preparing protected SOA…' }).isDisabled(), true)
    assert.equal((await download).suggestedFilename(), 'SOA-SX-FIXTURE.pdf'); assert.equal(polls, 1); assert.equal(files, 1)
    await page.getByText('Your protected SOA is ready. Check your email for its password.').waitFor()
    assert.equal(await page.getByText('Sent to r***@example.invalid · SX-FIXTURE').isVisible(), true)
    await page.screenshot({ path: `${output}/${width}px-ready.png` })
    scenario = 'ready'; const redownload = page.waitForEvent('download'); await downloadButton().click(); await redownload
    assert.equal(creations[0], creations[1], 'Repeat downloads reuse the idempotent export')
    const fresh = page.waitForEvent('download'); await page.getByRole('button', { name: 'Create a fresh PDF and password' }).click(); await fresh
    assert.notEqual(creations[2], creations[1])

    scenario = 'network'; await downloadButton().click(); await page.getByRole('alert').waitFor(); const retryKey = creations.at(-1)
    scenario = 'ready'; const retry = page.waitForEvent('download'); await downloadButton().click(); await retry; assert.equal(creations.at(-1), retryKey)
    scenario = 'failed'; await downloadButton().click(); await page.getByRole('alert').waitFor(); const failedKey = creations.at(-1)
    scenario = 'ready'; const recovered = page.waitForEvent('download'); await downloadButton().click(); await recovered; assert.notEqual(creations.at(-1), failedKey)
    scenario = 'unverified'; await downloadButton().click(); await page.getByRole('button', { name: 'Send account verification link' }).click(); await page.getByText('Verification email sent. Your account remains approved.').waitFor(); assert.equal(verifications, 1)
    await page.screenshot({ path: `${output}/${width}px-verify-email.png` })
    assert.equal(await page.locator('input[type="password"]').count(), 0, 'No account-password reauthentication')
    assert.equal(await page.locator('.soa-viewer').getByRole('button', { name: 'View SOA', exact: true }).isVisible(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow')
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`${width}px: protected download, pending polling, retry identity, fresh export, verification and glass viewer passed`)
  }
} finally { await browser.close() }
