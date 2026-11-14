// All account, bill and payment requests use fixtures. No live backend is accessed.
import assert from 'node:assert/strict'
import { preview } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 4186, strictPort: true } })
const origin = 'http://127.0.0.1:4186'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const resident = { id: 1, role: 'RESIDENT', fullName: 'Offline Resident', email: 'test@example.com', isActive: true, approvalStatus: 'APPROVED' }
const bill = {
  id: 17, unitId: 1, unitNumber: '234', payerName: 'Offline Resident',
  periodStart: '2026-10-01', periodEnd: '2026-11-01', dueDate: '2026-11-15',
  totalAmount: 1234, remainingBalance: 1234, approvedAmount: 0, paymentStatus: 'UNPAID',
  allowedPaymentPurposes: ['COMBINED'], charges: [],
}

async function savedResponseCount(page) {
  return page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('residens-resident-offline', 1)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('responses')
      const request = tx.objectStore('responses').count()
      request.onsuccess = () => { db.close(); resolve(request.result) }
    }
  }))
}

try {
  for (const width of [1366, 390]) {
    let connected = true
    let authorized = true
    let amount = 1234
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(user => {
      if (!sessionStorage.getItem('fixture-started')) {
        localStorage.setItem('condo_token', 'resident-one')
        localStorage.setItem('condo_user', JSON.stringify(user))
        sessionStorage.setItem('fixture-started', 'true')
      }
    }, resident)
    await context.route('**/api/**', async route => {
      if (!connected) return route.abort('internetdisconnected')
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') return route.fulfill({ status: authorized ? 200 : 401, headers, json: authorized ? { user: resident } : { message: 'Account unavailable.' } })
      const data = {
        '/api/bills': { bills: [{ ...bill, remainingBalance: amount }] },
        '/api/bills/17': { bill: { ...bill, remainingBalance: amount } },
        '/api/payments': { payments: [{ id: 30, unitNumber: '234', targetBillId: 17, reviewStatus: 'APPROVED', verifiedAmount: 500, paymentPurpose: 'COMBINED' }] },
        '/api/analytics/resident': { units: [{ id: 1, unitNumber: '234', relationshipType: 'OWNER', history: [] }] },
        '/api/prescriptive-recommendations/resident': { recommendations: [] },
        '/api/notifications': { notifications: [], unreadCount: 0 },
        '/api/bills/17/protected-exports': { status: 'AVAILABLE' },
      }[path]
      return route.fulfill({ headers, status: data ? 200 : 404, json: data || { message: 'Fixture not found.' } })
    })

    let page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/resident')
    await page.getByText('Welcome back, Offline Resident', { exact: true }).waitFor()
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    })
    for (let retry = 0; retry < 30 && await savedResponseCount(page) < 5; retry++) await page.waitForTimeout(100)
    assert.ok(await savedResponseCount(page) >= 5)

    connected = false
    await context.setOffline(true)
    // A new tab simulates reopening the installed app. Existing origin storage is retained.
    await page.close()
    page = await context.newPage()
    // Do not seed the session again after logout in this new tab.
    await page.addInitScript(() => sessionStorage.setItem('fixture-started', 'true'))
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/resident')
    await page.getByText('You’re offline. Viewing saved information.', { exact: true }).waitFor()
    await page.getByText('Welcome back, Offline Resident', { exact: true }).waitFor()
    await page.goto(origin + '/resident/bills/17')
    await page.getByRole('button', { name: 'Upload receipt', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Upload receipt', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Report error', exact: true }).isDisabled(), true)
    await page.evaluate(() => {
      history.pushState(null, '', '/resident/bills/999')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.getByText('This information has not been saved for offline viewing. Connect to the internet to load it.', { exact: true }).waitFor()
    assert.equal(await page.locator('.soa-viewer').count(), 0)
    await page.goto(origin + '/resident/payments')
    await page.getByRole('button', { name: 'approved', exact: true }).click()
    await page.getByText('APPROVED', { exact: true }).waitFor()
    await page.goto(origin + '/resident/bills/999')
    await page.getByText('This information has not been saved for offline viewing. Connect to the internet to load it.', { exact: true }).waitFor()

    await page.goto(origin + '/resident/bills')
    amount = 800
    connected = true
    await context.setOffline(false)
    await page.getByText('₱800.00', { exact: true }).waitFor()
    assert.equal(await page.getByText('You’re offline. Viewing saved information.', { exact: true }).count(), 0)

    // A server rejection must remove both access and private saved information.
    authorized = false
    await page.reload()
    await page.waitForURL('**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('residens_offline_session')), null)
    assert.equal(await savedResponseCount(page), 0)

    authorized = true
    await page.evaluate(user => {
      localStorage.setItem('condo_token', 'resident-one')
      localStorage.setItem('condo_user', JSON.stringify(user))
    }, resident)
    await page.goto(origin + '/resident')
    await page.getByText('Welcome back, Offline Resident', { exact: true }).waitFor()
    await page.waitForFunction(() => localStorage.getItem('residens_offline_session'))
    await page.getByRole('button', { name: 'Open account menu for Offline Resident' }).click()
    await page.getByRole('menuitem', { name: /log out|logout|sign out/i }).click()
    await page.waitForURL('**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('residens_offline_session')), null)
    assert.equal(await savedResponseCount(page), 0)
    await page.evaluate(user => {
      localStorage.setItem('condo_token', 'resident-one')
      localStorage.setItem('condo_user', JSON.stringify(user))
    }, resident)
    await page.goto(origin + '/resident')
    await page.getByText('Welcome back, Offline Resident', { exact: true }).waitFor()
    await page.waitForFunction(() => localStorage.getItem('residens_offline_session'))
    await page.evaluate(() => {
      const key = 'residens_offline_session'
      const session = JSON.parse(localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ ...session, verifiedAt: Date.now() - 8 * 86400000 }))
    })
    connected = false
    await context.setOffline(true)
    await page.reload()
    await page.waitForURL('**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('residens_offline_session')), null)
    assert.deepEqual(errors, [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    console.log(width + 'px: reopen offline, saved statements, payment filters, blocked writes, reconnect refresh, logout cleanup, expired access and server rejection passed.')
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
