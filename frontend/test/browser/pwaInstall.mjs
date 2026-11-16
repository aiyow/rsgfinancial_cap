// Synthetic install events only. These checks do not install an app or sign in.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const errors = []
await mkdir('../artifacts/pwa-install', { recursive: true })
async function emit(page, outcome = 'dismissed') {
  return page.evaluate(outcome => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = async () => { window.installCalls = (window.installCalls || 0) + 1 }
    event.userChoice = Promise.resolve({ outcome, platform: 'web' })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, outcome)
}
async function open(options = {}, init) {
  const context = await browser.newContext(options)
  if (init) await context.addInitScript(init)
  await context.route('**/api/**', route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ json: { user: null } }) })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/login')
  await page.getByRole('heading', { name: 'Sign in to your portal' }).waitFor()
  return { context, page }
}
try {
  for (const mobile of [false, true]) {
    const { context, page } = await open(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } })
    const dialog = page.getByRole('dialog', { name: 'Install The ResiDens app?' })
    assert.equal(await dialog.count(), 0, 'No automatic Chromium offer without a real install event')
    assert.equal(await emit(page), true)
    await dialog.waitFor()
    assert.equal(await page.evaluate(() => window.installCalls || 0), 0)
    assert.equal(await dialog.getByRole('button', { name: 'Close install prompt' }).evaluate(el => el === document.activeElement), true)
    await page.screenshot({ path: `../artifacts/pwa-install/${mobile ? 'mobile' : 'desktop'}.png` })
    const box = await dialog.boundingBox(), size = page.viewportSize()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height)
    await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
    await emit(page)
    assert.equal(await dialog.count(), 0, 'Dismissal prevents repeated automatic offers')
    await page.getByRole('button', { name: 'Install The ResiDens app', exact: true }).click()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.installCalls), 1)
    await page.reload()
    await page.getByRole('heading', { name: 'Sign in to your portal' }).waitFor()
    await emit(page, 'accepted')
    assert.equal(await dialog.count(), 0, 'Dismissal lasts through reload in this session')
    await page.getByRole('button', { name: 'Install The ResiDens app', exact: true }).click()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await page.getByRole('button', { name: 'Install The ResiDens app', exact: true }).waitFor({ state: 'hidden' })
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'} automatic offer, native-click flow, dismissal, reopen, reload and installed state`)
    await context.close()
  }
  {
    const { context, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' })
    const dialog = page.getByRole('dialog', { name: 'Install The ResiDens app?' })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Safari[\s\S]*Share[\s\S]*Add to Home Screen/)
    assert.equal(await dialog.getByRole('button', { name: 'Install', exact: true }).count(), 0)
    await page.screenshot({ path: '../artifacts/pwa-install/iphone.png' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await context.close()
    console.log('PASS iPhone manual installation guidance and Escape dismissal')
  }
  {
    const { context, page } = await open({}, () => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, addEventListener() {}, removeEventListener() {} } : original(query)
    })
    await emit(page)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Install The ResiDens app', exact: true }).count(), 0)
    await context.close()
    console.log('PASS standalone app never offers installation')
  }
  {
    const { context, page } = await open({}, () => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) { if (key === 'residens_install_dismissed') throw new Error('Storage blocked'); return original.call(this, key, value) }
    })
    await page.getByRole('button', { name: 'Install The ResiDens app', exact: true }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.innerText(), /browser menu/)
    await dialog.getByRole('button', { name: 'Got it', exact: true }).click()
    await emit(page)
    assert.equal(await dialog.count(), 0)
    await context.close()
    console.log('PASS browser-menu fallback and dismissal when storage is blocked')
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
