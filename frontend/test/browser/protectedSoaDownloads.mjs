// Mock-only browser acceptance. No real email, billing or account changes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/soa-email-requests/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const user = { id: 1, role: 'RESIDENT', fullName: 'Protected SOA Tester', email: 'resident@example.invalid', emailVerified: true, isActive: true, approvalStatus: 'APPROVED' }
    const bill = { id: 171, unitNumber: '234', floor: '2', payerName: user.fullName, periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-10', totalAmount: 1833.63, remainingBalance: 1833.63, approvedAmount: 0, advanceBalance: 0, paymentStatus: 'UNPAID', allowedPaymentPurposes: ['COMBINED'], charges: [] }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    let scenario = 'pending', creations = [], polls = 0, files = 0, verifications = 0, serverReceipt = null, now = Date.now()
    const exportId = '00000000-0000-4000-8000-000000000001'
    const receipt = () => ({ exportId, reference: 'SX-FIXTURE', status: 'READY', nextRequestAt: new Date(now + 30 * 60 * 1000).toISOString() })
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      if (path.endsWith('/protected-exports')) {
        assert.equal(req.headers().authorization, 'Bearer mock-only')
        if (req.method() === 'GET') return route.fulfill({ json: serverReceipt && Date.parse(serverReceipt.nextRequestAt) > now ? serverReceipt : { status: 'AVAILABLE' } })
        assert.equal(req.method(), 'POST'); assert.equal(req.postData(), null)
        const key = req.headers()['idempotency-key']; assert.match(key, /^[a-f\d-]{36}$/); creations.push(key)
        if (scenario === 'network') return route.abort('failed')
        if (scenario === 'unverified') return route.fulfill({ status: 403, json: { code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your account email before requesting an SOA.' } })
        if (scenario === 'failed') return route.fulfill({ json: { status: 'FAILED', message: 'SOA email could not be delivered.' } })
        if (scenario === 'cooldown') return route.fulfill({ status: 429, json: { code: 'SOA_EMAIL_COOLDOWN', nextRequestAt: receipt().nextRequestAt, retryAfterSeconds: 1800 } })
        if (scenario === 'pending') return route.fulfill({ status: 202, json: { exportId, status: 'EMAIL_PENDING' } })
        serverReceipt = receipt(); return route.fulfill({ json: serverReceipt })
      }
      if (path === `/api/soa-exports/${exportId}`) { polls++; serverReceipt = receipt(); return route.fulfill({ json: serverReceipt }) }
      if (path.endsWith('/file')) { files++; assert.fail('The portal must never request a PDF download') }
      if (path === '/api/auth/resend-verification') { verifications++; assert.deepEqual(JSON.parse(req.postData()), { email: user.email }); return route.fulfill({ json: { message: 'Verification email sent. Your account remains approved.' } }) }
      if (path.includes('/assets/')) return route.fulfill({ status: 404, json: { message: 'No fixture asset' } })
      const data = path === '/api/auth/me' ? { user } : path === '/api/bills/171' ? { bill } : path === '/api/notifications' ? { notifications: [], unreadCount: 0 } : null
      assert.ok(data, path); return route.fulfill({ json: data })
    })
    const page = await context.newPage(), errors = []
    await page.clock.install({ time: new Date(now) })
    page.on('pageerror', e => errors.push(e.message))
    page.on('download', () => assert.fail('SOAs are downloaded from email, never the portal'))
    await page.goto('http://127.0.0.1:5173/resident/bills/171')
    const requestButton = () => page.getByRole('button', { name: 'Request SOA', exact: true })
    const sentButton = () => page.getByRole('button', { name: 'SOA already sent in email', exact: true })
    async function expectSent() {
      await sentButton().waitFor()
      assert.equal(await sentButton().isDisabled(), true)
      assert.equal(await page.getByText(/Request successful!|Sent to r\*|Request another SOA email/).count(), 0)
      assert.equal(await sentButton().locator('..').locator('[role="status"], [role="alert"]').count(), 0, 'No details below the sent button')
    }
    async function expireCooldown() {
      now += 30 * 60 * 1000 + 1000
      await page.clock.fastForward(30 * 60 * 1000 + 1000)
      await requestButton().waitFor(); assert.equal(await requestButton().isEnabled(), true)
    }
    await requestButton().waitFor(); await requestButton().click()
    assert.equal(await page.getByRole('button', { name: 'Sending SOA…' }).isDisabled(), true)
    await page.clock.runFor(2200)
    await expectSent(); assert.equal(polls, 1); assert.equal(files, 0)
    await page.screenshot({ path: `${output}/${width}px-ready.png` })
    const firstKey = creations[0]
    await page.reload(); await expectSent(); assert.equal(creations.length, 1, 'Refreshing cannot send another email')
    const secondTab = await context.newPage()
    await secondTab.goto('http://127.0.0.1:5173/resident/bills/171')
    await secondTab.getByRole('button', { name: 'SOA already sent in email', exact: true }).waitFor()
    assert.equal(creations.length, 1, 'A new tab restores the server cooldown without sending')
    await secondTab.close()
    await expireCooldown(); scenario = 'ready'; await requestButton().click(); await expectSent()
    assert.notEqual(creations.at(-1), firstKey, 'After 30 minutes a new request gets a fresh key')
    await expireCooldown(); scenario = 'network'; await requestButton().click(); await page.getByRole('alert').waitFor(); const retryKey = creations.at(-1)
    scenario = 'ready'; await requestButton().click(); await expectSent(); assert.equal(creations.at(-1), retryKey)
    await expireCooldown(); scenario = 'failed'; await requestButton().click(); await page.getByRole('alert').waitFor(); const failedKey = creations.at(-1)
    scenario = 'ready'; await requestButton().click(); await expectSent(); assert.notEqual(creations.at(-1), failedKey)
    await expireCooldown(); scenario = 'cooldown'; await requestButton().click(); await expectSent()
    await expireCooldown(); scenario = 'unverified'; await requestButton().click(); await page.getByRole('button', { name: 'Send account verification link' }).click(); await page.getByText('Verification email sent. Your account remains approved.').waitFor(); assert.equal(verifications, 1)
    assert.equal(await page.locator('.soa-viewer').getByRole('button', { name: 'View SOA', exact: true }).isVisible(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow')
    assert.equal(files, 0); assert.deepEqual(errors, [])
    await context.close()
    console.log(`${width}px: compact sent button, 30-minute cooldown, reload/new-tab recovery, retries, verification and no downloads passed`)
  }
} finally { await browser.close() }
