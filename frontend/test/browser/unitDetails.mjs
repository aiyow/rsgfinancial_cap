// All APIs are mocked; this exercises the real UI without changing live data.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = new URL('../../../artifacts/unit-details/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const units = [
  { id: '10', unitNumber: '231', floor: '2', billableAreaSqm: '12.00', occupancyStatus: 'VACANT' },
  { id: '20', unitNumber: '232', floor: '2', billableAreaSqm: '15.00', occupancyStatus: 'OCCUPIED' },
  { id: '30', unitNumber: '233', floor: '2', billableAreaSqm: '15.00', occupancyStatus: 'VACANT' },
  { id: '40', unitNumber: '234', floor: '2', billableAreaSqm: '15.00', occupancyStatus: 'OCCUPIED' },
  { id: '50', unitNumber: '235', floor: '2', billableAreaSqm: '15.00', occupancyStatus: 'OCCUPIED' },
]
const users = [
  { id: '2', fullName: 'Juan Owner', role: 'RESIDENT', email: 'owner@example.invalid', isActive: true },
  { id: '3', fullName: 'Maria Tenant', role: 'RESIDENT', email: 'tenant@example.invalid', isActive: true },
  { id: '4', fullName: 'Unassigned Resident', role: 'RESIDENT', isActive: true },
  { id: '5', fullName: 'Inactive Resident', role: 'RESIDENT', isActive: false },
  { id: '6', fullName: 'Active Admin', role: 'ADMIN', isActive: true },
]
const assignments = [
  { id: '1', unitId: '10', userId: '2', residentName: 'Juan Owner', relationshipType: 'OWNER', isPrimaryPayer: true },
  { id: '2', unitId: '10', userId: '3', residentName: 'Maria Tenant', relationshipType: 'TENANT' },
  { id: '3', unitId: '20', userId: '2', residentName: 'Juan Owner', relationshipType: 'OWNER' },
  { id: '4', unitId: '20', userId: '3', residentName: 'Former Tenant', relationshipType: 'TENANT', endDate: '2026-01-01' },
  { id: '5', unitId: '40', userId: '2', residentName: 'Juan Owner', relationshipType: 'OWNER' },
  { id: '6', unitId: '40', userId: '3', residentName: 'Maria Tenant', relationshipType: 'TENANT' },
]
const bills = [
  { id: '101', unitId: '10', periodStart: '2026-08-01', periodEnd: '2026-09-01', dueDate: '2026-09-10', totalAmount: '300', remainingBalance: '0', paymentStatus: 'PAID' },
  { id: '102', unitId: '10', periodStart: '2026-09-01', periodEnd: '2026-10-01', dueDate: '2026-10-10', totalAmount: '500', remainingBalance: '125', paymentStatus: 'PARTIAL' },
]
try {
  for (const role of ['ADMIN', 'COLLECTOR']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport })
      const user = { id: '1', role, fullName: 'Unit Tester', isActive: true, approvalStatus: 'APPROVED' }
      await context.addInitScript(user => {
        localStorage.setItem('condo_token', 'mock-only')
        localStorage.setItem('condo_user', JSON.stringify(user))
      }, user)
      let failDetails = false, delayDetails = false
      const writes = []
      await context.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname
        if (request.method() !== 'GET') {
          writes.push({ path, body: request.postDataJSON() })
          await route.fulfill({ json: path === '/api/unit-assignments' ? { assignment: { ...assignments[0], id: '5' } } : { unit: units[0] } })
          return
        }
        if (path.startsWith('/api/units/')) {
          if (delayDetails) await new Promise(resolve => setTimeout(resolve, 350))
          await route.fulfill(failDetails ? { status: 503, json: { message: 'Details temporarily unavailable' } } : { json: { unit: units.find(unit => path.endsWith(`/${unit.id}`)) } }).catch(() => {})
          return
        }
        const data = path === '/api/auth/me' ? { user }
          : path === '/api/units' ? { units }
            : path === '/api/unit-assignments' ? { assignments }
              : path === '/api/users' ? { users }
                : path === '/api/bills' ? { bills }
                  : path === '/api/payments' ? { payments: [{ id: '1', unitId: '10', reviewStatus: 'APPROVED', verifiedPaymentDate: '2026-10-03' }] }
                    : path === '/api/dashboard/overview' ? { metrics: { activeResidentAccounts: 3, totalUnits: 2, occupiedUnits: 1, vacantUnits: 1 }, monthly: [], billStatus: [] }
                      : { notifications: [], unreadCount: 0 }
        await route.fulfill({ json: data })
      })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      const root = role === 'ADMIN' ? '/admin' : '/collector'
      await page.goto(`${base}${root}/units`)
      const trigger = page.getByRole('button', { name: 'View Unit 231', exact: true })
      await trigger.waitFor()
      assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['Unit', 'Floor', 'Owner', 'Current Resident(s)', 'Occupancy'])
      const unitRow = page.getByRole('row').filter({ has: trigger })
      assert.equal(await unitRow.getByRole('cell').nth(2).innerText(), 'Juan Owner')
      assert.equal(await unitRow.getByRole('cell').nth(3).innerText(), '—', 'Vacant units do not display current residents, even with assignments')
      const ownerOnlyRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'View Unit 232', exact: true }) })
      assert.equal(await ownerOnlyRow.getByRole('cell').nth(2).innerText(), 'Juan Owner')
      assert.equal(await ownerOnlyRow.getByRole('cell').nth(3).innerText(), 'Juan Owner', 'An occupied unit without current tenants shows its owner')
      const tenantRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'View Unit 234', exact: true }) })
      assert.equal(await tenantRow.getByRole('cell').nth(2).innerText(), 'Juan Owner')
      assert.equal(await tenantRow.getByRole('cell').nth(3).innerText(), 'Maria Tenant', 'An occupied unit with a tenant shows the tenant instead of its owner')
      const unassignedRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'View Unit 235', exact: true }) })
      assert.equal(await unassignedRow.getByRole('cell').nth(3).innerText(), '—', 'An occupied unit with no assignments has no resident name to display')
      await trigger.focus()
      await page.keyboard.press('Enter')
      let dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Unit 231', exact: true }).waitFor()
      assert.match(await dialog.innerText(), /Juan Owner[\s\S]*Owner · Primary payer/)
      assert.doesNotMatch(await dialog.innerText(), /An account assignment does not confirm/)
      assert.match(await dialog.innerText(), /Maria Tenant[\s\S]*Tenant/)
      assert.match(await dialog.innerText(), /Vacant/)
      assert.match(await dialog.innerText(), /₱125\.00/)
      assert.match(await dialog.innerText(), /Oct 03, 2026/)
      const billLinks = dialog.getByRole('link', { name: 'View bill' })
      assert.equal(await billLinks.count(), 2)
      const billButtonStyle = await billLinks.first().evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color, borderRadius: style.borderRadius } })
      assert.notEqual(billButtonStyle.background, 'rgba(0, 0, 0, 0)')
      assert.equal(billButtonStyle.color, 'rgb(255, 255, 255)')
      assert.notEqual(billButtonStyle.borderRadius, '0px')
      const billRoot = role === 'ADMIN' ? '/admin/soa/bills' : '/collector/bills'
      assert.equal(await billLinks.nth(0).getAttribute('href'), `${billRoot}/102`)
      assert.equal(await billLinks.nth(1).getAttribute('href'), `${billRoot}/101`)
      await billLinks.last().focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'Close unit details' }).evaluate(element => element === document.activeElement), true)
      await page.keyboard.press('Shift+Tab')
      assert.equal(await billLinks.last().evaluate(element => element === document.activeElement), true)
      const dimensions = await dialog.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, height: element.getBoundingClientRect().height, scrollHeight: element.scrollHeight }))
      assert.ok(dimensions.left >= 0 && dimensions.right <= viewport.width)
      assert.ok(dimensions.height <= viewport.height * 0.91)
      await dialog.evaluate(element => { element.scrollTop = 0; element.querySelectorAll('div').forEach(child => { child.scrollLeft = 0 }) })
      await page.screenshot({ path: fileURLToPath(new URL(`${role.toLowerCase()}-${viewport.width}.png`, output)), fullPage: false })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true)

      delayDetails = true
      await trigger.click()
      await page.getByRole('status').filter({ hasText: 'Loading unit details' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'View Unit 232', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Unit 232', exact: true }).waitFor()
      assert.match(await dialog.innerText(), /No billing records/)
      assert.doesNotMatch(await dialog.innerText(), /Maria Tenant|Former Tenant/)
      assert.equal(await dialog.getByRole('link', { name: 'View bill' }).count(), 0)
      await page.keyboard.press('Escape')
      delayDetails = false
      await page.getByRole('button', { name: 'View Unit 233', exact: true }).click()
      await page.getByRole('dialog').getByText('No active unit assignments.', { exact: true }).waitFor()
      await page.keyboard.press('Escape')

      failDetails = true
      await trigger.click()
      await page.getByRole('alert').filter({ hasText: 'Details temporarily unavailable' }).waitFor()
      failDetails = false
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.getByRole('dialog').getByRole('heading', { name: 'Unit 231', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      assert.equal(writes.length, 0, 'Viewing units must not write data')

      if (role === 'ADMIN') {
        await page.goto(`${base}/admin/units/manage`)
        const accountCard = page.locator('article').filter({ has: page.getByText('Active Resident Accounts', { exact: true }) })
        await accountCard.getByText('3', { exact: true }).waitFor()
        assert.match(await accountCard.innerText(), /3/)
        await page.getByRole('button', { name: 'View Unit 231', exact: true }).click()
        await page.getByRole('dialog').getByRole('heading', { name: 'Unit 231', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        const row = page.locator('tr').filter({ has: page.getByRole('button', { name: 'View Unit 231', exact: true }) })
        await row.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('dialog').getByRole('heading', { name: 'Unit 231', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        await row.getByRole('button', { name: 'Edit', exact: true }).click()
        const edit = page.getByRole('dialog')
        await edit.getByRole('button', { name: 'Filter by Occupancy', exact: true }).click()
        await edit.getByRole('button', { name: 'Occupied', exact: true }).click()
        await edit.getByPlaceholder('Search name or email').fill('Maria')
        await edit.getByRole('option').filter({ hasText: 'Maria Tenant' }).click()
        await edit.getByRole('button', { name: 'Add account assignment' }).click()
        await page.getByText('Account assigned.', { exact: true }).waitFor()
        assert.match(await edit.getByRole('button', { name: 'Filter by Occupancy', exact: true }).innerText(), /Occupied/)
        assert.ok(!writes[0].body.occupancyStatus)
        await edit.getByRole('button', { name: 'Save unit changes' }).click()
        await edit.waitFor({ state: 'detached' })
        assert.equal(writes.at(-1).body.occupancyStatus, 'OCCUPIED')
        await page.goto(`${base}/admin`)
        const metric = page.locator('article').filter({ has: page.getByText('Active Resident Accounts', { exact: true }) })
        await metric.getByText('3', { exact: true }).waitFor()
        assert.match(await metric.innerText(), /3/)
      } else {
        assert.equal(await page.getByRole('link', { name: 'Manage units' }).count(), 0)
      }
      assert.deepEqual(errors, [])
      await context.close()
      console.log(`Passed ${role} at ${viewport.width}px`)
    }
  }
} finally { await browser.close() }
