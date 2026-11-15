// Mock all APIs so staff dashboard regressions never touch live data.
import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const role of ['ADMIN', 'COLLECTOR']) {
    for (const failOverview of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const user = { id: 1, role, fullName: 'Dashboard Tester', isActive: true, approvalStatus: 'APPROVED' }
        await context.addInitScript(user => {
          localStorage.setItem('condo_token', 'mock-only')
          localStorage.setItem('condo_user', JSON.stringify(user))
        }, user)
        let releaseOverview
        const overviewReady = new Promise(resolve => { releaseOverview = resolve })
        await context.route('**/api/**', async route => {
          assert.equal(route.request().method(), 'GET')
          const path = new URL(route.request().url()).pathname
          if (path === '/api/dashboard/overview' || path === '/api/analytics/overview') {
            await overviewReady
            if (failOverview && path === '/api/dashboard/overview') {
              await route.fulfill({ status: 503, json: { message: 'Dashboard temporarily unavailable' } })
              return
            }
          }
          const data = path === '/api/auth/me' ? { user }
            : path === '/api/dashboard/overview' ? { metrics: {}, monthly: [], billStatus: [] }
              : path === '/api/analytics/overview' ? { chartSeries: [], latestForecast: { ready: 2, total: 3, excluded: 1 } }
                : { notifications: [], unreadCount: 0 }
          await route.fulfill({ json: data })
        })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(`${base}${role === 'ADMIN' ? '/admin' : '/collector'}`)
        try {
          await page.getByRole('heading', { name: 'Loading dashboard', exact: true }).waitFor()
          assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).isVisible(), true)
          assert.deepEqual(errors, [], 'Initial render must work before overview data arrives')
        } finally {
          releaseOverview()
        }
        if (failOverview) {
          await page.getByText('Dashboard temporarily unavailable', { exact: true }).waitFor()
          assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).isVisible(), true)
        } else {
          await page.getByRole('heading', { name: 'Water outlook', exact: true }).waitFor()
          await page.getByText('2 of 3 homes have a ready forecast; 1 need more valid meter history.', { exact: true }).waitFor()
          assert.equal(await page.getByRole('heading', { name: 'Loading dashboard', exact: true }).count(), 0)
        }
        assert.deepEqual(errors, [])
        console.log(`${role}: loading → ${failOverview ? 'API error' : 'loaded dashboard'} passed`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}
