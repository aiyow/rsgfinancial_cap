// Run against the local Vite server. Every API call is mocked; no real account is changed.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/account-safeguards/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const admin = { id: 501, fullName: 'Test Admin', email: 'admin@example.invalid', role: 'ADMIN', isActive: true, approvalStatus: 'APPROVED' }
const resident = { ...admin, id: 502, fullName: 'Test Resident', email: 'resident@example.invalid', role: 'RESIDENT' }
const associate = { ...admin, id: 503, fullName: 'Test Associate', email: 'associate@example.invalid', role: 'COLLECTOR' }
const assignmentMessage = 'This account is assigned to a unit. Unassign the resident before deleting.'
const balanceWarning = 'Settle unpaid bills before deactivating this account.'
const balanceMessage = 'This resident has unpaid published SOA charges. Settle the required charges before deactivating the account.'
const assignments = [{ assignmentId: 1, unitId: 1, unitNumber: '231', relationshipType: 'OWNER' }, { assignmentId: 2, unitId: 2, unitNumber: '232', relationshipType: 'TENANT' }]
let state
const errors = []
const unexpected = []
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
await context.addInitScript(({ admin }) => {
  localStorage.setItem('condo_token', 'mock-only-token')
  localStorage.setItem('condo_user', JSON.stringify(admin))
}, { admin })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const respond = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
function payload(privileged = false) {
  const assigned = state.mode === 'assigned'
  const unpaid = state.mode === 'unpaid'
  const bills = unpaid ? Array.from({ length: state.billCount || 2 }, (_, i) => ({ billId: 100+i, unitNumber: String(state.sameUnit ? 231 : 231+i), periodStart: '2026-09-05', periodEnd: '2026-10-05', requiredCategories: i % 2 ? ['WATER'] : ['WATER', 'ASSOCIATION_DUES'], balances: { WATER: 125, ASSOCIATION_DUES: i % 2 ? 0 : 75 }, remainingBalance: i % 2 ? 125 : 200 })) : []
  return { canDelete: !assigned, canDeactivate: !unpaid, activeAssignments: assigned ? assignments : [], unpaidSOAs: bills, totalOutstanding: bills.reduce((sum, b) => sum+b.remainingBalance, 0), deleteBlockReason: assigned ? assignmentMessage : null, deactivationBlockReason: unpaid ? balanceMessage : null, requiresPasswordForDelete: privileged }
}
await context.route('**/api/**', async route => {
  const req = route.request()
  const path = new URL(req.url()).pathname
  if (path === '/api/auth/me') return respond(route, { user: admin })
  if (path === '/api/notifications') return respond(route, { notifications: [], unreadCount: 0 })
  if (path === '/api/users' && req.method() === 'GET') return respond(route, { users: [admin, ...(!state.deleted ? [resident] : []), associate] })
  if (/^\/api\/users\/\d+\/action-eligibility$/.test(path)) {
    state.checks++
    if (state.mode === 'loading') await new Promise(resolve => { state.resolveCheck = resolve })
    if (state.mode === 'error') return respond(route, { message: 'Eligibility service unavailable.' }, 503)
    if (state.mode === 'invalid') return respond(route, {})
    return respond(route, payload(path.includes('/503/')))
  }
  if (/^\/api\/users\/\d+$/.test(path) && ['PATCH', 'DELETE'].includes(req.method())) {
    state.mutations.push({ method: req.method(), body: req.postDataJSON() })
    if (state.mutation === 'stale') {
      state.mode = req.method() === 'DELETE' ? 'assigned' : 'unpaid'
      return respond(route, { ...payload(), message: req.method() === 'DELETE' ? assignmentMessage : balanceMessage, code: req.method() === 'DELETE' ? 'USER_ASSIGNED_TO_UNIT' : 'UNPAID_PUBLISHED_SOA' }, 409)
    }
    if (state.mutation === 'fail') return respond(route, { message: 'Could not save this action.' }, 500)
    if (path === '/api/users/503' && req.postDataJSON().currentPassword !== 'CorrectAdmin7!') return respond(route, { message: 'Your current password is incorrect. The account was not deleted.' }, 403)
    state.deleted = req.method() === 'DELETE' && path === '/api/users/502'
    return respond(route, { message: 'Saved.' })
  }
  unexpected.push(`${req.method()} ${path}`)
  return respond(route, { message: 'Unexpected mocked API request.' }, 500)
})
function reset(mode = 'available', mutation = 'success') { state = { mode, mutation, checks: 0, mutations: [], deleted: false } }
async function load() {
  await page.goto(process.env.FRONTEND_URL || 'http://localhost:5173/admin/users')
  await page.getByRole('row').filter({ hasText: 'Test Resident' }).waitFor()
}
async function open(action, name = 'Test Resident') {
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: action, exact: true }).click()
  await page.getByRole('dialog').waitFor()
}
const dialog = () => page.getByRole('dialog')
async function disabled(button) { assert.equal(await dialog().getByRole('button', { name: button, exact: true }).isDisabled(), true) }
try {
  reset('loading'); await load(); await open('Delete')
  await dialog().getByRole('status').waitFor(); await disabled('Delete permanently')
  state.mode = 'assigned'; state.resolveCheck()
  await dialog().getByText(assignmentMessage, { exact: true }).waitFor()
  await disabled('Delete permanently'); assert.equal(await dialog().getByText('Unit 231', { exact: true }).count(), 1)
  assert.equal(await dialog().getByText('Unit 232', { exact: true }).count(), 1)
  assert.equal(await dialog().getByRole('link', { name: 'Manage unit assignments' }).getAttribute('href'), '/admin/units/manage')
  await page.screenshot({ path: `${output}/delete-assigned-desktop.png` })
  await dialog().getByRole('button', { name: 'Keep account' }).click(); assert.equal(state.mutations.length, 0)

  state.mode = 'error'; await open('Delete')
  await dialog().getByText('Eligibility service unavailable.').waitFor(); await disabled('Delete permanently')
  state.mode = 'invalid'; await dialog().getByRole('button', { name: 'Retry eligibility check' }).click()
  await dialog().getByText('Unable to verify account eligibility. Please retry.').waitFor(); await disabled('Delete permanently')
  state.mode = 'available'; await dialog().getByRole('button', { name: 'Retry eligibility check' }).click()
  await dialog().getByText(/Their ended assignment history/).waitFor()
  await page.keyboard.press('Escape'); assert.equal(await dialog().count(), 0)
  assert.equal(await page.getByRole('row').filter({ hasText: 'Test Resident' }).getByRole('button', { name: 'Delete', exact: true }).evaluate(el => el === document.activeElement), true)
  console.log('PASS loading, assignment blockers, retry, malformed eligibility, cancel and focus restoration')

  reset('available', 'stale'); await open('Delete')
  await dialog().getByText(/Their ended assignment history/).waitFor()
  await dialog().getByRole('button', { name: 'Delete permanently' }).click()
  await dialog().getByText(assignmentMessage, { exact: true }).waitFor(); await disabled('Delete permanently')
  assert.equal(state.mutations.length, 1); assert.ok(state.checks >= 2)
  await page.keyboard.press('Escape')
  reset('available', 'stale'); await open('Deactivate')
  await dialog().getByText(/Their records and unit assignments/).waitFor()
  await dialog().getByRole('button', { name: 'Deactivate account', exact: true }).click()
  await dialog().getByText(balanceWarning, { exact: true }).waitFor(); await disabled('Deactivate account')
  await dialog().getByText('Pending payments need approval.').waitFor()
  assert.equal(await dialog().getByRole('link', { name: 'View SOA', exact: true }).count(), 0)
  assert.equal(await dialog().getByRole('list', { name: 'Units with unpaid bills' }).getByRole('listitem').count(), 2)
  assert.doesNotMatch(await dialog().innerText(), /₱|Water:|Sep 5|Required outstanding balance/)
  assert.equal(state.mutations.length, 1)
  await page.screenshot({ path: `${output}/deactivate-unpaid-desktop.png` })
  await page.keyboard.press('Escape')
  console.log('PASS stale DELETE and PATCH conflicts refresh blockers and retain inline dialogs')

  reset('available', 'fail'); await open('Delete'); await dialog().getByText(/Their ended assignment history/).waitFor()
  await dialog().getByRole('button', { name: 'Delete permanently' }).click()
  await dialog().getByText('Could not save this action.').waitFor()
  assert.equal(await dialog().getByRole('button', { name: 'Delete permanently' }).isEnabled(), true)
  state.mutation = 'success'; await dialog().getByRole('button', { name: 'Delete permanently' }).click()
  await dialog().waitFor({ state: 'detached' }); assert.equal(state.mutations.length, 2)
  assert.equal(await page.getByRole('row').filter({ hasText: 'Test Resident' }).count(), 0)
  console.log('PASS inline mutation failure, successful retry and updated user list')

  reset(); await load(); await open('Delete', 'Test Associate')
  const password = dialog().getByLabel('Your current password', { exact: true }); await password.waitFor()
  await dialog().getByRole('button', { name: 'Delete permanently' }).click(); assert.equal(state.mutations.length, 0)
  await password.fill('WrongPassword7!'); await dialog().getByRole('button', { name: 'Delete permanently' }).click()
  await dialog().getByText('Your current password is incorrect. The account was not deleted.').waitFor()
  await password.fill('CorrectAdmin7!'); await dialog().getByRole('button', { name: 'Delete permanently' }).click()
  await dialog().waitFor({ state: 'detached' }); assert.equal(state.mutations.length, 2)
  console.log('PASS privileged-account password confirmation and inline rejection')

  reset(); await load(); await open('Deactivate'); await dialog().getByText(/Their records and unit assignments/).waitFor()
  await dialog().getByRole('button', { name: 'Deactivate account', exact: true }).click()
  await dialog().waitFor({ state: 'detached' }); assert.deepEqual(state.mutations[0], { method: 'PATCH', body: { isActive: false } })
  await page.setViewportSize({ width: 390, height: 844 }); reset('unpaid'); state.billCount = 12; state.sameUnit = true; await load(); await open('Deactivate')
  await dialog().getByText(balanceWarning, { exact: true }).waitFor(); await disabled('Deactivate account')
  assert.equal(await dialog().getByRole('list', { name: 'Units with unpaid bills' }).getByRole('listitem').count(), 1)
  let bounds = await dialog().boundingBox(); assert.ok(bounds.height < 600, 'Repeated bills for one unit should keep the dialog compact'); assert.ok(bounds.x >= 0 && bounds.x+bounds.width <= 391 && bounds.y >= 0 && bounds.y+bounds.height <= 845)
  const confirm = dialog().getByRole('button', { name: 'Deactivate account', exact: true }); await confirm.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/deactivate-unpaid-mobile.png` })
  await page.keyboard.press('Escape'); reset('assigned'); await open('Delete'); await dialog().getByText(assignmentMessage, { exact: true }).waitFor()
  bounds = await dialog().boundingBox(); assert.ok(bounds.width <= 390 && bounds.height <= 844)
  await page.screenshot({ path: `${output}/delete-assigned-mobile.png` })
  await page.keyboard.press('Tab'); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  console.log('PASS paid deactivation, mobile dialogs, deduplicated unit lists and keyboard navigation')
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log('All mocked browser account-action checks passed. No real APIs were mutated.')
} finally { await browser.close() }
