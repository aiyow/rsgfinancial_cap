import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const user = {id:1,role:'ADMIN',fullName:'Test Admin',email:'admin@example.invalid'};
  const payment = {id:158,unitNumber:'236',entryType:'MANUAL',reviewStatus:'APPROVED',paymentPurpose:'WATER',
    residentName:'Test Resident',submittedByName:'Test Admin',submittedAt:'2026-10-17T00:30:27Z',
    reviewedAt:'2026-10-17T10:46:27Z',ocrPaymentDate:'2026-10-16',dueDate:'2026-10-31',
    verifiedPaymentDate:'2026-10-17',paymentMethod:'CASH',verifiedAmount:100,allocations:[]};
  const context = await browser.newContext({timezoneId:'America/Los_Angeles',locale:'en-US'});
  await context.addInitScript(user=>{
    localStorage.setItem('condo_token','payment-date-preview');
    localStorage.setItem('condo_user',JSON.stringify(user));
  },user);
  await context.route('**/api/**',async route=>{
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({json:path === '/api/auth/me' ? {user} : path === '/api/payments/158' ? {payment} : {notifications:[],unreadCount:0}});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(15000);
  for(const width of [1366,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://localhost:5173/admin/payments/158');
    await page.getByRole('heading',{name:'Manual payment for Unit 236',exact:true}).waitFor();
    assert.match(await page.locator('main').innerText(), /Recorded by Test Admin on October 17, 2026 at 8:30 AM/);
    for(const [label,date] of [
      ['Reviewed at','October 17, 2026 at 6:46 PM'],
      ['OCR payment date','October 16, 2026'],
      ['Resident due date','October 31, 2026'],
      ['Verified payment date','October 17, 2026'],
    ]) {
      const fact = page.getByText(label,{exact:true}).locator('..');
      assert((await fact.innerText()).includes(date),label+' should display '+date);
      assert(await fact.evaluate(e=>e.scrollWidth<=e.clientWidth),label+' should wrap within its card');
    }
    await page.screenshot({path:'artifacts/payment-dates/payment-'+width+'.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: all five payment dates render readably at desktop and mobile widths, in Manila time even with a different browser timezone.');
} finally { await browser.close(); }
