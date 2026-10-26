// All requests and receipt images are fixtures; no real payment is submitted.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/receipt-feedback/', import.meta.url))
await mkdir(output, { recursive: true })
const qualityMessage = 'The receipt image is blurred. Please upload a clearer image and try again.'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const runtimeErrors = []

try {
  for (const mobile of [true, false]) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1366, height: 900 } })
    const user = { id: 1, role: 'RESIDENT', fullName: 'Receipt Tester', isActive: true, approvalStatus: 'APPROVED' }
    const bill = { id: 171, unitNumber: '237', totalAmount: 1694.22, remainingBalance: 1694.22, paymentStatus: 'UNPAID', allowedPaymentPurposes: ['COMBINED'], charges: [] }
    let response = { status: 422, body: { message: qualityMessage, analysis: { quality: { status: 'LOW_RESOLUTION' } } } }
    let submitCount = 0
    await context.addInitScript(user => {
      localStorage.setItem('condo_token', 'mock-only')
      localStorage.setItem('condo_user', JSON.stringify(user))
    }, user)
    await context.route('**/api/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'POST') {
        assert.ok(['/api/payments/bills/171/preview', '/api/payments/bills/171'].includes(path), path)
        if (path === '/api/payments/bills/171') submitCount++
        return route.fulfill({ status: response.status, json: response.body })
      }
      assert.equal(request.method(), 'GET')
      if (path.includes('/assets/')) return route.fulfill({ status: 404, json: { message: 'No fixture asset' } })
      const data = path === '/api/auth/me' ? { user }
        : path === '/api/bills/171' ? { bill }
          : path === '/api/notifications' ? { notifications: [], unreadCount: 0 }
            : path === '/api/soa-template' ? { template: {} }
              : path === '/api/payments' ? { payments: [] } : null
      assert.ok(data, path)
      return route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => runtimeErrors.push(error.message))
    await page.goto('http://127.0.0.1:5173/resident/bills/171')
    await page.getByRole('button', { name: 'Upload receipt', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Submit your receipt' })
    const input = dialog.getByLabel('Receipt image', { exact: true })
    const image = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 1000
      return canvas.toDataURL('image/png').split(',')[1]
    }), 'base64')
    const select = name => input.setInputFiles({ name, mimeType: 'image/png', buffer: image })
    await select('invalid.pdf')
    await dialog.getByRole('alert').waitFor()
    assert.match(await dialog.getByRole('alert').innerText(), /Only JPEG/)
    await select('receipt.png')
    assert.equal(await dialog.getByRole('alert').count(), 0)
    await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).click()
    const alert = dialog.getByRole('alert')
    await alert.waitFor()
    assert.match(await alert.innerText(), /receipt image is blurred.*clearer image and try again/)
    assert.equal(await page.locator('[role="alert"]').count(), 1)
    await dialog.getByText('Blurred image', { exact: true }).waitFor()
    await dialog.locator('div.overflow-y-auto').last().evaluate(el => { el.scrollTop = el.scrollHeight })
    const box = await alert.boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height)
    assert.ok(await alert.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }))
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-error.png` })
    await alert.waitFor({ state: 'hidden', timeout: 10000 })
    assert.equal(await dialog.isVisible(), true, 'Auto-dismiss keeps the receipt form open')
    await dialog.getByText('Blurred image', { exact: true }).waitFor()
    assert.equal(await input.evaluate(el => el.files[0]?.name), 'receipt.png')

    // Repeating the same failure must show a fresh notification after dismissal.
    await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).click()
    await alert.waitFor()
    await dialog.getByRole('button', { name: 'Dismiss receipt notification', exact: true }).click()
    assert.equal(await alert.count(), 0)
    assert.equal(await dialog.isVisible(), true)

    for (const [status, message, analysis] of [
      [422, qualityMessage, { quality: { status: 'BLURRY' } }],
      [409, 'This receipt image was already submitted.'],
      [500, 'Upload failed. Please try again.'],
      [400, 'The uploaded file is not a readable JPEG/JPG or PNG image.'],
    ]) {
      response = { status, body: { message, analysis } }
      await dialog.getByRole('button', { name: 'Submit payment proof', exact: true }).click()
      await page.waitForFunction(message => document.getElementById('receipt-form-feedback')?.textContent === message, message)
      assert.equal(await alert.isVisible(), true)
    }
    await select('clear-receipt.png')
    response = { status: 200, body: { message: 'Receipt is clear and all payment fields were detected.', analysis: { quality: { status: 'GOOD' }, amount: 1694.22 } } }
    await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).click()
    await dialog.getByText('Clear image', { exact: true }).waitFor()
    assert.equal(await dialog.getByText('Receipt preview ready', { exact: true }).count(), 0)
    assert.equal(await dialog.locator('#receipt-form-feedback').count(), 0)
    assert.equal(new URL(page.url()).pathname, '/resident/bills/171')
    response = { status: 201, body: { message: 'Payment proof submitted for Admin verification.' } }
    const countBefore = submitCount
    await dialog.getByRole('button', { name: 'Submit payment proof', exact: true }).click()
    await dialog.getByRole('status').filter({ hasText: 'Opening Payments…' }).waitFor()
    const redirectStarted = Date.now()
    assert.equal(submitCount, countBefore + 1)
    assert.equal(await dialog.getByText('Payment proof submitted', { exact: true }).count(), 0)
    assert.equal(await dialog.locator('#receipt-form-feedback').count(), 0)
    assert.equal(await dialog.getByRole('button', { name: 'Submit payment proof', exact: true }).count(), 0)
    assert.equal(new URL(page.url()).pathname, '/resident/bills/171')
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-success.png` })
    await page.waitForURL('**/resident/payments', { timeout: 6000 })
    const redirectDelay = Date.now() - redirectStarted
    assert.ok(redirectDelay >= 2500 && redirectDelay < 6000, `Expected a 3-second redirect, got ${redirectDelay}ms`)
    assert.equal(await page.getByText('Payment proof submitted', { exact: true }).count(), 0)
    assert.equal(submitCount, countBefore + 1, 'Redirect must not submit again')
    assert.equal(await page.getByRole('button', { name: 'pending', exact: true }).getAttribute('aria-pressed'), 'true')
    await context.close()
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: error notifications, no success notifications, and automatic 3-second redirect to pending payments`)
  }
  assert.deepEqual(runtimeErrors, [])
} finally {
  await browser.close()
}
