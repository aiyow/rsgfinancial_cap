import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const user = {id:1,role:'ADMIN',fullName:'Test Admin',email:'admin@example.invalid'};
  const units = [{id:1,unitNumber:'101',floor:'1'},{id:2,unitNumber:'236',floor:'2'},{id:3,unitNumber:'312',floor:'3'},{id:4,unitNumber:'404',floor:'4'}];
  units.push(...Array.from({length:138},(_,index)=>({id:index+5,unitNumber:String(index+500),floor:String(Math.floor(index/40)+1)})));
  const overview = {metrics:{},evaluationHistory:[],diagnostics:[],flaggedReadings:[],chartSeries:[],latestForecast:{total:4,ready:2,excluded:2,forecastForMonth:'2026-11-01'}};
  let emptyUnits = false, listFailures = 0, unitFailure = true, refreshed = false, slowFirst = false;
  const requests = [];
  const history = id => Array.from({length:10},(_,index)=>({unitId:id,periodStart:`2026-${String(index+1).padStart(2,'0')}-01`,billingPeriodId:index+1,consumption:(id===2?8:5)+index,waterCharge:((id===2?8:5)+index)*23,validationStatus:index===4&&id===1?'FLAGGED':'VALID'}));
  const context = await browser.newContext();
  await context.addInitScript(user=>{localStorage.setItem('condo_token','unit-water-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
  await context.route('**/api/**',async route=>{
    const path = new URL(route.request().url()).pathname;
    let json={};
    if(path==='/api/auth/me') json={user};
    if(path==='/api/notifications') json={notifications:[],unreadCount:0};
    if(path==='/api/prescriptive-recommendations') json={recommendations:[]};
    if(path==='/api/analytics/overview') json=overview;
    if(path==='/api/analytics/refresh-forecasts') {refreshed=true;json={message:'Refreshed'};}
    if(path==='/api/units') {
      if(listFailures>0) {await route.fulfill({status:503,json:{message:'Temporary unit list failure'}});return;}
      json={units:emptyUnits?[]:units};
    }
    if(path.startsWith('/api/analytics/units/')) {
      const id=Number(path.split('/').at(-1));requests.push(id);
      if(id===1&&slowFirst) await new Promise(resolve=>setTimeout(resolve,300));
      if(id===4&&unitFailure) {await route.fulfill({status:503,json:{message:'Temporary unit failure'}});return;}
      json={unit:units.find(unit=>unit.id===id),history:id===3?[]:history(id),forecasts:id===3?[]:[{forecastForMonth:'2026-11-01',status:'READY',predictedConsumption:refreshed?30:12,estimatedWaterCharge:refreshed?690:276}]};
    }
    await route.fulfill({json});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1366,height:900});
  await page.goto('http://localhost:5173/admin/analytics');
  const panel=page.locator('#unit-water-analytics');
  await panel.getByText('₱322.00',{exact:true}).waitFor();
  const trigger=panel.getByRole('button',{name:'Unit chart history',exact:true});
  const menu=panel.getByRole('listbox',{name:'Chart history range',exact:true});
  await trigger.click();
  assert.equal(await menu.getByRole('option').count(),4);
  assert.equal(await menu.getByRole('option',{name:'Last 6 months',exact:true}).getAttribute('aria-selected'),'true');
  await panel.screenshot({path:'artifacts/unit-water-analytics/month-menu-desktop.png'});
  await menu.getByRole('option',{name:'Last 3 months',exact:true}).click();
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  assert((await trigger.textContent()).includes('Last 3 months'));
  assert((await panel.locator('.recharts-wrapper').textContent()).includes('Aug 2026'));
  assert(!(await panel.locator('.recharts-wrapper').textContent()).includes('Jan 2026'));
  await trigger.press('ArrowDown');
  await menu.waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Last 3 months');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'All history');
  await page.keyboard.press('Enter');
  assert((await trigger.textContent()).includes('All history'));
  assert((await panel.locator('.recharts-wrapper').textContent()).includes('Jan 2026'));
  await trigger.click();await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  assert(await trigger.evaluate(element=>element===document.activeElement));
  await trigger.click();await panel.getByRole('heading',{name:'Per-unit water analytics',exact:true}).click();
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await trigger.click();await panel.getByRole('button',{name:'Select unit',exact:true}).click();
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await panel.getByRole('combobox',{name:'Search units',exact:true}).press('Escape');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:900});
    await trigger.click();await menu.waitFor();
    const outer=await panel.boundingBox(), bounds=await menu.boundingBox();
    assert(bounds.x>=outer.x&&bounds.x+bounds.width<=outer.x+outer.width,'Menu stays within panel at '+width);
    assert(bounds.height<200,'Menu remains compact');
    assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth),'No horizontal overflow');
    await panel.screenshot({path:`artifacts/unit-water-analytics/month-menu-${width}.png`});
    await menu.getByRole('option',{name:'Last 12 months',exact:true}).click();
    assert((await trigger.textContent()).includes('Last 12 months'));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: styled month menu, selected state, chart filtering, keyboard arrows/Home/End/Enter/Escape, outside dismissal, one menu at a time, and mobile bounds.');
} finally {await browser.close();}
