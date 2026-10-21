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
  assert.equal(await panel.locator('.recharts-wrapper').count(),1);
  assert.equal(await panel.evaluate(element=>element.nextElementSibling.querySelector('h2').textContent),'Prescriptive Recommendations');
  const desktopHeight=(await panel.boundingBox()).height;
  assert(desktopHeight<480,'Desktop section should be compact: '+desktopHeight);
  await panel.screenshot({path:'artifacts/unit-water-analytics/compact-desktop.png'});
  await panel.getByRole('button',{name:'Select unit',exact:true}).click();
  const list=panel.getByRole('listbox',{name:'Units',exact:true});
  assert.equal(await list.getByRole('option').count(),142);
  assert((await list.boundingBox()).height<=192,'Unit menu must have a fixed maximum height');
  await panel.screenshot({path:'artifacts/unit-water-analytics/compact-menu.png'});
  await panel.getByRole('combobox',{name:'Search units',exact:true}).fill('not-a-unit');
  await panel.getByText('No matching units.',{exact:true}).waitFor();
  await panel.getByRole('combobox',{name:'Search units',exact:true}).fill('236');
  await panel.getByRole('combobox',{name:'Search units',exact:true}).press('Enter');
  await panel.getByText('₱391.00',{exact:true}).waitFor();
  await panel.getByRole('tab',{name:'Consumption',exact:true}).click();
  await panel.getByText('17 m³',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('tab',{name:'Consumption',exact:true}).getAttribute('aria-selected'),'true');
  await panel.getByRole('combobox',{name:'Unit chart history',exact:true}).selectOption('3');
  assert((await panel.locator('.recharts-wrapper').textContent()).includes('Aug 2026'));
  assert(!(await panel.locator('.recharts-wrapper').textContent()).includes('Jan 2026'));
  await panel.getByRole('tab',{name:'Consumption',exact:true}).press('ArrowLeft');
  await panel.getByText('₱391.00',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('tab',{name:'Water bill',exact:true}).getAttribute('aria-selected'),'true');
  async function selectUnit(number) {
    await panel.getByRole('button',{name:'Select unit',exact:true}).click();
    await panel.getByRole('combobox',{name:'Search units',exact:true}).fill(number);
    await panel.getByRole('option',{name:new RegExp('Unit '+number+' ')}).click();
  }
  await selectUnit('312');
  await panel.getByText('No valid water history is available for this unit yet.',{exact:true}).waitFor();
  await selectUnit('404');
  await panel.getByRole('button',{name:'Retry unit analytics',exact:true}).waitFor();
  unitFailure=false;await panel.getByRole('button',{name:'Retry unit analytics',exact:true}).click();
  await panel.getByText('₱322.00',{exact:true}).waitFor();
  await selectUnit('236');
  await panel.getByText('₱391.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh forecasts',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Refresh Forecasts',exact:true}).click();
  await panel.getByText('₱690.00',{exact:true}).waitFor();
  for(const width of [1366,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(100);
    if (!(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth))) { await panel.screenshot({path:'artifacts/unit-water-analytics/overflow-'+width+'.png'}); console.log(await panel.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,children:[...element.querySelectorAll('*')].filter(child=>child.getBoundingClientRect().right>element.getBoundingClientRect().right+1).slice(0,8).map(child=>({tag:child.tagName,classes:child.getAttribute('class'),width:child.getBoundingClientRect().width,text:child.textContent?.slice(0,60)}))}))); }
    assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth),'Panel overflow at '+width);
    const height=(await panel.boundingBox()).height;
    assert(height<(width>=1000?480:650),'Panel should remain compact: '+width+' / '+height);
    await panel.screenshot({path:`artifacts/unit-water-analytics/compact-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',desktopHeight,checks:'one compact chart, tab and keyboard navigation, 142-unit searchable bounded menu, correct placement, range, empty/error states, forecast refresh, 390px/320px layouts'}));
} finally {await browser.close();}
