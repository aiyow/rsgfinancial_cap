import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const user = {id:1,role:'ADMIN',fullName:'Test Admin',email:'admin@example.invalid'};
  const units = [{id:1,unitNumber:'101',floor:'1'},{id:2,unitNumber:'236',floor:'2'},{id:3,unitNumber:'312',floor:'3'},{id:4,unitNumber:'404',floor:'4'}];
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
  await page.setViewportSize({width:1440,height:1050});
  await page.goto('http://localhost:5173/admin/analytics');
  const panel=page.locator('#unit-water-analytics');
  await panel.getByRole('heading',{name:'Unit 101',exact:true}).waitFor();
  await panel.getByText('14 m³',{exact:true}).waitFor();
  assert.equal(await panel.locator('.recharts-wrapper').count(),2);
  assert(await panel.locator('.recharts-bar-rectangle').count()>0);
  await panel.screenshot({path:'artifacts/unit-water-analytics/admin-desktop.png'});
  await panel.getByRole('combobox',{name:'Unit chart history',exact:true}).selectOption('3');
  assert((await panel.locator('.recharts-wrapper').first().textContent()).includes('Aug 2026'));
  assert(!(await panel.locator('.recharts-wrapper').first().textContent()).includes('Jan 2026'));
  await panel.getByRole('combobox',{name:'Select unit',exact:true}).selectOption('2');
  await panel.getByRole('heading',{name:'Unit 236',exact:true}).waitFor();
  await panel.getByText('17 m³',{exact:true}).waitFor();
  await panel.getByText('₱391.00',{exact:true}).waitFor();
  await panel.getByRole('combobox',{name:'Select unit',exact:true}).selectOption('3');
  await panel.getByRole('heading',{name:'Unit 312',exact:true}).waitFor();
  assert.equal(await panel.getByText('No valid water history is available for this unit yet.',{exact:true}).count(),2);
  await panel.getByRole('combobox',{name:'Select unit',exact:true}).selectOption('4');
  await panel.getByRole('button',{name:'Retry unit analytics',exact:true}).waitFor();
  unitFailure=false;
  await panel.getByRole('button',{name:'Retry unit analytics',exact:true}).click();
  await panel.getByRole('heading',{name:'Unit 404',exact:true}).waitFor();
  slowFirst=true;
  await panel.getByRole('combobox',{name:'Select unit',exact:true}).selectOption('1');
  await panel.getByRole('combobox',{name:'Select unit',exact:true}).selectOption('2');
  await panel.getByRole('heading',{name:'Unit 236',exact:true}).waitFor();
  await page.waitForTimeout(350);
  assert.equal(await panel.getByRole('heading',{name:'Unit 101',exact:true}).count(),0);
  const beforeRefresh=requests.length;
  await page.getByRole('button',{name:'Refresh forecasts',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Refresh Forecasts',exact:true}).click();
  await panel.getByText('₱690.00',{exact:true}).waitFor();
  assert(requests.length>beforeRefresh);
  for(const width of [1366,390,320]) {
    await page.setViewportSize({width,height:900});
    await panel.getByRole('heading',{name:'Unit 236',exact:true}).waitFor();
    await page.waitForTimeout(100);
    assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth),'Panel overflows at '+width);
    for(const chart of await panel.locator('.recharts-wrapper').all()) assert(await chart.evaluate(e=>e.getBoundingClientRect().width>0),'Chart must have visible width');
    await panel.screenshot({path:`artifacts/unit-water-analytics/admin-${width}.png`});
  }
  listFailures=1;await page.reload();
  await panel.getByRole('button',{name:'Retry loading units',exact:true}).waitFor();
  listFailures=0;
  await panel.getByRole('button',{name:'Retry loading units',exact:true}).click();
  await panel.getByRole('heading',{name:'Unit 101',exact:true}).waitFor();
  emptyUnits=true;await page.reload();
  await panel.getByText('No units are available yet. Add a unit in Unit Management to get started.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: two populated charts, unit switching, calendar range, empty states, retries, stale-request protection, forecast refresh, and desktop/390px/320px layouts.');
} finally {await browser.close();}

