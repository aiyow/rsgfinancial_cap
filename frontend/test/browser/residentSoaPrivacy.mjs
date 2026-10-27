// Read-only mocked resident data; no real account, statement or payment changes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/resident-soa-privacy/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const user = { id: 1, role: 'RESIDENT', fullName: 'SOA Privacy Tester', isActive: true, approvalStatus: 'APPROVED' }
    const bill = { id: 171, unitNumber: '234', floor: '2', payerName: 'SOA Privacy Tester', periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-10', totalAmount: 1833.63, remainingBalance: 1833.63, approvedAmount: 0, advanceBalance: 0, paymentStatus: 'UNPAID', allowedPaymentPurposes: ['COMBINED'], charges: [] }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'mock-only'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    await context.route('**/api/**', route => {
      assert.equal(route.request().method(), 'GET')
      const path = new URL(route.request().url()).pathname
      if (path.includes('/assets/')) return route.fulfill({ status: 404, json: { message: 'No fixture asset' } })
      const data = path === '/api/auth/me' ? { user } : path === '/api/bills/171' ? { bill } : path === '/api/notifications' ? { notifications: [], unreadCount: 0 } : null
      assert.ok(data, path); return route.fulfill({ json: data })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/resident/bills/171')
    const viewer = page.locator('.soa-viewer'), canvas = viewer.locator('.soa-viewer-canvas'), viewport = viewer.locator('.soa-viewer-viewport')
    const reveal = () => viewer.getByRole('button', { name: 'View SOA', exact: true })
    async function expectHidden() {
      await reveal().waitFor(); assert.equal(await canvas.evaluate(el => getComputedStyle(el).filter), 'blur(8px)'); assert.equal(await canvas.getAttribute('aria-hidden'), 'true'); assert.equal(await canvas.evaluate(el => el.inert), true)
    }
    async function expectRevealed() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.soa-viewer-canvas')).filter === 'none')
      assert.equal(await reveal().count(), 0); assert.equal(await canvas.getAttribute('aria-hidden'), 'false'); assert.equal(await canvas.evaluate(el => el.inert), false)
    }
    async function zoomUntilScrollable() {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await viewport.evaluate(el => el.scrollHeight > el.clientHeight + 100 && el.scrollWidth > el.clientWidth + 60)) return
        await viewer.getByRole('button', { name: 'Zoom in statement', exact: true }).click()
      }
      assert.fail('The zoomed SOA must be scrollable in both directions')
    }
    await expectHidden(); await viewer.scrollIntoViewIfNeeded()
    assert.equal((await viewer.locator('.soa-viewer-privacy-overlay').innerText()).trim(), 'View SOA', 'The glass overlay contains only the reveal button')
    assert.match(await reveal().evaluate(el => getComputedStyle(el).backdropFilter), /blur\(18px\)/)
    await page.screenshot({ path: `${output}/${width}px-hidden.png` })
    await reveal().focus(); await page.keyboard.press('Enter'); await expectRevealed()
    assert.equal(await viewport.evaluate(el => el === document.activeElement), true)
    await page.screenshot({ path: `${output}/${width}px-revealed.png` })
    const beforeDown = await page.evaluate(() => scrollY)
    await page.evaluate(() => scrollBy(0, 50))
    assert.ok(await page.evaluate(before => scrollY > before, beforeDown)); await expectHidden()
    await reveal().click(); await expectRevealed()
    const beforeUp = await page.evaluate(() => scrollY)
    await page.evaluate(() => scrollBy(0, -50))
    assert.ok(await page.evaluate(before => scrollY < before, beforeUp)); await expectHidden()

    await viewer.scrollIntoViewIfNeeded(); await zoomUntilScrollable()
    await reveal().click(); await expectRevealed()
    await viewport.evaluate(el => { el.scrollTop += 50 }); await expectRevealed()
    await viewport.evaluate(el => { el.scrollTop -= 25 }); await expectRevealed()
    await viewport.evaluate(el => { el.scrollLeft += 40 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expectRevealed()
    const viewportBox = await viewport.boundingBox(), beforeWheel = await viewport.evaluate(el => el.scrollTop)
    await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2)
    await page.mouse.wheel(0, 50)
    await page.waitForFunction(before => document.querySelector('.soa-viewer-viewport').scrollTop > before, beforeWheel)
    await expectRevealed()
    await viewport.evaluate(el => { el.scrollTop = 0 }); await expectRevealed()
    await viewport.focus(); await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.querySelector('.soa-viewer-viewport').scrollTop > 0)
    await expectRevealed()
    await page.screenshot({ path: `${output}/${width}px-internal-scroll-readable.png` })
    await page.evaluate(() => scrollBy(0, scrollY > 0 ? -40 : 40)); await expectHidden()

    const previousOverflow = await page.evaluate(() => document.body.style.overflow)
    await viewer.getByRole('button', { name: 'Open full screen statement', exact: true }).click()
    await page.getByRole('dialog', { name: 'Statement of account viewer' }).waitFor()
    await expectHidden(); await zoomUntilScrollable()
    await reveal().click(); await expectRevealed()
    await viewport.evaluate(el => { el.scrollTop = 50 }); await expectRevealed()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog', { name: 'Statement of account viewer' }).count(), 0)
    assert.equal(await page.evaluate(() => document.body.style.overflow), previousOverflow)

    await page.evaluate(() => scrollBy(0, scrollY > 0 ? -40 : 40)); await expectHidden()
    await page.emulateMedia({ media: 'print' })
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).filter), 'none', 'Print/PDF remains readable')
    assert.equal(await reveal().isVisible(), false)
    await page.emulateMedia({ media: 'screen' }); await expectHidden()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow')
    await reveal().click(); await expectRevealed(); await page.reload(); await expectHidden()
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`${width}px: main-page scrolling conceals; internal vertical scroll, wheel, keyboard and horizontal pan remain readable; fullscreen, print and reload passed`)
  }
} finally { await browser.close() }
