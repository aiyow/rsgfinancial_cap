// Fixture-only directory checks. No unit assignments or live records are changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5181'
const units = [
  { id: '1', unitNumber: '231', floor: '2', occupancyStatus: 'VACANT' },
  { id: '2', unitNumber: '232', floor: '2', occupancyStatus: 'OCCUPIED' },
  { id: '3', unitNumber: '233', floor: '2', occupancyStatus: 'OCCUPIED' },
  { id: '4', unitNumber: '234', floor: '2', occupancyStatus: 'OCCUPIED' },
]
const assignments = [
  { id: '1', unitId: '2', residentName: 'Juan Dela Cruz', relationshipType: 'OWNER' },
  { id: '2', unitId: '3', residentName: 'Zoe Santos', relationshipType: 'TENANT' },
  { id: '3', unitId: '3', residentName: 'Ana Santos', relationshipType: 'TENANT' },
  { id: '4', unitId: '4', residentName: 'Maria Santos', relationshipType: 'TENANT' },
  { id: '5', unitId: '4', residentName: 'Zed Dela Cruz', relationshipType: 'TENANT', isPrimaryPayer: true },
  { id: '6', unitId: '4', residentName: 'Albert Cruz', relationshipType: 'TENANT' },
  { id: '7', unitId: '4', residentName: 'Former Tenant', relationshipType: 'TENANT', endDate: '2026-01-01' },
]
const errors = []
await mkdir('../artifacts/unit-tenants', { recursive: true })
try {
  for (const role of ['ADMIN', 'COLLECTOR']) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } })
    const user = { id: 1, role, fullName: 'Sample Staff', isActive: true, approvalStatus: 'APPROVED' }
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'fixture'); localStorage.setItem('condo_user', JSON.stringify(user)) }, user)
    let requests = 0
    await context.route('**/api/**', route => {
      assert.equal(route.request().method(), 'GET')
      requests++
      const path = new URL(route.request().url()).pathname
      const data = path === '/api/auth/me' ? { user } : path === '/api/units' ? { units }
        : path === '/api/unit-assignments' ? { assignments } : path === '/api/notifications' ? { notifications: [], unreadCount: 0 } : null
      assert.ok(data, path)
      return route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/${role === 'ADMIN' ? 'admin' : 'collector'}/units`)
    const tenantHeader = page.getByRole('columnheader', { name: 'Tenant(s)', exact: true })
    await tenantHeader.waitFor()
    assert.equal(await tenantHeader.innerText(), 'Tenant(s)')
    assert.equal(await tenantHeader.evaluate(element => getComputedStyle(element).textTransform), 'none')
    const row = number => page.getByRole('row').filter({ has: page.getByRole('button', { name: `View Unit ${number}`, exact: true }) })
    await row('232').getByText('Juan Dela Cruz', { exact: true }).first().waitFor()
    assert.equal(await row('231').getByRole('cell').nth(3).innerText(), '—')
    assert.equal(await row('232').getByRole('cell').nth(3).innerText(), 'Juan Dela Cruz')
    const two = row('233').getByRole('cell').nth(3)
    assert.match(await two.innerText(), /Ana Santos/)
    assert.doesNotMatch(await two.innerText(), /Zoe Santos/)
    await two.getByRole('button', { name: 'View all 2 tenants for Unit 233' }).getByText('+1 more', { exact: true }).waitFor()
    const three = row('234').getByRole('cell').nth(3)
    assert.match(await three.innerText(), /Zed Dela Cruz/)
    assert.doesNotMatch(await three.innerText(), /Albert Cruz|Maria Santos|Former Tenant|Primary payer/i)
    const trigger = three.getByRole('button', { name: 'View all 3 tenants for Unit 234', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'Unit 234 — Tenant(s)', exact: true }).waitFor()
    const before = requests
    assert.deepEqual(await dialog.getByRole('listitem').locator('p.font-bold').allTextContents(), ['Zed Dela Cruz', 'Albert Cruz', 'Maria Santos'])
    assert.equal(await dialog.getByText('Primary payer', { exact: true }).count(), 0)
    assert.equal(await dialog.getByText('Tenant', { exact: true }).count(), 3)
    assert.equal(await dialog.getByText('Former Tenant', { exact: true }).count(), 0)
    const box = await dialog.boundingBox(), size = page.viewportSize()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height)
    assert.equal(requests, before)
    await page.screenshot({ path: `../artifacts/unit-tenants/${role.toLowerCase()}-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    await trigger.click()
    await page.getByRole('button', { name: 'Close tenant list', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('searchbox', { name: 'Search units' }).fill('Albert Cruz')
    assert.equal(await row('234').count(), 1)
    assert.equal(await page.getByRole('button', { name: 'View Unit 233', exact: true }).count(), 0)
    console.log(`PASS ${role} ${mobile ? 'mobile' : 'desktop'} tenant heading, counts, payer/alphabetic order, full list, dismissal and hidden-name search`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
