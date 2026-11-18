// UI checks use synthetic data and intercept every API request.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5182'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
await mkdir('../artifacts/unit-soa-names', { recursive: true })
try {
  for (const role of ['ADMIN', 'COLLECTOR']) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } })
    const user = { id: 1, role, fullName: 'Sample Staff', isActive: true, approvalStatus: 'APPROVED' }
    const rows = [
      { unitId: 10, unitNumber: '231', floor: '2', occupancyStatus: 'OCCUPIED', residentNames: 'Live Account Name', soaResidentName: 'Saved SOA Name' },
      { unitId: 11, unitNumber: '232', floor: '2', occupancyStatus: 'VACANT', residentNames: 'Another Account', soaResidentName: null },
    ]
    let patches = 0, fail = false
    await context.addInitScript(user => { localStorage.setItem('condo_token', 'fixture'); localStorage.setItem('condo_user', JSON.stringify(user)); window.print = () => {} }, user)
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      if (path === '/api/units/soa-names') {
        assert.equal(role, 'ADMIN'); assert.equal(req.method(), 'PATCH'); patches++
        const body = req.postDataJSON(); assert.deepEqual(Object.keys(body), ['names']); assert.equal(body.names.length, 2)
        if (fail) return route.fulfill({ status: 503, json: { message: 'Could not save. Please try again.' } })
        for (const name of body.names) rows.find(row => row.unitId === name.unitId).soaResidentName = name.soaResidentName
        return route.fulfill({ json: { units: body.names.map(name => ({ id: name.unitId, soaResidentName: name.soaResidentName })) } })
      }
      assert.equal(req.method(), 'GET')
      const data = path === '/api/auth/me' ? { user }
        : path === '/api/notifications' ? { notifications: [], unreadCount: 0 }
        : path === '/api/reports/financial' ? {
          filters: { startDate: '2026-11-01', endDate: '2026-11-30', label: 'November 2026' },
          overview: {}, occupancy: { rows, totalUnits: 2, occupiedUnits: 1, vacantUnits: 1 },
        } : null
      assert.ok(data, `Unexpected request ${path}`)
      return route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    async function occupancy() {
      await page.getByRole('tab', { name: 'Unit Occupancy', exact: true }).click()
      await page.getByRole('columnheader', { name: 'Resident Name', exact: true }).first().waitFor()
    }
    await page.goto(`${base}/${role === 'ADMIN' ? 'admin' : 'collector'}/reports`)
    await occupancy()
    const screen = page.locator('.financial-report > .print-hidden').last()
    const row = screen.getByRole('row').filter({ has: page.getByRole('cell', { name: '231', exact: true }) })
    assert.match(await row.innerText(), /Saved SOA Name/)
    assert.doesNotMatch(await screen.innerText(), /Live Account Name|Another Account/)
    assert.equal(await row.getByRole('textbox').count(), 0)
    if (role === 'ADMIN') {
      const edit = screen.getByRole('button', { name: 'Edit', exact: true })
      assert.equal(await edit.count(), 1)
      const buttonBox = await edit.boundingBox(), tableBox = await screen.getByRole('table').boundingBox()
      assert.ok(buttonBox.y < tableBox.y && Math.abs(buttonBox.x - tableBox.x) < 2)
      await edit.click()
      const input = page.getByRole('textbox', { name: 'Resident name for unit 231', exact: true })
      assert.equal(await input.inputValue(), 'Saved SOA Name')
      assert.equal(await screen.getByRole('textbox').count(), 2)
      assert.equal(await edit.count(), 0, 'Edit becomes Save while editing')
      await input.fill('Discard Me'); await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(patches, 0)
      await edit.click(); await page.getByRole('button', { name: 'Save', exact: true }).click()
      assert.equal(patches, 0, 'No changes should not send a request')
      await edit.click(); await input.fill('   ')
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true)
      await input.fill('  Juan Dela Cruz  ')
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled(), true, 'An unchanged blank template does not block saving')
      await page.getByRole('textbox', { name: 'Resident name for unit 232', exact: true }).fill('Anna Santos')
      await page.screenshot({ path: `../artifacts/unit-soa-names/admin-editing-${mobile ? 'mobile' : 'desktop'}.png` })
      assert.equal(await row.locator('input').count(), 1, 'Only the resident name can be edited')
      fail = true; await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('alert').getByText('Could not save. Please try again.', { exact: true }).waitFor()
      assert.equal(rows[0].soaResidentName, 'Saved SOA Name'); assert.equal(rows[1].soaResidentName, null)
      fail = false; await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('status').getByText('Names saved for new SOAs.', { exact: true }).waitFor()
      assert.equal(rows[0].soaResidentName, 'Juan Dela Cruz'); assert.equal(rows[1].soaResidentName, 'Anna Santos'); assert.equal(patches, 2)
      assert.equal(await screen.getByRole('textbox').count(), 0)
      assert.equal(await edit.count(), 1)
      assert.match(await page.locator('.financial-report-print').innerText(), /Juan Dela Cruz/)
      assert.doesNotMatch(await page.locator('.financial-report-print').innerText(), /Live Account Name|Edit|Save/)
      await page.reload(); await occupancy()
      await row.getByText('Juan Dela Cruz', { exact: true }).waitFor()
    } else {
      assert.equal(await page.getByRole('button', { name: /^(Edit|Save)$/ }).count(), 0)
      assert.equal(patches, 0)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await screen.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `../artifacts/unit-soa-names/${role.toLowerCase()}-${mobile ? 'mobile' : 'desktop'}.png` })
    console.log(`PASS ${role} ${mobile ? 'mobile' : 'desktop'} template names, permissions, persistence, validation, retry and print output`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
