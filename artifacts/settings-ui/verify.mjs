import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const user = { id: 1, role: 'ADMIN', fullName: 'Airon Magpayo', email: 'admin@gmail.com' };
const context = await browser.newContext();
await context.addInitScript(user => {
  localStorage.setItem('condo_token', 'settings-ui-preview');
  localStorage.setItem('condo_user', JSON.stringify(user));
  localStorage.setItem('rsg_sidebar_collapsed', 'false');
}, user);
await context.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  let body = { notifications: [], unreadCount: 0 };
  if (path === '/api/auth/me') body = { user };
  if (path === '/api/account/email-change') body = { challengeId: 'preview', email: 'new@example.com', retryAfterSeconds: 60 };
  await route.fulfill({ json: body });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
for (const width of [1364, 1024, 768, 390, 320]) {
  await page.setViewportSize({width, height: 900});
  await page.goto('http://localhost:5173/settings#account-profile');
  await page.getByRole('heading', {name:'Account settings', exact:true}).waitFor();
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    cards: [...document.querySelectorAll('.settings-panel')].map(e => {
      const b = e.getBoundingClientRect();
      return {title:e.querySelector('h2').textContent, x:b.x, y:b.y, width:b.width};
    }),
  }));
  assert(layout.scroll <= layout.viewport, 'Horizontal overflow at ' + width + ': ' + JSON.stringify(layout));
  if (width >= 1280) {
    assert(layout.cards[0].x === layout.cards[1].x, 'Profile and password should share a column');
    assert(layout.cards[2].x > layout.cards[0].x, 'Email should use the right column');
  }
  await page.screenshot({path: 'artifacts/settings-ui/settings-' + width + '.png', fullPage:true});
  console.log(JSON.stringify({width, ...layout}));
}
await page.setViewportSize({width:1364,height:900});
await page.goto('http://localhost:5173/settings');
await page.getByRole('heading', {name:'Account settings', exact:true}).waitFor();
await page.getByRole('button', {name:'Show current password',exact:true}).first().click();
assert.equal(await page.getByLabel('Current password', {exact:true}).first().getAttribute('type'),'text');
await page.getByRole('checkbox', {name:'Use compact sidebar'}).check();
assert.equal(await page.evaluate(() => localStorage.getItem('rsg_sidebar_collapsed')), 'true');
const emailPanel = page.locator('.settings-panel').filter({has:page.getByRole('heading',{name:'Email address',exact:true})});
await emailPanel.getByLabel('New email address').fill('new@example.com');
await emailPanel.getByLabel('Current password',{exact:true}).fill('preview-password');
await emailPanel.getByRole('button',{name:'Send verification code',exact:true}).click();
await emailPanel.getByRole('group',{name:'Verification code'}).waitFor();
await page.setViewportSize({width:320,height:900});
assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'OTP overflows on mobile');
await page.screenshot({path:'artifacts/settings-ui/settings-mobile-verification.png',fullPage:true});
await emailPanel.getByRole('button',{name:'Cancel change',exact:true}).click();
await emailPanel.getByLabel('New email address').waitFor();
assert.deepEqual(errors, []);
console.log('Password visibility, sidebar preference, verification state, cancel action, and browser errors: PASS');
await browser.close();
