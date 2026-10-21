import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const user={id:1,role:'COLLECTOR',fullName:'Test Associate',email:'collector@example.invalid'};
 let releasePeriods,releaseBills,failBills=false,empty=false;
 const periodGate=new Promise(resolve=>{releasePeriods=resolve;});
 const billGate=new Promise(resolve=>{releaseBills=resolve;});
 const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.addInitScript(user=>{localStorage.setItem('condo_token','batch-loading-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let json={};
  if(path==='/api/auth/me') json={user};
  if(path==='/api/notifications') json={notifications:[],unreadCount:0};
  if(path==='/api/billing-periods') {await periodGate;json={periods:empty?[]:[{id:1,periodStart:'2026-09-05',periodEnd:'2026-10-05',dueDate:'2026-10-21',waterRatePerCubicM:23,associationDuesRatePerSqm:134.07,status:'GENERATED'}]};}
  if(path==='/api/bills') {
   await billGate;
   if(failBills) {await route.fulfill({status:503,json:{message:'Temporary connection failure.'}});return;}
   json={bills:empty?[]:Array.from({length:142},(_,index)=>({id:index+1,billingPeriodId:1}))};
  }
  await route.fulfill({json});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/collector/bills');
 const loading=page.getByRole('status',{name:'Loading billing batches',exact:true});
 await loading.waitFor();
 assert.equal(await page.getByText('No billing batches found.',{exact:true}).count(),0);
 assert.equal(await page.getByRole('link',{name:'View batch',exact:true}).count(),0);
 assert.equal(await loading.locator('.animate-pulse').evaluate(e=>getComputedStyle(e).animationName),'pulse');
 await loading.screenshot({path:'artifacts/billing-batch-loading/loading-desktop.png'});
 await page.setViewportSize({width:390,height:900});
 assert(await loading.evaluate(e=>e.getBoundingClientRect().right<=document.documentElement.clientWidth),'Skeleton must fit on mobile');
 await loading.screenshot({path:'artifacts/billing-batch-loading/loading-mobile.png'});
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await loading.locator('.animate-pulse').evaluate(e=>getComputedStyle(e).animationName),'none');
 releasePeriods();await page.waitForTimeout(100);
 assert(await loading.isVisible(),'Loading must remain until SOA counts are available');
 releaseBills();
 await page.getByRole('link',{name:'View batch',exact:true}).waitFor();
 await loading.waitFor({state:'hidden'});
 await page.getByText(/142 SOAs/).waitFor();
 failBills=true;await page.reload();
 await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
 assert.equal(await page.getByText('No billing batches found.',{exact:true}).count(),0);
 failBills=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.getByRole('link',{name:'View batch',exact:true}).waitFor();
 empty=true;await page.reload();
 await page.getByText('No billing batches found.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: animated skeleton, no premature empty state, waits for both responses, 142 SOA count, mobile layout, reduced motion, error retry, and genuine empty state.');
} finally {await browser.close();}
