// Sanitized fixtures only. All API calls are intercepted; no payment is changed.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const output = fileURLToPath(new URL('../../../artifacts/receipt-batches/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const analysis = { amount: 1675.88, referenceNo: 'BN-20261112-12345678', paymentDate: '2026-11-12',
  quality: { status: 'GOOD' }, confidence: 92, detectedReceiptType: 'BDO', warnings: [], complete: true }

async function image(page, color, label) {
  return Buffer.from(await page.evaluate(({ color, label }) => {
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 1000
    const c = canvas.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 700, 1000)
    c.fillStyle = '#123'; c.font = '30px Arial'; c.fillText(label, 40, 70)
    return canvas.toDataURL('image/png').split(',')[1]
  }, { color, label }), 'base64')
}

try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true }
      : { viewport: { width: 1366, height: 900 }, acceptDownloads: true })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const images = [await image(page, '#f0fdf4', 'Receipt part 1'), await image(page, '#eff6ff', 'Receipt part 2')]
    const files = images.map((buffer, i) => ({ name: `part-${i + 1}.png`, mimeType: 'image/png', buffer }))
    const resident = { id: 10, role: 'RESIDENT', fullName: 'Sample Resident', isActive: true, approvalStatus: 'APPROVED' }
    const admin = { ...resident, id: 1, role: 'ADMIN', fullName: 'Sample Admin' }
    let user = resident, count = 2, submitted = 0, previews = 0
    const bill = { id: 171, unitNumber: '237', totalAmount: 1675.88, remainingBalance: 1675.88,
      paymentStatus: 'UNPAID', allowedPaymentPurposes: ['COMBINED'], charges: [] }
    const payment = { id: 171, unitNumber: '237', entryType: 'RECEIPT_UPLOAD', reviewStatus: 'APPROVED',
      receiptType: 'BDO', receiptMimeType: 'image/png', submittedByName: 'Sample Resident', submittedAt: '2026-11-12T00:00:00Z',
      ocrAmount: analysis.amount, ocrReferenceNo: analysis.referenceNo, ocrPaymentDate: analysis.paymentDate,
      paymentPurpose: 'COMBINED', paymentMethod: 'BANK_TRANSFER', verifiedAmount: analysis.amount,
      verifiedReferenceNo: analysis.referenceNo, officialReceiptNo: 'REF-0000171', allocations: [], ocrDetails: { warnings: [] } }
    await context.addInitScript(user => {
      if (!localStorage.getItem('condo_token')) { localStorage.setItem('condo_token', 'fixture-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
        window.sharedReceipt = { name: files[0].name, bytes: [...new Uint8Array(await files[0].arrayBuffer())] }
      } })
    }, resident)
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
      if (request.method() === 'POST') {
        const data = request.postDataBuffer().toString('latin1')
        assert.equal((data.match(/name="receipt"; filename=/g) || []).length, 2)
        assert.match(data, /name="receiptType"\r\n\r\nBDO/)
        if (path.endsWith('/preview')) { previews++; return route.fulfill({ json: { analysis } }) }
        assert.equal(path, '/api/payments/bills/171'); submitted++
        return route.fulfill({ status: 201, json: { paymentId: 171, analysis } })
      }
      assert.equal(request.method(), 'GET')
      if (path === '/api/payments/171/receipt' || path === '/api/payments/171/receipts/501') return route.fulfill({ contentType: 'image/png', body: images[0] })
      if (path === '/api/payments/171/receipts/502') return route.fulfill({ contentType: 'image/png', body: images[1] })
      if (path.includes('/assets/')) return route.fulfill({ status: 404, json: { message: 'No fixture asset' } })
      const data = path === '/api/auth/me' ? { user } : path === '/api/bills/171' ? { bill }
        : path === '/api/notifications' ? { notifications: [], unreadCount: 0 }
          : path === '/api/soa-template' ? { template: {} } : path === '/api/bills' ? { bills: [bill] }
            : path === '/api/analytics/resident' ? { units: [] }
              : path === '/api/prescriptive-recommendations/resident' ? { recommendations: [] }
                : path === '/api/bills/171/protected-exports' ? { status: 'AVAILABLE' }
                  : path === '/api/payments' ? { payments: [] }
                    : path === '/api/payments/171' ? { payment: { ...payment, receiptImages: count === 2
                      ? [{ id: 501, position: 1, mimeType: 'image/png' }, { id: 502, position: 2, mimeType: 'image/png' }] : [] } } : null
      assert.ok(data, path)
      return route.fulfill({ json: data })
    })
    await page.goto(`${base}/resident/bills/171`)
    await page.getByRole('button', { name: 'Upload receipt', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Submit your receipt' })
    const picker = dialog.getByLabel('Receipt images', { exact: true })
    await picker.setInputFiles(files[0])
    assert.equal(await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).isDisabled(), true)
    await dialog.getByLabel('Select Receipt Type', { exact: true }).selectOption('BDO')
    await picker.setInputFiles(files)
    assert.equal(await dialog.locator('input[type="file"]').count(), 1)
    const pager = dialog.getByLabel('Receipt image page', { exact: true })
    await pager.getByText('1 of 2', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    assert.equal(await pager.innerText(), '2 of 2')
    assert.equal(await dialog.getByRole('img', { name: 'Uploaded payment receipt', exact: true }).count(), 1)
    await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).click()
    await dialog.getByText('₱1,675.88', { exact: true }).waitFor()
    await dialog.getByText('November 12, 2026', { exact: true }).waitFor()
    await dialog.getByLabel('Select Receipt Type', { exact: true }).selectOption('OTHER')
    assert.equal(await dialog.getByText('Detected amount', { exact: true }).count(), 0)
    await dialog.getByLabel('Select Receipt Type', { exact: true }).selectOption('BDO')
    await picker.setInputFiles(files[0])
    assert.equal(await dialog.getByRole('button', { name: 'Next', exact: true }).count(), 0)
    await picker.setInputFiles(files)
    await picker.setInputFiles([...files, { ...files[0], name: 'third.png' }])
    await dialog.getByRole('alert').getByText(/one or two images/).waitFor()
    await picker.setInputFiles(files)
    assert.equal(await dialog.getByRole('alert').count(), 0)
    await picker.setInputFiles([files[0], { ...files[1], name: 'replacement.png' }])
    assert.equal(await picker.evaluate(el => el.files[1].name), 'replacement.png')
    await dialog.getByRole('button', { name: 'Preview OCR', exact: true }).click()
    await dialog.getByText('₱1,675.88', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-resident.png` })
    await dialog.getByRole('button', { name: 'Submit payment proof', exact: true }).click()
    await page.getByRole('dialog', { name: 'Payment Submitted', exact: true }).waitFor()
    assert.equal(submitted, 1); assert.equal(previews, 2)
    await page.getByRole('button', { name: 'View Payment History', exact: true }).click()
    await page.waitForURL('**/resident/payments')

    user = admin
    await page.evaluate(user => localStorage.setItem('condo_user', JSON.stringify(user)), admin)
    await page.goto(`${base}/admin/payments/171`)
    const adminPager = page.getByLabel('Receipt image page', { exact: true })
    await adminPager.getByText('1 of 2', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    assert.equal(await adminPager.innerText(), '2 of 2')
    assert.equal(await page.getByRole('img', { name: 'Uploaded payment receipt', exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Zoom in receipt', exact: true }).click()
    await page.getByRole('button', { name: 'Share receipt image', exact: true }).click()
    await page.waitForFunction(() => window.sharedReceipt)
    assert.deepEqual(Buffer.from(await page.evaluate(() => window.sharedReceipt.bytes)), images[1])
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt image', exact: true }).click()])
    assert.equal(download.suggestedFilename(), 'payment-receipt-171-2.png')
    assert.deepEqual(await readFile(await download.path()), images[1])
    await page.getByRole('button', { name: 'Prev', exact: true }).click()
    assert.equal(await page.getByLabel('Receipt zoom', { exact: true }).innerText(), '100%')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-admin.png`, fullPage: true })
    count = 1
    await page.reload()
    await page.getByRole('button', { name: 'Download receipt image', exact: true }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Receipt image pages', exact: true }).count(), 0)
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'} receipt selection, combined OCR, two-image submission, gallery, active-image download/share and legacy single image`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
