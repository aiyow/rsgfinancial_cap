import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const units=[{id:1,unitNumber:'231',floor:'2'},{id:2,unitNumber:'521',floor:'5'}];
const history=id=>Array.from({length:9},(_,i)=>({periodStart:`2026-${String(i+1).padStart(2,'0')}-01`,
  consumption:id===1?i+5:i+10,waterCharge:(id===1?i+5:i+10)*23,validationStatus:'VALID'}));
const overview={metrics:{evaluatedCount:1,excludedCount:1,mae:1,rmse:1,wape:10,accuracy:90},
  evaluationMonth:'2026-09-01',evaluationHistory:[],flaggedReadings:[],
  latestForecast:{forecastForMonth:'2026-10-01',total:2,ready:2,excluded:0},
  chartSeries:history(1).map(row=>({month:row.periodStart,actualConsumption:row.consumption,actualWaterBill:row.waterCharge})),
  diagnostics:[{unitId:1,unitNumber:'231',forecastForMonth:'2026-09-01',status:'READY',actualValidationStatus:'VALID',
    predictedConsumption:10,actualConsumption:11,absoluteError:1,modelName:'LINEAR_REGRESSION',reason:'No qualifying recent spike or unexpected zero.'}]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
const snapshots=[];
try {
  for(const role of ['ADMIN','COLLECTOR']) {
    let refreshed=false;
    const requests=[];
    const context=await browser.newContext({viewport:{width:1366,height:900}});
    const user={id:1,role,fullName:'Analytics Preview',email:'preview@example.invalid'};
    await context.addInitScript(user=>{localStorage.setItem('condo_token','parity-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
    await context.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      requests.push(path);
      let json={};
      if(path==='/api/auth/me')json={user};
      if(path==='/api/notifications')json={notifications:[],unreadCount:0};
      if(path==='/api/prescriptive-recommendations')json={recommendations:[]};
      if(path==='/api/analytics/overview')json=overview;
      if(path==='/api/units')json={units};
      if(path==='/api/analytics/refresh-forecasts'){refreshed=true;json={message:'Refreshed'};}
      if(path.startsWith('/api/analytics/units/')) {
        const id=Number(path.split('/').at(-1));
        json={unit:units.find(unit=>unit.id===id),history:history(id),forecasts:[{forecastForMonth:'2026-10-01',
          status:'READY',predictedConsumption:refreshed?30:12,estimatedWaterCharge:refreshed?690:276}]};
      }
      await route.fulfill({json});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://localhost:5173/${role==='ADMIN'?'admin':'collector'}/analytics`);
    const panel=page.locator('#unit-water-analytics');
    await panel.getByText('₱299.00',{exact:true}).waitFor();
    assert.equal(await panel.locator('.recharts-wrapper').count(),1);
    assert.equal(await panel.evaluate(element=>element.nextElementSibling.querySelector('h2').textContent),'Prescriptive Recommendations');
    await panel.getByRole('button',{name:'Select unit',exact:true}).click();
    await panel.getByRole('combobox',{name:'Search units',exact:true}).fill('521');
    await panel.getByRole('combobox',{name:'Search units',exact:true}).press('Enter');
    await panel.getByText('₱414.00',{exact:true}).waitFor();
    await panel.getByRole('tab',{name:'Consumption',exact:true}).click();
    await panel.getByText('18 m³',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Unit chart history',exact:true}).click();
    await panel.getByRole('option',{name:'All history',exact:true}).click();
    assert((await panel.locator('.recharts-wrapper').textContent()).includes('Jan 2026'));
    await panel.getByRole('tab',{name:'Consumption',exact:true}).press('ArrowLeft');
    await panel.getByText('₱414.00',{exact:true}).waitFor();
    // Only mocked requests are used for refresh, so this browser check never alters saved data.
    await page.getByRole('button',{name:'Refresh forecasts',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Refresh Forecasts',exact:true}).click();
    await panel.getByText('₱690.00',{exact:true}).waitFor();
    await page.mouse.move(0,0);
    snapshots.push({role,headings:await page.locator('main h2').allTextContents(),panel:await panel.innerText()});
    assert(requests.includes('/api/units')&&requests.includes('/api/analytics/units/1')&&requests.includes('/api/analytics/units/2'));
    for(const width of [1366,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,{},{timeout:10000}).catch(async error=>{
        console.log(JSON.stringify({role,width,overflow:await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,
          elements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+2&&el.getBoundingClientRect().width>0).slice(0,12).map(el=>({tag:el.tagName,classes:el.getAttribute('class'),text:el.textContent.slice(0,100),width:el.getBoundingClientRect().width}))}))}));
        await page.screenshot({path:`artifacts/staff-analytics-parity/overflow-${role.toLowerCase()}-${width}.png`});throw error;
      });
      assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth));
      await panel.screenshot({path:`artifacts/staff-analytics-parity/${role.toLowerCase()}-${width}.png`});
    }
    await context.close();
  }
  assert.deepEqual(snapshots[0].headings,snapshots[1].headings);
  assert.equal(snapshots[0].panel,snapshots[1].panel);
  assert.deepEqual(errors,[]);
  const report={verifiedAt:new Date().toISOString(),roles:['ADMIN','COLLECTOR'],matchingSectionOrder:true,
    matchingPerUnitPanel:true,unitSelection:true,billAndConsumptionTabs:true,historyFilter:true,
    refreshUpdatesUnitChart:true,viewportWidths:[1366,390,320],browserErrors:errors};
  await writeFile('artifacts/staff-analytics-parity/result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
