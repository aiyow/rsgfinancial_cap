import assert from 'node:assert/strict'
import { createPublicKey, randomUUID, verify } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const screenshotDir = process.env.LOGIN_SCREENSHOT_DIR
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const email = 'admin@example.invalid'
const user = { id: 1, fullName: 'Test Admin', email, role: 'ADMIN' }
const password = 'Fixture-password-7!'
const challenges = new Map()
const publicKeys = new Map()
const errors = []
let codesSent = 0
let adminRecovery = false

async function openPage(options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, json: data })
    if (path === '/api/auth/me') return json({ user })
    if (path === '/api/dashboard/overview') return json({ metrics: {}, monthly: [], billStatus: [] })
    if (path === '/api/analytics/overview') return json({ chartSeries: [] })
    if (!path.startsWith('/api/auth/login')) return json({ notifications: [] })

    const body = request.postDataJSON()
    if (path === '/api/auth/login') {
      if (body.email !== email || body.password !== password) return json({ message: 'Invalid email or password.' }, 401)
      if (adminRecovery) return json({ user, token: 'test-session' })
      const challengeId = randomUUID()
      const publicKey = publicKeys.get(body.trustedBrowserId)
      if (!publicKey) codesSent++
      challenges.set(challengeId, { publicKey, otp: '012345' })
      return json({ challengeId, code: publicKey ? 'LOGIN_BROWSER_PROOF_REQUIRED' : 'LOGIN_OTP_REQUIRED', retryAfterSeconds: 1 }, 202)
    }

    const challenge = challenges.get(body.challengeId)
    if (!challenge) return json({ code: 'LOGIN_CHALLENGE_EXPIRED', message: 'Expired.' }, 400)
    if (path === '/api/auth/login/resend') {
      challenge.otp = '123456'
      codesSent++
      return json({ retryAfterSeconds: 1, message: 'A new sign-in code was sent.' })
    }

    let trustedBrowserId
    if (challenge.publicKey) {
      const key = createPublicKey({ key: Buffer.from(challenge.publicKey, 'base64url'), type: 'spki', format: 'der' })
      const correct = verify('sha256', Buffer.from(`residens-trusted-browser:${body.challengeId}`),
        { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64url'))
      if (!correct) return json({ code: 'LOGIN_BROWSER_UNAVAILABLE' }, 409)
    } else {
      if (body.otp !== challenge.otp) return json({ message: 'That sign-in code is incorrect. Try again.' }, 400)
      if (body.publicKey) {
        trustedBrowserId = randomUUID()
        publicKeys.set(trustedBrowserId, body.publicKey)
      }
    }

    challenges.delete(body.challengeId)
    return json({ user, token: 'test-session', trustedBrowserId })
  })
  await page.goto(`${baseUrl}/login`)
  return page
}

async function enterCredentials(page, suppliedPassword = password) {
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(suppliedPassword)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function signOut(page) {
  await page.getByRole('button', { name: /Open account menu for/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('**/login')
  await page.reload()
  assert.equal(await page.evaluate(() => localStorage.getItem('condo_token')), null)
}

function verificationDialog(page) {
  return page.getByRole('dialog', { name: '2-Step Verification' })
}

async function screenshot(page, name) {
  if (!screenshotDir) return
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({ path: join(screenshotDir, name), animations: 'disabled' })
}

try {
  const desktop = await openPage({ viewport: { width: 1366, height: 900 } })
  await enterCredentials(desktop, 'wrong')
  await desktop.getByRole('alert').filter({ hasText: 'Invalid email or password.' }).waitFor()
  assert.equal(codesSent, 0)

  await enterCredentials(desktop)
  const dialog = verificationDialog(desktop)
  await dialog.waitFor()
  assert.equal(await dialog.getByLabel('Verification code').evaluate(input => input === document.activeElement), true)
  assert.equal(await dialog.getByLabel(/Trust this device for 15 days/).isChecked(), false)
  assert.equal(await dialog.getByRole('button', { name: 'Verify and sign in' }).isDisabled(), true)
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'login-verification-enter')
  assert.equal(await desktop.evaluate(() => localStorage.getItem('condo_token')), null)
  await screenshot(desktop, 'desktop.png')

  await desktop.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await desktop.locator('input[autocomplete="current-password"]').inputValue(), '')
  assert.equal(await desktop.evaluate(() => localStorage.getItem('condo_token')), null)

  await enterCredentials(desktop)
  await dialog.getByLabel('Verification code').fill('000000')
  await dialog.getByRole('button', { name: 'Verify and sign in' }).click()
  await dialog.getByRole('alert').filter({ hasText: 'That sign-in code is incorrect.' }).waitFor()
  await dialog.getByRole('button', { name: 'Resend code', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: 'A new sign-in code was sent.' }).waitFor()
  await dialog.getByLabel(/Trust this device for 15 days/).check()
  await dialog.getByLabel('Verification code').fill('123456')
  await dialog.getByRole('button', { name: 'Verify and sign in' }).click()
  await desktop.waitForURL('**/admin')
  assert.equal(await desktop.evaluate(() => localStorage.getItem('condo_token')), 'test-session')
  assert.equal(publicKeys.size, 1)

  const before = codesSent
  await signOut(desktop)
  await enterCredentials(desktop)
  await desktop.waitForURL('**/admin')
  assert.equal(await verificationDialog(desktop).count(), 0)
  assert.equal(codesSent, before)

  const mobile = await openPage({ viewport: { width: 390, height: 720 }, reducedMotion: 'reduce' })
  await enterCredentials(mobile)
  const mobileDialog = verificationDialog(mobile)
  await mobileDialog.waitFor()
  assert.equal(codesSent, before + 1)
  assert.equal(await mobileDialog.evaluate(element => getComputedStyle(element).animationName), 'none')
  const bounds = await mobileDialog.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 720)
  await screenshot(mobile, 'mobile.png')
  await mobileDialog.getByLabel('Verification code').fill('012345')
  await mobileDialog.getByRole('button', { name: 'Verify and sign in' }).click()
  await mobile.waitForURL('**/admin')
  assert.equal(publicKeys.size, 1)
  await signOut(mobile)
  await enterCredentials(mobile)
  await mobileDialog.waitFor()
  assert.equal(codesSent, before + 2)

  adminRecovery = true
  const recovery = await openPage()
  const sentBeforeRecovery = codesSent
  await enterCredentials(recovery)
  await recovery.waitForURL('**/admin')
  assert.equal(await verificationDialog(recovery).count(), 0)
  assert.equal(await recovery.evaluate(() => localStorage.getItem('condo_token')), 'test-session')
  assert.equal(codesSent, sentBeforeRecovery)

  assert.deepEqual(errors, [])
  console.log('Passed dialog, wrong code, resend, keyboard dismissal, opt-in trust, separate browser, mobile layout, reduced motion and temporary Admin recovery checks.')
} finally {
  await browser.close()
}
